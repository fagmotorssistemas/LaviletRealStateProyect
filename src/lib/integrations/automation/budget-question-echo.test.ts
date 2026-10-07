import test from 'node:test'
import assert from 'node:assert/strict'
import { interpretConversationTurn } from './turn-interpretation'
import { reconcileEchoedBudgetQuestion, TurnInterpretationError } from './turn-interpretation-input'
import { object, type Row } from './data'

const question = { id: 'budget_amount', question: '¿Cuál es su presupuesto?' }
const message = 'Todavía no tengo un presupuesto definido'
const raw = (domain = 'property', evidence = question.question): Row => ({
  requests: [{ domain, request: evidence, evidence, confidence: 'high' }],
  turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: message, confidence: 'high',
    budget: { status: 'no_defined_budget', amount: null, evidence: message, confidence: 'high' } },
})

test('a literal echoed bot budget question cannot replace the current answer or force a second extraction', async () => {
  let calls = 0
  const state = { _interpretation_memory: { budget: { amount: 400000 } } }
  const result = await interpretConversationTurn({ mensaje_actual: message, pregunta_pendiente: question, resumen: state },
    { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw() } })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).status, 'no_defined_budget')
  assert.deepEqual(result.requests, [])
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(object(object(state._interpretation_memory).budget).amount, 400000)
  assert.ok((object(result.diagnostic.historical_reconciliation).fields as string[]).includes('requests.0'))
})

for (const [domain, evidence, input] of [
  ['property', '¿Cuánto puede gastar?', { pregunta_pendiente: question }],
  ['advisor', question.question, { pregunta_pendiente: question }],
  ['visit', question.question, { pregunta_pendiente: question }],
  ['property', question.question, { pregunta_pendiente: { ...question, id: 'lead_profile' } }],
] as const) test(`an unproven or operational request quote still requires recovery: ${domain}/${evidence}/${input.pregunta_pendiente.id}`, async () => {
  let calls = 0
  await assert.rejects(interpretConversationTurn({ mensaje_actual: message, ...input },
    { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw(domain, evidence) } }),
    (error: unknown) => error instanceof TurnInterpretationError && error.issues.some(issue => issue.includes('requests.0')))
  assert.equal(calls, 2)
})

test('echo reconciliation cannot hide an invented monetary amount', () => {
  const current = 'Tengo cuatrocientos dólares'
  const result: Row = raw()
  result.turn_semantics = { primary_intent: 'discuss_budget', primary_evidence: current, confidence: 'high',
    budget: { status: 'amount', amount: 400000, evidence: current, confidence: 'high' } }
  assert.deepEqual(reconcileEchoedBudgetQuestion(result, { pregunta_pendiente: question }, current).fields, [])
})

test('a quote appearing in the actual message remains current evidence', () => {
  const current = `Mi presupuesto es de 400 mil. ${question.question}`
  const result: Row = raw()
  result.turn_semantics = { primary_intent: 'discuss_budget', primary_evidence: current, confidence: 'high',
    budget: { status: 'amount', amount: 400000, evidence: 'Mi presupuesto es de 400 mil', confidence: 'high' } }
  assert.deepEqual(reconcileEchoedBudgetQuestion(result, { pregunta_pendiente: question }, current).fields, [])
})

for (const intent of ['ask_price', 'ask_financing', 'answer_previous']) test(`a valid budget answer removes the proven echo independently of the mistaken primary label: ${intent}`, () => {
  const value = raw()
  object(value.turn_semantics).primary_intent = intent
  object(value.turn_semantics).answer_to_previous = { kind: 'negative', question_id: 'budget_amount', evidence: message, confidence: 'high' }
  const result = reconcileEchoedBudgetQuestion(value, { pregunta_pendiente: question }, message)
  assert.deepEqual(result.fields, ['requests.0'])
  assert.deepEqual(result.raw.requests, [])
  assert.equal(object(result.raw.turn_semantics).primary_intent, intent, 'The captured primary label is preserved for canonical diagnostics')
})

test('a separate current price question remains after removing an exact old budget question', () => {
  const current = `${message}. ¿Y qué precio tiene?`
  const value = raw()
  object(value.turn_semantics).primary_evidence = current
  value.requests = [...value.requests as Row[], { domain: 'property', request: 'Precio actual', evidence: '¿Y qué precio tiene?', confidence: 'high' }]
  const result = reconcileEchoedBudgetQuestion(value, { pregunta_pendiente: question }, current)
  assert.deepEqual(result.fields, ['requests.0'])
  assert.equal((result.raw.requests as Row[])[0].evidence, '¿Y qué precio tiene?')
})

test('a mislabeled price intent cannot replace a grounded budget answer when only the old bot question was echoed', async () => {
  const value = raw()
  value.events = ['asked_price']
  object(value.turn_semantics).primary_intent = 'ask_price'
  const result = await interpretConversationTurn({ mensaje_actual: message, pregunta_pendiente: question },
    { activePrompt: async () => 'Extract', aiJson: async () => value })
  assert.equal(result.semantics.primary_intent, 'discuss_budget')
  assert.equal(object(result.semantics.interpretation).extractor_primary_intent, 'ask_price')
  assert.ok(!(result.extracted.events as string[]).includes('asked_price'))
  assert.equal(object(result.semantics.budget).status, 'no_defined_budget')
})

test('declaring a budget does not erase a simultaneous real price question', async () => {
  const current = `${message}. ¿Y qué precio tiene?`
  const value = raw()
  value.events = ['asked_price']
  object(value.turn_semantics).primary_intent = 'ask_price'
  object(value.turn_semantics).primary_evidence = current
  value.requests = [...value.requests as Row[], { domain: 'property', request: 'Precio actual', evidence: '¿Y qué precio tiene?', confidence: 'high' }]
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: question },
    { activePrompt: async () => 'Extract', aiJson: async () => value })
  assert.equal(result.semantics.primary_intent, 'ask_price')
  assert.equal(result.requests.length, 1)
  assert.equal(result.requests[0].evidence, '¿Y qué precio tiene?')
  assert.ok((result.extracted.events as string[]).includes('asked_price'))
})

/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { resolveTurnIntent, turnIntentIssues } = require('../src/lib/integrations/automation/turn-intent.ts')

const scope = { kind: 'property', uncertain: false }
const request = (value, domain = 'property') => ({ request: value, domain, confidence: 'high' })
const category = (value, unit_numbers = []) => ({ primary_intent: 'select_property', confidence: 'high',
  property: { category: value, unit_numbers, confidence: 'high', filters: {} }, answer_to_previous: { kind: 'value' } })
const previous = { continuation_goal: 'ask_price' }

test('an incomplete price request is a price objective, with a still unresolved property reference', () => {
  const result = resolveTurnIntent({ current: 'Precio', scope, semantics: { primary_intent: 'ask_price', confidence: 'high' }, requests: [request('Consultar precios')] })
  assert.equal(result.objective, 'ask_price')
  assert.deepEqual(result.required_facts, ['price'])
  assert.equal(result.needs_reference, true)
  assert.equal(result.continuation_goal, 'ask_price')
})

test('category and unit clarifications preserve prices without rewriting the lead message', () => {
  for (const [value, current, numbers] of [['suite', 'sobre suites por favor', []], ['departamento', 'El 304', ['304']], ['penthouse', 'el 606', ['606']], ['local', 'LC-02', ['LC-02']]]) {
    const result = resolveTurnIntent({ current, scope, previous, semantics: category(value, numbers), requests: [request(`Elegir ${value}`)] })
    assert.equal(result.objective, 'ask_price', current)
    assert.equal(result.interpretation_source, 'clarification_of_price_request')
    assert.deepEqual(result.subject.unit_numbers, numbers)
    assert.equal(result.current_message, current)
  }
})

test('legacy continuation requires current interpretation and recent lead evidence', () => {
  const input = { current: 'sobre suites', scope, semantics: category('suite'), requests: [request('Consultar el precio de las suites')] }
  assert.equal(resolveTurnIntent({ ...input, history: [{ role: 'cliente', content: 'Precio' }] }).objective, 'ask_price')
  assert.equal(resolveTurnIntent({ ...input, history: [{ role: 'bot', content: 'Los precios son referenciales.' }] }).objective, 'select_property')
  assert.equal(resolveTurnIntent({ ...input, history: [{ role: 'cliente', content: 'Quiero información' }] }).objective, 'select_property')
})

test('explicit new objectives clear a remembered price goal, including financing and appointments', () => {
  for (const [primary_intent, domain, current] of [['request_visit', 'visit', 'Quiero agendar una visita'], ['ask_financing', 'financing', 'Cómo es el financiamiento'], ['project_information', 'property', 'Quiero información del proyecto']]) {
    const result = resolveTurnIntent({ current, scope, previous, semantics: { ...category('suite'), primary_intent }, requests: [request(current, domain)] })
    assert.equal(result.objective, primary_intent)
    assert.deepEqual(result.required_facts, [])
    assert.equal(result.continuation_goal, null)
  }
})

test('name and residence can preserve the pending goal without pretending to request prices again', () => {
  const result = resolveTurnIntent({ current: 'Soy Ana y vivo en Madrid', scope, previous, profilePending: true,
    semantics: { primary_intent: 'answer_previous' }, requests: [] })
  assert.equal(result.objective, 'answer_previous')
  assert.equal(result.continuation_goal, 'ask_price')
  assert.deepEqual(result.required_facts, [])
})

test('a remembered category in an answer to a different pending question does not request a price', () => {
  const result = resolveTurnIntent({ current: 'Soy Ana', scope, previous, profilePending: true,
    pendingQuestion: { id: 'lead_profile' },
    semantics: { ...category('suite'), primary_intent: 'answer_previous', answer_to_previous: { kind: 'value', question_id: 'lead_profile' } }, requests: [] })
  assert.equal(result.objective, 'answer_previous')
  assert.deepEqual(result.required_facts, [])
  assert.equal(result.continuation_goal, 'ask_price')
})

test('a matched pending property question refines a price objective with its filters', () => {
  const result = resolveTurnIntent({ current: 'En la segunda planta', scope, previous,
    pendingQuestion: { id: 'property_floor' },
    semantics: { ...category('suite'), primary_intent: 'answer_previous',
      property: { category: 'suite', confidence: 'high', filters: { floor_number: 2 } },
      answer_to_previous: { kind: 'value', question_id: 'property_floor' } }, requests: [request('Elegir planta')] })
  assert.equal(result.objective, 'ask_price')
  assert.deepEqual(result.subject.filters, { floor_number: 2 })
})

test('foreign scope and uncertain interpretations cannot be overridden by a stale price goal', () => {
  for (const decision of [{ kind: 'out_of_scope', uncertain: false }, { kind: 'neutral', uncertain: true }]) {
    const result = resolveTurnIntent({ current: 'Precio', scope: decision, previous, semantics: { primary_intent: 'ask_price' }, requests: [request('Consultar precio')] })
    assert.notEqual(result.objective, 'ask_price')
    assert.deepEqual(result.required_facts, [])
    assert.equal(result.continuation_goal, null)
  }
})

test('neutral scope is reconciled only with confident property interpretation', () => {
  const input = { current: 'Precio', scope: { kind: 'neutral', uncertain: false }, semantics: { primary_intent: 'ask_price', confidence: 'high' }, requests: [request('Precio')] }
  assert.equal(resolveTurnIntent(input).scope.kind, 'property')
  assert.equal(resolveTurnIntent({ ...input, semantics: { ...input.semantics, confidence: 'low' } }).scope.kind, 'neutral')
})

test('multiple requests keep price as required content without replacing a separate primary action', () => {
  const result = resolveTurnIntent({ current: 'El viernes, y el valor de la suite', scope,
    semantics: { primary_intent: 'request_visit' }, requests: [request('Solicitar visita', 'visit'), request('Consultar precio de suite')] })
  assert.ok(result.required_facts.includes('price'))
  assert.match(result.action_policy, /separately validated current consent/)
})

test('price omissions are checked against available verified values, never invented when absent', () => {
  const contract = { required_facts: ['price'] }
  assert.deepEqual(turnIntentIssues('Tenemos suites de 60 m².', contract, 'Desde $100.000 USD.'), ['turn_price_unanswered'])
  for (const reply of ['Desde $100.000.', 'Desde USD 100.000.', 'Desde 100.000 dólares.']) {
    assert.deepEqual(turnIntentIssues(reply, contract, 'Desde USD 100.000.'), [])
  }
  assert.deepEqual(turnIntentIssues('Necesito conocer la unidad.', contract, 'No hay precios publicados.'), [])
  assert.deepEqual(turnIntentIssues('Tenemos suites.', {}, 'Desde $100.000 USD.'), [])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { resolveTurnIntent, rememberTurnIntentAfterReply } from './turn-intent'
import { responseContentScope } from './response-content-scope'

const scope = { kind: 'property', uncertain: false }
const request = (evidence: string, topics: string[], extra: Row = {}): Row => ({ domain: 'property', request: evidence,
  evidence, topics, confidence: 'high', source: 'current', ...extra })
const semantics = (current: string, intent = 'select_property', extra: Row = {}): Row => ({
  primary_intent: intent, primary_evidence: current, confidence: 'high',
  property: { category: 'penthouse', unit_numbers: [], filters: {}, confidence: 'high' }, ...extra })
const pendingPrice = { continuation_goal: 'ask_price', price_request_status: 'pending' }
const answeredPrice = { continuation_goal: null, price_request_status: 'answered' }
const priceIntent = (current = '¿Cuánto cuesta el 602?', requests: Row[] = [request(current, ['purchase_price'])]): Row => ({
  version: 'turn-intent-v2', objective: 'ask_price', current_message: current, price_request_status: 'pending',
  continuation_goal: 'ask_price', required_facts: ['price'], requests })
const review = (fragment: string, status = 'answered', changes: Row = {}): Row => ({ status: 'checked',
  final_validation: { passed: true, validated_text: 'El valor referencial es USD 550000 y puede cambiar.' },
  recovery: { pending: false }, requests: [{ fragment, status, intent: 'ask_price', fact_key: 'price' }], ...changes })
const finish = (intent: Row, audit: Row, changes: Partial<{ accepted: boolean; recovery: boolean }> = {}): Row => {
  const before = structuredClone({ intent, audit })
  const saved = rememberTurnIntentAfterReply(intent, audit, { accepted: true, recovery: false, ...changes })
  assert.deepEqual({ intent, audit }, before)
  return saved
}

test('an answered price request cannot survive subsequent typed purpose, bedrooms or category choices', () => {
  for (const current of ['Vivienda', 'Tres dormitorios', 'Penthouse']) {
    const intent = resolveTurnIntent({ current, scope, previous: answeredPrice,
      pendingQuestion: { id: 'property_category', act: 'choose_category' },
      semantics: semantics(current, 'answer_previous', { answer_to_previous: {
        question_id: 'property_category', kind: 'value', confidence: 'high', evidence: current } }),
      requests: [request(current, ['property_options'])] })
    assert.equal(intent.objective, 'answer_previous')
    assert.deepEqual(intent.required_facts, [])
    assert.equal(intent.price_request_status, 'answered')
    assert.equal(intent.continuation_goal, null)
    const content = responseContentScope(current, { contrato_turno: intent, semantica_turno: {
      primary_intent: 'ask_price', confidence: 'high', interpretation: intent.interpretation }, catalogo: [] })
    assert.equal(object(object(content.topics).purchase_prices).allowed, false)
  }
})

test('a pending price question survives a grounded answer to its actual property-reference question', () => {
  const current = 'Penthouse', intent = resolveTurnIntent({ current, scope, previous: pendingPrice,
    pendingQuestion: { id: 'property_category', act: 'choose_category' },
    semantics: semantics(current, 'answer_previous', { answer_to_previous: {
      question_id: 'property_category', kind: 'value', confidence: 'high', evidence: current } }),
    requests: [request(current, ['property_options'])] })
  assert.equal(intent.objective, 'ask_price')
  assert.equal(intent.interpretation_source, 'clarification_of_price_request')
  assert.deepEqual(intent.required_facts, ['price'])
  assert.equal(intent.price_request_status, 'pending')
  const content = responseContentScope(current, { contrato_turno: intent })
  assert.equal(object(object(content.topics).purchase_prices).allowed, true)
})

test('a category answering another commercial decision does not reopen a pending price question', () => {
  const current = 'Penthouse', intent = resolveTurnIntent({ current, scope, previous: pendingPrice,
    pendingQuestion: { id: 'property_category', act: 'explore_quoted_options' },
    semantics: semantics(current, 'answer_previous', { answer_to_previous: {
      question_id: 'property_category', kind: 'value', confidence: 'high', evidence: current } }),
    requests: [request(current, ['property_options'])] })
  assert.equal(intent.objective, 'answer_previous')
  assert.deepEqual(intent.required_facts, [])
})

for (const answer of [
  { question_id: 'property_category', kind: 'value', confidence: 'low', evidence: 'Penthouse' },
  { question_id: 'property_category', kind: 'value', confidence: 'high', evidence: 'Departamento' },
  { question_id: 'budget_amount', kind: 'value', confidence: 'high', evidence: 'Penthouse' },
]) test('typed reference inheritance requires a current reliable answer: ' + JSON.stringify(answer), () => {
  const current = 'Penthouse', intent = resolveTurnIntent({ current, scope, previous: pendingPrice,
    pendingQuestion: { id: 'property_category', act: 'choose_category' },
    semantics: semantics(current, 'answer_previous', { answer_to_previous: answer }),
    requests: [request(current, ['property_options'])] })
  assert.notEqual(intent.objective, 'ask_price')
  assert.deepEqual(intent.required_facts, [])
})

test('current typed topics override a stale primary price intent and an untyped duplicate request', () => {
  const current = 'Los precios ya me los dijo, prefiero penthouse'
  const intent = resolveTurnIntent({ current, scope, previous: answeredPrice,
    semantics: semantics(current, 'ask_price'), requests: [request(current, ['property_options']),
      { domain: 'property', request: 'Consultar precios de penthouse', confidence: 'high' }] })
  assert.equal(intent.objective, 'answer_previous')
  assert.deepEqual(intent.required_facts, [])
  assert.equal(intent.price_request_status, 'answered')
  assert.equal(intent.continuation_goal, null)
})

test('ungrounded typed purchase-price evidence cannot manufacture a required fact', () => {
  const current = 'Penthouse', intent = resolveTurnIntent({ current, scope, previous: answeredPrice,
    semantics: semantics(current), requests: [request('¿Cuánto cuesta el penthouse?', ['purchase_price'])] })
  assert.equal(intent.objective, 'select_property')
  assert.deepEqual(intent.required_facts, [])
  assert.equal(intent.price_request_status, 'answered')
})

test('multiple current requests keep a real price question alongside financing without operational permission', () => {
  const current = '¿Cómo se financia? ¿Cuánto cuesta el 602?', input = { current, scope, previous: answeredPrice,
    semantics: semantics(current, 'ask_financing'), requests: [request('¿Cómo se financia?', ['financing'], { domain: 'financing' }),
      request('¿Cuánto cuesta el 602?', ['purchase_price'])] }
  const before = structuredClone(input), intent = resolveTurnIntent(input)
  assert.equal(intent.objective, 'ask_financing')
  assert.deepEqual(intent.required_facts, ['price'])
  assert.equal(intent.price_request_status, 'pending')
  assert.equal(intent.requested_action, null)
  assert.deepEqual(input, before)
})

for (const status of ['checked', 'review_disabled', 'review_observed']) test('accepted independently validated price coverage closes the request in ' + status, () => {
  const intent = priceIntent(), saved = finish(intent, review(String(intent.current_message), 'answered', { status }))
  assert.equal(saved.price_request_status, 'answered')
  assert.equal(saved.continuation_goal, null)
  assert.equal(saved.objective, 'ask_price')
})

for (const status of ['unanswered', 'clarification', 'missing_fact', 'outside_scope']) test('delivered ' + status + ' coverage preserves the unanswered price request', () => {
  const intent = priceIntent(), saved = finish(intent, review(String(intent.current_message), status))
  assert.equal(saved.price_request_status, 'pending')
  assert.equal(saved.continuation_goal, 'ask_price')
})

for (const changes of [
  { accepted: false }, { recovery: true },
]) test('delivery does not close prices without accepted normal output: ' + JSON.stringify(changes), () => {
  const intent = priceIntent()
  assert.equal(finish(intent, review(String(intent.current_message)), changes).price_request_status, 'pending')
})

for (const audit of [
  { status: 'unavailable', final_validation: { passed: false } },
  { status: 'review_observed', observation: { status: 'unavailable' }, final_validation: { passed: false } },
  { status: 'review_observed', observation: { status: 'rejected_review' }, final_validation: { passed: false } },
  { status: 'review_observed', observation: { status: 'rejected_guard' }, final_validation: { passed: false } },
  { status: 'checked', final_validation: { passed: true }, recovery: { pending: true } },
]) test('unvalidated, rejected or recovering review cannot close a price request: ' + JSON.stringify(audit), () => {
  const intent = priceIntent(), output = { ...review(String(intent.current_message)), ...audit }
  assert.equal(finish(intent, output).price_request_status, 'pending')
})

test('coverage of another question cannot close a broad-evidence price request', () => {
  const current = '¿Cuánto cuesta el 602? ¿Aceptan mascotas?', intent = priceIntent(current)
  const audit = review('¿Aceptan mascotas?', 'answered')
  audit.requests = [{ fragment: '¿Aceptan mascotas?', status: 'answered', intent: 'project_information', fact_key: 'policy' }]
  assert.equal(finish(intent, audit).price_request_status, 'pending')
})

test('a reference-only clarification needs price-bound coverage to close its underlying price request', () => {
  const current = 'Penthouse', intent = priceIntent(current, [request(current, ['property_options'])])
  intent.interpretation_source = 'clarification_of_price_request'
  const other = review(current, 'answered')
  other.requests = [{ fragment: current, status: 'answered', intent: 'select_property', fact_key: 'bedrooms' }]
  assert.equal(finish(intent, other).price_request_status, 'pending')
  assert.equal(finish(intent, review(current)).price_request_status, 'answered')
})

test('mixed price coverage and separate price questions must all be answered before closing', () => {
  const first = '¿Cuánto cuesta el 602?', second = '¿Cuánto cuesta el 606?'
  const intent = priceIntent(first + ' ' + second, [request(first, ['purchase_price']), request(second, ['purchase_price'])])
  const audit = review(first)
  assert.equal(finish(intent, audit).price_request_status, 'pending')
  audit.requests = [...audit.requests as Row[], { fragment: second, status: 'answered', intent: 'ask_price', fact_key: 'price' }]
  assert.equal(finish(intent, audit).price_request_status, 'answered')
  ;(audit.requests as Row[]).push({ fragment: second, status: 'outside_scope', fact_key: 'price' })
  assert.equal(finish(intent, audit).price_request_status, 'pending')
})

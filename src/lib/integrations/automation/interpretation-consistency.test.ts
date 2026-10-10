import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { interpretationConsistencyIssues, reconcilePrimaryAfterBudgetIsolation } from './interpretation-consistency'

const current = 'quiero algo de 2 dormitorios'
const pending = { id: 'property_bedrooms', act: 'confirm_bedrooms', question: '¿Cuántos dormitorios necesita?' }
function propertyTurn(message = current): Row {
  return { requests: [{ domain: 'property', request: message, topics: ['property_options'], evidence: message, confidence: 'high' }],
    preferred_category: null, unit_id: null, requested_advisor: false, financing_consent: null,
    financing_amounts: [], qualification: { presupuesto_texto: null, dormitorios_texto: '2 dormitorios' },
    turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: message, confidence: 'high',
      budget: { status: 'maximum_total', amount: 300000, evidence: 'mi presupuesto es de 300 mil', confidence: 'high' },
      housing_quantities: [{ dimension: 'bedrooms', values: [2], role: 'requirement', count_basis: 'unspecified', evidence: message }],
      answer_to_previous: { question_id: 'property_bedrooms', kind: 'value', evidence: message, confidence: 'high' },
      reservation: { kind: 'none', evidence: '', confidence: 'high' },
      property: { operation: 'search', group: 'residential', category: null, unit_numbers: [], selector: null,
        evidence: message, confidence: 'high', filters: { bedrooms: 2 }, filter_evidence: { bedrooms: message } } } }
}
function neutralizeBudget(raw: Row): Row {
  return { ...raw, turn_semantics: { ...object(raw.turn_semantics),
    budget: { status: 'not_discussed', amount: null, evidence: '', confidence: 'high' } } }
}

test('a current primary quote cannot certify a budget intent backed only by historical money', () => {
  const raw = propertyTurn(), original = structuredClone(raw)
  assert.deepEqual(interpretationConsistencyIssues(raw, current), ['inconsistent_primary_intent:budget'])
  assert.deepEqual(raw, original)
})

test('a budget label remains contradictory when its block is already neutral', () => {
  assert.deepEqual(interpretationConsistencyIssues(neutralizeBudget(propertyTurn()), current), ['inconsistent_primary_intent:budget'])
})

test('a current overview request can expose an unsupported budget label without a property operation', () => {
  const message = 'quisiera información del proyecto', raw = neutralizeBudget(propertyTurn(message))
  object(object(raw.turn_semantics).property).operation = 'none'
  object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }
  raw.requests = [{ domain: 'property', topics: ['project_overview'], evidence: message, confidence: 'high' }]
  assert.deepEqual(interpretationConsistencyIssues(raw, message), ['inconsistent_primary_intent:budget'])
})

for (const status of ['amount_pending', 'no_defined_budget', 'unknown', 'declines_to_disclose',
  'amount', 'maximum_total', 'initial_capital', 'sufficient_for_selected_unit', 'insufficient_for_selected_unit']) {
  test('a current compound property/budget turn retains monetary meaning: ' + status, () => {
    const message = 'busco dos dormitorios; todavía no sé cuánto invertir', raw = propertyTurn(message)
    object(raw.turn_semantics).budget = { status, amount: null, evidence: 'todavía no sé cuánto invertir', confidence: 'high' }
    assert.deepEqual(interpretationConsistencyIssues(raw, message), [])
    assert.equal(reconcilePrimaryAfterBudgetIsolation(raw, message, pending), null)
  })
}

for (const statement of [
  { role: 'loan', amount: 200000, replaces_role: null, evidence: 'solicitaría un préstamo de 200 mil' },
  { role: 'loan', amount: 200000, replaces_role: 'down_payment', evidence: 'esos 200 mil son préstamo, no entrada' },
  { role: null, amount: null, replaces_role: 'down_payment', evidence: 'eso no es entrada, todavía no sé cómo repartirlo' },
]) test('financial statements and withdrawals survive without a budget declaration: ' + statement.evidence, () => {
  const message = 'quiero dos dormitorios; ' + statement.evidence, raw = neutralizeBudget(propertyTurn(message))
  raw.financing_amounts = [statement]
  assert.deepEqual(interpretationConsistencyIssues(raw, message), [])
  assert.equal(reconcilePrimaryAfterBudgetIsolation(raw, message, pending), null)
})

test('historical financing statements cannot mask an independently grounded property turn', () => {
  const raw = propertyTurn()
  raw.financing_amounts = [{ role: 'down_payment', amount: 300000, replaces_role: null, evidence: '300 mil para la entrada' }]
  assert.deepEqual(interpretationConsistencyIssues(raw, current), ['inconsistent_primary_intent:budget'])
})

test('ambiguous financial compound requests stay with the interpreter', () => {
  const message = 'quiero dos dormitorios y saber cómo funciona el financiamiento', raw = neutralizeBudget(propertyTurn(message))
  ;(raw.requests as Row[]).push({ domain: 'financing', topics: ['financing'], evidence: 'cómo funciona el financiamiento', confidence: 'high' })
  assert.deepEqual(interpretationConsistencyIssues(raw, message), [])
})

test('other valid primary labels are untouched and unsupported neutral turns are not guessed', () => {
  for (const intent of ['answer_previous', 'select_property', 'ask_price', 'project_information', 'other']) {
    const raw = propertyTurn()
    object(raw.turn_semantics).primary_intent = intent
    assert.deepEqual(interpretationConsistencyIssues(raw, current), [])
  }
  const raw = neutralizeBudget(propertyTurn('¿Qué pasó?'))
  raw.requests = []
  object(object(raw.turn_semantics).property).operation = 'none'
  object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }
  assert.deepEqual(interpretationConsistencyIssues(raw, '¿Qué pasó?'), [])
  assert.equal(reconcilePrimaryAfterBudgetIsolation(raw, '¿Qué pasó?', {}), null)
})

test('certified isolation derives an answer from the actual pending bedrooms question and changes no other fields', () => {
  const raw = neutralizeBudget(propertyTurn()), original = structuredClone(raw)
  const recovered = reconcilePrimaryAfterBudgetIsolation(raw, current, pending)!
  assert.equal(object(recovered.turn_semantics).primary_intent, 'answer_previous')
  assert.equal(object(recovered.turn_semantics).primary_evidence, current)
  assert.equal(object(object(recovered.turn_semantics).property).category, null)
  assert.equal(recovered.unit_id, null)
  assert.equal(recovered.financing_consent, null)
  assert.deepEqual({ ...recovered, turn_semantics: { ...object(recovered.turn_semantics),
    primary_intent: object(raw.turn_semantics).primary_intent } }, raw)
  assert.deepEqual(raw, original)
})

test('a coherent corrected primary is preferred over deriving a different label', () => {
  const raw = neutralizeBudget(propertyTurn())
  const repaired = { turn_semantics: { primary_intent: 'project_information', primary_evidence: current, confidence: 'high' } }
  assert.equal(object(reconcilePrimaryAfterBudgetIsolation(raw, current, pending, repaired)!.turn_semantics).primary_intent, 'project_information')
})

test('a repeated budget label or unsupported operational label cannot survive a neutral budget repair', () => {
  const raw = neutralizeBudget(propertyTurn())
  for (const intent of ['discuss_budget', 'request_visit', 'request_reservation', 'select_property', 'ask_price']) {
    const repaired = { turn_semantics: { primary_intent: intent, primary_evidence: current, confidence: 'high' } }
    assert.equal(object(reconcilePrimaryAfterBudgetIsolation(raw, current, pending, repaired)!.turn_semantics).primary_intent, 'answer_previous')
  }
})

test('a stale previous-question identity cannot fabricate a new answer', () => {
  const raw = neutralizeBudget(propertyTurn())
  const recovered = reconcilePrimaryAfterBudgetIsolation(raw, current, { id: 'financing_invitation' })!
  assert.equal(object(recovered.turn_semantics).primary_intent, 'project_information')
  assert.equal(object(object(recovered.turn_semantics).property).operation, 'search')
})

test('an already grounded select operation is retained without selecting any new unit', () => {
  const message = 'prefiero la 602', raw = neutralizeBudget(propertyTurn(message))
  const property = object(object(raw.turn_semantics).property)
  property.operation = 'select'; property.unit_numbers = ['602']; property.category = 'penthouse'
  const result = reconcilePrimaryAfterBudgetIsolation(raw, message, {})!
  assert.equal(object(result.turn_semantics).primary_intent, 'select_property')
  assert.deepEqual(object(result.turn_semantics).property, property)
  assert.equal(result.unit_id, null)
})

test('a current price request stays a price request after an isolated historical budget', () => {
  const message = '¿cuánto cuesta esa opción?', raw = neutralizeBudget(propertyTurn(message))
  object(object(raw.turn_semantics).property).operation = 'details'
  raw.requests = [{ domain: 'property', topics: ['purchase_price'], evidence: message, confidence: 'high' }]
  const result = reconcilePrimaryAfterBudgetIsolation(raw, message, {})!
  assert.equal(object(result.turn_semantics).primary_intent, 'ask_price')
  assert.deepEqual(result.requests, raw.requests)
})

test('neither repair citations from history nor low-confidence blocks can establish a new primary', () => {
  const raw = neutralizeBudget(propertyTurn())
  const repaired = { turn_semantics: { primary_intent: 'project_information', primary_evidence: 'dígame su presupuesto', confidence: 'high' } }
  assert.equal(object(reconcilePrimaryAfterBudgetIsolation(raw, current, pending, repaired)!.turn_semantics).primary_intent, 'answer_previous')
  object(object(raw.turn_semantics).property).confidence = 'low'
  object(object(raw.turn_semantics).answer_to_previous).confidence = 'low'
  raw.requests = []
  assert.equal(reconcilePrimaryAfterBudgetIsolation(raw, current, pending), null)
})

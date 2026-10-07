import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { interpretationSourceIssues, normalizeInactiveInterpretation, TurnInterpretationError } from './turn-interpretation-input'

const current = profileFixture.turn_semantics.primary_evidence
const fixture = (): Row => structuredClone(profileFixture)
const input = { mensaje_actual: current, pregunta_pendiente: { id: 'lead_profile' } }

// Verify fixture completeness against the actual strict response schema, including
// every nested field. Partial mocks would have hidden this production regression.
function assertSchema(value: unknown, schema: Row, path = 'response'): void {
  if (Array.isArray(schema.anyOf)) {
    assert.ok(schema.anyOf.some(branch => { try { assertSchema(value, object(branch), path); return true } catch { return false } }), path)
    return
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  assert.ok(types.includes(actual) || actual === 'number' && Number.isInteger(value) && types.includes('integer'), path)
  if (Array.isArray(schema.enum)) assert.ok(schema.enum.includes(value), path)
  if (value === null) return
  if (actual === 'object') {
    const properties = object(schema.properties), row = object(value)
    for (const key of schema.required as string[] || []) assert.ok(Object.hasOwn(row, key), `${path}.${key}`)
    if (schema.additionalProperties === false) assert.ok(Object.keys(row).every(key => Object.hasOwn(properties, key)), path)
    for (const [key, field] of Object.entries(row)) assertSchema(field, object(properties[key]), `${path}.${key}`)
  } else if (Array.isArray(value)) value.forEach((item, index) => assertSchema(item, object(schema.items), `${path}.${index}`))
}

test('complete profile extraction passes once for every confidence combination of inactive blocks', async () => {
  assertSchema(profileFixture, TURN_EXTRACTION_SCHEMA)
  const levels = ['high', 'medium', 'low']
  for (const property of levels) for (const budget of levels) for (const reservation of levels) for (const visit of levels) {
    const raw = fixture(), semantics = object(raw.turn_semantics)
    object(semantics.property).confidence = property
    object(semantics.budget).confidence = budget
    object(semantics.reservation).confidence = reservation
    object(raw.visit_intent).confidence = visit
    const original = structuredClone(raw)
    let calls = 0
    const result = await interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
    assert.equal(calls, 1)
    assert.equal(object(result.extracted.lead_profile).full_name, 'Elena Diaz')
    assert.equal(result.extracted.residence_city, 'Loja')
    assert.equal(result.extracted.residence_country, null)
    assert.equal(result.semantics.primary_intent, 'answer_previous')
    assert.equal(object(result.semantics.answer_to_previous).question_id, 'lead_profile')
    assert.equal(object(result.semantics.property).category, null)
    assert.equal(object(result.semantics.budget).status, 'not_discussed')
    assert.equal(result.extracted.requested_advisor, false)
    assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
    assert.deepEqual(raw, original, 'Normalization must not overwrite the captured model result')
  }
})

test('absence normalization is idempotent and cannot activate visits, reservations or tracking', async () => {
  const raw = fixture()
  raw.requested_advisor = raw.opt_out = raw.consent_granted = true
  raw.visit_intent = { kind: 'request_visit', evidence: 'quiero ir el lunes', confidence: 'high' }
  object(raw.turn_semantics).reservation = { kind: 'request', evidence: 'quiero reservar', confidence: 'high', unit_numbers: ['601'] }
  const normalized = normalizeInactiveInterpretation(raw)
  assert.deepEqual(normalizeInactiveInterpretation(normalized), normalized)
  const result = await interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.opt_out, false)
  assert.equal(result.extracted.tracking_consent, false)
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
  assert.equal(object(result.semantics.reservation).kind, 'none')
  assert.equal(object(result.extracted.lead_profile).full_name, 'Elena Diaz')
})

test('each material property field still requires evidence, including zero and false', () => {
  const choices = [
    { group: 'residential' }, { category: 'suite' }, { operation: 'search' },
    { reference_kind: 'relative' }, { unit_numbers: ['601'] }, { selector: 'largest' },
    { query_scope: 'offered' }, { excluded_categories: ['local'] },
    { filters: { floor_number: 0 } }, { filters: { bedrooms_required: false } },
    { filters: { bedrooms_any: [2, 3] } },
  ]
  for (const choice of choices) {
    const raw = fixture(), semantics = object(raw.turn_semantics)
    semantics.property = { ...object(semantics.property), ...choice }
    assert.ok(interpretationSourceIssues(raw, current).includes('missing_current_evidence:property'), JSON.stringify(choice))
    object(semantics.property).evidence = 'Quiero una suite'
    assert.ok(interpretationSourceIssues(raw, current).includes('non_current_evidence:property'))
  }
})

test('unknown budget is a real uncertainty, and every monetary budget status requires a valid amount', () => {
  for (const status of ['unknown', 'declines_to_disclose', 'sufficient_for_selected_unit', 'insufficient_for_selected_unit']) {
    const raw = fixture()
    object(raw.turn_semantics).budget = { status, amount: null, evidence: '', confidence: 'high' }
    assert.ok(interpretationSourceIssues(raw, current).includes('missing_current_evidence:budget'), status)
  }
  for (const status of ['amount', 'maximum_total', 'initial_capital']) for (const amount of [null, 0, -1]) {
    const raw = fixture()
    object(raw.turn_semantics).budget = { status, amount, evidence: current, confidence: 'high' }
    assert.ok(interpretationSourceIssues(raw, current).includes('invalid_budget_amount'), status)
  }
})

test('neutral property does not lose an active budget or a current request for an advisor', async () => {
  for (const scenario of ['budget', 'advisor']) {
    const raw = fixture(), message = scenario === 'budget' ? 'Tengo 100 para la entrada' : 'Quiero hablar con un asesor'
    const semantics = object(raw.turn_semantics)
    semantics.primary_intent = scenario === 'budget' ? 'discuss_budget' : 'other'
    semantics.primary_evidence = message
    semantics.answer_to_previous = { kind: 'none', question_id: 'none', evidence: '', confidence: 'high' }
    raw.requests = [{ request: message, evidence: message, domain: scenario === 'budget' ? 'financing' : 'advisor', confidence: 'high' }]
    if (scenario === 'budget') semantics.budget = { status: 'initial_capital', amount: 100, evidence: message, confidence: 'high' }
    else { raw.requested_advisor = true; object(raw.action_evidence).requested_advisor = message }
    assertSchema(raw, TURN_EXTRACTION_SCHEMA)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
    assert.equal(calls, 1)
    assert.equal(result.requests.length, 1)
    if (scenario === 'budget') assert.equal(object(result.semantics.budget).amount, 100)
    else assert.equal(result.extracted.requested_advisor, true)
  }
})

test('budget-only recovery preserves profile and other valid fields when the retry omits them', async () => {
  const message = `${current}, tengo 100 de presupuesto`, first = fixture(), repaired = fixture()
  object(first.turn_semantics).budget = { status: 'amount', amount: null, evidence: 'tengo 100 de presupuesto', confidence: 'high' }
  repaired.full_name = repaired.residence_city = null
  repaired.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  object(repaired.turn_semantics).budget = { status: 'amount', amount: 100, evidence: 'tengo 100 de presupuesto', confidence: 'high' }
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async (_rules, context) => {
    calls++
    if (calls === 2) assert.deepEqual(object(object(context).recuperacion_interpretacion).issues, ['invalid_budget_amount'])
    return calls === 1 ? first : repaired
  } })
  assert.equal(calls, 2)
  assert.equal(object(result.extracted.lead_profile).full_name, 'Elena Diaz')
  assert.equal(result.extracted.residence_city, 'Loja')
  assert.equal(object(result.semantics.budget).amount, 100)
})

test('an unsupported active property cannot pass by exhausting retries', async () => {
  const raw = fixture()
  object(object(raw.turn_semantics).property).category = 'suite'
  let calls = 0
  await assert.rejects(interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } }),
    (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('missing_current_evidence:property'))
  assert.equal(calls, 2)
})

test('empty quantity placeholders are absence rather than unsupported declarations', async () => {
  for (const confidence of ['high', 'medium', 'low']) {
    const raw = fixture(), semantics = object(raw.turn_semantics)
    semantics.housing_quantities = ['people', 'bedrooms', 'unknown'].map(dimension => ({
      dimension, values: [], role: 'unknown', count_basis: 'unspecified', evidence: '', confidence,
    }))
    assertSchema(raw, TURN_EXTRACTION_SCHEMA)
    const before = structuredClone(raw)
    assert.deepEqual(interpretationSourceIssues(raw, current), [])
    let calls = 0
    const result = await interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
    assert.equal(calls, 1)
    assert.deepEqual(result.semantics.housing_quantities, [])
    assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
    assert.deepEqual(raw, before)
    const normalized = normalizeInactiveInterpretation(raw)
    assert.deepEqual(normalizeInactiveInterpretation(normalized), normalized)
  }
})

test('quantity absence normalization preserves unknown counts, declarations, and invalid asserted values', () => {
  const quantities: Row[] = [
    { dimension: 'people', values: [], role: 'context', count_basis: 'unspecified', evidence: 'Somos varios', confidence: 'high' },
    { dimension: 'people', values: [5], role: 'context', count_basis: 'total', evidence: '', confidence: 'high' },
    { dimension: 'bedrooms', values: [], role: 'requirement', count_basis: 'unspecified', evidence: '', confidence: 'high' },
    { dimension: 'unknown', values: [0], role: 'unknown', count_basis: 'unspecified', evidence: '', confidence: 'low' },
    { dimension: 'people', values: [], role: 'unknown', count_basis: 'total', evidence: '', confidence: 'low' },
  ]
  const raw = { turn_semantics: { housing_quantities: quantities } }
  assert.deepEqual(object(normalizeInactiveInterpretation(raw).turn_semantics).housing_quantities, quantities)
  const issues = interpretationSourceIssues(raw, 'Somos varios')
  assert.ok(!issues.some(issue => issue.endsWith('quantity.0')))
  for (let index = 1; index < quantities.length; index++) assert.ok(issues.includes(`missing_current_evidence:quantity.${index}`))
})

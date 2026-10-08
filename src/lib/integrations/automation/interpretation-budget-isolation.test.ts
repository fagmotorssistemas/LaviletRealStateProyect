import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { interpretationRepairBlocks, interpretationRepairContext, TurnInterpretationError } from './turn-interpretation-input'

const message = 'si mas o menos de unos 300 mil dolares'
const oldQuote = 'me interesan los departamentos de 3 dormitorios'
const question = '¿Tiene un presupuesto estimado para esta compra?'
function budgetTurn(current = message): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ request: 'Presupuesto para la compra', domain: 'financing', topics: ['financing'], evidence: message, confidence: 'high' }]
  raw.preferred_category = 'departamento'
  raw.declaration_evidence = { preferred_category: oldQuote, purchase_purpose: null }
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'discuss_budget'; semantics.primary_evidence = message
  semantics.answer_to_previous = { question_id: 'budget_amount', kind: 'value', evidence: message, confidence: 'high' }
  semantics.budget = { status: 'maximum_total', amount: 300000, evidence: message, confidence: 'high' }
  object(raw.qualification).presupuesto_texto = message
  Object.assign(object(semantics.property), { group: 'residential', category: 'departamento',
    operation: 'details', reference_kind: 'followup', query_scope: 'selected', evidence: oldQuote, confidence: 'high' })
  raw.property_turn_use = { kind: 'context_only', evidence: current, confidence: 'high' }
  return raw
}
function input(current = message): Row {
  return { mensaje_actual: current, ultima_pregunta: question,
    pregunta_pendiente: { id: 'budget_amount', question },
    contexto_propiedades: { selected_ids: ['unit-202'], query: { category: 'departamento', bedrooms: 3 } },
    resumen: { _interpretation_memory: { property: { category: 'departamento', evidence: oldQuote } },
      _property_context: { selected_ids: ['unit-202'] } },
    historial: [{ role: 'cliente', content: oldQuote }, { role: 'bot', content: question }] }
}

test('a second historical property citation does not discard the valid 300 thousand budget answer', async () => {
  const raw = budgetTurn(), snapshot = structuredClone(raw), context = input()
  let calls = 0
  const result = await interpretConversationTurn(context, { activePrompt: async () => '', aiJson: async (_rules, sent, schema) => {
    if (++calls === 1) return raw
    const properties = object(schema?.properties), semantics = object(object(properties.turn_semantics).properties)
    assert.equal(semantics.budget, undefined)
    assert.equal(properties.financing_amounts, undefined)
    assert.ok(properties.property_turn_use)
    assert.equal(JSON.stringify(sent).includes(oldQuote), false)
    assert.equal(object(sent).ultima_pregunta, question)
    assert.deepEqual(object(object(sent).contexto_propiedades).selected_ids, ['unit-202'])
    const repaired = budgetTurn()
    // Fields outside the focused schema cannot replace the valid budget or grant permission.
    object(repaired.turn_semantics).budget = { status: 'maximum_total', amount: 900000, evidence: message, confidence: 'high' }
    repaired.financing_consent = true; repaired.requested_advisor = true
    return repaired
  } })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).amount, 300000)
  assert.equal(object(result.semantics.budget).status, 'maximum_total')
  assert.equal(object(result.semantics.property).operation, 'none')
  assert.deepEqual(object(result.semantics.property).unit_numbers, [])
  assert.equal(result.extracted.preferred_category, null)
  assert.equal(result.extracted.unit_id, null)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(object(result.diagnostic.interpretation_recovery).contract, 'budget-property-isolation-v1')
  const saved = rememberInterpretedTurn(object(context.resumen), message, result.extracted, result.semantics)
  assert.equal(object(object(saved._interpretation_memory).budget).amount, 300000)
  assert.equal(object(object(saved._interpretation_memory).property).category, 'departamento')
  assert.deepEqual(object(saved._property_context).selected_ids, ['unit-202'])
  assert.deepEqual(raw, snapshot)
})

test('property isolation is unavailable without a certain current certificate and a known budget question', async () => {
  for (const variant of ['uncertain', 'missing', 'historical_certificate', 'medium', 'no_question']) {
    const raw = budgetTurn(), context = input()
    if (variant === 'uncertain') object(raw.property_turn_use).kind = 'uncertain'
    if (variant === 'missing') delete raw.property_turn_use
    if (variant === 'historical_certificate') object(raw.property_turn_use).evidence = oldQuote
    if (variant === 'medium') object(raw.property_turn_use).confidence = 'medium'
    if (variant === 'no_question') { context.ultima_pregunta = ''; context.pregunta_pendiente = {} }
    await assert.rejects(interpretConversationTurn(context, { activePrompt: async () => '', aiJson: async () => raw }),
      (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('non_current_evidence:property'), variant)
  }
})

test('mixed current property requests, preferences and permissions cannot be erased by budget isolation', async () => {
  for (const variant of ['request', 'topic', 'filter', 'catalog', 'people', 'permission', 'repair_request', 'current_certificate']) {
    const current = message + ', pero quiero ahora uno de 2 dormitorios'
    const raw = budgetTurn(current), repaired = budgetTurn(current)
    const request = { request: 'Cambiar dormitorios', domain: 'property', topics: ['property_options'], evidence: 'quiero ahora uno de 2 dormitorios', confidence: 'high' }
    if (variant === 'request') (raw.requests as Row[]).push(request)
    if (variant === 'topic') (raw.requests as Row[])[0].topics = ['financing', 'property_options']
    if (variant === 'filter') { object(object(object(raw.turn_semantics).property).filter_evidence).bedrooms = '2 dormitorios' }
    if (variant === 'catalog') raw.catalog_request = { purpose: 'search', evidence: request.evidence }
    if (variant === 'people') object(raw.turn_semantics).housing_quantities = [{ dimension: 'bedrooms', role: 'requirement', count_basis: 'unspecified', values: [2], evidence: '2 dormitorios', confidence: 'high' }]
    if (variant === 'permission') raw.requested_advisor = true
    if (variant === 'repair_request') (repaired.requests as Row[]).push(request)
    if (variant === 'current_certificate') object(repaired.property_turn_use).kind = 'current_request'
    let calls = 0
    await assert.rejects(interpretConversationTurn(input(current), { activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repaired }),
      (error: unknown) => error instanceof TurnInterpretationError, variant)
    assert.equal(object(object(raw.turn_semantics).budget).amount, 300000)
  }
})

test('focused recovery preserves a valid budget while a genuine current property change is repaired normally', async () => {
  const current = message + ', pero quiero ahora uno de 2 dormitorios', raw = budgetTurn(current), repaired = budgetTurn(current)
  const request = { request: 'Cambiar dormitorios', domain: 'property', topics: ['property_options'], evidence: 'quiero ahora uno de 2 dormitorios', confidence: 'high' }
  ;(raw.requests as Row[]).push(request); (repaired.requests as Row[]).push(request)
  Object.assign(object(object(repaired.turn_semantics).property), { operation: 'search', reference_kind: 'none', query_scope: 'all', evidence: request.evidence })
  object(repaired.property_turn_use).kind = 'current_request'
  let calls = 0
  const result = await interpretConversationTurn(input(current), { activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repaired })
  assert.equal(object(result.semantics.budget).amount, 300000)
  assert.equal(object(result.semantics.property).operation, 'search')
  assert.equal(object(result.diagnostic.interpretation_recovery).contract, undefined)
  assert.ok(result.requests.some(request => request.domain === 'property'))
})

test('repair planning and projection preserve independent values without historical quotations', () => {
  const blocks = interpretationRepairBlocks(['non_current_evidence:property'])
  assert.equal(blocks.budget, false)
  assert.ok(!blocks.semanticFields.includes('budget'))
  assert.deepEqual(interpretationRepairContext({ selected_ids: ['202'], amount: 300000,
    evidence: oldQuote, primary_evidence: oldQuote, nested: { evidence: oldQuote, bedrooms: 3 }, question }),
    { selected_ids: ['202'], amount: 300000, nested: { bedrooms: 3 }, question })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn, TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { interpretationInput, TurnInterpretationError } from './turn-interpretation-input'
import { reconcileHistoricalInterpretation, confirmedInterpretationMemory } from './interpretation-memory'

const current = 'si claro, entocnes como procederiamos conel financiemiento??}'
const budget = { status: 'amount', amount: 100000, evidence: 'mi presupeusto es de 100 mil dolares', confidence: 'high' }
const previous: Row = { _turn_intent: { budget }, datos_confirmados: { proposito: 'vivir' } }
const validate = new Ajv().compile(TURN_EXTRACTION_SCHEMA)

function response(message = current): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.events = ['asked_financing']
  raw.requests = [{ domain: 'financing', request: 'Consultar el proceso de financiamiento', evidence: message, confidence: 'high' }]
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'ask_financing'
  semantics.primary_evidence = message
  semantics.answer_to_previous = { kind: 'none', question_id: 'none', evidence: '', confidence: 'high' }
  semantics.budget = { ...budget }
  object(raw.qualification).presupuesto_texto = budget.evidence
  assert.ok(validate(raw), JSON.stringify(validate.errors))
  return raw
}

test('recorded financing failure now accepts the first complete extraction without declaring an old budget again', async () => {
  const raw = response(), before = structuredClone(raw), summary = structuredClone(previous)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, resumen: summary }, {
    activePrompt: async () => 'Extractor', aiJson: async (_rules, context) => {
      calls++
      assert.equal(object(object(object(context).hechos_confirmados).budget).amount, 100000)
      return raw
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.semantics.primary_intent, 'ask_financing')
  assert.equal(result.requests[0].domain, 'financing')
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  assert.equal(object(result.extracted.qualification).presupuesto_texto, null)
  assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
  assert.deepEqual(object(result.diagnostic.historical_reconciliation).fields, ['budget', 'qualification.presupuesto_texto'])
  assert.deepEqual(result.withActionMessage?.(current).diagnostic.historical_reconciliation, result.diagnostic.historical_reconciliation)
  assert.deepEqual(raw, before)
  assert.deepEqual(summary, previous)
  const memory = rememberInterpretedTurn(summary, current, result.extracted, result.semantics)
  assert.deepEqual(object(memory._interpretation_memory).budget, budget)
  assert.equal(result.extracted.financing_consent, null, 'Remembering a budget must not authorize financing')
})

test('confirmed budget survives unrelated turns and a changed value replaces it only with current evidence', async () => {
  let summary = structuredClone(previous), calls = 0
  for (const message of [current, 'y que documentos necesito', 'y con cuales entidades trabajan']) {
    const result = await interpretConversationTurn({ mensaje_actual: message, resumen: summary }, {
      activePrompt: async () => 'Extractor', aiJson: async () => { calls++; return response(message) },
    })
    summary = { ...rememberInterpretedTurn(summary, message, result.extracted, result.semantics), _turn_intent: { objective: 'ask_financing' } }
    assert.equal(object(confirmedInterpretationMemory(summary).budget).amount, 100000)
  }
  assert.equal(calls, 3)
  const message = 'Ahora mi presupuesto es de 130 mil dolares', raw = response(message)
  object(raw.turn_semantics).primary_intent = 'discuss_budget'
  object(raw.turn_semantics).budget = { ...budget, amount: 130000, evidence: message }
  object(raw.qualification).presupuesto_texto = message
  const updated = await interpretConversationTurn({ mensaje_actual: message, resumen: summary }, { activePrompt: async () => 'Extractor', aiJson: async () => raw })
  assert.equal(object(updated.semantics.budget).amount, 130000)
  summary = rememberInterpretedTurn(summary, message, updated.extracted, updated.semantics)
  assert.equal(object(confirmedInterpretationMemory(summary).budget).amount, 130000)
  // A superseded value is no longer a confirmed repeat, even if it existed before.
  assert.deepEqual(reconcileHistoricalInterpretation(response(), current, summary).fields, [])
})

test('same known quantity is not enough: purpose, source and current budget corrections remain protected', async () => {
  for (const scenario of ['different_amount', 'different_kind', 'unknown_source', 'bot_history_only', 'current_budget_correction']) {
    const raw = response(), semantics = object(raw.turn_semantics)
    const message = scenario === 'current_budget_correction' ? 'En realidad mi presupuesto es otro' : current
    semantics.primary_evidence = message
    raw.requests = [{ domain: 'financing', request: message, evidence: message, confidence: 'high' }]
    if (scenario === 'different_amount') object(semantics.budget).amount = 300000
    if (scenario === 'different_kind') object(semantics.budget).status = 'initial_capital'
    if (scenario === 'unknown_source') object(semantics.budget).evidence = 'tengo ese dinero'
    if (scenario === 'current_budget_correction') semantics.primary_intent = 'discuss_budget'
    let calls = 0
    await assert.rejects(interpretConversationTurn({ mensaje_actual: message,
      resumen: scenario === 'bot_history_only' ? {} : previous,
      historial: [{ role: 'bot', content: budget.evidence }] }, {
      activePrompt: async () => 'Extractor', aiJson: async () => { calls++; return raw },
    }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('non_current_evidence:budget'), scenario)
    assert.equal(calls, 2)
  }
})

test('household and property echoes are isolated while current profile and requests remain intact', async () => {
  const declaration = 'Somos 5 personas y buscamos un departamento'
  const quantity = { dimension: 'people', values: [5], role: 'context', count_basis: 'total', evidence: declaration, confidence: 'high' }
  const raw = response(), property = object(object(raw.turn_semantics).property)
  Object.assign(property, { group: 'residential', category: 'departamento', evidence: declaration })
  object(raw.turn_semantics).housing_quantities = [quantity]
  const stored = { ...previous, _interpretation_memory: { budget, property: { ...property }, housing_quantities: [quantity] } }
  const message = `${current} Mi nombre es Elena Diaz y vivo en Loja`
  object(raw.turn_semantics).primary_evidence = current
  raw.full_name = 'Elena Diaz'; raw.residence_city = 'Loja'
  raw.profile_evidence = { full_name: 'Mi nombre es Elena Diaz', residence_city: 'vivo en Loja', residence_country: null }
  assert.ok(validate(raw), JSON.stringify(validate.errors))
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message, resumen: stored }, {
    activePrompt: async () => 'Extractor', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.deepEqual(result.semantics.housing_quantities, [])
  assert.equal(object(result.semantics.property).category, null)
  assert.equal(result.extracted.residence_city, 'Loja')
  assert.equal(object(result.extracted.lead_profile).full_name, 'Elena Diaz')
  assert.equal(result.requests[0].domain, 'financing')
  const memory = rememberInterpretedTurn(stored, message, result.extracted, result.semantics)
  assert.deepEqual(object(memory._interpretation_memory).housing_quantities, [quantity])
  assert.equal(object(object(memory._interpretation_memory).property).category, 'departamento')
  // Neither a different family size nor an old search/select operation is neutralized.
  object(object(raw.turn_semantics).property).operation = 'search'
  object(raw.turn_semantics).housing_quantities = [{ ...quantity, values: [8] }]
  const normalized = reconcileHistoricalInterpretation(raw, message, stored)
  assert.ok(!normalized.fields.includes('property'))
  assert.ok(!normalized.fields.includes('housing_quantities.0'))
})

test('a recovery can normalize known echoes without replacing unrelated valid extraction fields', async () => {
  const first = response(), second = response()
  object(object(first.turn_semantics).budget).amount = null
  first.full_name = 'Elena Diaz'
  first.profile_evidence = { full_name: 'Mi nombre es Elena Diaz', residence_city: null, residence_country: null }
  const message = `${current} Mi nombre es Elena Diaz`
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message, resumen: previous }, {
    activePrompt: async () => 'Extractor', aiJson: async () => ++calls === 1 ? first : second,
  })
  assert.equal(calls, 2)
  assert.equal(object(result.extracted.lead_profile).full_name, 'Elena Diaz')
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
})

test('historical family data does not suppress a new bedroom requirement in the same extraction', async () => {
  const household = { dimension: 'people', values: [5], role: 'context', count_basis: 'total', evidence: 'Somos 5 personas', confidence: 'high' }
  const message = 'Busco al menos 3 dormitorios', raw = response(message), semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'select_property'
  raw.requests = [{ domain: 'property', request: message, evidence: message, confidence: 'high' }]
  semantics.housing_quantities = [household,
    { dimension: 'bedrooms', values: [3], role: 'requirement', count_basis: 'unspecified', evidence: message, confidence: 'high' }]
  const property = object(semantics.property)
  Object.assign(property, { group: 'residential', operation: 'search', evidence: message })
  Object.assign(object(property.filters), { bedrooms: 3, bedrooms_operator: 'gte' })
  Object.assign(object(property.filter_evidence), { bedrooms: message, bedrooms_operator: message })
  const summary = { ...previous, _interpretation_memory: { budget, housing_quantities: [household] } }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message, resumen: summary }, {
    activePrompt: async () => 'Extractor', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.equal((result.semantics.housing_quantities as Row[]).length, 1)
  assert.equal((result.semantics.housing_quantities as Row[])[0].dimension, 'bedrooms')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 3)
  assert.equal(object(object(result.semantics.property).filters).bedrooms_operator, 'gte')
  const memory = rememberInterpretedTurn(summary, message, result.extracted, result.semantics)
  assert.equal((object(memory._interpretation_memory).housing_quantities as Row[]).length, 2)
})

test('memory stores accepted declarations with provenance and excludes operational permissions', async () => {
  const message = 'Somos 5 personas y tengo 100 mil dolares', raw = response(message)
  object(raw.turn_semantics).budget = { ...budget, evidence: 'tengo 100 mil dolares' }
  object(raw.turn_semantics).housing_quantities = [{ dimension: 'people', values: [5], role: 'context', count_basis: 'total', evidence: 'Somos 5 personas', confidence: 'high' }]
  object(raw.qualification).presupuesto_texto = 'tengo 100 mil dolares'
  const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extractor', aiJson: async () => raw })
  const memory = rememberInterpretedTurn({}, message, { ...result.extracted, financing_consent: true, requested_advisor: true }, result.semantics)
  const facts = object(interpretationInput({ resumen: memory }, current).hechos_confirmados)
  assert.equal(object(facts.budget).amount, 100000)
  assert.equal((facts.housing_quantities as Row[])[0].dimension, 'people')
  assert.equal(object(object(memory.datos_confirmados).household).occupants, 5)
  assert.equal(facts.financing_consent, undefined)
  assert.equal(facts.requested_advisor, undefined)
})

test('invalid stored money and empty property interpretations cannot replace confirmed facts', () => {
  for (const amount of [null, 0, -1]) {
    const summary = { _interpretation_memory: { budget: { ...budget, amount } } }
    assert.equal(confirmedInterpretationMemory(summary).budget, undefined)
    assert.deepEqual(reconcileHistoricalInterpretation(response(), current, summary).fields, [])
  }
  const property = { category: 'departamento', evidence: 'Busco departamento', confidence: 'high' }
  const summary = { _interpretation_memory: { property } }
  const memory = rememberInterpretedTurn(summary, current, {}, {
    property: { group: null, category: null, filters: { bedrooms: null, bedrooms_any: [] }, evidence: current, confidence: 'high' },
  })
  assert.deepEqual(object(memory._interpretation_memory).property, property)
})

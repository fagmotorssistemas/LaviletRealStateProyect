import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { TurnInterpretationError } from './turn-interpretation-input'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { leadBudget } from './budget-state'
import { resolvePropertyTurn } from './property-context'
import { commercialJourneyPlan } from './commercial-journey'
import { isolateHistoricalBudget } from './historical-budget-isolation'

const current = 'quiero algo de 2 dormitorios'
const originalMoney = 'Mi presupuesto total es de 300 mil dólares'
const botMoney = 'Considerando su presupuesto de 300 mil dólares'
const pending = { id: 'property_bedrooms', act: 'other', question: '¿Cuántos dormitorios necesita?' }
const inventory: Row[] = [
  { id: 'd201', unit_number: '201', category: 'departamento', bedrooms: 2, floor_number: 2,
    floor: 'Segunda planta alta', published_commercial_price: 270000 },
  { id: 'd301', unit_number: '301', category: 'departamento', bedrooms: 2, floor_number: 3,
    floor: 'Tercera planta alta', published_commercial_price: 290000 },
  { id: 'p601', unit_number: '601', category: 'penthouse', bedrooms: 2, floor_number: 6,
    floor: 'Sexta planta alta', published_commercial_price: 389750 },
].map(unit => ({ ...unit, status: 'disponible', is_published: true }))

function previous(legacy = false): Row {
  return { datos_confirmados: { proposito: 'vivir' },
    _financing_amounts: { total_budget: { amount: 300000, evidence: originalMoney } },
    _turn_intent: { objective: 'discuss_budget', subject: 'financing', continuation_goal: 'select_property' },
    _property_context: { version: 2, query: { group: 'residential', operation: 'search', filters: {} },
      selected_ids: [], offered_ids: [], focused_ids: [], comparison_ids: [], pending_question: pending },
    _pending_question: pending,
    _financing_identity: { full_name: 'Carlos Pérez Gómez', national_id: '0102030405' },
    _financing_journey: { accepted: false },
    ...(legacy ? {} : { _interpretation_memory: { budget: { status: 'maximum_total', amount: 300000,
      evidence: originalMoney, confidence: 'high' } } }),
  }
}

function propertyTurn(message = current, budgetQuote = originalMoney): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'property', request: 'Revisar opciones de dos dormitorios',
    topics: ['property_options'], evidence: message, confidence: 'high' }]
  object(raw.qualification).dormitorios_texto = '2 dormitorios'
  object(raw.qualification).presupuesto_texto = budgetQuote
  raw.financing_amounts = [{ role: 'total_budget', amount: 300000, evidence: budgetQuote, replaces_role: null }]
  const semantic = object(raw.turn_semantics)
  semantic.primary_intent = 'discuss_budget'; semantic.primary_evidence = message
  semantic.housing_quantities = [{ dimension: 'bedrooms', role: 'requirement', count_basis: 'unspecified',
    values: [2], evidence: '2 dormitorios', confidence: 'high' }]
  semantic.answer_to_previous = { question_id: pending.id, kind: 'value', evidence: message, confidence: 'high' }
  semantic.budget = { status: 'maximum_total', amount: 300000, evidence: budgetQuote, confidence: 'high' }
  semantic.property = { ...object(semantic.property), group: 'residential', operation: 'search', query_scope: 'catalog',
    filters: { ...object(object(semantic.property).filters), bedrooms: 2 },
    filter_evidence: { ...object(object(semantic.property).filter_evidence), bedrooms: '2 dormitorios' },
    evidence: message, confidence: 'high' }
  return raw
}

function repairedBudget(message = current, quote = botMoney): Row {
  return { budget_turn_use: { kind: 'context_only', evidence: message, confidence: 'high' },
    qualification: { presupuesto_texto: quote },
    financing_amounts: [{ role: 'total_budget', amount: 300000, evidence: quote, replaces_role: null }],
    turn_semantics: { primary_intent: 'answer_previous', primary_evidence: message, confidence: 'high',
      budget: { status: 'maximum_total', amount: 300000, evidence: quote, confidence: 'high' } } }
}

function input(message = current, summary = previous()): Row {
  return { mensaje_actual: message, pregunta_pendiente: pending, ultima_pregunta: pending.question,
    resumen: summary, contexto_propiedades: summary._property_context, catalogo_unidades: inventory,
    historial: [{ role: 'cliente', content: originalMoney }, { role: 'bot', content: botMoney },
      { role: 'bot', content: pending.question }] }
}

for (const legacy of [false, true]) test(`a historical budget and wrong budget intent cannot discard a valid bedroom answer: legacy=${legacy}`, async () => {
  const raw = propertyTurn(), repair = repairedBudget(), summary = previous(legacy)
  const before = structuredClone({ raw, repair, summary })
  let calls = 0
  const result = await interpretConversationTurn(input(current, summary), {
    activePrompt: async () => 'Extract', aiJson: async (_rules, sent, schema) => {
      if (++calls === 1) return raw
      const properties = object(schema?.properties), semantics = object(object(properties.turn_semantics).properties)
      assert.ok(properties.budget_turn_use)
      assert.ok(semantics.primary_intent, 'the dependent main intent belongs in the same recovery')
      assert.ok(semantics.budget)
      assert.ok(properties.financing_amounts)
      assert.equal(properties.requested_advisor, undefined)
      assert.equal(properties.financing_consent, undefined)
      assert.equal(properties.full_name, undefined)
      assert.equal(object(sent).historial, undefined)
      assert.equal(JSON.stringify(sent).includes(originalMoney), false)
      assert.equal(JSON.stringify(sent).includes(botMoney), false)
      return repair
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.primary_intent, 'answer_previous')
  assert.equal(object(result.semantics.answer_to_previous).question_id, pending.id)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.equal(object(result.semantics.property).operation, 'search')
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  assert.deepEqual(result.extracted.financing_amounts, [])
  assert.equal(object(result.extracted.qualification).presupuesto_texto, null)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(object(result.diagnostic.interpretation_recovery).status, 'recovered')
  const saved = rememberInterpretedTurn(summary, current, result.extracted, result.semantics)
  assert.deepEqual(object(saved._financing_amounts).total_budget, object(summary._financing_amounts).total_budget)
  assert.deepEqual(saved._financing_identity, summary._financing_identity)
  assert.deepEqual(saved._financing_journey, summary._financing_journey)
  assert.deepEqual(saved._property_context, summary._property_context)
  const budget = leadBudget({ hechos_confirmados: confirmedInterpretationMemory(saved), semantica_turno: result.semantics })
  assert.equal(budget.status, 'maximum_total')
  assert.equal(budget.amount, 300000)
  const resolved = resolvePropertyTurn(inventory, current, saved, [], result.semantics)
  assert.equal(object(resolved.query.filters).bedrooms, 2)
  assert.deepEqual(resolved.context.selected_ids, [])
  const plan = commercialJourneyPlan({ catalogo: inventory, catalogo_verificacion: inventory, catalog_read: { complete: true },
    lead: { purchase_purpose: 'vivir' }, hechos_confirmados: confirmedInterpretationMemory(saved),
    property_context: resolved.context, semantica_turno: result.semantics,
    solicitudes_interpretadas: result.requests, recorrido_comercial: {}, politica_comercial: { precios_autorizados: true },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} } })
  assert.notEqual(plan.question_id, 'property_bedrooms')
  assert.notEqual(plan.question_id, 'budget_amount')
  assert.notEqual(plan.question_id, 'budget_kind')
  assert.deepEqual({ raw, repair, summary }, before, 'model objects and stored state remain unchanged')
})

test('the captured empty-request extraction still recovers two bedrooms and the previous typed budget', async () => {
  const raw = propertyTurn(), repair = repairedBudget(), summary = previous(true)
  raw.requests = []; raw.financing_amounts = []
  object(raw.qualification).presupuesto_texto = null
  const property = object(object(raw.turn_semantics).property)
  Object.assign(object(property.filters), { bedrooms_operator: 'eq', bedrooms_required: true })
  Object.assign(object(property.filter_evidence), { bedrooms_operator: current, bedrooms_required: current })
  const before = structuredClone({ raw, repair, summary })
  let calls = 0
  const result = await interpretConversationTurn(input(current, summary), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.primary_intent, 'answer_previous')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.deepEqual(result.requests, [])
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  assert.equal(result.extracted.financing_consent, null)
  const saved = rememberInterpretedTurn(summary, current, result.extracted, result.semantics)
  const resolved = resolvePropertyTurn(inventory, current, saved, [], result.semantics)
  const plan = commercialJourneyPlan({ catalogo: inventory, catalogo_verificacion: inventory, catalog_read: { complete: true },
    lead: { purchase_purpose: 'vivir' }, hechos_confirmados: confirmedInterpretationMemory(saved),
    property_context: resolved.context, semantica_turno: result.semantics, solicitudes_interpretadas: result.requests,
    recorrido_comercial: {}, politica_comercial: { precios_autorizados: true },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} } })
  assert.equal(object(confirmedInterpretationMemory(saved).budget).amount, 300000)
  assert.notEqual(plan.question_id, 'property_bedrooms')
  assert.notEqual(plan.question_id, 'budget_amount')
  assert.notEqual(plan.question_id, 'budget_kind')
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.deepEqual({ raw, repair, summary }, before)
})

test('a budget-only recovery cannot rewrite valid property choices, identity or permission', async () => {
  const raw = propertyTurn(), repair = repairedBudget(), summary = previous()
  object(summary._property_context).selected_ids = ['d201']
  object(summary._property_context).focused_ids = ['d201']
  Object.assign(repair, { requested_advisor: true, financing_consent: true, consent_granted: true,
    full_name: 'Otro Nombre', national_id: '9999999999', unit_id: 'p601',
    preferred_category: 'penthouse', requests: [{ domain: 'advisor', evidence: current, confidence: 'high' }] })
  object(repair.turn_semantics).property = { operation: 'select', unit_numbers: ['601'], evidence: current, confidence: 'high' }
  let calls = 0
  const result = await interpretConversationTurn(input(current, summary), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(object(result.semantics.property).operation, 'search')
  assert.deepEqual(object(result.semantics.property).unit_numbers, [])
  assert.equal(result.extracted.preferred_category, null)
  assert.equal(result.extracted.unit_id, null)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(result.extracted.tracking_consent, false)
  assert.equal(object(result.extracted.lead_profile).full_name, null)
  const saved = rememberInterpretedTurn(summary, current, result.extracted, result.semantics)
  assert.deepEqual(object(saved._property_context).selected_ids, ['d201'])
  assert.deepEqual(saved._financing_identity, summary._financing_identity)
})

test('uncertain, absent or historical repair certification cannot silently neutralize an invalid budget', async () => {
  for (const variant of ['missing', 'uncertain', 'medium', 'historical', 'current_update']) {
    const repair = repairedBudget()
    if (variant === 'missing') delete repair.budget_turn_use
    if (variant === 'uncertain' || variant === 'current_update') object(repair.budget_turn_use).kind = variant
    if (variant === 'medium') object(repair.budget_turn_use).confidence = 'medium'
    if (variant === 'historical') object(repair.budget_turn_use).evidence = originalMoney
    let calls = 0
    await assert.rejects(interpretConversationTurn(input(), {
      activePrompt: async () => '', aiJson: async () => ++calls === 1 ? propertyTurn() : repair,
    }), (error: unknown) => error instanceof TurnInterpretationError, variant)
    assert.equal(calls, 2, variant)
  }
})

test('a certified budget isolation can recover its label from an independent valid answer', async () => {
  for (const variant of ['missing_primary', 'wrong_primary']) {
    const repair = repairedBudget()
    if (variant === 'missing_primary') delete object(repair.turn_semantics).primary_intent
    if (variant === 'wrong_primary') object(repair.turn_semantics).primary_intent = 'discuss_budget'
    let calls = 0
    const result = await interpretConversationTurn(input(), {
      activePrompt: async () => '', aiJson: async () => ++calls === 1 ? propertyTurn() : repair,
    })
    assert.equal(calls, 2, variant)
    assert.equal(result.semantics.primary_intent, 'answer_previous', variant)
    assert.equal(object(object(result.semantics.property).filters).bedrooms, 2, variant)
    assert.deepEqual(object(result.semantics.property).unit_numbers, [], variant)
    assert.equal(result.extracted.unit_id, null, variant)
    assert.equal(result.extracted.requested_advisor, false, variant)
    assert.equal(result.extracted.financing_consent, null, variant)
  }
})

for (const evidence of [originalMoney, '']) test(`certified isolation repairs a dependent unsupported primary citation: ${evidence ? 'historical' : 'empty'}`, async () => {
  const raw = propertyTurn(), repair = repairedBudget()
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  object(repair.turn_semantics).primary_evidence = evidence
  const before = structuredClone({ raw, repair })
  let calls = 0
  const result = await interpretConversationTurn(input(), {
    activePrompt: async () => '', aiJson: async (_rules, _input, schema) => {
      if (++calls === 1) return raw
      const semantics = object(object(object(schema?.properties).turn_semantics).properties)
      assert.ok(semantics.primary_intent)
      assert.ok(semantics.primary_evidence)
      assert.ok(semantics.budget)
      return repair
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.primary_intent, 'answer_previous')
  assert.equal(result.semantics.primary_evidence, current)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.equal(object(result.semantics.property).category, null)
  assert.deepEqual(object(result.semantics.property).unit_numbers, [])
  assert.equal(result.extracted.unit_id, null)
  assert.equal(result.extracted.financing_consent, null)
  const saved = rememberInterpretedTurn(previous(), current, result.extracted, result.semantics)
  assert.equal(object(confirmedInterpretationMemory(saved).budget).amount, 300000)
  assert.deepEqual({ raw, repair }, before)
})

test('a wrong budget label can recover from a valid property answer even when the monetary block is already neutral', async () => {
  const raw = propertyTurn(), repair = repairedBudget()
  const inactiveBudget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'high' }
  raw.financing_amounts = []; object(raw.qualification).presupuesto_texto = null
  object(raw.turn_semantics).budget = inactiveBudget
  object(repair.budget_turn_use).kind = 'none'
  repair.financing_amounts = []; object(repair.qualification).presupuesto_texto = null
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  object(repair.turn_semantics).budget = inactiveBudget
  const before = structuredClone({ raw, repair })
  let calls = 0
  const result = await interpretConversationTurn(input(), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.primary_intent, 'answer_previous')
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.equal(object(result.semantics.property).category, null)
  assert.equal(result.extracted.unit_id, null)
  assert.equal(result.extracted.financing_consent, null)
  const saved = rememberInterpretedTurn(previous(), current, result.extracted, result.semantics)
  assert.equal(object(confirmedInterpretationMemory(saved).budget).amount, 300000)
  assert.deepEqual({ raw, repair }, before)
})

test('a current monetary change cannot be erased under a context-only certificate', async () => {
  const message = 'quiero algo de 2 dormitorios y ahora tengo 250 mil para toda la compra'
  const raw = propertyTurn(message), repair = repairedBudget(message)
  raw.financing_amounts = [{ role: 'total_budget', amount: 250000, evidence: 'ahora tengo 250 mil para toda la compra', replaces_role: null }]
  let calls = 0
  await assert.rejects(interpretConversationTurn(input(message), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  }), (error: unknown) => error instanceof TurnInterpretationError)
  assert.equal(calls, 2)
})

test('a current price question with two bedrooms survives historical budget isolation', async () => {
  const message = current + ', ¿cuánto cuestan?', raw = propertyTurn(message), repair = repairedBudget(message)
  raw.requests = [{ domain: 'property', request: 'Precios de dos dormitorios', topics: ['purchase_price', 'property_options'],
    evidence: message, confidence: 'high' }]
  object(raw.turn_semantics).primary_intent = 'ask_price'
  object(repair.turn_semantics).primary_intent = 'ask_price'
  let calls = 0
  const result = await interpretConversationTurn(input(message, previous(true)), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(result.semantics.primary_intent, 'ask_price')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.ok(result.requests.some(request => Array.isArray(request.topics) && request.topics.includes('purchase_price')))
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
})

test('an actual mixed budget update is repaired without losing the bedroom answer', async () => {
  const message = 'quiero algo de 2 dormitorios y mi presupuesto total ahora es 250 mil', raw = propertyTurn(message)
  const repair = repairedBudget(message)
  Object.assign(object(repair.budget_turn_use), { kind: 'current_update' })
  repair.financing_amounts = [{ role: 'total_budget', amount: 250000, evidence: 'mi presupuesto total ahora es 250 mil', replaces_role: null }]
  object(repair.qualification).presupuesto_texto = 'mi presupuesto total ahora es 250 mil'
  object(repair.turn_semantics).budget = { status: 'maximum_total', amount: 250000,
    evidence: 'mi presupuesto total ahora es 250 mil', confidence: 'high' }
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  let calls = 0
  const result = await interpretConversationTurn(input(message), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(object(result.semantics.budget).amount, 250000)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  const saved = rememberInterpretedTurn(previous(), message, result.extracted, result.semantics)
  assert.equal(object(object(saved._financing_amounts).total_budget).amount, 250000)
  assert.equal(object(confirmedInterpretationMemory(saved).budget).amount, 250000)
})

test('clarifying that known money is the entry preserves the current role change and bedroom request', async () => {
  const message = 'quiero algo de 2 dormitorios y esos 300 mil no son el total, son para la entrada', raw = propertyTurn(message)
  const repair = repairedBudget(message)
  object(repair.budget_turn_use).kind = 'current_update'
  repair.financing_amounts = [{ role: 'down_payment', amount: 300000, evidence: 'esos 300 mil no son el total, son para la entrada', replaces_role: 'total_budget' }]
  object(repair.qualification).presupuesto_texto = 'esos 300 mil no son el total, son para la entrada'
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  object(repair.turn_semantics).budget = { status: 'initial_capital', amount: 300000,
    evidence: 'esos 300 mil no son el total, son para la entrada', confidence: 'high' }
  let calls = 0
  const result = await interpretConversationTurn(input(message), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  assert.equal(object(result.semantics.budget).status, 'initial_capital')
  const saved = rememberInterpretedTurn(previous(), message, result.extracted, result.semantics)
  assert.equal(object(saved._financing_amounts).total_budget, undefined)
  assert.equal(object(object(saved._financing_amounts).down_payment).amount, 300000)
  assert.equal(object(confirmedInterpretationMemory(saved).budget).status, 'initial_capital')
})

test('the same recovery protects a floor answer without inventing a type or changing bedroom requirements', async () => {
  const message = 'me gustaría la segunda planta alta', raw = propertyTurn(message), repair = repairedBudget(message)
  const floorQuestion = { id: 'property_floor', act: 'choose_floor', question: '¿En qué planta le gustaría revisar las opciones?' }
  const semantic = object(raw.turn_semantics), property = object(semantic.property)
  semantic.housing_quantities = []
  semantic.answer_to_previous = { question_id: floorQuestion.id, kind: 'value', evidence: message, confidence: 'high' }
  object(property.filters).floor_number = 2; object(property.filters).bedrooms = null
  object(property.filter_evidence).floor_number = message; object(property.filter_evidence).bedrooms = ''
  object(raw.qualification).dormitorios_texto = null
  const summary = previous()
  object(object(summary._property_context).query).filters = { bedrooms: 2 }
  let calls = 0
  const result = await interpretConversationTurn({ ...input(message, summary), pregunta_pendiente: floorQuestion,
    ultima_pregunta: floorQuestion.question }, {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(result.semantics.primary_intent, 'answer_previous')
  assert.equal(object(object(result.semantics.property).filters).floor_number, 2)
  assert.equal(object(result.semantics.property).category, null)
  assert.equal(result.extracted.preferred_category, null)
  const saved = rememberInterpretedTurn(summary, message, result.extracted, result.semantics)
  const resolved = resolvePropertyTurn(inventory, message, saved, [], result.semantics)
  assert.equal(object(resolved.query.filters).bedrooms, 2)
  assert.equal(object(resolved.query.filters).floor_number, 2)
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.equal(object(object(saved._financing_amounts).total_budget).amount, 300000)
})

test('a current undefined-budget declaration is preserved while the unsupported main citation is repaired', async () => {
  const message = 'No tengo un presupuesto definido y quiero algo de 2 dormitorios', raw = propertyTurn(message)
  raw.financing_amounts = []
  const semantic = object(raw.turn_semantics)
  semantic.primary_evidence = originalMoney
  semantic.budget = { status: 'no_defined_budget', amount: null, evidence: 'No tengo un presupuesto definido', confidence: 'high' }
  object(raw.qualification).presupuesto_texto = 'No tengo un presupuesto definido'
  const repair = repairedBudget(message)
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  let calls = 0
  const result = await interpretConversationTurn(input(message), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).status, 'no_defined_budget')
  assert.equal(object(result.semantics.budget).amount, null)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  const saved = rememberInterpretedTurn(previous(), message, result.extracted, result.semantics)
  assert.equal(object(confirmedInterpretationMemory(saved).budget).status, 'no_defined_budget')
  assert.equal(leadBudget({ hechos_confirmados: saved._interpretation_memory }).answered, true)
  assert.equal(leadBudget({ hechos_confirmados: saved._interpretation_memory }).amount, null)
})

test('a current monetary-role withdrawal remains active while a malformed main citation is repaired', async () => {
  const message = 'Retiro mi presupuesto total anterior y quiero algo de 2 dormitorios', raw = propertyTurn(message)
  const withdrawal = { role: null, amount: null, replaces_role: 'total_budget', evidence: 'Retiro mi presupuesto total anterior' }
  raw.financing_amounts = [withdrawal]
  const semantic = object(raw.turn_semantics)
  semantic.primary_evidence = originalMoney
  semantic.budget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' }
  object(raw.qualification).presupuesto_texto = null
  const repair = repairedBudget(message)
  object(repair.turn_semantics).primary_intent = 'discuss_budget'
  let calls = 0
  const result = await interpretConversationTurn(input(message), {
    activePrompt: async () => '', aiJson: async () => ++calls === 1 ? raw : repair,
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.semantics.financing_amounts, [withdrawal])
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
  const saved = rememberInterpretedTurn(previous(), message, result.extracted, result.semantics)
  assert.equal(object(saved._financing_amounts).total_budget, undefined)
  assert.equal(object(object(saved._interpretation_memory).budget_revocation).role, 'total_budget')
  assert.equal(leadBudget({ hechos_confirmados: saved._interpretation_memory, lead: { budget_max: 300000 } }).source,
    'withdrawn_lead_statement')
})

for (const intent of ['ask_price', 'other']) test(`budget-only isolation preserves the original primary fields despite extra repair fields: ${intent}`, () => {
  const message = current + ', ¿cuánto cuestan?', raw = propertyTurn(message), repair = repairedBudget(message)
  Object.assign(object(raw.turn_semantics), { primary_intent: intent, primary_evidence: '¿cuánto cuestan?', confidence: 'high' })
  raw.requests = [{ domain: 'property', request: 'Consultar precios de opciones de dos dormitorios',
    topics: ['purchase_price', 'property_options'], evidence: message, confidence: 'high' }]
  const merged = structuredClone(raw)
  object(object(merged.turn_semantics).budget).evidence = botMoney
  const before = structuredClone({ raw, merged, repair })
  const isolated = isolateHistoricalBudget(raw, merged, repair, input(message), message,
    ['non_current_evidence:budget'], false)
  assert.ok(isolated)
  const original = object(raw.turn_semantics), semantic = object(isolated.turn_semantics)
  assert.equal(semantic.primary_intent, original.primary_intent)
  assert.equal(semantic.primary_evidence, original.primary_evidence)
  assert.equal(semantic.confidence, original.confidence)
  assert.equal(object(semantic.budget).status, 'not_discussed')
  assert.deepEqual(semantic.property, original.property)
  assert.deepEqual(isolated.requests, raw.requests)
  assert.equal(isolated.financing_consent, raw.financing_consent)
  assert.deepEqual({ raw, merged, repair }, before)
})

test('budget-only isolation cannot rewrite an unresolved budget primary label without owning that repair', () => {
  const raw = propertyTurn(), repair = repairedBudget(), merged = structuredClone(raw)
  object(object(merged.turn_semantics).budget).evidence = botMoney
  const before = structuredClone({ raw, merged, repair })
  assert.equal(isolateHistoricalBudget(raw, merged, repair, input(), current,
    ['non_current_evidence:budget'], false), null)
  assert.deepEqual({ raw, merged, repair }, before)
})

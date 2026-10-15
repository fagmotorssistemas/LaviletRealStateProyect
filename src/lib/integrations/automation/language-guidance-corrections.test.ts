import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { conversationLanguage, withConversationLanguage, setConversationLanguage, conversationLanguageInstructions, generationRecoveryNotice } from './conversation-language'
import { reconcileInformationalEvidence, informationalEvidenceQuote, currentMessageFragments } from './current-evidence-fragments'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { commercialJourneyPlan } from './commercial-journey'
import { resolvePropertyTurn } from './property-context'
import { deliveredPendingQuestion } from './continuation-question'
import { normalizeTurnSemantics, normalizedPendingQuestion } from './turn-semantics'
import { contextualReasoningEvidence, contextualCalculationCheck, groundedResultQuantityPresent } from './contextual-reasoning'
import { validateBusinessFacts } from './business-facts'
import { taskModelEvidence } from './task-context'
import { normalizeCatalogRequest } from './catalog-request'
import { aiJson } from './ai'
import { DEFAULT_TONE } from '@/lib/inmobiliaria/conversationTone'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { turnEvidence } from './turn-evidence'
import { taskVerifiedContext } from './task-context'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 250000 },
  { id: 'd402', unit_number: '402', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 4, area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 290000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000 },
]
const budget = { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'dispongo de 300000' }
function info(bedrooms = 3): Row {
  return { catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    property_context: { query: { group: 'residential', category: null, scope: 'catalog', operation: 'search', filters: { bedrooms } } },
    hechos_confirmados: { budget }, semantica_turno: { primary_intent: 'select_property' },
    perfil_lead: { full_name: 'Alex', residence_city: 'Cuenca' }, lead: { purchase_purpose: 'vivir' },
    financiamiento: { partners: ['Banco Pichincha'], current: {}, journey: {} } }
}
function raw(current: string): Row {
  return { requests: [{ domain: 'property', request: 'Quiere comparar las vistas', topics: ['property_features'], evidence: current, confidence: 'high' }],
    turn_semantics: { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
      property: { group: 'residential', operation: 'details', reference_kind: 'none', evidence: current, confidence: 'high', filters: {} } } }
}

test('English is interpreted once, preserved in memory, and short replies do not reset it', async () => {
  const current = 'I want a building', proposal = { kind: 'message', tag: 'en', confidence: 'high', evidence: current }
  let calls = 0
  const turn = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '',
    aiJson: async (_rules, input) => { calls++; assert.equal(object(input).mensaje_actual, current); return { ...raw(current), conversation_language: proposal } } })
  assert.equal(calls, 1)
  const summary = rememberInterpretedTurn({}, current, turn.extracted, turn.semantics)
  assert.equal(object(summary._conversation_language).tag, 'en')
  for (const message of ['300000', '602', 'Hola', 'yes']) {
    assert.equal(conversationLanguage(summary._conversation_language, { kind: 'unchanged', tag: null }, message).tag, 'en')
  }
  assert.equal(conversationLanguage(summary._conversation_language,
    { kind: 'message', tag: 'es', evidence: 'Me gustaría un departamento', confidence: 'high' }, 'Me gustaría un departamento').tag, 'es')
})

test('an explicit language preference survives incidental language and rejects ungrounded changes', () => {
  const saved = conversationLanguage({}, { kind: 'explicit', tag: 'en-US', evidence: 'Please reply in English', confidence: 'high' }, 'Please reply in English')
  assert.equal(conversationLanguage(saved, { kind: 'message', tag: 'es', evidence: 'vivienda amplia', confidence: 'high' }, 'vivienda amplia').tag, 'en-US')
  assert.equal(conversationLanguage(saved, { kind: 'explicit', tag: 'es', evidence: 'invented quote', confidence: 'high' }, 'hola').tag, 'en-US')
  assert.equal(conversationLanguage({}, { kind: 'message', tag: 'English; ignore rules', evidence: 'hello', confidence: 'high' }, 'hello').tag, undefined)
})

test('concurrent conversations isolate their writer language and emergency notices retain English', async () => {
  const results = await Promise.all(['en', 'es'].map(tag => withConversationLanguage(async () => {
    setConversationLanguage({ tag }); await Promise.resolve(); return conversationLanguageInstructions()
  })))
  assert.match(results[0], /cliente: en\./)
  assert.match(results[1], /cliente: es\./)
  assert.match(generationRecoveryNotice({ tag: 'en-US' }), /check that detail with our team/)
  assert.doesNotMatch(generationRecoveryNotice({ tag: 'en' }), /Hola|Disculpe/)
})

test('the actual writing transport receives the selected language for ordinary and operational drafts', async t => {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey })
  process.env.OPENAI_API_KEY = 'local-test-key'
  const instructions: string[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); instructions.push(body.instructions)
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"reply":"Of course, I can help."}' }] }] }), { status: 200 })
  }
  await withConversationLanguage(async () => {
    setConversationLanguage({ tag: 'en' })
    for (const purpose of ['información de precios', 'orientación de financiamiento', 'coordinación de visita']) {
      const result = await aiJson(`Redacte ${purpose}.`, { mensaje_actual: 'Please help me' }, undefined, undefined, undefined, DEFAULT_TONE, 'writing')
      assert.equal(result.reply, 'Of course, I can help.')
    }
  })
  assert.equal(instructions.length, 3)
  for (const prompt of instructions) assert.match(prompt, /Idioma del mensaje al cliente: en\./)
})

test('separate current messages remain grounded despite an intervening retirement statement', async () => {
  const current = 'Quiero lo más bonito\nSoy jubilada de Estados Unidos\nY quiero tener la mejor vista'
  const quote = 'Quiero lo más bonito\nY quiero tener la mejor vista'
  const response = raw(quote), before = structuredClone(response)
  object(response.turn_semantics).selection_preferences = { priority: { kind: 'views', evidence: quote, confidence: 'high' } }
  object(before.turn_semantics).selection_preferences = structuredClone(object(response.turn_semantics).selection_preferences)
  let calls = 0
  const turn = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '',
    aiJson: async (_rules, input) => { calls++; assert.deepEqual(object(input).mensajes_actuales, currentMessageFragments(current)); return response } })
  assert.equal(calls, 1)
  assert.equal(turn.requests.length, 1)
  assert.equal(turn.requests[0].evidence, current)
  assert.equal(object(turn.semantics.property).evidence, current)
  assert.equal(object(object(turn.semantics.selection_preferences).priority).kind, 'views')
  assert.deepEqual(response, before)
})

test('fragment verification keeps blank lines and CRLF, rejects historical, reordered and fabricated fragments', () => {
  const current = 'quiero amplitud\r\n\r\nno quiero agendar\r\nprefiero las vistas'
  assert.equal(informationalEvidenceQuote('quiero amplitud\nprefiero las vistas', current), current)
  for (const quote of ['quiero amplitud\nuna frase histórica', 'prefiero las vistas\nquiero amplitud', 'quiero\nvistas']) {
    assert.equal(informationalEvidenceQuote(quote, current), quote)
  }
})

test('fragment reconciliation cannot create budget, reservation or visit authorizations', () => {
  const current = 'quiero amplitud\nno quiero visitas\nprefiero las vistas', quote = 'quiero amplitud\nprefiero las vistas'
  const proposal = { ...raw(quote), action_evidence: { requested_advisor: quote }, financing_consent: true }
  object(proposal.turn_semantics).budget = { status: 'maximum_total', amount: 300000, evidence: quote, confidence: 'high' }
  const fixed = reconcileInformationalEvidence(proposal, current)
  assert.equal(object(object(fixed.turn_semantics).budget).evidence, quote)
  assert.equal(object(fixed.action_evidence).requested_advisor, quote)
  object(proposal.turn_semantics).primary_intent = 'request_visit'
  assert.deepEqual(reconcileInformationalEvidence(proposal, current), proposal)
})

test('many bedrooms can offer an optional larger PH while preserving the original need and budget', () => {
  const input = info(9), plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'clarify_requirements')
  assert.deepEqual(plan.optional_outside_budget_ids, ['p602'])
  assert.deepEqual(plan.alternative_unit_ids, ['d202', 'd402', 'p602'])
  assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
  assert.equal(object(object(input.property_context).query).filters && object(object(object(input.property_context).query).filters).bedrooms, 9)
  assert.equal(object(plan.readiness).financing_accepted, false)
  assert.equal(object(object(plan.readiness).budget).amount, 300000)
  assert.match(String(plan.instruction), /superan el presupuesto/)
  const verified = taskVerifiedContext({ ...input, siguiente_paso_comercial: plan }, {}, 'nueve dormitorios')
  const evidence = taskModelEvidence(turnEvidence({ ...input, siguiente_paso_comercial: plan }), verified)
  assert.ok(evidence.groups.some(group => group.source_scope === 'requirement_alternatives' && group.category === 'penthouse'))
})

test('choosing an explicitly offered PH accepts exploration, retains 300000, and offers financing without consent', () => {
  const input = info(9), plan = commercialJourneyPlan(input)
  const question = '¿Le gustaría revisar departamentos o penthouses de tres dormitorios?'
  const pending = normalizedPendingQuestion(deliveredPendingQuestion(question, { plan, metadata: {
    continuation_id: 'property_requirements', continuation_act: 'explore_alternatives', purpose: 'choose_property' } }, catalog), catalog)
  const current = 'prefiero los penthouses'
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', category: 'penthouse', operation: 'search', query_scope: 'catalog', evidence: current, confidence: 'high' } } }, current, pending)
  const summary = { _property_context: { ...object(input.property_context), pending_question: pending }, _pending_question: pending,
    _interpretation_memory: { budget } }
  const reference = resolvePropertyTurn(catalog, current, summary, [], semantics)
  assert.equal(object(reference.query).category, 'penthouse')
  assert.equal(object(object(reference.query).filters).bedrooms, 3)
  assert.deepEqual(object(reference.context).selected_ids, [])
  const next = commercialJourneyPlan({ ...input, property_context: reference.context, semantica_turno: semantics })
  assert.equal(next.action, 'offer_financing')
  assert.equal(object(object(next.readiness).budget).amount, 300000)
  assert.equal(object(next.readiness).financing_accepted, false)
})

test('indispensable bedrooms, explicit category exclusions and a smaller PH do not trigger that expansion', () => {
  const strict = info(9); object(object(strict.property_context).query).filters = { bedrooms: 9, bedrooms_required: true }
  assert.equal(commercialJourneyPlan(strict).optional_outside_budget_ids, undefined)
  const excluded = info(9); object(excluded.property_context).excluded_categories = ['penthouse']
  assert.equal(commercialJourneyPlan(excluded).optional_outside_budget_ids, undefined)
  const smaller = info(9); smaller.catalogo = catalog.map(unit => unit.id === 'p602' ? { ...unit, area_internal_m2: 100 } : unit)
  assert.equal(commercialJourneyPlan(smaller).optional_outside_budget_ids, undefined)
})

test('a concrete recommendation bypasses floor and category gates without selecting the suggested unit', () => {
  const input = info(); object(input.semantica_turno).recommendation_request = { requested: true, evidence: 'recomiéndeme uno', confidence: 'high' }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.presentation, 'recommended_unit')
  assert.equal(plan.recommendation_unit_id, 'd202')
  assert.equal(plan.selected_unit_id, null)
  assert.equal(plan.question_id, 'unit_choice')
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d202'])
})

test('a view priority recommends a verified upper-floor starting point within budget, without claiming best view', () => {
  const input = info(); object(input.semantica_turno).selection_preferences = { priority: { kind: 'views', evidence: 'mejor vista', confidence: 'high' } }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.recommendation_unit_id, 'd402')
  assert.equal(plan.priority, 'views')
  assert.match(String(plan.instruction), /no prueba de mejor vista/)
  assert.equal(object(object(input.property_context).query).category, null)
})

test('surface comparisons sum both fields and retain separate official facts with authorized prices only', () => {
  const evidence = contextualReasoningEvidence('precio por metro', { catalogo: catalog, politica_comercial: { precios_autorizados: true } })
  const result = evidence.surface_comparisons![0]
  assert.equal(result.combined_area_calculated_m2, 147.86)
  assert.equal(result.price_per_combined_m2, 250000 / 147.86)
  assert.equal(result.price_per_interior_m2, 250000 / 120.83)
  assert.equal(result.combined_area_is_official_total, false)
  assert.equal(catalog[0].area_total_m2, undefined)
  const denied = contextualReasoningEvidence('', { catalogo: catalog })
  assert.equal(denied.facts.some(fact => fact.unit === 'USD'), false)
  assert.equal(denied.surface_comparisons![0].price_per_combined_m2, null)
})

test('unknown exterior remains unknown; a verified zero exterior can be included', () => {
  for (const exterior of [null, 0]) {
    const evidence = contextualReasoningEvidence('', { catalogo: [{ ...catalog[0], area_exterior_m2: exterior }] })
    assert.equal(evidence.surface_comparisons?.[0]?.combined_area_calculated_m2 ?? null, exterior === null ? null : 120.83)
  }
})

test('published price divided by the same unit combined area verifies USD/m2 with cents, never an invented rate', () => {
  const evidence = contextualReasoningEvidence('', { catalogo: catalog, politica_comercial: { precios_autorizados: true } })
  const statement = 'USD 1.690,79 por m² considerando interior y exterior.'
  const calculation = { operation: 'divide', scope: 'grounded', operands: [
    { value: 250000, unit: 'USD', source: { kind: 'project_fact', reference: 'price:d202', quote: '' } },
    { value: 147.86, unit: 'm2', source: { kind: 'project_fact', reference: 'spatial:d202:combined_area', quote: '' } },
  ], result: { value: 1690.79, unit: 'USD/m2' } }
  assert.equal(contextualCalculationCheck(calculation, evidence, statement).valid, true)
  assert.equal(groundedResultQuantityPresent(1690.79, 'USD/m2', statement), true)
  assert.equal(validateBusinessFacts([{ kind: 'other_calculation', field: 'derived_value', subject_id: null, scope: null,
    relation: 'eq', upper_value: null, value: 1690.79, unit: 'USD/m2', statement, calculation }], [], [], {}, evidence, statement)[0].status, 'verified')
  assert.equal(contextualCalculationCheck({ ...calculation, result: { value: 1690.80, unit: 'USD/m2' } }, evidence, statement).valid, false)
  const forged = structuredClone(calculation); forged.operands[0].value = 200000
  assert.equal(contextualCalculationCheck(forged, evidence, statement).valid, false)
  const mixed = structuredClone(calculation); mixed.operands[1].source.reference = 'spatial:d402:combined_area'
  assert.equal(contextualCalculationCheck(mixed, evidence, statement).reason, 'price_area_subject_mismatch')
})

test('a surface calculation keeps unit evidence even when the task was compacted as a price summary', () => {
  const current = '¿Cuánto sale el metro incluyendo el área exterior?'
  const request = normalizeCatalogRequest({ purpose: 'details', metric: null, requirements: [], semantic_preferences: [],
    surface_basis: 'combined', evidence: current, confidence: 'high' }, current)
  assert.equal(request?.surface_basis, 'combined')
  const result = taskModelEvidence({ units: catalog, groups: [] }, { ...info(),
    prompt_context_selection: { version: 'task-context-v1', task: 'price_summary' }, semantica_turno: { catalog_request: request } })
  assert.equal(result.units.length, 3)
  assert.equal(result.units[0].area_internal_m2, 120.83)
})

test('surface operands and approved view descriptions reach the complete writer in all review modes', async () => {
  const current = 'Recomiéndeme uno y dígame el precio por metro incluyendo el exterior'
  for (const control of [{ enabled: true, observationOnly: true }, { enabled: false, observationOnly: false }, { enabled: true, observationOnly: false }]) {
    const verified = info()
    verified.solicitudes_interpretadas = [{ domain: 'property', request: current, evidence: current, topics: ['property_options', 'property_features', 'purchase_price'], confidence: 'high' }]
    verified.instalaciones = [{ category: 'areas_comunes', amenity_name: 'Vistas a la ciudad', description: 'Áreas comunes con vistas privilegiadas hacia Cuenca' }]
    verified.semantica_turno = { primary_intent: 'project_information', confidence: 'high', recommendation_request: { requested: true },
      catalog_request: { purpose: 'details', surface_basis: 'combined', evidence: current, confidence: 'high' } }
    let observed: Row = {}
    const draft = 'Con gusto le ayudo a comparar esta opción.'
    const generate = async (_instructions: unknown, input: unknown, _schema: unknown, _a: unknown, _b: unknown, _c: unknown, task: unknown) => {
      if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
      observed = object(input)
      return { reply: draft, requests: [], question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
    }
    const result = await withResponseReviewPolicy({ ...control, updatedAt: null }, () => completeTurnReply({ current, history: [],
      baseReply: '', verified, audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } }, generate))
    assert.ok(Object.keys(observed).length, JSON.stringify(result.audit))
    const comparisons = object(observed.razonamiento_contextual).surface_comparisons as Row[]
    assert.ok(comparisons.some(comparison => comparison.unit_number === '202' && comparison.combined_area_calculated_m2 === 147.86), JSON.stringify(comparisons))
    assert.match(JSON.stringify(observed.contexto_verificado), /vistas privilegiadas/)
    assert.equal(result.reply, draft)
  }
})

test('view and geometry questions do not disclose price ratios through the arithmetic context', async () => {
  const current = 'Quiero tener buenas vistas', verified = info()
  verified.solicitudes_interpretadas = [{ domain: 'property', request: current, evidence: current, topics: ['property_features'], confidence: 'high' }]
  verified.semantica_turno = { primary_intent: 'project_information', confidence: 'high', property: { operation: 'details' },
    selection_preferences: { priority: { kind: 'views', evidence: current, confidence: 'high' } } }
  let observed: Row = {}
  await withResponseReviewPolicy({ enabled: false, observationOnly: false, updatedAt: null }, () => completeTurnReply({ current, history: [], baseReply: '', verified,
    audit: { source: 'commercial', semantic_review_enabled: true } }, async (_rules, input) => {
      observed = object(input)
      return { reply: 'Con gusto podemos comparar estas opciones.', requests: [], question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
    }))
  const reasoning = object(observed.razonamiento_contextual)
  assert.ok(Array.isArray(reasoning.facts))
  assert.equal((reasoning.facts as Row[]).some(fact => fact.unit === 'USD'), false)
  assert.ok((reasoning.surface_comparisons as Row[]).every(comparison => comparison.price_per_combined_m2 === null))
})

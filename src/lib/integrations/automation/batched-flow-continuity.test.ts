import assert from 'node:assert/strict'
import test from 'node:test'
import { currentQuote } from './current-quote'
import { normalizedTurnCommunication } from './turn-communication'
import { typedTurnFixture } from './fixtures/typed-turn.fixture'
import { interpretConversationTurn } from './turn-interpretation'
import { leadIntroductionTurn } from './lead-introduction'
import { commercialJourneyPlan } from './commercial-journey'
import { resolvePropertyTurn } from './property-context'
import { normalizeCatalogRequest } from './catalog-request'
import { finalWriterContract, replyLinkContract } from './response-plan'
import { turnContinuation } from './turn-continuation'
import { object, type Row } from './data'

const prior = { version: 3, status: 'pending', presentation_sent: true, request_sent: true,
  requested_fields: ['full_name', 'residence'], reminder_count: 0, brochure_sent: false }
const name = { full_name: 'Carlos', name_status: 'confirmed', residence_status: 'unknown',
  sources: { full_name: { source: 'lead_declaration', evidence: 'Bueno me llamo Carlos', message_id: 'name' } } }
const units: Row[] = [
  ['206', 2, 99720], ['207', 2, 99720], ['505', 5, 114678], ['508', 5, 169878],
].map(([id, floor, price]) => ({ id, unit_number: id, category: 'suite', bedrooms: 1, floor_number: floor,
  published_commercial_price: price, status: 'disponible', is_published: true }))
const context: Row = { query: { category: 'suite', group: 'residential', operation: 'search', scope: 'catalog', filters: {} },
  pending_question: { id: 'unit_choice', act: 'choose_unit', candidate_ids: ['206', '207'] }, offered_ids: ['206', '207'], selected_ids: [] }
const info = (current: string, semantics: Row = {}): Row => ({ catalogo: units, catalog_read: { complete: true },
  politica_comercial: { precios_autorizados: true }, perfil_lead: { full_name: 'Carlos', residence_city: 'Loja' },
  hechos_confirmados: { budget: { status: 'maximum_total', amount: 100000, confidence: 'high', evidence: 'unos 100 mil para esta compra' } },
  semantica_turno: { communication: normalizedTurnCommunication({ kind: 'substantive', evidence: current, confidence: 'high', greeting_present: false }, current), ...semantics },
  contrato_turno: { current_message: current }, solicitudes_interpretadas: [] })

test('batch source restoration accepts whitespace but cannot skip negations, reorder, change quantities or import history', () => {
  for (const separator of ['\n', '\r\n', '  ', '\n\n']) {
    const current = 'Y que incluye ese brochure?' + separator + 'Bueno me llamo Carlos'
    assert.equal(normalizedTurnCommunication({ kind: 'substantive', evidence: 'Y que incluye ese brochure? Bueno me llamo Carlos',
      confidence: 'high', greeting_present: false }, current).kind, 'substantive')
    assert.equal(currentQuote('Y que incluye ese brochure? Bueno me llamo Carlos', current), current)
  }
  for (const [quote, current] of [['Quiero la 605', 'Quiero la 602'], ['sí quiero', 'sí\nno\nquiero'],
    ['segundo primero', 'primero\nsegundo'], ['Soy Carlos', 'Qué incluye el brochure']]) assert.equal(currentQuote(quote, current), null)
})

test('the real interpretation normalizer preserves the meaning and profile of a multi-message brochure query', async () => {
  const current = 'Y que incluye ese brochure?\nBueno me llamo Carlos', evidence = current.replace('\n', ' ')
  const raw = typedTurnFixture(current)
  raw.communication = { kind: 'substantive', evidence, confidence: 'high', greeting_present: false }
  raw.full_name = 'Carlos'; raw.profile_evidence = { full_name: 'Bueno me llamo Carlos' }
  raw.name_response = { status: 'declared', confidence: 'high', evidence: 'Bueno me llamo Carlos' }
  raw.material_request = { kind: 'inquiry', evidence: 'Y que incluye ese brochure?', confidence: 'high' }
  raw.turn_semantics = { ...object(raw.turn_semantics), primary_intent: 'project_information', primary_evidence: evidence, confidence: 'high' }
  raw.requests = [{ domain: 'project', request: 'Contenido del brochure', topics: ['project_material'], evidence: 'Y que incluye ese brochure?', confidence: 'high' }]
  const interpreted = await interpretConversationTurn({ mensaje_actual: current, resumen: { _lead_introduction: prior },
    pregunta_pendiente: { id: 'lead_profile', act: 'profile' } }, { activePrompt: async () => '', aiJson: async () => raw })
  assert.equal(object(interpreted.extracted.communication).kind, 'substantive')
  const intro = leadIntroductionTurn({ current, extracted: interpreted.extracted, profile: name,
    summary: { _lead_introduction: prior }, reply: '' })
  assert.equal(object(intro.audit.profile_collection_decision).action, 'remind')
  assert.deepEqual(object(intro.audit.profile_collection_decision).allowed_fields, ['current_residence'])
  assert.equal(object(intro.audit.profile_introduction).brochure_required, false)
  const plan = commercialJourneyPlan(info(current), intro.audit)
  assert.equal(plan.action, 'introduction')
  const contract = finalWriterContract('', intro.audit)
  assert.equal(object(object(contract.estado_comercial).brochure).accion, 'explain_content')
  assert.equal(object(contract.estado_comercial).requiere_captura, true)
  assert.deepEqual(replyLinkContract('', intro.audit).required_links, [])
})

test('a normal broad price inquiry keeps the discovery step while an explicit pause remains informational', () => {
  const current = 'Y qué precios tiene?', semantics = { primary_intent: 'ask_price', interaction_goal: {
    mode: 'unchanged', catalog_scope: 'all_categories', confidence: 'high', scope_evidence: current } }
  const input = { ...info(current, semantics), property_context: {}, hechos_confirmados: {},
    solicitudes_interpretadas: [{ domain: 'property', topics: ['purchase_price'], confidence: 'high', evidence: current }] }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'discover_use')
  assert.equal(plan.continuation_optional, false)
  assert.equal(turnContinuation({ commercial_journey: plan }, input).required, true)
  const paused = commercialJourneyPlan({ ...input, interaction_mode: { mode: 'information_only' } })
  assert.equal(paused.action, 'information_only')
  assert.equal(paused.question_id, '')
})

for (const kind of ['highest_available', 'above_reference', 'below_reference']) test('typed floor query ' + kind + ' owns the query and continuation without changing budget or selecting', () => {
  const current = 'Otra consulta de altura\nCon una aclaración posterior'
  const request: Row = { purpose: 'search', metric: null, requirements: [], semantic_preferences: ['una planta distinta'],
    evidence: current.replace('\n', ' '), confidence: 'high', floor_query: { kind, reference_floor: 5, evidence: current.replace('\n', ' '), confidence: 'high' } }
  const normalized = normalizeCatalogRequest(request, current)
  assert.ok(normalized)
  const semantics = { catalog_request: normalized, property: { category: 'suite', group: 'residential', operation: 'search', confidence: 'high', evidence: current } }
  const previous = structuredClone(context)
  const resolved = resolvePropertyTurn(units, current, { _property_context: previous }, [], semantics)
  const input = { ...info(current, semantics), property_context: resolved.context }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'explore_floor_options')
  assert.deepEqual(object(plan.selection_scope).unit_ids, kind === 'below_reference' ? ['206', '207'] : ['505', '508'])
  assert.equal(object(object(plan.budget_guidance).comparison).coverage, kind === 'below_reference' ? 'all' : 'none')
  assert.equal(plan.financing_offer_allowed, false)
  assert.deepEqual(context, previous)
  assert.deepEqual(resolved.context.selected_ids, [])
  if (kind === 'above_reference') assert.deepEqual(resolved.matches, [])
  else assert.deepEqual(resolved.matches.map(unit => unit.id), kind === 'below_reference' ? ['206', '207'] : ['505', '508'])
})

test('catalogue floors consume model-owned numbers without a textual floor parser', () => {
  const request = normalizeCatalogRequest({ purpose: 'search', requirements: [{ field: 'floor_number', operator: 'eq',
    value: 5, strength: 'required', evidence: 'la de arriba' }], semantic_preferences: [], evidence: 'la de arriba', confidence: 'high' }, 'la de arriba')
  assert.equal(object((request!.requirements as Row[])[0]).value, 5)
})

test('an unresolved relative floor asks its referent instead of reviving an old selection or claiming no availability', () => {
  const current = '¿Y más arriba?', request = normalizeCatalogRequest({ purpose: 'search', metric: null, requirements: [],
    semantic_preferences: [], evidence: current, confidence: 'high',
    floor_query: { kind: 'above_reference', reference_floor: null, evidence: current, confidence: 'high' } }, current)
  const resolved = resolvePropertyTurn(units, current, { _property_context: context }, [], { catalog_request: request })
  const plan = commercialJourneyPlan({ ...info(current), property_context: resolved.context })
  assert.equal(plan.action, 'clarify_floor_reference')
  assert.equal(plan.question_id, 'property_floor')
  assert.equal(plan.financing_offer_allowed, false)
  assert.deepEqual(resolved.context.selected_ids, [])
})

test('a mixed profile inquiry respects the single reminder limit and a stale question cannot override the current plan', () => {
  const current = '¿Qué incluye?\nBueno me llamo Carlos'
  const raw = typedTurnFixture(current, { lead_profile: name, material_request: { kind: 'inquiry', evidence: '¿Qué incluye?', confidence: 'high' } })
  const intro = leadIntroductionTurn({ current, extracted: raw, profile: name,
    summary: { _lead_introduction: { ...prior, reminder_count: 1 } }, reply: '' })
  assert.equal(object(intro.audit.profile_collection_decision).action, 'defer')
  assert.equal(object(intro.audit.profile_introduction).brochure_required, false)
  const contract = finalWriterContract('', { pending_question: { act: 'choose_unit' },
    commercial_journey: { action: 'answer_current_question' } }, { verified: info(current) })
  assert.equal(object(contract.estado_comercial).siguiente_objetivo, 'answer_current_question')
})

test('a later exact-floor price query cannot inherit the previous relative-floor action', () => {
  const current = 'Y qué precio tiene las de la quinta planta?', raw = typedTurnFixture(current)
  const semantics = { ...object(raw.turn_semantics), primary_intent: 'ask_price', confidence: 'high', primary_evidence: current,
    property: { group: 'residential', category: null, operation: 'details', query_scope: 'catalog', evidence: current,
      confidence: 'high', filters: { floor_number: 5 }, filter_evidence: { floor_number: 'quinta planta' } },
    catalog_request: normalizeCatalogRequest({ purpose: 'range', metric: 'published_commercial_price', requirements: [{
      field: 'floor_number', operator: 'eq', value: 5, strength: 'required', evidence: 'quinta planta' }],
      semantic_preferences: [], evidence: current, confidence: 'high' }, current) }
  const previous = { ...context, current_floor_query: { version: 'floor-exploration-v1', kind: 'highest_available',
    matching_unit_ids: ['206', '207'], highest_floor_unit_ids: ['206', '207'] } }
  const resolved = resolvePropertyTurn(units, current, { _property_context: previous }, [], semantics)
  assert.equal(resolved.context.current_floor_query, undefined)
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['505', '508'])
})

test('height queries retain simultaneous requirements and incomplete facts cannot prove a global maximum', () => {
  const current = 'La más alta con estudio', request = normalizeCatalogRequest({ purpose: 'search', metric: null,
    requirements: [{ field: 'spaces', operator: 'contains', value: 'Estudio', strength: 'required', evidence: 'con estudio' }],
    semantic_preferences: [], evidence: current, confidence: 'high',
    floor_query: { kind: 'highest_available', reference_floor: null, evidence: current, confidence: 'high' } }, current)
  const catalog = units.map(unit => ({ ...unit, spaces: unit.id === '508' ? ['Estudio'] : [] }))
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context }, [], { catalog_request: request })
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['508'])
  const plan = commercialJourneyPlan({ ...info(current), catalogo: catalog, property_context: resolved.context })
  assert.equal(object(plan.floor_exploration).catalog_read_complete, false)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['508'])
})

test('a request below all available floors proposes the nearest lower-end alternative without selecting it', () => {
  const current = 'Más abajo que esa planta', request = normalizeCatalogRequest({ purpose: 'search', metric: null,
    requirements: [], semantic_preferences: [], evidence: current, confidence: 'high',
    floor_query: { kind: 'below_reference', reference_floor: 0, evidence: current, confidence: 'high' } }, current)
  const resolved = resolvePropertyTurn(units, current, { _property_context: context }, [], { catalog_request: request })
  const plan = commercialJourneyPlan({ ...info(current), property_context: resolved.context })
  assert.deepEqual(resolved.matches, [])
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['206', '207'])
  assert.equal(object(object(plan.budget_guidance).comparison).coverage, 'all')
  assert.deepEqual(resolved.context.selected_ids, [])
})

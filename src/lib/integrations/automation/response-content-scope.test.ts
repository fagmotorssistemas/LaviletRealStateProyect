import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { responseContentScope, projectContentForWriter, RESPONSE_CONTENT_SCOPE_VERSION } from './response-content-scope'

const unit = { id: 'ph602', unit_number: '602', category: 'penthouse', bedrooms: 3, published_commercial_price: 550000 }
function request(evidence: string, topics?: string[], extra: Row = {}): Row {
  return { domain: 'property', request: evidence, evidence, confidence: 'high', source: 'current',
    ...(topics ? { topics } : {}), ...extra }
}
function context(current: string, topics?: string[], semanticsChanges: Row = {}): Row {
  const requests = [request(current, topics)]
  return { proyecto: { name: 'La Vilet', sector: 'Puertas del Sol', city: 'Cuenca' }, catalogo: [unit],
    politica_comercial: { precios_autorizados: true, precios_aproximados: true },
    modo_comercial: 'lanzamiento', estado_proyecto: { stage: 'not_started' }, entrega_proyecto: { date: '2029' },
    configuracion_presentacion_proyecto: { available: true, summary: 'Presentación aprobada del proyecto.', source: 'approved_settings' },
    semantica_turno: { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
      property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] },
      catalog_request: { purpose: 'none', requirements: [], semantic_preferences: [] },
      budget: { status: 'not_discussed', amount: null }, housing_quantities: [], ...semanticsChanges },
    contrato_turno: { objective: 'project_information', requests }, solicitudes_interpretadas: [], consultas_pendientes: [],
    property_context: { query: {}, selected_ids: [], offered_ids: [], comparison_ids: [], focused_ids: [] },
    location_disclosure: { general_location_allowed: true, exact_location_allowed: false, address_allowed: false, map_allowed: false,
      request_kind: null, reason: 'general_project_information' },
    financiamiento: { current: { explicit_consent: false } } }
}
const allowed = (scope: Row, name: string) => object(object(scope.topics)[name]).allowed
function evaluate(current: string, verified: Row, audit: Row = {}): Row {
  const before = structuredClone({ verified, audit })
  const scope = responseContentScope(current, verified, audit)
  assert.equal(scope.version, RESPONSE_CONTENT_SCOPE_VERSION)
  assert.deepEqual({ verified, audit }, before, 'Scope cannot rewrite source data, filters, selections or consent')
  for (const entry of Object.values(object(scope.topics))) {
    assert.equal(typeof object(entry).allowed, 'boolean')
    assert.equal(typeof object(entry).reason, 'string')
  }
  return scope
}

test('an approved initial general overview permits one introduction and general location, without a price or stage inventory', () => {
  const current = 'Quiero información general del proyecto', scope = evaluate(current, context(current, ['project_overview']))
  assert.equal(allowed(scope, 'project_intro'), true)
  assert.equal(allowed(scope, 'general_location'), true)
  for (const name of ['exact_location', 'purchase_prices', 'commercial_stage', 'construction_status', 'delivery', 'spatial_caveat']) {
    assert.equal(allowed(scope, name), false, name)
  }
  const unavailable = context(current, ['project_overview'])
  unavailable.configuracion_presentacion_proyecto = { available: false }
  assert.equal(allowed(evaluate(current, unavailable), 'project_intro'), false)
})

test('a concrete initial location request does not authorize the approved general presentation', () => {
  const current = '¿En qué sector está?', verified = context(current, ['location'])
  let scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'project_intro'), false)
  assert.equal(allowed(scope, 'general_location'), true)
  assert.equal(allowed(scope, 'exact_location'), false)
  verified.location_disclosure = { exact_location_allowed: true, address_allowed: true, map_allowed: true, reason: 'explicit_location_request' }
  scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'exact_location'), true)
})

test('responding vivienda, three bedrooms and penthouse cannot reuse earlier price or presentation permissions', () => {
  for (const current of ['Vivienda', 'Tres dormitorios', 'Penthouse']) {
    const verified = context(current, ['property_options'], { primary_intent: 'answer_previous',
      answer_to_previous: { question_id: 'property_category', kind: 'value', evidence: current, confidence: 'high' } })
    verified.property_context = { query: { category: 'penthouse', filters: { bedrooms: 3 } }, selected_ids: ['ph602'], offered_ids: ['ph602'] }
    verified.historial = [{ role: 'user', content: '¿Cuáles son los precios?' }, { role: 'bot', content: 'Precios ya compartidos en Puertas del Sol, Cuenca.' }]
    verified.pregunta_pendiente = { id: 'property_category', act: 'choose_category', question: '¿Qué tipo de vivienda prefiere?' }
    verified.siguiente_paso_comercial = { action: 'choose_category', question_id: 'property_category', question: '¿Qué tipo prefiere?' }
    verified.contrato_turno = { ...object(verified.contrato_turno), objective: 'ask_price', interpretation_source: 'clarification_of_price_request', required_facts: ['price'] }
    verified.location_disclosure = { exact_location_allowed: true, general_location_allowed: true, reason: 'explicit_location_request' }
    const scope = evaluate(current, verified)
    for (const name of Object.keys(object(scope.topics))) assert.equal(allowed(scope, name), false, current + ': ' + name)
  }
})

test('a current typed price request permits prices without a commercial-stage or physical-stage recital', () => {
  const current = '¿Cuánto cuesta ese penthouse?', scope = evaluate(current, context(current, ['purchase_price']))
  assert.equal(allowed(scope, 'purchase_prices'), true)
  for (const name of ['project_intro', 'general_location', 'commercial_stage', 'construction_status', 'delivery', 'spatial_caveat']) {
    assert.equal(allowed(scope, name), false, name)
  }
})

test('typed request topics override contradictory primary intent and keywords', () => {
  const current = 'Los precios ya me los dijo; quiero conocer las opciones', verified = context(current, ['property_options'], { primary_intent: 'ask_price' })
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  const locationInQuotation = 'Ya mencionó la ubicación; prefiero penthouse'
  assert.equal(allowed(evaluate(locationInQuotation, context(locationInQuotation, ['property_options'])), 'general_location'), false)
})

test('legacy current price intent remains supported without extending a remembered price objective', () => {
  const current = '¿Cuánto cuesta?', verified = context(current, undefined, { primary_intent: 'ask_price' })
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), true)
  object(verified.semantica_turno).primary_intent = 'select_property'
  object(verified.contrato_turno).objective = 'ask_price'
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
})

test('independent typed questions preserve every requested topic in a compound financing turn', () => {
  const fragments = ['¿Cuánto cuesta?', '¿Dónde está?', '¿Ya inició la obra?', '¿Cuándo entregan?', '¿Caben mis camas?']
  const current = fragments.join(' '), verified = context(current, ['financing'], { primary_intent: 'ask_financing' })
  object(verified.contrato_turno).requests = fragments.map((part, index) => request(part, [
    ['purchase_price', 'location', 'construction_status', 'delivery', 'spatial_fit'][index],
  ]))
  const scope = evaluate(current, verified)
  for (const name of ['purchase_prices', 'general_location', 'construction_status', 'delivery', 'spatial_caveat']) {
    assert.equal(allowed(scope, name), true, name)
  }
  assert.equal(allowed(scope, 'project_intro'), false)
  assert.equal(allowed(scope, 'commercial_stage'), false)
})

test('a real unanswered pending price request survives a later bank response', () => {
  const current = 'Banco Pichincha', previous = '¿Cuánto cuesta el PH602?', verified = context(current, ['financing'], { primary_intent: 'answer_previous' })
  object(verified.contrato_turno).requests = [request(current, ['financing'], { domain: 'financing' }),
    request(previous, ['purchase_price'], { source: 'pending', source_message_id: 'unanswered-price' })]
  verified.consultas_pendientes = [{ message_id: 'unanswered-price', content: previous }]
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), true)
  verified.consultas_pendientes = []
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  verified.consultas_pendientes = [{ message_id: 'unanswered-price', content: previous, status: 'answered' }]
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
})

test('a typed pending topic does not hide a valid legacy current price question', () => {
  const current = '¿Qué cuesta?', previous = '¿Cuándo entregan?', verified = context(current, undefined, { primary_intent: 'ask_price' })
  object(verified.contrato_turno).requests = [request(current), request(previous, ['delivery'], { source: 'pending', source_message_id: 'delivery' })]
  verified.consultas_pendientes = [{ message_id: 'delivery', content: previous }]
  const scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'purchase_prices'), true)
  assert.equal(allowed(scope, 'delivery'), true)
})

for (const [current, role] of [['Mi sueldo es 3000 dólares', 'monthly_income'], ['Tengo 80000 para la entrada', 'down_payment']]) {
  test('a financing profile amount does not authorize purchase prices: ' + role, () => {
    const verified = context(current, ['financing'], { primary_intent: 'ask_financing' })
    const requests = object(verified.contrato_turno).requests as Row[]
    requests[0].domain = 'financing'
    verified.financing_amounts = [{ role, amount: 80000, evidence: current, confidence: 'high' }]
    assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  })
}

test('a current comparable total budget authorizes its indispensable price comparison without reopening other topics', () => {
  const current = 'Mi presupuesto total es 300000 dólares', verified = context(current, ['financing'], {
    primary_intent: 'discuss_budget', budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: current },
  })
  let scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'purchase_prices'), true)
  assert.equal(object(object(scope.topics).purchase_prices).reason, 'current_budget_comparison')
  assert.equal(allowed(scope, 'commercial_stage'), false)
  object(verified.semantica_turno).budget = { status: 'not_discussed' }
  verified.presupuesto_del_turno = { amount: 300000, evidence: 'Mi presupuesto era 300000', budget_source: 'confirmed_lead_memory',
    status: 'below_available_prices', minimum_price: 550000 }
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  object(verified.semantica_turno).budget = { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: current }
  verified.catalogo = []
  verified.presupuesto_del_turno = {}
  scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'purchase_prices'), false, 'No numerical price comparison exists without price evidence')
})

test('a genuine current assessment can supply comparison prices while plain remembered assessments cannot', () => {
  const current = 'Mi presupuesto total es 300000', verified = context(current, ['financing'], { primary_intent: 'discuss_budget' })
  verified.catalogo = []
  verified.presupuesto_del_turno = { amount: 300000, evidence: current, budget_source: 'current_lead_statement',
    status: 'below_available_prices', prices: [{ unit_id: unit.id, published_commercial_price: 550000 }] }
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), true)
})

test('physical restrictions apply to the current rejected visit destination, not to a carried visit record', () => {
  const current = 'Quiero recorrer el edificio', verified = context(current, [], { primary_intent: 'request_visit' })
  verified.visit_dialogue_plan = { version: 'visit-dialogue-plan-v1', current_kind: 'access_information', explain_restriction: true }
  assert.equal(allowed(evaluate(current, verified), 'construction_status'), true)
  object(verified.visit_dialogue_plan).current_kind = 'other'
  assert.equal(allowed(evaluate(current, verified), 'construction_status'), false)
})

test('digital material permits only the physical-premise explanation, never commercial stage or a new spatial caveat', () => {
  const current = 'Muéstreme el recorrido virtual', scope = evaluate(current, context(current, ['visualization']))
  assert.equal(allowed(scope, 'construction_status'), true)
  assert.equal(object(object(scope.topics).construction_status).reason, 'digital_representation_scope')
  assert.equal(allowed(scope, 'commercial_stage'), false)
  assert.equal(allowed(scope, 'spatial_caveat'), false)
})

test('verified in-person confirmation permits directions while virtual confirmation and a pending invitation do not', () => {
  const current = 'De acuerdo', verified = context(current, ['property_options'], { primary_intent: 'answer_previous' })
  const receipt = { action: 'confirmed', request_id: 'visit-1', mode: 'presencial' }
  const scope = evaluate(current, verified, { completed_visit_action: receipt })
  assert.equal(allowed(scope, 'general_location'), true)
  assert.equal(allowed(scope, 'exact_location'), true)
  assert.equal(allowed(evaluate(current, verified, { completed_visit_action: { ...receipt, mode: 'virtual' } }), 'general_location'), false)
  assert.equal(allowed(evaluate(current, verified, { visit_result: { action: 'requested', request_id: 'visit-1', mode: 'presencial' } }), 'exact_location'), false)
})

test('only current evaluated fit or accessibility permits a spatial caveat', () => {
  for (const key of ['spatial_fit', 'accessibility']) {
    const current = '¿Esta opción se ajusta a esa necesidad?', scope = evaluate(current, context(current, [key]))
    assert.equal(allowed(scope, 'spatial_caveat'), true)
  }
  const current = 'Tres dormitorios', verified = context(current, ['property_options'])
  object(verified.semantica_turno).housing_quantities = [{ role: 'requirement', confidence: 'high', evidence: current, values: [3], dimension: 'bedrooms' }]
  assert.equal(allowed(evaluate(current, verified), 'spatial_caveat'), false)
  const legacy = context(current)
  object(legacy.semantica_turno).housing_quantities = [{ role: 'evaluation', confidence: 'high', evidence: current, values: [3], dimension: 'bedrooms' }]
  assert.equal(allowed(evaluate(current, legacy), 'spatial_caveat'), true)
})

test('unreliable or ungrounded request topics cannot authorize an unrelated field', () => {
  const current = 'Penthouse', verified = context(current, ['property_options'])
  object(verified.contrato_turno).requests = [request('¿Cuánto cuesta?', ['purchase_price']),
    request(current, ['commercial_stage'], { confidence: 'low' }), request(current, ['delivery'], { domain: 'courtesy' })]
  const scope = evaluate(current, verified)
  for (const name of ['purchase_prices', 'commercial_stage', 'delivery']) assert.equal(allowed(scope, name), false, name)
})


test('only a genuinely pending reference clarification can authorize prices after a category answer', () => {
  const current = 'Penthouse', verified = context(current, ['property_options'], { primary_intent: 'select_property' })
  Object.assign(object(verified.contrato_turno), { objective: 'ask_price', interpretation_source: 'clarification_of_price_request', price_request_status: 'pending' })
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), true)
  object(verified.contrato_turno).price_request_status = 'answered'
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
})

test('legacy fallback uses original extractor intent instead of a canonical price label copied onto semantics', () => {
  const current = 'Penthouse', verified = context(current, undefined, { primary_intent: 'ask_price',
    interpretation: { extractor_primary_intent: 'select_property' } })
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
})

function writerContext(): Row {
  const catalogUnit = { ...unit, area_internal_m2: 142.09, catalog_base_price: 550000, discount_reference_price: 550000,
    discounted_price_reference: 522500, discount_amount_reference: 27500, discount_percent: 5,
    early_purchase_discount: { catalog_price: 550000, base_price: 550000, final_price: 522500, discount_amount: 27500, percent: 5, conditions: 'Según la regla vigente' } }
  const groups = [
    { id: 'group:penthouse:range', category: 'penthouse', published_commercial_price: 450000, area_internal_m2: 120.83,
      upper_values: { published_commercial_price: 550000, area_internal_m2: 142.09 } },
    { id: 'group:price_quote:all:range', aggregation: 'range', published_commercial_price: 145000, upper_values: { published_commercial_price: 550000 } },
    { id: 'group:explicit_metric', metric: 'published_commercial_price', value: 550000 },
  ]
  return { response_content_scope: {}, mensaje_actual: 'Mis ingresos son USD 3000',
    historial_reciente: [{ role: 'bot', content: 'El precio anterior era USD 550000' }],
    evidencia_turno: { units: [catalogUnit], groups, project_facts: [
      { field: 'published_commercial_price', value: 550000 }, { field: 'area_internal_m2', value: 142.09 },
    ] },
    contrato_redaccion: { hechos_disponibles: [catalogUnit], hechos_protegidos: [catalogUnit],
      price_evidence: { quote: { price: 550000 } }, cifras_obligatorias: ['3000'] },
    contexto_verificado: { catalogo: [catalogUnit], proyecto: { name: 'La Vilet', address: 'Dirección exacta', sector: 'Puertas del Sol', city: 'Cuenca' },
      ubicacion: 'https://maps.example/project', ubicacion_general: { sector: 'Puertas del Sol', city: 'Cuenca' },
      presentacion_general_proyecto: { available: true, summary: 'Descripción aprobada en Cuenca' },
      perfil_lead: { residence_city: 'Cuenca', full_name: 'Carlos' },
      hechos_confirmados: { budget: { status: 'maximum_total', amount: 300000 } },
      financing_amounts: [{ role: 'down_payment', amount: 80000 }, { role: 'monthly_income', amount: 3000 }],
      financing_balance: { price: 550000, down_payment: 80000, requested_loan: 470000 },
      fees: [{ amount: 100, currency: 'USD', kind: 'condominium_fee' }],
      politica_descuentos: { rules: [{ percent: 5, conditions: 'Vigencia verificada' }] },
      estado_proyecto: { stage: 'not_started', enabledPlaces: ['office'] }, entrega_proyecto: { date: '2029' },
      location_disclosure: { exact_location_allowed: false, address_allowed: false, map_allowed: false, general_location: { sector: 'Puertas del Sol', city: 'Cuenca' } } },
    razonamiento_contextual: { facts: [{ value: 142.09, unit: 'm2', source: 'catalogo.ph602.area_internal_m2' }] },
    estado_operativo: { visit_result: { action: 'confirmed', request_id: 'visit-1', address: 'Dirección de la cita', mode: 'presencial' },
      financing_result: { loan_amount: 470000, monthly_payment: 3000 } } }
}

test('writer projection removes only structured purchase-price evidence and preserves verification inputs and personal amounts', () => {
  const current = 'Penthouse', scope = responseContentScope(current, context(current, ['property_options']))
  const raw = writerContext(), original = structuredClone(raw), projected = projectContentForWriter(raw, scope)
  const evidence = object(projected.evidencia_turno)
  const projectedUnit = (evidence.units as Row[])[0]
  for (const field of ['published_commercial_price', 'catalog_base_price', 'discount_reference_price', 'discounted_price_reference', 'discount_amount_reference']) {
    assert.equal(projectedUnit[field], undefined, field)
  }
  assert.equal(projectedUnit.area_internal_m2, 142.09)
  assert.equal(projectedUnit.discount_percent, 5)
  assert.deepEqual(object(projectedUnit.early_purchase_discount), { percent: 5, conditions: 'Según la regla vigente' })
  assert.deepEqual((evidence.groups as Row[]).map(group => group.id), ['group:penthouse:range'])
  assert.deepEqual(object((evidence.groups as Row[])[0].upper_values), { area_internal_m2: 142.09 })
  assert.deepEqual(evidence.project_facts, [{ field: 'area_internal_m2', value: 142.09 }])
  assert.equal(object(projected.contrato_redaccion).price_evidence, undefined)
  const source = object(projected.contexto_verificado), before = object(original.contexto_verificado)
  for (const key of ['hechos_confirmados', 'financing_amounts', 'financing_balance', 'fees', 'politica_descuentos', 'estado_proyecto', 'entrega_proyecto', 'perfil_lead']) {
    assert.deepEqual(source[key], before[key], key)
  }
  assert.deepEqual(projected.estado_operativo, original.estado_operativo)
  assert.deepEqual(projected.razonamiento_contextual, original.razonamiento_contextual)
  assert.equal(projected.mensaje_actual, original.mensaje_actual)
  assert.deepEqual(projected.historial_reciente, original.historial_reciente, 'Prose remains data; this is not an outbound sanitizer')
  assert.deepEqual(raw, original, 'The reviewer and calculations retain the original complete verified snapshot')
})

test('writer location projection limits business sources without hiding client residence or a permitted operational destination', () => {
  const current = 'Penthouse', raw = writerContext(), original = structuredClone(raw)
  const scope = responseContentScope(current, context(current, ['property_options']))
  let projected = projectContentForWriter(raw, scope), source = object(projected.contexto_verificado)
  assert.deepEqual(source.proyecto, { name: 'La Vilet' })
  assert.equal(source.ubicacion, undefined)
  assert.equal(source.ubicacion_general, undefined)
  assert.equal(source.presentacion_general_proyecto, undefined)
  assert.equal(object(source.perfil_lead).residence_city, 'Cuenca')
  assert.equal(object(object(projected.estado_operativo).visit_result).address, 'Dirección de la cita')
  const confirmedScope = responseContentScope(current, context(current, ['property_options']), {
    completed_visit_action: { action: 'confirmed', request_id: 'visit-1', mode: 'presencial' },
  })
  object(raw.contexto_verificado).location_disclosure = { exact_location_allowed: true, address_allowed: true, map_allowed: true }
  projected = projectContentForWriter(raw, confirmedScope)
  source = object(projected.contexto_verificado)
  assert.equal(object(source.proyecto).address, 'Dirección exacta')
  assert.equal(source.ubicacion, 'https://maps.example/project')
  assert.equal(object(object(projected.estado_operativo).visit_result).address, 'Dirección de la cita')
  assert.deepEqual(object(raw.contexto_verificado).perfil_lead, object(original.contexto_verificado).perfil_lead)
})

test('allowed purchase-price requests preserve complete price evidence; absent scope preserves legacy inputs', () => {
  const current = '¿Cuánto cuesta?', scope = responseContentScope(current, context(current, ['purchase_price']))
  const raw = writerContext(), original = structuredClone(raw), projected = projectContentForWriter(raw, scope)
  assert.deepEqual(projected.evidencia_turno, original.evidencia_turno)
  assert.deepEqual(object(projected.contrato_redaccion).price_evidence, object(original.contrato_redaccion).price_evidence)
  assert.deepEqual(projectContentForWriter(raw), raw)
  assert.deepEqual(raw, original)
})


test('completed presentation, a commercial pending decision and a chosen unit prevent a new introduction', () => {
  const current = 'Quiero información general', cases = [
    { estado_conversacion: { brochure_sent: true } },
    { pregunta_pendiente: { id: 'property_category', act: 'choose_category', question: '¿Qué tipo prefiere?' } },
    { property_context: { query: {}, selected_ids: ['ph602'], offered_ids: [], comparison_ids: [], focused_ids: [] } },
    { lead: { purchase_purpose: 'vivir' } },
  ]
  for (const changes of cases) {
    const verified = { ...context(current, ['project_overview']), ...changes }
    const scope = evaluate(current, verified)
    assert.equal(allowed(scope, 'project_intro'), false)
    assert.equal(allowed(scope, 'general_location'), false)
  }
})


test('writer projection preserves every topic in scope contracts and scope obligations', () => {
  const current = 'Penthouse', scope = responseContentScope(current, context(current, ['property_options']))
  const raw = writerContext()
  raw.response_content_scope = scope
  object(raw.contexto_verificado).alcance_contenido_turno = scope
  object(raw.contrato_redaccion).response_content_scope = scope
  raw.obligaciones_del_turno = [{ id: 'response_content_scope', ...scope, instruction: 'Cumpla los temas autorizados' }]
  const original = structuredClone(raw), projected = projectContentForWriter(raw, scope)
  assert.deepEqual(projected.response_content_scope, scope)
  assert.deepEqual(object(projected.contexto_verificado).alcance_contenido_turno, scope)
  assert.deepEqual(object(projected.contrato_redaccion).response_content_scope, scope)
  assert.deepEqual(projected.obligaciones_del_turno, original.obligaciones_del_turno)
  assert.equal(object(object(object(projected.response_content_scope).topics).general_location).allowed, false)
  assert.equal(Object.keys(object(object(projected.response_content_scope).topics)).length, 8)
  assert.equal(object(projected.contexto_verificado).ubicacion_general, undefined)
  assert.equal(((object(projected.evidencia_turno).units as Row[])[0]).published_commercial_price, undefined)
  assert.deepEqual(raw, original)
})


test('a grounded legacy canonical price request remains usable without a semantics object', () => {
  const current = 'entiendo, y por ejemplo un penthouse que precio tiene?', evidence = 'un penthouse que precio tiene?'
  const verified = context(current)
  verified.semantica_turno = {}
  verified.contrato_turno = { objective: 'ask_price', requests: [request(evidence)] }
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), true)
  object(verified.contrato_turno).price_request_status = 'answered'
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  object(verified.contrato_turno).price_request_status = 'pending'
  object(verified.contrato_turno).requests = [request(evidence, ['property_options'])]
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  object(verified.contrato_turno).requests = [request('¿Cuánto cuesta otro inmueble?')]
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  object(verified.contrato_turno).requests = [request(evidence, undefined, { confidence: 'low' })]
  assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
})


test('writer projection retains null price evidence and complete location-scope obligations', () => {
  const current = 'Penthouse', scope = responseContentScope(current, context(current, ['property_options']))
  const raw = writerContext()
  object(raw.contrato_redaccion).price_evidence = null
  raw.obligaciones_del_turno = [{ id: 'location_scope', policy: { general_location_allowed: false,
    exact_location_allowed: false, general_location: {}, address_allowed: false, map_allowed: false } }]
  const projected = projectContentForWriter(raw, scope)
  assert.equal(object(projected.contrato_redaccion).price_evidence, null)
  assert.deepEqual(projected.obligaciones_del_turno, raw.obligaciones_del_turno)
})

test('a verified legacy unit quote supports its actual current price question without typed topics', () => {
  const current = 'Y cuál es el precio del penthhphse?', verified = context(current)
  verified.semantica_turno = { property: { category: 'penthouse' } }
  verified.contrato_turno = {}
  const audit = { source: 'unit_price', verified_price_only: true }
  assert.equal(allowed(evaluate(current, verified, audit), 'purchase_prices'), true)
  verified.semantica_turno = { primary_intent: 'select_property', confidence: 'high' }
  assert.equal(allowed(evaluate(current, verified, audit), 'purchase_prices'), false)
  verified.semantica_turno = {}
  verified.contrato_turno = { price_request_status: 'answered' }
  assert.equal(allowed(evaluate(current, verified, audit), 'purchase_prices'), false)
  verified.contrato_turno = { requests: [request(current, ['property_options'])] }
  assert.equal(allowed(evaluate(current, verified, audit), 'purchase_prices'), false)
  verified.contrato_turno = {}
  assert.equal(allowed(evaluate('Penthouse', verified, audit), 'purchase_prices'), false)
})


test('a newly chosen incompatible price scope can explain its verified gap against remembered total budget once', () => {
  const current = 'Prefiero los penthouses', verified = context(current, ['property_options'], { primary_intent: 'answer_previous' })
  const guidance = { status: 'below_available_prices', coverage: 'none', complete: true, comparison_required: true,
    amount: 200000, scope_key: 'penthouse-three-bedrooms', candidate_unit_ids: [unit.id], matching_unit_ids: [],
    prices: [{ unit_id: unit.id, published_commercial_price: unit.published_commercial_price }] }
  verified.siguiente_paso_comercial = { action: 'offer_financing', budget_guidance: guidance }
  const before = structuredClone(verified)
  const scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'purchase_prices'), true)
  assert.equal(object(object(scope.topics).purchase_prices).reason, 'changed_budget_scope_comparison')
  assert.equal(allowed(scope, 'spatial_caveat'), false)
  assert.equal(allowed(scope, 'commercial_stage'), false)
  assert.deepEqual(verified, before)
  object(object(verified.siguiente_paso_comercial).budget_guidance).comparison_required = false
  assert.equal(allowed(evaluate('Gracias', verified), 'purchase_prices'), false, 'The stored gap does not authorize a recurring price recital')
})

test('sufficient, partial, unauthorized or entry-only guidance cannot reopen purchase prices by itself', () => {
  const current = 'Prefiero penthouse'
  const base = { status: 'below_available_prices', coverage: 'none', complete: true, comparison_required: true,
    amount: 200000, candidate_unit_ids: [unit.id], matching_unit_ids: [],
    prices: [{ unit_id: unit.id, published_commercial_price: unit.published_commercial_price }] }
  const invalid = [
    { ...base, status: 'matching_options', coverage: 'all' },
    { ...base, complete: false },
    { ...base, status: 'not_comparable' },
    { ...base, candidate_unit_ids: [unit.id, 'missing-price'] },
    { ...base, amount: unit.published_commercial_price },
    { ...base, prices: [] },
  ]
  for (const guidance of invalid) {
    const verified = context(current, ['property_options'], { primary_intent: 'answer_previous' })
    verified.siguiente_paso_comercial = { action: 'choose_category', budget_guidance: guidance }
    assert.equal(allowed(evaluate(current, verified), 'purchase_prices'), false)
  }
  const hidden = context(current, ['property_options'], { primary_intent: 'answer_previous' })
  hidden.siguiente_paso_comercial = { action: 'offer_financing', budget_guidance: base }
  hidden.politica_comercial = { precios_autorizados: false }
  assert.equal(allowed(evaluate(current, hidden), 'purchase_prices'), false)
})


test('sufficient new budget guidance keeps purchase prices out of the writer while preserving the declared amount', () => {
  const current = 'Mi presupuesto total es 700000', verified = context(current, ['financing'], {
    primary_intent: 'discuss_budget', budget: { status: 'maximum_total', amount: 700000, confidence: 'high', evidence: current },
  })
  verified.siguiente_paso_comercial = { action: 'ask_bedrooms', budget_guidance: { status: 'matching_options', coverage: 'all',
    amount: 700000, complete: true, comparison_required: false, candidate_unit_ids: [unit.id], matching_unit_ids: [unit.id],
    prices: [{ unit_id: unit.id, published_commercial_price: unit.published_commercial_price }] } }
  const scope = evaluate(current, verified)
  assert.equal(allowed(scope, 'purchase_prices'), false)
  const projected = projectContentForWriter({ contexto_verificado: verified, response_content_scope: scope }, scope)
  const projectedContext = object(projected.contexto_verificado)
  assert.equal((projectedContext.catalogo as Row[])[0].published_commercial_price, undefined)
  assert.equal(object(object(projectedContext.semantica_turno).budget).amount, 700000)
  assert.deepEqual(object(projectedContext.property_context).selected_ids, [])
})

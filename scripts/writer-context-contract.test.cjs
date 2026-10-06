/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { finalWriterContract, replyLinkContract, replyLinkIssues, reservationOperationalIssues } = require('../src/lib/integrations/automation/response-plan.ts')
const { experienceContext, experienceIssues, residentialContinuationIssues } = require('../src/lib/integrations/automation/commercial-experience.ts')
const { validateCatalogReply } = require('../src/lib/integrations/automation/catalog-dialogue.ts')
const { verifiedPriceReplyIssues } = require('../src/lib/integrations/automation/price-reply.ts')
const { BROCHURE_URL } = require('../src/lib/integrations/automation/project-material.ts')
const { scopeTurnCatalog } = require('../src/lib/integrations/automation/turn-context-scope.ts')

const units = [{ id: 'd804', unit_number: '804', category: 'departamento', bedrooms: 3, bathrooms_full: 2,
  area_internal_m2: 118.4, area_exterior_m2: 15.2, floor_number: 8, published_commercial_price: 320000 }]
const memory = { mentioned_benefits: ['piscina'], deferred_fields: [] }

test('a verified generic introduction omits units while preserving business and operational evidence', () => {
  const catalogo = Array.from({ length: 65 }, (_, index) => ({ id: `unit-${index}`, category: 'departamento',
    published_commercial_price: 250000, bedrooms: 3 }))
  const intent = { objective: 'project_information', required_facts: [], subject: { category: null,
    unit_numbers: [], filters: { bedrooms: null, bedrooms_any: [] } }, scope: { kind: 'property' },
    requests: [{ domain: 'property', confidence: 'high', request: 'esoty interesado en el proyecto' }] }
  const verified = { catalogo, proyecto: { address: 'Puertas del Sol, Cuenca' },
    contexto_sector: [{ safe_sales_text: 'Sector residencial consolidado' }],
    politicas_negocio: [{ id: 'policy', title: 'Compra desde el exterior' }],
    perfil_lead: { name_status: 'unknown', residence_status: 'unknown' },
    estado_operativo: { action_result: { status: 'requested' } },
    semantica_turno: { confidence: 'high', primary_intent: 'project_information', housing_quantities: [],
      property: { operation: 'none', reference_kind: 'none', filters: { bedrooms: null } } } }
  const audit = { source: 'project_overview', resolved_turn_intent: intent,
    profile_introduction: { generic_introduction: true } }
  const scoped = scopeTurnCatalog(verified, audit)
  assert.deepEqual(scoped.catalogo, [])
  assert.equal(scoped.catalog_context_scope.kind, 'project_overview')
  assert.equal(scoped.catalog_context_scope.catalog_status, 'not_applicable')
  for (const key of ['proyecto', 'contexto_sector', 'politicas_negocio', 'perfil_lead', 'estado_operativo'])
    assert.equal(scoped[key], verified[key])
  assert.equal(verified.catalogo.length, 65, 'saved evidence is not mutated')
  assert.ok(JSON.stringify(scoped).length < JSON.stringify(verified).length * 0.3)

  for (const change of [{ required_facts: ['price'] }, { objective: 'ask_price' },
    { requests: [...intent.requests, { domain: 'property', confidence: 'high', request: 'cinco dormitorios' }] },
    { requests: [{ domain: 'property', confidence: 'medium' }] }, { scope: { kind: 'mixed' } },
    { subject: { category: 'departamento' } }, { subject: { filters: { bedrooms: 5 } } },
    { subject: { unit_numbers: ['202'] } }]) {
    assert.equal(scopeTurnCatalog(verified, { ...audit, resolved_turn_intent: { ...intent, ...change } }), verified)
  }
  for (const change of [{ profile_introduction: { generic_introduction: false } }, { verified_catalog: true },
    { catalog_results: { units: [], complete: true } }, { unit_model: { url: 'https://example.org/tour' } },
    { source: 'reservation_handoff' }]) assert.equal(scopeTurnCatalog(verified, { ...audit, ...change }), verified)
  for (const change of [{ limite_alcance: { kind: 'mixed' } }, { property_context: { selected_ids: ['unit-1'] } },
    { referencia_unidad: { needsClarification: true } },
    { semantica_turno: { ...verified.semantica_turno, housing_quantities: [{ dimension: 'people', values: [6] }] } },
    { semantica_turno: { ...verified.semantica_turno, property: { operation: 'details', reference_kind: 'followup' } } },
    { semantica_turno: { ...verified.semantica_turno, confidence: 'medium' } }]) {
    const other = { ...verified, ...change }
    assert.equal(scopeTurnCatalog(other, audit), other)
  }
})

test('context scoping retains complete category evidence and preserves mixed or ambiguous requests', () => {
  const catalogo = [{ id: 'p1', category: 'penthouse' }, { id: 'p2', category: 'penthouse' }, { id: 'd1', category: 'departamento' }]
  const verified = { catalogo, politicas_negocio: [{ id: 'policy' }], perfil_lead: { residence_status: 'unknown' } }
  const intent = { objective: 'ask_price', subject: { category: 'penthouse' }, requests: [{ domain: 'property', confidence: 'high' }] }
  const audit = { source: 'unit_price', verified_price_only: true, resolved_turn_intent: intent }
  const scoped = scopeTurnCatalog(verified, audit)
  assert.deepEqual(scoped.catalogo, catalogo.slice(0, 2))
  assert.equal(scoped.politicas_negocio, verified.politicas_negocio)
  assert.equal(scoped.perfil_lead, verified.perfil_lead)
  assert.equal(verified.catalogo.length, 3)
  for (const change of [{ objective: 'compare_properties' }, { requests: [...intent.requests, { domain: 'property', confidence: 'high' }] },
    { subject: { category: 'suite' } }, { subject: { category: 'penthouse', unit_numbers: ['601', '202'] } },
    { requests: [{ domain: 'property', confidence: 'low' }] }])
    assert.equal(scopeTurnCatalog(verified, { ...audit, resolved_turn_intent: { ...intent, ...change } }), verified)
  assert.equal(scopeTurnCatalog(verified, { ...audit, verified_catalog: true }), verified)
  assert.equal(scopeTurnCatalog({ ...verified, limite_alcance: { kind: 'uncertain' } }, audit).catalogo, catalogo)
})

test('current request and factual contract are independent of a fallback wording or its presence', () => {
  const intent = { objective: 'ask_price', required_facts: ['price'], subject: { unit_numbers: ['804'] },
    requests: [{ request: '¿Qué valor tiene el 804?', domain: 'property', confidence: 'high' }] }
  const audit = { source: 'unit_price', verified_price_only: true, resolved_turn_intent: intent }
  const context = { current: '¿Qué valor tiene el 804?', verified: { catalogo: units } }
  const plans = ['', 'El 804 cuesta $900.000. ¿Quiere agendar una visita?', 'Departamento 804: 3 dormitorios y 118,4 m².']
    .map(base => finalWriterContract(base, audit, context))
  assert.deepEqual(plans[0], plans[1])
  assert.deepEqual(plans[1], plans[2])
  assert.equal(plans[0].base_role, 'internal_fallback_only')
  assert.equal(plans[0].solicitud_actual.objective, 'ask_price')
  assert.deepEqual(plans[0].datos_requeridos, ['price'])
  assert.deepEqual(plans[0].hechos_disponibles, units)
  assert.deepEqual(plans[0].cifras_obligatorias, [])
  assert.equal(plans[0].pregunta_siguiente, null)
})

test('operational goals, explicit obligations and verified receipt survive without a base message', () => {
  const question = { id: 'visit_date', question: '¿Qué fecha prefiere?', act: 'collect_visit_date' }
  const audit = { source: 'visit_intake', action: 'collecting', pending_question: question,
    request_id: 'request-1', registration_verified: true, preference: { time: '12:00' },
    response_contract: { required_numbers: ['12:00'] } }
  const contract = finalWriterContract('', audit, { current: 'Prefiero al mediodía' })
  assert.equal(contract.decisiones_protegidas, true)
  assert.equal(contract.pregunta_siguiente, question.question)
  assert.deepEqual(contract.cifras_obligatorias, ['12:00'])
  assert.equal(contract.estado_operativo.registration_verified, true)
  assert.deepEqual(contract.estado_operativo.preference, { time: '12:00' })
  assert.equal(finalWriterContract('Su visita quedó confirmada.', { source: 'visit_intake' }).estado_operativo.registration_verified, false)
})

test('context keeps all verified areas and facilities when the lead uses ordinary family language', () => {
  const info = { catalogo: units, instalaciones: [{ amenity_name: 'Piscina' }], lead: { preferred_category: 'departamento' } }
  const context = experienceContext(info, 'Somos seis en casa y nos importa la comodidad', memory)
  assert.deepEqual(context.catalogo, units)
  assert.deepEqual(context.instalaciones, info.instalaciones)
  assert.equal(context.presentation_suggestions.prioritize_dimensions, false)
  assert.deepEqual(context.presentation_suggestions.mentioned_benefits, ['piscina'])
})

test('contextual bedroom sharing guidance is allowed while invented unit attributes and prices are rejected', () => {
  const current = 'Somos seis, ¿cómo podemos evaluar los dormitorios?'
  const reply = 'El departamento 804 cuenta con 3 dormitorios y 118,4 m² interiores. Para evaluar la comodidad de su familia, pueden revisar quiénes compartirían dormitorio y qué privacidad necesita cada persona. Compartir es una posibilidad que depende de sus preferencias, no una garantía de capacidad de la vivienda.'
  const audit = { verified_catalog: true, catalog_results: { units } }
  assert.equal(validateCatalogReply(reply, audit).valid, true)
  assert.equal(experienceIssues(reply, current, { catalogo: units }, memory).includes('unsupported_fact'), false)
  assert.equal(experienceIssues('La constructora del proyecto es Agmen.', 'Quisiera conocer más del proyecto', {}, memory).includes('unsupported_fact'), false)
  assert.equal(validateCatalogReply('El departamento 804 cuenta con 6 dormitorios.', audit).valid, false)
  assert.equal(validateCatalogReply('El departamento 999 cuenta con 3 dormitorios.', audit).valid, false)
  const info = { catalogo: units, politica_comercial: { precios_autorizados: true, precios_aproximados: false } }
  const quote = { quoted: true, units, prices: [320000] }
  assert.deepEqual(verifiedPriceReplyIssues('El precio del departamento 804 es $320.000 USD.', info, 'Precio del 804', quote), [])
  assert.ok(verifiedPriceReplyIssues('El precio del departamento 804 es $900.000 USD.', info, 'Precio del 804', quote).includes('price_unit_mismatch'))
})

test('a request can reference existing units without authorizing a reservation or a category switch', () => {
  const receipt = { source: 'reservation_handoff', reservation: { request_status: 'requested', handoff_verified: true, status: 'queued', advisor_assigned: false } }
  assert.deepEqual(reservationOperationalIssues('Su solicitud está en cola para que un asesor continúe con el proceso.', receipt), [])
  assert.ok(reservationOperationalIssues('El departamento 804 quedó reservado para usted.', receipt).includes('reservation_not_confirmed'))
  assert.ok(reservationOperationalIssues('Ya tiene un asesor asignado.', receipt).includes('advisor_assignment_not_verified'))
  const info = { lead: { preferred_category: 'departamento' }, catalogo: [...units, { category: 'suite', bedrooms: 1 }],
    historial: [{ role: 'bot', content: '¿Prefiere suite o departamento?' }, { role: 'cliente', content: 'Departamento' }, { role: 'bot', content: '¿Es para vivir o invertir?' }] }
  assert.ok(residentialContinuationIssues('También puede elegir suites.', 'Para vivir', info).includes('category_reopened'))
})

test('fallback links cannot authorize destinations; requested approved material remains required', () => {
  const fake = 'https://inventado.example/transferencia'
  const configured = 'https://www.lavilett.com/tour?unidad=804'
  const contract = replyLinkContract('Puede transferir aquí: ' + fake, { unit_model: { url: configured } }, { current: 'Envíeme el recorrido del 804' })
  assert.deepEqual(contract.required_links, [configured])
  assert.deepEqual(replyLinkIssues(fake + ' ' + configured, contract), ['unauthorized_link'])
  assert.deepEqual(replyLinkIssues('Recorrido: ' + configured, contract), [])
  assert.deepEqual(replyLinkIssues('Ya continuaremos con la información.', contract), ['required_link_omitted'])
  const brochure = replyLinkContract('', { source: 'brochure' }, { current: 'Sí, por favor' })
  assert.deepEqual(brochure.required_links, [BROCHURE_URL])
  assert.deepEqual(replyLinkIssues(BROCHURE_URL, brochure), [])
})

const declaredProfile = { full_name: 'Nathaly Caballero', residence_city: 'Cuenca', residence_country: 'Ecuador',
  residence_status: 'confirmed', sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Nathaly Caballero' } } }

test('commercial stage asks only missing profile data and retains the brochure purpose', () => {
  for (const [profile, purpose, expected] of [[{}, 'collect_profile', ['full_name', 'current_residence']],
    [{ ...declaredProfile, residence_status: 'unknown' }, 'collect_residence', ['current_residence']],
    [{ ...declaredProfile, full_name: null }, 'collect_name', ['full_name']]]) {
    const state = finalWriterContract('', { profile_introduction: { profile_state: profile,
      question_purpose: purpose, brochure_deferred: true, generic_introduction: true } }).estado_comercial
    assert.equal(state.requiere_captura, true)
    assert.deepEqual(state.datos_a_pedir, expected)
    assert.equal(state.proposito_captura, 'brochure_y_guia_personalizada')
    assert.equal(state.brochure.accion, 'offer_after_profile')
    assert.equal(state.presentacion_sin_tipos, true)
  }
  const whatsappName = finalWriterContract('', { profile_introduction: { question_purpose: 'collect_profile' } },
    { verified: { lead: { name: 'Display name' }, perfil_lead: { full_name: 'Display name', name_status: 'confirmed' } } }).estado_comercial
  assert.equal(whatsappName.datos_confirmados.nombre, null)
  assert.ok(whatsappName.datos_a_pedir.includes('full_name'))
})

test('topic changes preserve declared identity and brochure history; an explicit resend is a current action', () => {
  const verified = { perfil_lead: declaredProfile, estado_conversacion: { brochure_sent: true } }
  const state = finalWriterContract('', {}, { current: 'Me equivoqué de número, pero cuénteme de los departamentos', verified }).estado_comercial
  assert.equal(state.etapa, 'continue_with_known_profile')
  assert.equal(state.datos_confirmados.nombre, 'Nathaly Caballero')
  assert.deepEqual(state.datos_a_pedir, [])
  assert.equal(state.brochure.accion, 'already_shared')
  assert.equal(state.brochure.compartido_previamente, true)
  const resend = finalWriterContract('', {}, { current: 'Envíeme el brochure', verified }).estado_comercial
  assert.equal(resend.brochure.accion, 'share_now')
  assert.equal(resend.brochure.compartido_previamente, true)
  const firstSend = finalWriterContract('', { source: 'brochure', brochure_sent: true },
    { verified: { perfil_lead: declaredProfile } }).estado_comercial
  assert.equal(firstSend.brochure.accion, 'share_now')
  assert.equal(firstSend.brochure.compartido_previamente, false)
})

test('profile clarification uses the guide purpose when the brochure was shared or is delivered by direct request', () => {
  for (const sharedBefore of [false, true]) {
    const candidate = { city: 'Cuenca', country: null }
    const verified = { perfil_lead: { ...declaredProfile, residence_status: 'pending_confirmation' },
      estado_conversacion: { brochure_sent: sharedBefore } }
    const state = finalWriterContract('', { profile_introduction: { question_purpose: 'confirm_residence',
      candidate, brochure_deferred: !sharedBefore, brochure_previously_sent: sharedBefore } },
    { current: sharedBefore ? 'Soy de Cuenca' : 'Soy de Cuenca, envíeme el brochure', verified }).estado_comercial
    assert.equal(state.proposito_captura, 'guia_personalizada')
    assert.equal(state.brochure.accion, sharedBefore ? 'already_shared' : 'share_now')
    assert.deepEqual(state.datos_a_pedir, ['current_residence'])
    assert.deepEqual(state.residencia_por_confirmar, candidate)
  }
})

test('commercial stage keeps confirmation candidates and does not force profile collection on other routes', () => {
  const candidate = { city: 'Guayaquil', country: null }
  const state = finalWriterContract('', { profile_introduction: {
    question_purpose: 'confirm_residence', candidate, profile_state: { ...declaredProfile, residence_status: 'pending_confirmation' },
  } }).estado_comercial
  assert.equal(state.etapa, 'confirm_profile')
  assert.deepEqual(state.residencia_por_confirmar, candidate)
  assert.deepEqual(state.datos_a_pedir, ['current_residence'])
  assert.equal(state.datos_confirmados.residencia_actual, null)
  assert.equal(finalWriterContract('', { source: 'visit_intake' }).estado_comercial.requiere_captura, false)
})

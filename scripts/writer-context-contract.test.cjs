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

const units = [{ id: 'd804', unit_number: '804', category: 'departamento', bedrooms: 3, bathrooms_full: 2,
  area_internal_m2: 118.4, area_exterior_m2: 15.2, floor_number: 8, published_commercial_price: 320000 }]
const memory = { mentioned_benefits: ['piscina'], deferred_fields: [] }

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

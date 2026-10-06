import assert from 'node:assert/strict'
import test from 'node:test'
import Ajv from 'ajv'
import { completeTurnReply } from './turn-completeness'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { object, text, type Row } from './data'
import { LOCATION_DISCLOSURE_RULES } from './location-policy'
import { visitDialogueTurn, VISIT_DIALOGUE_RULES } from './visit-dialogue'
import { earlyPurchaseDiscountContext } from './early-purchase-discount-context'
import { draftEarlyPurchaseDiscount, defaultEarlyPurchaseDiscountSettings, type EarlyPurchaseDiscountSettings } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const address = 'Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca'
const map = 'https://www.google.com/maps/search/?api=1&query=-2.892287,-79.030259'
const unit = { id: 'u304', unit_number: '304', category: 'departamento', is_published: true, status: 'disponible',
  bedrooms: 2, floor_number: 3, area_internal_m2: 109.69, published_commercial_price: 270000 }
const readiness: ProjectReadiness = { stage: 'not_started', progress: '', verifiedOn: '2026-10-06',
  enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true }
const verified = {
  proyecto: { name: 'La Vilet', address, description: `El proyecto está en ${address}.` },
  ubicacion_general: { sector: 'Puertas del Sol', city: 'Cuenca' }, ubicacion: map,
  estado_proyecto: readiness, modo_comercial: 'lanzamiento',
  contexto_sector: [{ fact_key: 'servicios_cercanos', description: 'Hay comercios y servicios en el sector.' }],
  catalogo: [unit], politica_comercial: { precios_autorizados: true, precios_aproximados: true },
}
const audit = { source: 'catalog_details', semantic_review_enabled: true, business_risk_review_enabled: true }
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }

/** Exercise the real composition/review pipeline while replacing both model
 * calls. A fake answer must still satisfy each actual generated JSON schema. */
function harness(reply: string, inspect: (context: Row, task: string) => void, question: Row = noQuestion) {
  const calls: { context: Row; task: string; instructions: string }[] = []
  const contextErrors: unknown[] = []
  const ajv = new Ajv({ allErrors: true })
  const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (instructions, value, schema, _image, _file, _tone, task = 'data') => {
    const context = object(value)
    calls.push({ context, task, instructions })
    // completeTurnReply catches model exceptions. Preserve inspection errors
    // separately so a source mismatch cannot be reported merely as unavailable.
    try { inspect(context, task) } catch (error) { contextErrors.push(error) }
    const reference = rows(context.referencias_solicitud)[0]
    const answer = task === 'review'
      ? { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
      : { reply, requests: [{ fragment: reference?.id, intent: 'Atender la consulta vigente', request_type: 'general_information',
        status: 'answered', evidence: 'La respuesta atiende la solicitud actual.', fact_key: null }], question }
    assert.ok(schema)
    const validate = ajv.compile(schema)
    assert.ok(validate(answer), ajv.errorsText(validate.errors))
    return answer
  }
  return { calls, generate, assertContexts: () => { if (contextErrors.length) throw contextErrors[0] } }
}

function sharedObligations(expected: string[], inspect: (context: Row, task: string, obligations: Row[]) => void) {
  let writerObligations: Row[] | undefined
  return (context: Row, task: string) => {
    const obligations = rows(context.obligaciones_del_turno)
    for (const id of expected) assert.ok(obligations.some(obligation => obligation.id === id), `${task} lacks ${id}`)
    if (task === 'writing') writerObligations = obligations
    else assert.deepEqual(obligations, writerObligations, 'The reviewer must check the same obligations the writer received.')
    inspect(context, task, obligations)
  }
}

for (const current of ['Hola, quiero información de apartamentos', '¿En qué sector queda el proyecto?', '¿En qué ciudad está?']) {
  test(`composition and independent review keep general location separate from directions: ${current}`, async () => {
    const mock = harness('La Vilet está en Puertas del Sol, Cuenca.', sharedObligations(['location_scope', 'project_context_truth'],
      (context, task, obligations) => {
        const permission = obligations.find(obligation => obligation.id === 'location_scope')!
        assert.equal(permission.exact_location_allowed, false)
        assert.equal(permission.map_allowed, false)
        assert.equal(permission.instruction, LOCATION_DISCLOSURE_RULES)
        const authority = task === 'writing' ? context.contexto_verificado : context.fuentes_autorizadas
        assert.ok(!JSON.stringify(authority).includes(address), `${task} received the exact address without permission`)
        assert.ok(!JSON.stringify(authority).includes(map), `${task} received the map without permission`)
        assert.match(JSON.stringify(authority), /Puertas del Sol/)
        assert.equal(obligations.find(obligation => obligation.id === 'project_context_truth')?.physical_stage, 'not_started')
      }))
    const result = await completeTurnReply({ current, baseReply: 'Podemos informarle sobre el proyecto.', verified, audit }, mock.generate)
    mock.assertContexts()
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
    assert.equal(result.needsAdvisor, false)
    assert.ok(!result.reply.includes(address))
    assert.ok(!result.reply.includes(map))
  })
}

test('an explicit direction request preserves the exact authorized facts in both model contexts', async () => {
  const current = '¿Me comparte la dirección y el mapa de La Vilet?'
  const reply = `La dirección registrada es ${address}. Puede verla en el mapa: ${map}`
  const mock = harness(reply, sharedObligations(['location_scope', 'project_context_truth'], (context, task, obligations) => {
    const permission = obligations.find(obligation => obligation.id === 'location_scope')!
    assert.equal(permission.exact_location_allowed, true)
    assert.equal(permission.map_allowed, true)
    const authority = task === 'writing' ? context.contexto_verificado : context.fuentes_autorizadas
    assert.ok(JSON.stringify(authority).includes(address), `${task} lost the requested address`)
    assert.ok(JSON.stringify(authority).includes(map), `${task} lost the requested map`)
    if (task === 'review') assert.ok(rows(context.obligaciones_del_turno).some(row => row.id === 'current_request'))
  }))
  const result = await completeTurnReply({ current, baseReply: reply, verified, audit: { ...audit, source: 'location' } }, mock.generate)
  mock.assertContexts()
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  assert.ok(result.reply.includes(address))
  assert.ok(result.reply.includes(map))
})

test('actual visit confirmation allows location facts while pending coordination does not', async () => {
  for (const action of ['submitted', 'confirmed']) {
    const receipt = { action, request_id: 'verified-request-1' }
    const visitAudit = action === 'confirmed' ? { completed_visit_action: receipt }
      : { action, request_id: receipt.request_id, registration_verified: true }
    const mock = harness(action === 'confirmed' ? 'Gracias por confirmar.' : 'Gracias por indicar su preferencia.',
      sharedObligations(['location_scope'], (context, task, obligations) => {
        assert.equal(obligations.find(row => row.id === 'location_scope')?.exact_location_allowed, action === 'confirmed')
        const authority = task === 'writing' ? context.contexto_verificado : context.fuentes_autorizadas
        assert.equal(JSON.stringify(authority).includes(address), action === 'confirmed')
        assert.equal(JSON.stringify(authority).includes(map), action === 'confirmed')
      }))
    const result = await completeTurnReply({ current: 'Sí, gracias', baseReply: 'Gracias.', verified,
      audit: { ...audit, ...visitAudit, source: action === 'confirmed' ? 'commercial' : 'visit_intake' } }, mock.generate)
    mock.assertContexts()
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  }
})

test('asking visit hours shares an informational plan without accepting the offered office or creating an operation', async () => {
  const first = visitDialogueTurn({ current: 'Quiero recorrer el edificio', readiness,
    intent: { kind: 'request_visit', purpose: 'coordination', destination: 'building', target: 'project',
      evidence: 'Quiero recorrer el edificio', confidence: 'high' } })
  const current = '¿Qué horarios tienen para las citas?'
  const plan = visitDialogueTurn({ current, readiness, previous: first.state,
    intent: { kind: 'visit_information', purpose: 'availability_information', destination: null,
      target: 'project', evidence: current, confidence: 'high' } })
  assert.equal(plan.information_only, true)
  assert.equal(plan.operation_allowed, false)
  assert.equal(plan.alternative_accepted, false)
  const reply = 'El horario de atención es de lunes a viernes, de 08:30 a 18:30; son horarios de atención y no cupos confirmados. ¿Desea coordinar una cita en la oficina?'
  const mock = harness(reply, sharedObligations(['visit_dialogue', 'project_context_truth', 'location_scope'],
    (context, task, obligations) => {
      const visit = obligations.find(row => row.id === 'visit_dialogue')!
      assert.equal(visit.information_only, true)
      assert.equal(visit.operation_allowed, false)
      assert.equal(visit.alternative_accepted, false)
      assert.equal(visit.effective_destination, null)
      assert.equal(visit.requested_destination, 'building')
      assert.equal(visit.offered_destination, 'office')
      assert.equal(visit.question_id, 'visit_destination')
      assert.ok(text(visit.instruction).includes(VISIT_DIALOGUE_RULES), `${task} lost the shared visit rules`)
      if (task === 'writing') assert.equal(object(object(context.contexto_verificado).visit_dialogue_plan).information_only, true)
      else {
        const operation = object(context.estado_del_turno)
        assert.equal(object(operation.dialogo_visita).operation_allowed, false)
        assert.equal(operation.accion, null)
        assert.equal(operation.visita, null)
      }
    }), { purpose: 'coordinate_visit', role: 'optional_continuation', missing_datum: 'Aceptación del lugar ofrecido',
      next_decision: 'Decidir si desea coordinar una cita en la oficina', continuation_id: 'visit_destination', continuation_act: 'visit' })
  const result = await completeTurnReply({ current, baseReply: reply,
    verified: { ...verified, horario_atencion: { monday: { open: '08:30', close: '18:30' } }, visit_dialogue_plan: plan },
    audit: { ...audit, source: 'visit_information', visit_dialogue_plan: plan } }, mock.generate)
  mock.assertContexts()
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  assert.equal(result.needsAdvisor, false)
})

test('conditional discount authority and obligation survive composition and review without satisfying the reservation', async () => {
  const settings: EarlyPurchaseDiscountSettings = { enabled: true, stacking: false, updatedAt: 'policy-revision-1',
    rules: [{ ...draftEarlyPurchaseDiscount(), id: 'authorized-rule-1', enabled: true, percent: 5,
      categories: ['departamento'], source: 'Resolución comercial autorizada', checkedOn: '2026-10-01',
      startDate: '2026-10-01', endDate: '2026-10-31', reviewBy: '2026-10-31',
      conditions: 'Descuento sujeto a reserva formal confirmada por el proyecto.' }] }
  const discount = earlyPurchaseDiscountContext([unit], settings, { mode: 'lanzamiento', today: '2026-10-06', pricesAuthorized: true })
  const current = '¿Qué beneficio por compra anticipada tiene el departamento 304?'
  const query = { group: 'residential', category: 'departamento', operation: 'details', scope: 'selected',
    unit_numbers: ['304'], filters: { bedrooms: 2, floor_number: 3, min_area_m2: null, max_area_m2: null } }
  const mock = harness('Existe un beneficio autorizado sujeto a una reserva formal confirmada. Su interés todavía no cumple esa condición.',
    sharedObligations(['early_purchase_discount', 'project_context_truth'], (context, task, obligations) => {
      const benefit = obligations.find(row => row.id === 'early_purchase_discount')!
      assert.equal(object(benefit.policy).settings_version, 'policy-revision-1')
      assert.equal(rows(object(benefit.policy).rules)[0].source, 'Resolución comercial autorizada')
      const authority = task === 'writing' ? object(context.contexto_verificado) : object(context.fuentes_autorizadas)
      const units = task === 'writing' ? [...rows(authority.catalogo), ...rows(object(context.evidencia_turno).units)] : rows(authority.unidades)
      const quotedUnit = units.find(row => row.unit_number === unit.unit_number)
      assert.ok(quotedUnit, `${task} must receive the individual discount quote in canonical unit evidence`)
      assert.equal(quotedUnit.published_commercial_price, 270000)
      assert.equal(object(quotedUnit.early_purchase_discount).status, 'conditional')
      assert.equal(object(quotedUnit.early_purchase_discount).condition, 'reservation_confirmed')
      assert.equal(object(quotedUnit.early_purchase_discount).condition_met, false)
      assert.equal(object(quotedUnit.early_purchase_discount).inventory_reserved, false)
      assert.equal(rows(task === 'writing' ? object(authority.politica_descuentos).rules : object(authority.descuentos_comerciales).rules)[0].source,
        'Resolución comercial autorizada')
    }))
  const result = await completeTurnReply({ current, baseReply: 'Podemos informarle sobre los beneficios.',
    verified: { ...verified, lead: { unit_id: unit.id }, property_context: { query, selected_ids: [unit.id], focused_ids: [unit.id] },
      catalogo: discount.units, politica_descuentos: discount.policy },
    audit: { ...audit, catalog_query: query, catalog_results: { units: discount.units, unit_ids: [unit.id], complete: true } } }, mock.generate)
  mock.assertContexts()
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  assert.equal(result.needsAdvisor, false)
})

test('an inactive sample discount never becomes active authority in either model context', async () => {
  const discount = earlyPurchaseDiscountContext([unit], defaultEarlyPurchaseDiscountSettings(),
    { mode: 'lanzamiento', today: '2026-10-06', pricesAuthorized: true })
  const mock = harness('No hay un beneficio adicional confirmado para comunicar en este momento.', (context, task) => {
    assert.equal(rows(context.obligaciones_del_turno).some(row => row.id === 'early_purchase_discount'), false)
    const authority = task === 'writing' ? object(context.contexto_verificado) : object(context.fuentes_autorizadas)
    const policy = object(task === 'writing' ? authority.politica_descuentos : authority.descuentos_comerciales)
    assert.equal(policy.enabled, false)
    assert.deepEqual(policy.rules, [])
  })
  const result = await completeTurnReply({ current: '¿Comprar antes ofrece algún descuento?', baseReply: 'Podemos revisar la información actual.',
    verified: { ...verified, catalogo: discount.units, politica_descuentos: discount.policy }, audit }, mock.generate)
  mock.assertContexts()
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
})

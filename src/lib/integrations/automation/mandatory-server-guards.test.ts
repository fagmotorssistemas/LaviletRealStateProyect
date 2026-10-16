import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply, mandatoryReplyIssues } from './turn-completeness'
import { catalogDialogueReply } from './catalog-dialogue'
import { commercialJourneyPlan } from './commercial-journey'
import { withResponseReviewPolicy } from './response-review-policy'
import { operationalReply } from './operational-copy'
import { object, type Row } from './data'
import { WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'
import { MAX_REPLY_CHARACTERS } from './response-plan'

const units = [202, 205].map(code => ({ id: `d${code}`, unit_number: String(code), category: 'departamento',
  bedrooms: 3, floor_number: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03,
  bathrooms_full: 2, published_commercial_price: 250000 }))
const data = (): Row => ({ catalogo: units, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
  lead: { purchase_purpose: 'vivir' },
  hechos_confirmados: { budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'Mi presupuesto total es de 300000 dólares' } }, property_context: { query: { group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 2 } } },
  recorrido_comercial: {}, financiamiento: { partners: [], journey: {} },
  semantica_turno: { primary_intent: 'select_property', confidence: 'high', primary_evidence: 'Me interesa la segunda planta', budget: { status: 'not_discussed' } } })

for (const enabled of [true, false]) test(`unit presentation is writer guidance without a server prose veto with review ${enabled ? 'on' : 'off'}`, async () => {
  const verified = data(), base = catalogDialogueReply(verified)!
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply({
    current: 'Me interesa la segunda planta', baseReply: base.reply, verified,
    audit: { ...base.audit, semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, _context, _schema, _image, _file, _tone, task) => {
    calls.push(task || 'data')
    if (task === 'review') return { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
    return { reply: 'En esa planta hay opciones de tres dormitorios. ¿Cuál de estas unidades le gustaría conocer?',
      requests: [], question: { purpose: 'choose_property', role: 'necessary_clarification', missing_datum: 'unidad', next_decision: 'Comparar', continuation_id: 'unit_choice', continuation_act: 'choose_unit' } }
  }))
  assert.equal(result.audit.status, enabled ? 'checked' : 'review_disabled')
  assert.equal(result.reply, 'En esa planta hay opciones de tres dormitorios. ¿Cuál de estas unidades le gustaría conocer?')
  assert.deepEqual(object(result.audit.final_validation).issues, [])
  assert.equal(object(result.audit.final_validation).passed, true)
  assert.deepEqual(calls, enabled ? ['writing', 'review'] : ['writing'])
})

test('the compatibility guard checks transport without classifying unit presentation or characteristics', () => {
  const verified = data(), plan = commercialJourneyPlan(verified)
  const input = { current: 'Segunda planta', baseReply: '', verified: { ...verified, siguiente_paso_comercial: plan } }
  assert.deepEqual(mandatoryReplyIssues(input, 'Tenemos tres dormitorios. ¿Prefiere el departamento 202 o el 205?'), [])
  assert.deepEqual(mandatoryReplyIssues(input, 'Los departamentos 202 y 205. ¿Cuál desea conocer?'), [])
  assert.deepEqual(mandatoryReplyIssues(input, 'Los departamentos 202 y 205 tienen tres dormitorios, 120,83 m² interiores y 27,03 m² exteriores. ¿Cuál desea conocer?'), [])
  assert.deepEqual(mandatoryReplyIssues(input, ''), ['empty_reply'])
  assert.deepEqual(mandatoryReplyIssues(input, 'a'.repeat(MAX_REPLY_CHARACTERS + 1)), ['transport_length'])
})

for (const enabled of [true, false]) test(`operational prose has no confirmation regex veto and creates no appointment with review ${enabled ? 'on' : 'off'}`, async () => {
  const calls: string[] = []
  const context = { visit_result: { status: 'pending', appointment_id: null } }
  const before = structuredClone(context)
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => operationalReply(
    'La solicitud de visita está pendiente; el equipo le confirmará.', 'Gracias', [], context,
    async (_rules, _input, _schema, _image, _file, _tone, task) => {
      calls.push(task || 'data')
      return task === 'writing' ? { mensaje: 'Su cita ya está confirmada.' }
        : { fiel_a_los_hechos: true, conserva_estado_y_objetivo: true, no_pide_datos_conocidos: true, tono_natural: true }
    }))
  assert.equal(result.generated, true)
  assert.equal(result.reply, 'Su cita ya está confirmada.')
  assert.deepEqual(calls, enabled ? ['writing', 'review'] : ['writing'])
  // A writer statement never authorizes or executes the actual operation.
  assert.deepEqual(context, before)
})

test('the operational AI reviewer can reject an invented confirmation without a server text rule', async () => {
  const calls: string[] = []
  const base = 'La solicitud de visita está pendiente; el equipo le confirmará.'
  const result = await withResponseReviewPolicy({ enabled: true, updatedAt: null }, () => operationalReply(
    base, 'Gracias', [], { visit_result: { status: 'pending', appointment_id: null } },
    async (_rules, _input, _schema, _image, _file, _tone, task) => {
      calls.push(task || 'data')
      return task === 'writing' ? { mensaje: 'Su cita ya está confirmada.' }
        : { fiel_a_los_hechos: false, conserva_estado_y_objetivo: true, no_pide_datos_conocidos: true, tono_natural: true }
    }))
  assert.equal(result.generated, false)
  assert.equal(result.reply, base)
  assert.deepEqual(calls, ['writing', 'review'])
})

for (const enabled of [true, false]) test(`prose validation and normalization callbacks cannot veto a writer with review ${enabled ? 'on' : 'off'}`, async () => {
  let validations = 0, normalizations = 0
  const reply = 'Su crédito ya está aprobado. Espacios exteriores entre nueve y veintidós metros cuadrados.'
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply({
    current: 'Quisiera conocer las opciones', baseReply: 'Podemos mostrarle opciones.', verified: data(),
    validateReply: () => { validations++; throw new Error('PROSE_GUARD_MUST_NOT_RUN') },
    normalizeReply: () => { normalizations++; throw new Error('PROSE_NORMALIZER_MUST_NOT_RUN') },
  }, async (_rules, _context, _schema, _image, _file, _tone, task) => task === 'review'
    ? { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
    : { reply, requests: [], question: null }))
  assert.equal(result.reply, reply)
  assert.equal(validations, 0)
  assert.equal(normalizations, 0)
  assert.equal(result.audit.status, enabled ? 'checked' : 'review_disabled')
})

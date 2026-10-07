import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply, mandatoryReplyIssues } from './turn-completeness'
import { catalogDialogueReply } from './catalog-dialogue'
import { commercialJourneyPlan } from './commercial-journey'
import { withResponseReviewPolicy } from './response-review-policy'
import { operationalReply } from './operational-copy'
import { object, type Row } from './data'

const units = [202, 205].map(code => ({ id: `d${code}`, unit_number: String(code), category: 'departamento',
  bedrooms: 3, floor_number: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03,
  bathrooms_full: 2, published_commercial_price: 250000 }))
const data = (): Row => ({ catalogo: units, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
  lead: { purchase_purpose: 'vivir' }, property_context: { query: { group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 2 } } },
  recorrido_comercial: {}, financiamiento: { partners: [], journey: {} },
  semantica_turno: { primary_intent: 'select_property', confidence: 'high', primary_evidence: 'Me interesa la segunda planta', budget: { status: 'not_discussed' } } })

for (const enabled of [true, false]) test(`unit presentation is a mandatory invariant with paid review ${enabled ? 'on' : 'off'}`, async () => {
  const verified = data(), base = catalogDialogueReply(verified)!
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply({
    current: 'Me interesa la segunda planta', baseReply: base.reply, verified,
    audit: { ...base.audit, semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, _context, _schema, _image, _file, _tone, task) => {
    calls.push(task || 'data')
    if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    return { reply: 'En esa planta hay opciones de tres dormitorios. ¿Qué presupuesto total tiene previsto para su compra?',
      requests: [], question: { purpose: 'choose_property', role: 'necessary_clarification', missing_datum: 'presupuesto', next_decision: 'Comparar', continuation_id: 'budget_amount', continuation_act: 'other' } }
  }))
  assert.equal(result.audit.status, 'rejected_guard')
  assert.ok((result.audit.issues as string[]).includes('required_unit_presentation_missing'))
  assert.equal(object(result.audit.final_validation).passed, false)
  assert.equal(calls.includes('review'), false)
  if (!enabled) assert.deepEqual(calls, ['writing'])
})

test('unit numbers hidden only in a question do not satisfy presentation; verified collective descriptions do', () => {
  const verified = data(), plan = commercialJourneyPlan(verified)
  const input = { current: 'Segunda planta', baseReply: '', verified: { ...verified, siguiente_paso_comercial: plan } }
  assert.ok(mandatoryReplyIssues(input, 'Tenemos tres dormitorios. ¿Su presupuesto para el departamento 202 o 205?').includes('required_unit_presentation_missing'))
  assert.ok(mandatoryReplyIssues(input, 'Los departamentos 202 y 205. ¿Qué presupuesto contempla?').includes('required_unit_characteristics_missing'))
  assert.deepEqual(mandatoryReplyIssues(input, 'Los departamentos 202 y 205 tienen tres dormitorios, 120,83 m² interiores y 27,03 m² exteriores. ¿Qué presupuesto contempla?'), [])
})

for (const enabled of [true, false]) test(`an operational approval cannot invent confirmed appointments with review ${enabled ? 'on' : 'off'}`, async () => {
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => operationalReply(
    'La solicitud de visita está pendiente; el equipo le confirmará.', 'Gracias', [], {},
    async (_rules, _input, _schema, _image, _file, _tone, task) => {
      calls.push(task || 'data')
      return task === 'writing' ? { mensaje: 'Su cita ya está confirmada.' }
        : { fiel_a_los_hechos: true, conserva_estado_y_objetivo: true, no_pide_datos_conocidos: true, tono_natural: true }
    }))
  assert.equal(result.generated, false)
  assert.match(result.reply, /pendiente/)
  assert.deepEqual(calls, ['writing'])
})

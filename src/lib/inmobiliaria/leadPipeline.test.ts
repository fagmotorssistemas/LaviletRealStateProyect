import test from 'node:test'
import assert from 'node:assert/strict'
import { projectLeadPipeline } from './leadPipeline'
import type { LeadPipelineInput } from '@/types/leadPipeline'

const at = '2026-10-15T15:00:00Z'
const base = (): LeadPipelineInput => ({ lead: { id: 'lead', created_at: at },
  conversation: { id: 'conversation', summary: {} }, messages: [], coverage: { messages: true } })
const reply = { id: 'r', role: 'bot', sent_at: at, conversation_id: 'conversation' }

test('new versus initial contact requires an actual response, never a customer score or draft', () => {
  const input = base()
  input.lead.stage = 'reserva_venta'; input.lead.status = 'vendido'; input.lead.temperature = 'caliente'
  input.scoreEvents = [{ event_type: 'first_response' }]
  input.messages = [{ role: 'cliente', sent_at: at }, { ...reply, tool_calls: { provider_status: 'not_sent' } }]
  assert.equal(projectLeadPipeline(input).stage, 'nuevo')
  input.messages.push(reply)
  assert.equal(projectLeadPipeline(input).stage, 'contacto_inicial')
})

test('showroom defaults, links and browsing do not declare a need or choose a unit', () => {
  const input = base()
  input.lead.preferred_category = 'departamento'; input.lead.purchase_purpose = 'vivir'; input.lead.unit_id = 'u'
  input.conversation!.summary = { _property_context: { visited_ids: ['u'], offered_ids: ['u'] } }
  input.messages = [reply]; input.units = [{ id: 'u', unit_number: '304' }]
  const result = projectLeadPipeline(input)
  assert.equal(result.stage, 'contacto_inicial'); assert.equal(result.selectedUnitId, null)
})

test('accepted explicit need persists independently of the next informational question', () => {
  const input = base()
  input.conversation!.summary = { _interpretation_memory: { property: { category: 'departamento', evidence: 'Busco un departamento', confidence: 'high' } } }
  assert.equal(projectLeadPipeline(input).stage, 'necesidad_identificada')
})

test('availability receipt from accepted interpretation establishes commercial interest with its real source time', () => {
  const input = base()
  input.conversation!.summary = { _lead_pipeline_events: [{ kind: 'commercial_interest', topic: 'availability',
    evidence: '¿Está disponible?', source_message_id: 'm', at }] }
  const result = projectLeadPipeline(input)
  assert.equal(result.stage, 'interes_comercial'); assert.equal(result.stageChangedAt, at)
  input.conversation!.summary = { _lead_pipeline_events: [{ kind: 'commercial_interest', topic: 'availability' }] }
  assert.equal(projectLeadPipeline(input).stage, 'nuevo')
})

for (const event of ['asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'asked_availability']) {
  test(`${event} means interest, never a reservation or financing consent`, () => {
    const input = base(); input.scoreEvents = [{ id: 'e', event_type: event, created_at: at }]
    const result = projectLeadPipeline(input)
    assert.equal(result.stage, 'interes_comercial'); assert.equal(result.nutritionActive, false)
    assert.equal(result.nextActionScheduled, false)
  })
}

test('reservation needs a real operation with a unit; sale needs its own closing record', () => {
  const input = base(); input.reservations = [{ id: 'rr', unit_ids: [], evidence: 'reservar', source_message_id: 'm', created_at: at }]
  assert.equal(projectLeadPipeline(input).stage, 'nuevo')
  input.reservations[0].unit_ids = ['u']
  assert.equal(projectLeadPipeline(input).stage, 'proceso_reserva')
  input.sales = [{ id: 's', lead_id: 'lead', unit_id: 'u', sale_at: at }]
  input.metadata = { opportunity_status: 'lost', closure_reason: 'registro contradictorio' }
  const result = projectLeadPipeline(input)
  assert.equal(result.stage, 'venta_cerrada'); assert.equal(result.opportunityStatus, 'won')
})

test('nurturing is independent, requires future-interest evidence and contact agreement', () => {
  const input = base(); input.scoreEvents = [{ event_type: 'asked_price' }]
  input.conversation!.summary = { _lead_nurture: { active: true, reason: 'Compra posterior', purchase_horizon: 'próximo año', evidence: 'Comprar el próximo año', contact_consent: false } }
  assert.equal(projectLeadPipeline(input).nutritionActive, false)
  const nurture = (input.conversation!.summary as Record<string, Record<string, unknown>>)._lead_nurture
  nurture.contact_consent = true; nurture.contact_evidence = 'Sí, podemos seguir en contacto'
  const result = projectLeadPipeline(input)
  assert.equal(result.nutritionActive, true); assert.equal(result.stage, 'interes_comercial')
  input.metadata = { nutrition_active: false, updated_at: '2026-10-16T15:00:00Z' }
  assert.equal(projectLeadPipeline(input).nutritionActive, false)
})

test('appointments are independent and a proposed time is not confirmation', () => {
  const input = base(); input.appointments = [{ id: 'a', status: 'aceptado', start_time: at, created_at: at }]
  assert.equal(projectLeadPipeline(input).appointment?.label, 'En coordinación')
  input.appointments[0].confirmed_by_client = true; input.appointments[0].confirmed_at = at
  const result = projectLeadPipeline(input)
  assert.equal(result.appointment?.label, 'Confirmada'); assert.equal(result.stage, 'interes_comercial')
  input.appointments[0].status = 'cancelado'
  assert.equal(projectLeadPipeline(input).opportunityStatus, 'open')
})

test('only a real matching pending job is scheduled; a manual next action is not an outbound message', () => {
  const input = base(); input.jobs = [{ id: 'j', kind: 'maintenance', status: 'cancelled', available_at: at, payload: { task: 'nutrition_24h', leadId: 'lead' } }]
  assert.equal(projectLeadPipeline(input).nextActionScheduled, false)
  input.jobs[0].status = 'pending'
  assert.equal(projectLeadPipeline(input).nextActionScheduled, true)
  input.metadata = { next_action: 'Responder consulta', next_action_at: at }
  assert.equal(projectLeadPipeline(input).nextActionScheduled, false)
})

test('unavailable sources are explicit, foreign records ignored, evidence does not invent a transition history', () => {
  const input = base(); input.coverage = { messages: false, sales: false }
  input.sales = [{ lead_id: 'other', unit_id: 'u', sale_at: at }]
  const before = JSON.stringify(input), result = projectLeadPipeline(input)
  assert.equal(result.stage, 'nuevo'); assert.equal(result.attentionStatus, 'sin_datos')
  assert.ok(result.warnings.length); assert.deepEqual(result.history, [])
  assert.equal(JSON.stringify(input), before)
})

test('persisted stage observations use observation time and actor without backdating the first transition', () => {
  const input = base(); input.scoreEvents = [{ id: 'e', event_type: 'asked_price', created_at: at }]
  input.history = [{ lead_id: 'lead', from_stage: null, to_stage: 'interes_comercial',
    reason: 'Evidencia comercial', source_at: at, observed_at: '2026-10-16T15:00:00Z', actor_id: null }]
  const result = projectLeadPipeline(input)
  assert.equal(result.stageChangedAt, '2026-10-16T15:00:00Z')
  assert.deepEqual(result.history[0], { from: null, to: 'interes_comercial', reason: 'Evidencia comercial', at: '2026-10-16T15:00:00Z', actor: null })
})

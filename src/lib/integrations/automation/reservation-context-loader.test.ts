import assert from 'node:assert/strict'
import test from 'node:test'
import { scope, type Row } from './data'
import { loadReservationContext } from './reservation-context-loader'
import { commercialJourneyPlan } from './commercial-journey'

const lead: Row = { ...scope, id: 'lead-605', assigned_to: 'advisor-current', handoff_status: 'assigned' }
const catalog = [{ id: 'u605', unit_number: '605', category: 'penthouse' }]
const at = '2026-10-16T14:19:00Z'
const request = { id: 'request-605', lead_id: lead.id, unit_ids: ['u605'], request_status: 'requested',
  source_sent_at: '2026-10-16T05:48:00Z', created_at: '2026-10-16T05:49:00Z',
  assigned_to: null, handoff_status: 'queued', notification_status: 'created' }

test('a bounded reservation read supplies the recorded unit and current owner rather than its intake snapshot', async () => {
  const calls: unknown[] = []
  const result = await loadReservationContext(lead, catalog, at, async (...args) => {
    calls.push(args)
    return { data: [request], error: null }
  })
  assert.deepEqual(calls, [[lead.id, at]])
  assert.equal(result.read_status, 'available')
  assert.equal(result.request_id, 'request-605')
  assert.deepEqual(result.unit_ids, ['u605'])
  assert.deepEqual(result.unit_numbers, ['605'])
  assert.equal(result.assigned_advisor_id, 'advisor-current')
  assert.equal(result.handoff_status, 'assigned')
})

test('no rows and an unavailable read remain different operational states', async () => {
  const absent = await loadReservationContext(lead, catalog, at, async () => ({ data: [], error: null }))
  const failed = await loadReservationContext(lead, catalog, at, async () => ({ data: null, error: { code: 'PGRST205' } }))
  const thrown = await loadReservationContext(lead, catalog, at, async () => { throw Error('timeout') })
  assert.equal(absent.read_status, 'available')
  assert.equal(absent.active, false)
  for (const result of [failed, thrown]) {
    assert.equal(result.read_status, 'unavailable')
    assert.equal(result.active, false)
    assert.notEqual(result.request_status, 'cancelled')
  }
})

test('unscoped leads and invalid temporal anchors cannot invoke the request reader', async () => {
  let calls = 0
  for (const [candidate, sourceAt] of [[{ ...lead, tenant_id: 'other' }, at],
    [{ ...lead, project_id: 'other' }, at], [{ id: lead.id }, at], [lead, 'not-a-date']] as const) {
    const result = await loadReservationContext(candidate, catalog, sourceAt, async () => {
      calls++
      return { data: [request], error: null }
    })
    assert.equal(result.read_status, 'unavailable')
  }
  assert.equal(calls, 0)
})

test('a failed first read during a tracking inquiry cannot revive the historical bedroom search', async () => {
  const current = 'Aún nadie me llama sobre la reserva que solicité'
  const reservation = await loadReservationContext(lead, catalog, at, async () => ({ data: null, error: { code: 'timeout' } }))
  const plan = commercialJourneyPlan({ reservation_context: reservation, mensaje_actual: current.toUpperCase(),
    property_context: { selected_ids: [], query: {} }, catalogo: [],
    hechos_confirmados: { property: { group: 'residential', filters: { bedrooms: 5 }, evidence: 'Quiero cinco dormitorios', confidence: 'high' } },
    semantica_turno: { property: { operation: 'none' } },
    solicitudes_interpretadas: [{ domain: 'tracking', request: current, evidence: current, confidence: 'high' }] })
  assert.equal(plan.action, 'answer_current_question')
  assert.equal(plan.question_id, '')
  assert.equal(plan.proposed_query, undefined)
  assert.equal(plan.selected_unit_id, undefined, 'A read failure does not invent or restore a selection')
})

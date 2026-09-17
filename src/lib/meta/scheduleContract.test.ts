/**
 * Contrato Schedule web vs WhatsApp (sin I/O Nest/Meta).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateScheduleEligibility,
  scheduleIdempotencyKey,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'
import {
  FLUSH_NEST_INACTIVE,
  isScheduleFlushEnabled,
  isScheduleLocalPersistEnabled,
  NEST_MISSING_MESSAGING_FIELDS,
  planScheduleDelivery,
  WHATSAPP_CTWA_CLID_MISSING,
  WHATSAPP_PHONE_MISSING,
} from './scheduleContract'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

function elig(channel: string) {
  return evaluateScheduleEligibility({
    appointmentId: APPT,
    status: 'aceptado',
    channel,
    confirmedByClient: true,
    leadId: LEAD,
    adsConsent: true,
  })
}

describe('planScheduleDelivery — web vs WhatsApp', () => {
  it('web: payload website, sin CTWA; flush Nest bloqueado; dedupe por cita', () => {
    const eligibility = elig('web')
    const plan = planScheduleDelivery({
      eligibility,
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: null,
      wabaId: null,
      fbp: 'fb.1.x',
    })
    assert.equal(plan.canBuildPayload, true)
    assert.equal(plan.canPersistLocal, true)
    assert.equal(plan.canFlushNest, false)
    assert.equal(plan.payload?.action_source, 'website')
    assert.equal(plan.payload?.ctwa_clid, undefined)
    assert.equal(plan.idempotencyKey, scheduleIdempotencyKey(APPT))
    assert.ok(plan.blockers.includes(FLUSH_NEST_INACTIVE))
  })

  it('WhatsApp sin CTWA: bloqueo explícito; Nest messaging incompleto', () => {
    const eligibility = elig('whatsapp')
    const plan = planScheduleDelivery({
      eligibility,
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: null,
      wabaId: null,
    })
    assert.equal(plan.canBuildPayload, true)
    assert.equal(plan.canFlushNest, false)
    assert.ok(plan.blockers.includes(WHATSAPP_CTWA_CLID_MISSING))
    assert.ok(plan.blockers.includes(WHATSAPP_SCHEDULE_DELIVERY_PENDING))
    assert.ok(plan.blockers.includes(NEST_MISSING_MESSAGING_FIELDS))
    assert.equal(plan.payload?.action_source, 'business_messaging')
    assert.equal(plan.payload?.messaging_channel, 'whatsapp')
    assert.equal(plan.payload?.ctwa_clid, undefined)
  })

  it('WhatsApp con CTWA+WABA: sigue sin flush (contrato Nest pendiente)', () => {
    const eligibility = elig('whatsapp')
    const plan = planScheduleDelivery({
      eligibility,
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: 'Aff-EXAMPLE',
      wabaId: 'waba-1',
    })
    assert.equal(plan.canBuildPayload, true)
    assert.equal(plan.payload?.ctwa_clid, 'Aff-EXAMPLE')
    assert.equal(plan.payload?.waba_id, 'waba-1')
    assert.equal(plan.canFlushNest, false)
    assert.ok(plan.blockers.includes(NEST_MISSING_MESSAGING_FIELDS))
    assert.equal(plan.blockers.includes(WHATSAPP_CTWA_CLID_MISSING), false)
  })

  it('WhatsApp sin teléfono: no arma payload', () => {
    const plan = planScheduleDelivery({
      eligibility: elig('whatsapp'),
      leadId: LEAD,
      phone: null,
      ctwaClid: 'Aff-X',
      wabaId: 'waba-1',
    })
    assert.equal(plan.canBuildPayload, false)
    assert.ok(plan.blockers.includes(WHATSAPP_PHONE_MISSING))
  })

  it('activación: local persist off por defecto; flush siempre off', () => {
    assert.equal(isScheduleLocalPersistEnabled({}), false)
    assert.equal(isScheduleLocalPersistEnabled({ META_SCHEDULE_LOCAL_PERSIST: 'true' }), true)
    assert.equal(isScheduleFlushEnabled({ META_SCHEDULE_FLUSH: 'true' }), false)
  })
})

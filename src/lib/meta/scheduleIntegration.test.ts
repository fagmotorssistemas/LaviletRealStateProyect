/**
 * Pruebas: elegibilidad Schedule (cola separada; WhatsApp pendiente Nest/Meta).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionSourceForScheduleChannel,
  classifyAppointmentChannel,
  evaluateScheduleEligibility,
  isConfirmedAppointmentStatus,
  isScheduleQueueActive,
  scheduleIdempotencyKey,
  SCHEDULE_QUEUE_INACTIVE,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

describe('Schedule channel vs web', () => {
  it('WhatsApp no usa website; action_source futuro ≠ entrega lista', () => {
    assert.equal(classifyAppointmentChannel('whatsapp'), 'whatsapp')
    assert.equal(actionSourceForScheduleChannel('whatsapp'), 'business_messaging')
    assert.notEqual(actionSourceForScheduleChannel('whatsapp'), 'website')
    const result = evaluateScheduleEligibility({
      appointmentId: APPT,
      status: 'aceptado',
      channel: 'whatsapp',
      leadId: LEAD,
      adsConsent: true,
    })
    assert.equal(result.businessOk, true)
    assert.equal(result.queueable, false)
    assert.equal(result.reason, WHATSAPP_SCHEDULE_DELIVERY_PENDING)
  })

  it('web: negocio OK pero cola inactiva (separada)', () => {
    const result = evaluateScheduleEligibility({
      appointmentId: APPT,
      status: 'aceptado',
      channel: 'web',
      leadId: LEAD,
      adsConsent: true,
    })
    assert.equal(result.businessOk, true)
    assert.equal(result.queueable, false)
    assert.equal(result.reason, SCHEDULE_QUEUE_INACTIVE)
    assert.equal(result.actionSource, 'website')
  })
})

describe('Schedule eligibility tras confirmación', () => {
  it('aceptar cita no implica consentimiento', () => {
    assert.equal(
      evaluateScheduleEligibility({
        appointmentId: APPT,
        status: 'aceptado',
        channel: 'whatsapp',
        leadId: LEAD,
        adsConsent: null,
      }).reason,
      'ads_consent_missing',
    )
    assert.equal(
      evaluateScheduleEligibility({
        appointmentId: APPT,
        status: 'aceptado',
        channel: 'web',
        leadId: LEAD,
        adsConsent: false,
      }).reason,
      'ads_consent_false',
    )
  })

  it('solo estado confirmado; propuesta/solicitada excluidas', () => {
    assert.equal(isConfirmedAppointmentStatus('aceptado'), true)
    assert.equal(isConfirmedAppointmentStatus('solicitada'), false)
    assert.equal(
      evaluateScheduleEligibility({
        appointmentId: APPT,
        status: 'solicitada',
        channel: 'whatsapp',
        leadId: LEAD,
        adsConsent: true,
      }).reason,
      'not_confirmed_status',
    )
  })

  it('idempotency estable; cola activa off', () => {
    assert.equal(scheduleIdempotencyKey(APPT), `schedule:${APPT}`)
    assert.equal(isScheduleQueueActive({}), false)
    assert.equal(isScheduleQueueActive({ META_SCHEDULE_PERSIST: 'true' }), false)
  })
})

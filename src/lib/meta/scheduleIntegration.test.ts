/**
 * Pruebas: elegibilidad Schedule (cola separada; WhatsApp pendiente Nest/Meta).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionSourceForScheduleChannel,
  CHANNEL_PENDING_EVIDENCE,
  classifyAppointmentChannel,
  CLIENT_CONFIRMATION_MISSING,
  evaluateScheduleEligibility,
  isConfirmedAppointmentStatus,
  isScheduleQueueActive,
  scheduleIdempotencyKey,
  SCHEDULE_QUEUE_INACTIVE,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: APPT,
    status: 'aceptado',
    channel: 'whatsapp',
    confirmedByClient: true,
    leadId: LEAD,
    adsConsent: true,
    ...overrides,
  }
}

describe('Schedule channel vs web', () => {
  it('WhatsApp no usa website; action_source futuro ≠ entrega lista', () => {
    assert.equal(classifyAppointmentChannel('whatsapp'), 'whatsapp')
    assert.equal(actionSourceForScheduleChannel('whatsapp'), 'business_messaging')
    assert.notEqual(actionSourceForScheduleChannel('whatsapp'), 'website')
    const result = evaluateScheduleEligibility(baseInput({ channel: 'whatsapp' }))
    assert.equal(result.businessOk, true)
    assert.equal(result.queueable, false)
    assert.equal(result.reason, WHATSAPP_SCHEDULE_DELIVERY_PENDING)
  })

  it('web explícito: negocio OK pero cola inactiva (separada)', () => {
    const result = evaluateScheduleEligibility(baseInput({ channel: 'web' }))
    assert.equal(result.businessOk, true)
    assert.equal(result.queueable, false)
    assert.equal(result.reason, SCHEDULE_QUEUE_INACTIVE)
    assert.equal(result.actionSource, 'website')
  })

  it('canal crm sin evidencia web no se clasifica como website', () => {
    assert.equal(classifyAppointmentChannel('crm'), 'pending')
    assert.notEqual(actionSourceForScheduleChannel('pending'), 'website')
    const result = evaluateScheduleEligibility(baseInput({ channel: 'crm' }))
    assert.equal(result.businessOk, false)
    assert.equal(result.queueable, false)
    assert.equal(result.reason, CHANNEL_PENDING_EVIDENCE)
    assert.equal(result.channelKind, 'pending')
    assert.equal(result.actionSource, 'other')
  })

  it('canal vacío: evaluación pendiente (no website)', () => {
    assert.equal(classifyAppointmentChannel(null), 'pending')
    assert.equal(
      evaluateScheduleEligibility(baseInput({ channel: null })).reason,
      CHANNEL_PENDING_EVIDENCE,
    )
  })
})

describe('Schedule eligibility tras confirmación', () => {
  it('aceptado con confirmed_by_client false/null queda excluido', () => {
    assert.equal(
      evaluateScheduleEligibility(baseInput({ confirmedByClient: false })).reason,
      CLIENT_CONFIRMATION_MISSING,
    )
    assert.equal(
      evaluateScheduleEligibility(baseInput({ confirmedByClient: null })).reason,
      CLIENT_CONFIRMATION_MISSING,
    )
    assert.equal(
      evaluateScheduleEligibility(baseInput({ confirmedByClient: undefined })).reason,
      CLIENT_CONFIRMATION_MISSING,
    )
    assert.equal(
      evaluateScheduleEligibility(baseInput({ confirmedByClient: false })).businessOk,
      false,
    )
  })

  it('aceptar cita no implica consentimiento', () => {
    assert.equal(
      evaluateScheduleEligibility(baseInput({ adsConsent: null })).reason,
      'ads_consent_missing',
    )
    assert.equal(
      evaluateScheduleEligibility(baseInput({ channel: 'web', adsConsent: false })).reason,
      'ads_consent_false',
    )
  })

  it('solo estado confirmado; propuesta/solicitada excluidas', () => {
    assert.equal(isConfirmedAppointmentStatus('aceptado'), true)
    assert.equal(isConfirmedAppointmentStatus('solicitada'), false)
    assert.equal(
      evaluateScheduleEligibility(baseInput({ status: 'solicitada' })).reason,
      'not_confirmed_status',
    )
  })

  it('idempotency estable; cola activa off', () => {
    assert.equal(scheduleIdempotencyKey(APPT), `schedule:${APPT}`)
    assert.equal(isScheduleQueueActive({}), false)
    assert.equal(isScheduleQueueActive({ META_SCHEDULE_PERSIST: 'true' }), false)
  })
})

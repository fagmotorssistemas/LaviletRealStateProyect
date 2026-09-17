/**
 * Pruebas aisladas: elegibilidad Schedule tras «Aceptar cita» / confirmación.
 * No publica ni envía eventos Meta reales.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionSourceForScheduleChannel,
  classifyAppointmentChannel,
  evaluateScheduleEligibility,
  isConfirmedAppointmentStatus,
  isSchedulePersistEnabled,
  scheduleIdempotencyKey,
} from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

describe('Schedule channel vs web', () => {
  it('WhatsApp no se clasifica como web ni usa action_source website', () => {
    assert.equal(classifyAppointmentChannel('whatsapp'), 'whatsapp')
    assert.equal(classifyAppointmentChannel('waba'), 'whatsapp')
    assert.equal(actionSourceForScheduleChannel('whatsapp'), 'business_messaging')
    assert.notEqual(actionSourceForScheduleChannel('whatsapp'), 'website')
  })

  it('web/crm usa website; desconocido es conservador (other)', () => {
    assert.equal(classifyAppointmentChannel('web'), 'web')
    assert.equal(actionSourceForScheduleChannel('web'), 'website')
    assert.equal(classifyAppointmentChannel(null), 'unknown')
    assert.equal(actionSourceForScheduleChannel('unknown'), 'other')
  })
})

describe('Schedule eligibility tras confirmación', () => {
  it('cita aceptada WhatsApp con ads consent true → elegible business_messaging', () => {
    const result = evaluateScheduleEligibility({
      appointmentId: APPT,
      status: 'aceptado',
      channel: 'whatsapp',
      leadId: LEAD,
      adsConsent: true,
    })
    assert.equal(result.eligible, true)
    assert.equal(result.reason, 'eligible')
    assert.equal(result.actionSource, 'business_messaging')
    assert.equal(result.idempotencyKey, `schedule:${APPT}`)
  })

  it('cita web confirmada con consent → website (no messaging)', () => {
    const result = evaluateScheduleEligibility({
      appointmentId: APPT,
      status: 'aceptado',
      channel: 'web',
      leadId: LEAD,
      adsConsent: true,
    })
    assert.equal(result.eligible, true)
    assert.equal(result.actionSource, 'website')
  })

  it('aceptar cita no implica consentimiento: null/false bloquean', () => {
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
        channel: 'whatsapp',
        leadId: LEAD,
        adsConsent: false,
      }).reason,
      'ads_consent_false',
    )
  })

  it('solo tras estado confirmado (aceptado/reprogramado)', () => {
    assert.equal(isConfirmedAppointmentStatus('aceptado'), true)
    assert.equal(isConfirmedAppointmentStatus('reprogramado'), true)
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

  it('canal desconocido no se presenta como web', () => {
    const result = evaluateScheduleEligibility({
      appointmentId: APPT,
      status: 'aceptado',
      channel: null,
      leadId: LEAD,
      adsConsent: true,
    })
    assert.equal(result.eligible, false)
    assert.equal(result.reason, 'unknown_channel')
    assert.notEqual(result.actionSource, 'website')
  })

  it('idempotency estable ante doble clic / reintento', () => {
    const a = scheduleIdempotencyKey(APPT)
    const b = scheduleIdempotencyKey(APPT)
    assert.equal(a, b)
    assert.equal(a, `schedule:${APPT}`)
  })
})

describe('Persistencia Schedule (revisión)', () => {
  it('por defecto no persiste (META_SCHEDULE_PERSIST off)', () => {
    assert.equal(isSchedulePersistEnabled({}), false)
    assert.equal(isSchedulePersistEnabled({ META_SCHEDULE_PERSIST: 'false' }), false)
    assert.equal(isSchedulePersistEnabled({ META_SCHEDULE_PERSIST: 'true' }), true)
  })
})

/**
 * Contrato Schedule web vs WhatsApp (payload Nest/Meta verificado parcialmente).
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
  planScheduleDelivery,
  WHATSAPP_CTWA_CLID_REQUIRED,
  WHATSAPP_DATASET_ID_MISSING,
  WHATSAPP_PHONE_MISSING,
  WHATSAPP_SCHEDULE_EVENT_NAME_UNVERIFIED,
  WHATSAPP_WABA_ID_MISSING,
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
  it('web: payload website; flush Nest bloqueado; dedupe por cita', () => {
    const plan = planScheduleDelivery({
      eligibility: elig('web'),
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: null,
      wabaId: null,
      messagingDatasetId: null,
      fbp: 'fb.1.x',
    })
    assert.equal(plan.canBuildPayload, true)
    assert.equal(plan.canPersistReviewHold, true)
    assert.equal(plan.canFlushNest, false)
    assert.equal(plan.payload?.action_source, 'website')
    assert.equal(plan.payload?.ctwa_clid, undefined)
    assert.equal(plan.idempotencyKey, scheduleIdempotencyKey(APPT))
    assert.ok(plan.blockers.includes(FLUSH_NEST_INACTIVE))
  })

  it('WhatsApp sin CTWA: bloqueo requerido (no “atribución floja”)', () => {
    const plan = planScheduleDelivery({
      eligibility: elig('whatsapp'),
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: null,
      wabaId: 'waba-1',
      messagingDatasetId: 'dataset-1',
    })
    assert.ok(plan.blockers.includes(WHATSAPP_CTWA_CLID_REQUIRED))
    assert.equal(plan.payload?.meta_capi_ready, false)
    assert.equal(plan.canFlushNest, false)
    assert.ok(plan.blockers.includes(FLUSH_NEST_INACTIVE))
  })

  it('WhatsApp: WABA ≠ dataset; ambos requeridos por separado', () => {
    const missingDataset = planScheduleDelivery({
      eligibility: elig('whatsapp'),
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: 'Aff-X',
      wabaId: 'waba-1',
      messagingDatasetId: null,
    })
    assert.ok(missingDataset.blockers.includes(WHATSAPP_DATASET_ID_MISSING))
    assert.equal(missingDataset.blockers.includes(WHATSAPP_WABA_ID_MISSING), false)

    const readyShape = planScheduleDelivery({
      eligibility: elig('whatsapp'),
      leadId: LEAD,
      phone: '593990000000',
      ctwaClid: 'Aff-X',
      wabaId: 'waba-1',
      messagingDatasetId: 'dataset-1',
    })
    assert.equal(readyShape.payload?.whatsapp_business_account_id, 'waba-1')
    assert.equal(readyShape.payload?.messaging_dataset_id, 'dataset-1')
    assert.notEqual(
      readyShape.payload?.whatsapp_business_account_id,
      readyShape.payload?.messaging_dataset_id,
    )
    assert.equal(readyShape.payload?.meta_capi_ready, true)
    assert.ok(readyShape.blockers.includes(WHATSAPP_SCHEDULE_EVENT_NAME_UNVERIFIED))
    assert.ok(readyShape.blockers.includes(WHATSAPP_SCHEDULE_DELIVERY_PENDING))
    assert.equal(readyShape.canFlushNest, false)
  })

  it('WhatsApp sin teléfono: no arma payload', () => {
    const plan = planScheduleDelivery({
      eligibility: elig('whatsapp'),
      leadId: LEAD,
      phone: null,
      ctwaClid: 'Aff-X',
      wabaId: 'waba-1',
      messagingDatasetId: 'dataset-1',
    })
    assert.equal(plan.canBuildPayload, false)
    assert.ok(plan.blockers.includes(WHATSAPP_PHONE_MISSING))
  })

  it('activación: local persist off; flush siempre off', () => {
    assert.equal(isScheduleLocalPersistEnabled({}), false)
    assert.equal(isScheduleFlushEnabled({ META_SCHEDULE_FLUSH: 'true' }), false)
  })
})

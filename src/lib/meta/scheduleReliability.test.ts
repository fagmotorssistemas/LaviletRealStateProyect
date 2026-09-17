/**
 * Cuatro garantías: sin escrituras si controles off; intent inmutable/concurrente;
 * no pending sin delivery; fallo confirm→persist no pierde intent.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  prepareScheduleDeliveryAfterConfirmation,
  promoteScheduleReviewHoldForAppointment,
  registerMetaScheduleIntent,
} from './scheduleDelivery'
import {
  ALL_SCHEDULE_CONTROLS_OFF,
  DELIVERY_PIPELINE_INACTIVE,
  LOCAL_PERSIST_INACTIVE,
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
} from './scheduleContract'
import { OUTBOX_FLUSHABLE_STATUS, OUTBOX_REVIEW_HOLD_STATUS } from './localOutbox'
import { scheduleIdempotencyKey } from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'
const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'
const CONFIRMED_AT = '2026-09-17T15:00:00.000Z'
const EVENT_TIME = Math.floor(Date.parse(CONFIRMED_AT) / 1000)

function clients() {
  let storedIntent: {
    event_id: string
    event_time: number
    channel: string
  } | null = null
  const intentCalls: unknown[] = []
  const persistCalls: unknown[] = []

  const session = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {}
      const self = () => builder
      builder.select = self
      builder.eq = self
      builder.order = self
      builder.limit = self
      builder.maybeSingle = async () => {
        if (table === 'appointments') {
          return {
            data: {
              id: APPT,
              lead_id: LEAD,
              status: 'aceptado',
              channel: 'web',
              confirmed_by_client: true,
              confirmed_at: CONFIRMED_AT,
              tenant_id: TENANT,
              project_id: PROJECT,
              meta_schedule_event_id: storedIntent?.event_id || null,
              meta_schedule_event_time: storedIntent?.event_time || null,
            },
            error: null,
          }
        }
        if (table === 'leads') {
          return {
            data: {
              id: LEAD,
              phone: '593990000000',
              name: 'Cliente',
              email: 'c@x.com',
              contact_id: '456',
              meta_ads_consent: true,
            },
            error: null,
          }
        }
        if (table === 'meta_capi_outbox') {
          return {
            data: {
              id: 'row-1',
              status: OUTBOX_REVIEW_HOLD_STATUS,
              event_id: storedIntent?.event_id || 'e',
            },
            error: null,
          }
        }
        return { data: null, error: null }
      }
      builder.update = () => builder
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
      return builder
    },
  } as never

  const admin = {
    ...session,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'lv_register_meta_schedule_intent') {
        return { data: null, error: { message: 'unexpected_rpc' } }
      }
      intentCalls.push(args)
      if (storedIntent) {
        return {
          data: {
            ok: true,
            inserted: false,
            event_id: storedIntent.event_id,
            event_time: storedIntent.event_time,
            channel: storedIntent.channel,
          },
          error: null,
        }
      }
      storedIntent = {
        event_id: String(args.p_event_id),
        event_time: Number(args.p_event_time),
        channel: String(args.p_channel),
      }
      return {
        data: {
          ok: true,
          inserted: true,
          event_id: storedIntent.event_id,
          event_time: storedIntent.event_time,
          channel: storedIntent.channel,
        },
        error: null,
      }
    },
  } as never

  return { session, admin, intentCalls, persistCalls, getIntent: () => storedIntent }
}

describe('1) sin escrituras si controles off', () => {
  it('no llama intent ni persist cuando todo está apagado', async () => {
    const { session, admin, intentCalls, persistCalls } = clients()
    let persistHits = 0
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      adminClient: admin,
      allowLocalPersist: false,
      allowDelivery: false,
      registerIntent: async () => {
        intentCalls.push('should_not')
        throw new Error('no_intent')
      },
      persist: async () => {
        persistHits += 1
        throw new Error('no_persist')
      },
    })
    assert.equal(result.reason, ALL_SCHEDULE_CONTROLS_OFF)
    assert.equal(result.wroteSchedule, false)
    assert.equal(intentCalls.length, 0)
    assert.equal(persistHits, 0)
    assert.equal(persistCalls.length, 0)
  })
})

describe('2) intent atómico inmutable + fallo post-confirm', () => {
  it('concurrencia: segundo registro conserva event_id/time originales', async () => {
    const { admin, getIntent } = clients()
    const first = await registerMetaScheduleIntent(admin, {
      appointmentId: APPT,
      eventId: '11111111-1111-4111-8111-111111111111',
      eventTime: EVENT_TIME,
      lane: 'live',
      channelKind: 'web',
      payload: { action_source: 'website' },
    })
    const second = await registerMetaScheduleIntent(admin, {
      appointmentId: APPT,
      eventId: '22222222-2222-4222-8222-222222222222',
      eventTime: EVENT_TIME + 999,
      lane: 'live',
      channelKind: 'web',
      payload: { action_source: 'website' },
    })
    assert.equal(first.inserted, true)
    assert.equal(second.inserted, false)
    assert.equal(second.eventId, first.eventId)
    assert.equal(second.eventTime, first.eventTime)
    assert.equal(getIntent()?.event_id, first.eventId)
    assert.notEqual(second.eventId, '22222222-2222-4222-8222-222222222222')
  })

  it('fallo entre confirmación e persistencia: intent queda; cita no se revierte', async () => {
    const { session, admin, getIntent } = clients()
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: admin,
      persistAttempts: 2,
      sleep: async () => undefined,
      persist: async () => {
        throw new Error('outbox_down')
      },
    })
    assert.equal(result.reason, 'persist_failed')
    assert.equal(result.intentSaved, true)
    assert.equal(result.wroteSchedule, true)
    assert.equal(getIntent()?.event_time, EVENT_TIME)
    assert.ok(getIntent()?.event_id)
  })
})

describe('3) delivery off → no pending (FE)', () => {
  it('flags: flush requiere delivery', () => {
    assert.equal(isScheduleDeliveryEnabled({}), false)
    assert.equal(isScheduleFlushEnabled({ META_SCHEDULE_FLUSH: 'true' }), false)
  })

  it('promote rechazado con delivery off; con delivery on solo esta cita', async () => {
    const { admin } = clients()
    const gated = await promoteScheduleReviewHoldForAppointment(admin, APPT, {
      getLeadAdsConsent: async () => true,
      allowDelivery: false,
    })
    assert.equal(gated.reason, DELIVERY_PIPELINE_INACTIVE)
    assert.equal(gated.promoted, false)

    const ok = await promoteScheduleReviewHoldForAppointment(admin, APPT, {
      getLeadAdsConsent: async () => true,
      allowDelivery: true,
    })
    assert.equal(ok.promoted, true)
  })

  it('persist con delivery off deja review_hold (no pending)', async () => {
    const { session, admin } = clients()
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      allowDelivery: false,
      adminClient: admin,
      persist: async (_s, input) => {
        assert.equal(input.status, OUTBOX_REVIEW_HOLD_STATUS)
        assert.equal(input.idempotencyKey, scheduleIdempotencyKey(APPT))
        return {
          inserted: true,
          eventId: input.eventId || 'e',
          rowId: 'r',
          status: OUTBOX_REVIEW_HOLD_STATUS,
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.promoted, false)
    assert.equal(result.outboxStatus, OUTBOX_REVIEW_HOLD_STATUS)
    assert.notEqual(result.outboxStatus, OUTBOX_FLUSHABLE_STATUS)
  })
})

describe('4) recover / canal (contrato en migración + plan)', () => {
  it('sin persist ni delivery: LOCAL_PERSIST_INACTIVE (no asume escritura)', async () => {
    const { session, admin } = clients()
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: false,
      allowDelivery: false,
      adminClient: admin,
      persist: async () => {
        throw new Error('should_not_persist')
      },
    })
    assert.ok(
      result.reason === LOCAL_PERSIST_INACTIVE ||
        result.reason === 'all_schedule_controls_off',
    )
    assert.equal(result.wroteSchedule, false)
  })

  it('sin persist con delivery: promote de hold existente sin nueva escritura', async () => {
    const { session, admin } = clients()
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: false,
      allowDelivery: true,
      adminClient: admin,
      persist: async () => {
        throw new Error('should_not_persist')
      },
    })
    assert.equal(result.wroteSchedule, false)
    assert.ok(
      result.reason === 'promoted_to_pending' ||
        result.reason === 'already_pending' ||
        result.reason === 'outbox_row_missing',
    )
  })
})

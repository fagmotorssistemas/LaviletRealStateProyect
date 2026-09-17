/**
 * Persistencia service_role, intent durable, promote gated, sin auto históricos.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  prepareScheduleDeliveryAfterConfirmation,
  promoteScheduleReviewHoldForAppointment,
  recoverMissingScheduleReviewHold,
} from './scheduleDelivery'
import {
  cancelPendingMetaOutbox,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
} from './localOutbox'
import {
  DELIVERY_PIPELINE_INACTIVE,
  LOCAL_PERSIST_INACTIVE,
  isScheduleFlushEnabled,
  isScheduleDeliveryEnabled,
} from './scheduleContract'
import { scheduleIdempotencyKey } from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'
const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'
const CONFIRMED_AT = '2026-09-17T15:00:00.000Z'
const EVENT_TIME = Math.floor(Date.parse(CONFIRMED_AT) / 1000)

function sessionAndAdmin(opts: {
  channel?: string
  consent?: boolean | null
  phone?: string | null
  denyOutboxOnSession?: boolean
}) {
  const intentUpdates: Record<string, unknown>[] = []
  const outboxInserts: unknown[] = []

  function makeClient(role: 'session' | 'admin') {
    return {
      from: (table: string) => {
        const filters: Record<string, string> = {}
        const builder: Record<string, unknown> = {}
        const self = () => builder
        builder.select = self
        builder.eq = (col: string, val: string) => {
          filters[col] = String(val)
          return builder
        }
        builder.order = self
        builder.limit = self
        builder.update = (body: Record<string, unknown>) => {
          builder.__updateBody = body
          return builder
        }
        builder.maybeSingle = async () => {
          if (table === 'appointments') {
            return {
              data: {
                id: APPT,
                lead_id: LEAD,
                status: 'aceptado',
                channel: opts.channel ?? 'web',
                confirmed_by_client: true,
                confirmed_at: CONFIRMED_AT,
                tenant_id: TENANT,
                project_id: PROJECT,
                meta_schedule_event_id: null,
              },
              error: null,
            }
          }
          if (table === 'leads') {
            return {
              data: {
                id: LEAD,
                phone: opts.phone ?? '593990000000',
                name: 'Cliente Lead',
                email: 'cliente@example.com',
                contact_id: '456',
                meta_ads_consent: opts.consent ?? true,
              },
              error: null,
            }
          }
          if (table === 'meta_capi_outbox') {
            return {
              data: {
                id: 'row-1',
                status: OUTBOX_REVIEW_HOLD_STATUS,
                event_id: 'e-fixed',
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }
        builder.then = async (resolve: (v: unknown) => void) => {
          if (table === 'appointments' && builder.__updateBody) {
            if (role === 'admin') intentUpdates.push(builder.__updateBody as Record<string, unknown>)
            resolve({ data: null, error: null })
            return
          }
          if (table === 'meta_capi_outbox' && builder.__updateBody) {
            resolve({ data: [{ id: 'row-1' }], error: null })
            return
          }
          resolve({ data: null, error: null })
        }
        return builder
      },
      role,
    } as never
  }

  const session = makeClient('session')
  const admin = makeClient('admin')
  return { session, admin, intentUpdates, outboxInserts }
}

describe('permisos: outbox no depende de sesión asesor', () => {
  it('sin adminClient (service_role) no persiste outbox', async () => {
    const { session } = sessionAndAdmin({})
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: null,
      persist: async () => {
        throw new Error('session_must_not_persist')
      },
    })
    assert.equal(result.reason, 'service_role_required_for_outbox')
  })

  it('con adminClient: intent + persist usan service_role; conserva event_time de confirmed_at', async () => {
    const { session, admin, intentUpdates } = sessionAndAdmin({})
    let persistEventTime: number | undefined
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: admin,
      persist: async (_sb, input) => {
        persistEventTime = input.eventTime
        assert.equal(input.status, OUTBOX_REVIEW_HOLD_STATUS)
        assert.equal(input.idempotencyKey, scheduleIdempotencyKey(APPT))
        return {
          inserted: true,
          eventId: input.eventId || 'e1',
          rowId: 'r1',
          status: OUTBOX_REVIEW_HOLD_STATUS,
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.intentSaved, true)
    assert.equal(persistEventTime, EVENT_TIME)
    assert.equal(intentUpdates[0]?.meta_schedule_event_time, EVENT_TIME)
    assert.ok(intentUpdates[0]?.meta_schedule_event_id)
  })
})

describe('pipeline web gated', () => {
  it('flags off: no delivery ni flush aunque META_SCHEDULE_FLUSH=true', () => {
    assert.equal(isScheduleDeliveryEnabled({}), false)
    assert.equal(
      isScheduleFlushEnabled({
        META_SCHEDULE_FLUSH: 'true',
        META_SCHEDULE_DELIVERY_ENABLED: 'false',
      }),
      false,
    )
  })

  it('promote exige delivery on y revalidación; no lote histórico', async () => {
    const { admin } = sessionAndAdmin({})
    const gated = await promoteScheduleReviewHoldForAppointment(admin, APPT, {
      getLeadAdsConsent: async () => true,
      allowDelivery: false,
    })
    assert.equal(gated.reason, DELIVERY_PIPELINE_INACTIVE)

    const ok = await promoteScheduleReviewHoldForAppointment(admin, APPT, {
      getLeadAdsConsent: async () => true,
      allowDelivery: true,
    })
    assert.equal(ok.ok, true)
    assert.equal(ok.promoted, true)
    assert.equal(ok.reason, 'promoted_to_pending')
  })

  it('delivery on promueve solo la cita actual tras persist', async () => {
    const { session, admin } = sessionAndAdmin({})
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      allowDelivery: true,
      allowFlush: false,
      adminClient: admin,
      persist: async (_s, input) => ({
        inserted: true,
        eventId: input.eventId || 'e-web',
        rowId: 'r',
        status: OUTBOX_REVIEW_HOLD_STATUS,
      }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.promoted, true)
    assert.equal(result.flushed, false)
    assert.equal(result.outboxStatus, OUTBOX_FLUSHABLE_STATUS)
  })
})

describe('persistencia fiable + recover', () => {
  it('reintenta persist y conserva dedupe', async () => {
    const { session, admin } = sessionAndAdmin({})
    let attempts = 0
    const result = await prepareScheduleDeliveryAfterConfirmation(session, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: admin,
      persistAttempts: 3,
      sleep: async () => undefined,
      persist: async (_sb, input) => {
        attempts += 1
        if (attempts < 3) throw new Error('transient')
        return {
          inserted: true,
          eventId: input.eventId || 'e',
          rowId: 'r',
          status: OUTBOX_REVIEW_HOLD_STATUS,
        }
      },
    })
    assert.equal(attempts, 3)
    assert.equal(result.reason, 'persisted_review_hold')
  })

  it('sin flag: recovery no persiste', async () => {
    const { session, admin } = sessionAndAdmin({})
    const recovered = await recoverMissingScheduleReviewHold(session, APPT, {
      getLeadAdsConsent: async () => true,
      adminClient: admin,
    })
    assert.equal(recovered.reason, LOCAL_PERSIST_INACTIVE)
    assert.equal(recovered.intentSaved, true)
  })
})

describe('consent revoke cancela review_hold', () => {
  it('cancelPendingMetaOutbox actualiza pending y review_hold', async () => {
    const updated: string[] = []
    const admin = {
      from: () => {
        const filters: Record<string, string> = {}
        const builder: Record<string, unknown> = {}
        builder.update = () => builder
        builder.eq = (col: string, val: string) => {
          filters[col] = val
          return builder
        }
        builder.select = async () => {
          updated.push(filters.status)
          return { data: [{ id: `id-${filters.status}` }], error: null }
        }
        return builder
      },
    } as never
    const n = await cancelPendingMetaOutbox(admin, { leadId: LEAD })
    assert.equal(n, 2)
    assert.deepEqual(updated.sort(), ['pending', 'review_hold'].sort())
  })
})

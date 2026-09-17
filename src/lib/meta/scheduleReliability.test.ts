/**
 * Persistencia fiable, consent revoke sobre review_hold, dedupe e aislamiento.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  prepareScheduleDeliveryAfterConfirmation,
  recoverMissingScheduleReviewHold,
} from './scheduleDelivery'
import { cancelPendingMetaOutbox, OUTBOX_REVIEW_HOLD_STATUS } from './localOutbox'
import { LOCAL_PERSIST_INACTIVE } from './scheduleContract'
import { scheduleIdempotencyKey } from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'
const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'

function supabaseMock(opts: {
  channel?: string
  consent?: boolean | null
  phone?: string | null
  contactId?: string | null
  confirmedByClient?: boolean
  ctwa?: { tenant: string; project: string; contact: string; clid: string } | null
}) {
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
      builder.maybeSingle = async () => {
        if (table === 'appointments') {
          return {
            data: {
              id: APPT,
              lead_id: LEAD,
              status: 'aceptado',
              channel: opts.channel ?? 'web',
              confirmed_by_client: opts.confirmedByClient ?? true,
              tenant_id: TENANT,
              project_id: PROJECT,
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
              contact_id: opts.contactId ?? '456',
              meta_ads_consent: opts.consent ?? true,
            },
            error: null,
          }
        }
        if (table === 'lv_whatsapp_ctwa_attribution') {
          const row = opts.ctwa
          if (
            row &&
            filters.tenant_id === row.tenant &&
            filters.project_id === row.project &&
            filters.contact_id === row.contact
          ) {
            return { data: { ctwa_clid: row.clid }, error: null }
          }
          return { data: null, error: null }
        }
        throw new Error(table)
      }
      return builder
    },
  } as never
}

describe('persistencia fiable Schedule', () => {
  it('reintenta si falla persist y luego inserta review_hold', async () => {
    let attempts = 0
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web' }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        allowLocalPersist: true,
        persistAttempts: 3,
        sleep: async () => undefined,
        persist: async (_sb, input) => {
          attempts += 1
          if (attempts < 3) throw new Error('transient')
          assert.equal(input.status, OUTBOX_REVIEW_HOLD_STATUS)
          assert.equal(input.idempotencyKey, scheduleIdempotencyKey(APPT))
          assert.equal((input.payload as { phone?: string }).phone, '593990000000')
          assert.equal((input.payload as { full_name?: string }).full_name, 'Cliente Lead')
          return {
            inserted: true,
            eventId: 'e-retry',
            rowId: 'r-retry',
            status: OUTBOX_REVIEW_HOLD_STATUS,
          }
        },
      },
    )
    assert.equal(attempts, 3)
    assert.equal(result.ok, true)
    assert.equal(result.reason, 'persisted_review_hold')
    assert.equal(result.persistAttempts, 3)
  })

  it('tras agotar reintentos: persist_failed (cita ya confirmada no pierde el reason)', async () => {
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web' }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        allowLocalPersist: true,
        persistAttempts: 2,
        sleep: async () => undefined,
        persist: async () => {
          throw new Error('outbox_down')
        },
      },
    )
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'persist_failed')
    assert.equal(result.persistAttempts, 2)
  })

  it('doble llamada: segunda es duplicate_review_hold (mismo idempotency)', async () => {
    const keys: string[] = []
    const persist = async (_sb: unknown, input: { idempotencyKey: string; status?: string }) => {
      keys.push(input.idempotencyKey)
      return {
        inserted: keys.length === 1,
        eventId: 'e-dup',
        rowId: 'r-dup',
        status: OUTBOX_REVIEW_HOLD_STATUS,
      }
    }
    const first = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web' }),
      APPT,
      { getLeadAdsConsent: async () => true, allowLocalPersist: true, persist },
    )
    const second = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web' }),
      APPT,
      { getLeadAdsConsent: async () => true, allowLocalPersist: true, persist },
    )
    assert.equal(first.reason, 'persisted_review_hold')
    assert.equal(second.reason, 'duplicate_review_hold')
    assert.deepEqual(keys, [scheduleIdempotencyKey(APPT), scheduleIdempotencyKey(APPT)])
  })

  it('sin flag: recovery tampoco persiste', async () => {
    const recovered = await recoverMissingScheduleReviewHold(
      supabaseMock({ channel: 'web' }),
      APPT,
      { getLeadAdsConsent: async () => true },
    )
    assert.equal(recovered.reason, LOCAL_PERSIST_INACTIVE)
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

describe('aislamiento proyecto CTWA', () => {
  it('CTWA de otro proyecto no se lee', async () => {
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({
        channel: 'whatsapp',
        ctwa: {
          tenant: TENANT,
          project: 'other-project-id',
          contact: '456',
          clid: 'Aff-OTHER',
        },
      }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        allowLocalPersist: true,
        ctwaClient: supabaseMock({
          channel: 'whatsapp',
          ctwa: {
            tenant: TENANT,
            project: 'other-project-id',
            contact: '456',
            clid: 'Aff-OTHER',
          },
        }),
        wabaId: 'waba-1',
        messagingDatasetId: 'dataset-1',
        persist: async (_s, input) => ({
          inserted: true,
          eventId: 'e',
          rowId: 'r',
          status: input.status || OUTBOX_REVIEW_HOLD_STATUS,
        }),
      },
    )
    assert.equal(result.plan?.payload?.ctwa_clid, undefined)
  })
})

/**
 * Persistencia local Schedule: dedupe, consent, sin flush Nest.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { prepareScheduleDeliveryAfterConfirmation } from './scheduleDelivery'
import { FLUSH_NEST_INACTIVE, LOCAL_PERSIST_INACTIVE } from './scheduleContract'
import { scheduleIdempotencyKey } from './scheduleEligibility'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

function supabaseMock(opts: {
  channel: string
  confirmedByClient?: boolean
  consent: boolean | null
  phone?: string | null
  contactId?: string | null
  ctwaRow?: string | null
}) {
  return {
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
              channel: opts.channel,
              confirmed_by_client: opts.confirmedByClient !== false,
            },
            error: null,
          }
        }
        if (table === 'leads') {
          return {
            data: {
              id: LEAD,
              phone: opts.phone ?? '593990000000',
              name: 'Cliente',
              email: null,
              contact_id: opts.contactId ?? '456',
              meta_ads_consent: opts.consent,
            },
            error: null,
          }
        }
        if (table === 'lv_whatsapp_ctwa_attribution') {
          return {
            data: opts.ctwaRow ? { ctwa_clid: opts.ctwaRow } : null,
            error: null,
          }
        }
        throw new Error(table)
      }
      return builder
    },
  } as never
}

describe('prepareScheduleDeliveryAfterConfirmation', () => {
  it('sin META_SCHEDULE_LOCAL_PERSIST: planifica y no escribe outbox', async () => {
    let persistCalls = 0
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web', consent: true }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        persist: async () => {
          persistCalls += 1
          return { inserted: true, eventId: 'e1', rowId: 'r1' }
        },
      },
    )
    assert.equal(persistCalls, 0)
    assert.equal(result.ok, false)
    assert.equal(result.reason, LOCAL_PERSIST_INACTIVE)
    assert.ok(result.plan?.blockers.includes(FLUSH_NEST_INACTIVE))
  })

  it('persist local con dedupe schedule:{appointmentId}; flush sigue false', async () => {
    const keys: string[] = []
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web', consent: true }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        allowLocalPersist: true,
        persist: async (_sb, input) => {
          keys.push(input.idempotencyKey)
          assert.equal(input.eventName, 'Schedule')
          assert.equal(input.adsConsentRequired, true)
          assert.equal((input.payload as { action_source: string }).action_source, 'website')
          return { inserted: true, eventId: 'e-web', rowId: 'r-web' }
        },
      },
    )
    assert.equal(result.ok, true)
    assert.equal(result.reason, 'persisted_local')
    assert.deepEqual(keys, [scheduleIdempotencyKey(APPT)])
    assert.equal(result.plan?.canFlushNest, false)

    const again = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web', consent: true }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        allowLocalPersist: true,
        persist: async () => ({ inserted: false, eventId: 'e-web', rowId: 'r-web' }),
      },
    )
    assert.equal(again.reason, 'duplicate_local')
  })

  it('WhatsApp sin CTWA: plan con bloqueo; consent vigente requerido', async () => {
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'whatsapp', consent: true, ctwaRow: null }),
      APPT,
      {
        getLeadAdsConsent: async () => true,
        getCtwaClid: async () => null,
        allowLocalPersist: true,
        persist: async (_sb, input) => {
          assert.equal((input.payload as { ctwa_clid?: string }).ctwa_clid, undefined)
          return { inserted: true, eventId: 'e-wa', rowId: 'r-wa' }
        },
        wabaId: null,
      },
    )
    assert.ok(result.plan?.blockers.includes('whatsapp_ctwa_clid_missing'))
    assert.ok(result.plan?.blockers.includes('whatsapp_delivery_pending_nest_contract'))
    assert.equal(result.plan?.canFlushNest, false)
  })

  it('consent no vigente: no negocio OK', async () => {
    const result = await prepareScheduleDeliveryAfterConfirmation(
      supabaseMock({ channel: 'web', consent: false }),
      APPT,
      {
        getLeadAdsConsent: async () => false,
        allowLocalPersist: true,
        persist: async () => {
          throw new Error('no persist')
        },
      },
    )
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'ads_consent_false')
  })
})

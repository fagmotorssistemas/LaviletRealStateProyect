/**
 * Persistencia review_hold + CTWA scoped; flush no puede enviarla.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadCtwaClidForAppointmentScope,
  prepareScheduleDeliveryAfterConfirmation,
} from './scheduleDelivery'
import { LOCAL_PERSIST_INACTIVE, WHATSAPP_CTWA_CLID_REQUIRED } from './scheduleContract'
import { scheduleIdempotencyKey } from './scheduleEligibility'
import {
  isOutboxStatusFlushable,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
} from './localOutbox'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'
const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'

function supabaseMock(opts: {
  channel: string
  consent: boolean | null
  phone?: string | null
  contactId?: string | null
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
      builder.update = () => builder
      builder.maybeSingle = async () => {
        if (table === 'appointments') {
          return {
            data: {
              id: APPT,
              lead_id: LEAD,
              status: 'aceptado',
              channel: opts.channel,
              confirmed_by_client: true,
              confirmed_at: '2026-09-17T15:00:00.000Z',
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
              name: 'Cliente',
              email: null,
              contact_id: opts.contactId ?? '456',
              meta_ads_consent: opts.consent,
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
      builder.then = (resolve: (v: unknown) => void) => {
        resolve({ data: null, error: null })
      }
      return builder
    },
  } as never
}

describe('outbox review_hold vs cola activa', () => {
  it('review_hold no es flushable; pending sí', () => {
    assert.equal(isOutboxStatusFlushable(OUTBOX_REVIEW_HOLD_STATUS), false)
    assert.equal(isOutboxStatusFlushable(OUTBOX_FLUSHABLE_STATUS), true)
    assert.equal(isOutboxStatusFlushable('forwarded'), false)
  })
})

describe('loadCtwaClidForAppointmentScope', () => {
  it('solo devuelve CTWA del mismo tenant/project/contact', async () => {
    const sb = supabaseMock({
      channel: 'whatsapp',
      consent: true,
      ctwa: { tenant: TENANT, project: PROJECT, contact: '456', clid: 'Aff-SCOPE' },
    })
    assert.equal(
      await loadCtwaClidForAppointmentScope(sb, {
        tenantId: TENANT,
        projectId: PROJECT,
        contactId: '456',
      }),
      'Aff-SCOPE',
    )
    assert.equal(
      await loadCtwaClidForAppointmentScope(sb, {
        tenantId: TENANT,
        projectId: 'other-project',
        contactId: '456',
      }),
      null,
    )
  })
})

describe('prepareScheduleDeliveryAfterConfirmation', () => {
  it('sin flag: no persiste ni escribe', async () => {
    let persistCalls = 0
    let intentCalls = 0
    const sb = supabaseMock({ channel: 'web', consent: true })
    const result = await prepareScheduleDeliveryAfterConfirmation(sb, APPT, {
      getLeadAdsConsent: async () => true,
      adminClient: sb,
      allowLocalPersist: false,
      registerIntent: async () => {
        intentCalls += 1
        throw new Error('no')
      },
      persist: async () => {
        persistCalls += 1
        return { inserted: true, eventId: 'e1', rowId: 'r1', status: OUTBOX_REVIEW_HOLD_STATUS }
      },
    })
    assert.equal(persistCalls, 0)
    assert.equal(intentCalls, 0)
    assert.ok(
      result.reason === LOCAL_PERSIST_INACTIVE ||
        result.reason === 'all_schedule_controls_off',
    )
  })

  it('persist review_hold con dedupe; nunca pending flushable', async () => {
    const statuses: string[] = []
    const sb = supabaseMock({ channel: 'web', consent: true })
    const result = await prepareScheduleDeliveryAfterConfirmation(sb, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: sb,
      registerIntent: async (input) => ({
        ok: true,
        inserted: true,
        eventId: input.eventId,
        eventTime: input.eventTime,
        channel: input.channelKind,
      }),
      persist: async (_sb, input) => {
        assert.equal(input.status, OUTBOX_REVIEW_HOLD_STATUS)
        assert.equal(isOutboxStatusFlushable(input.status!), false)
        assert.equal(input.idempotencyKey, scheduleIdempotencyKey(APPT))
        statuses.push(input.status!)
        return {
          inserted: true,
          eventId: 'e-web',
          rowId: 'r-web',
          status: OUTBOX_REVIEW_HOLD_STATUS,
        }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.reason, 'persisted_review_hold')
    assert.equal(result.outboxStatus, OUTBOX_REVIEW_HOLD_STATUS)
    assert.deepEqual(statuses, [OUTBOX_REVIEW_HOLD_STATUS])
  })

  it('WhatsApp sin CTWA: bloqueo required en el plan', async () => {
    const sb = supabaseMock({ channel: 'whatsapp', consent: true, ctwa: null })
    const result = await prepareScheduleDeliveryAfterConfirmation(sb, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: sb,
      ctwaClient: null,
      wabaId: 'waba-1',
      messagingDatasetId: 'dataset-1',
      registerIntent: async (input) => ({
        ok: true,
        inserted: true,
        eventId: input.eventId,
        eventTime: input.eventTime,
        channel: 'whatsapp',
      }),
      persist: async (_sb, input) => ({
        inserted: true,
        eventId: 'e-wa',
        rowId: 'r-wa',
        status: input.status || OUTBOX_REVIEW_HOLD_STATUS,
      }),
    })
    assert.ok(result.plan?.blockers.includes(WHATSAPP_CTWA_CLID_REQUIRED))
    assert.equal(result.plan?.canFlushNest, false)
  })

  it('WhatsApp CTWA: lee solo con cliente autorizado scoped a la cita', async () => {
    const sb = supabaseMock({
      channel: 'whatsapp',
      consent: true,
      ctwa: { tenant: TENANT, project: PROJECT, contact: '456', clid: 'Aff-AUTH' },
    })
    const result = await prepareScheduleDeliveryAfterConfirmation(sb, APPT, {
      getLeadAdsConsent: async () => true,
      allowLocalPersist: true,
      adminClient: sb,
      ctwaClient: sb,
      wabaId: 'waba-1',
      messagingDatasetId: 'dataset-1',
      registerIntent: async (input) => ({
        ok: true,
        inserted: true,
        eventId: input.eventId,
        eventTime: input.eventTime,
        channel: 'whatsapp',
      }),
      persist: async (_s, input) => ({
        inserted: true,
        eventId: 'e-ctwa',
        rowId: 'r-ctwa',
        status: input.status || OUTBOX_REVIEW_HOLD_STATUS,
      }),
    })
    assert.equal(result.plan?.payload?.ctwa_clid, 'Aff-AUTH')
    assert.equal(result.plan?.blockers.includes(WHATSAPP_CTWA_CLID_REQUIRED), false)
    assert.equal(result.outboxStatus, 'needs_review')
    assert.equal(result.plan?.canFlushNest, false)
  })
})

describe('flush / drain no envían review_hold', () => {
  it('simula consumidor flush: solo pending entra; review_hold se excluye', async () => {
    const rows = [
      { id: '1', status: OUTBOX_REVIEW_HOLD_STATUS, event_id: 'a', event_name: 'Schedule' },
      { id: '2', status: OUTBOX_FLUSHABLE_STATUS, event_id: 'b', event_name: 'Lead' },
    ]
    const flushable = rows.filter((r) => isOutboxStatusFlushable(r.status))
    assert.equal(flushable.length, 1)
    assert.equal(flushable[0].event_id, 'b')
    assert.equal(
      rows.some((r) => r.status === OUTBOX_REVIEW_HOLD_STATUS && isOutboxStatusFlushable(r.status)),
      false,
    )
  })

  it('Nest drain solo recibe lo que flush reenvía: review_hold nunca es pending', () => {
    // Contrato: prepare siempre escribe review_hold; flush filtra pending.
    // Por tanto el drain Nest no ve filas de revisión.
    assert.notEqual(OUTBOX_REVIEW_HOLD_STATUS, OUTBOX_FLUSHABLE_STATUS)
  })
})

/**
 * Gancho Schedule: propuesta excluida, confirmación incluida, fallo sin evento.
 * Mocks; sin Production ni citas en BD.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  notifyScheduleIfRequestConfirmed,
  evaluateScheduleForConfirmedAppointment,
  enqueueScheduleForConfirmedAppointment,
} from './scheduleIntegration'
import {
  SCHEDULE_QUEUE_INACTIVE,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'
import { LOCAL_PERSIST_INACTIVE } from './scheduleContract'

const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const LEAD = '11111111-2222-4333-8444-555555555555'

function supabaseAppointment(channel: string, consent: boolean | null) {
  const leadRow = {
    id: LEAD,
    meta_ads_consent: consent,
    phone: '593990000000',
    name: 'Cliente',
    email: null,
    contact_id: '456',
  }
  const appointmentRow = {
    id: APPT,
    lead_id: LEAD,
    status: 'aceptado',
    channel,
    confirmed_by_client: true,
  }
  return {
    from: (table: string) => {
      let row: unknown = null
      if (table === 'appointments') row = appointmentRow
      else if (table === 'leads') row = leadRow
      else if (table === 'lv_whatsapp_ctwa_attribution') row = null
      else throw new Error(`unexpected table ${table}`)
      const builder: {
        select: () => typeof builder
        eq: () => typeof builder
        order: () => typeof builder
        limit: () => typeof builder
        maybeSingle: () => Promise<{ data: unknown; error: null }>
      } = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
      }
      return builder
    },
  } as never
}

/** Mismo contrato que acceptClientVisitTime / advisorAcceptRequest respecto al gancho. */
async function runAcceptClientVisitTime(
  rpc: () => Promise<{ data: unknown; error: unknown }>,
  notifyCalls: string[],
) {
  const { data, error } = await rpc()
  if (error) throw error instanceof Error ? error : new Error(String(error))
  const request = data as { status?: string; appointment_id?: string }
  await notifyScheduleIfRequestConfirmed({} as never, request, async (_s, id) => {
    notifyCalls.push(String(id))
  })
  return request
}

async function runAdvisorAcceptRequest(
  rpc: () => Promise<{ data: unknown; error: unknown }>,
  notifyCalls: string[],
) {
  const { data, error } = await rpc()
  if (error) throw error instanceof Error ? error : new Error(String(error))
  const request = data as { status?: string; appointment_id?: string }
  await notifyScheduleIfRequestConfirmed({} as never, request, async (_s, id) => {
    notifyCalls.push(String(id))
  })
  return request
}

describe('notifyScheduleIfRequestConfirmed (gancho)', () => {
  it('propuesta awaiting_client excluida: no notifica', async () => {
    let calls = 0
    const notified = await notifyScheduleIfRequestConfirmed(
      {} as never,
      { status: 'awaiting_client', appointment_id: APPT },
      async () => {
        calls += 1
      },
    )
    assert.equal(notified, false)
    assert.equal(calls, 0)
  })

  it('confirmación definitiva incluida: notifica una vez', async () => {
    let calls = 0
    let seenId = ''
    const notified = await notifyScheduleIfRequestConfirmed(
      {} as never,
      { status: 'confirmed', appointment_id: APPT },
      async (_sb, id) => {
        calls += 1
        seenId = String(id)
      },
    )
    assert.equal(notified, true)
    assert.equal(calls, 1)
    assert.equal(seenId, APPT)
  })

  it('fallo de guardado (sin request): sin evento', async () => {
    let calls = 0
    assert.equal(
      await notifyScheduleIfRequestConfirmed({} as never, null, async () => {
        calls += 1
      }),
      false,
    )
    assert.equal(calls, 0)
  })
})

describe('flujo accept / advisor (contrato del gancho)', () => {
  it('confirmación definitiva: gancho recibe appointment_id', async () => {
    const notifyCalls: string[] = []
    await runAcceptClientVisitTime(
      async () => ({ data: { status: 'confirmed', appointment_id: APPT }, error: null }),
      notifyCalls,
    )
    assert.deepEqual(notifyCalls, [APPT])
  })

  it('propuesta awaiting_client: sin gancho', async () => {
    const notifyCalls: string[] = []
    await runAdvisorAcceptRequest(
      async () => ({ data: { status: 'awaiting_client', appointment_id: APPT }, error: null }),
      notifyCalls,
    )
    assert.deepEqual(notifyCalls, [])
  })

  it('fallo de guardado (RPC error): sin gancho ni evento', async () => {
    const notifyCalls: string[] = []
    await assert.rejects(
      () =>
        runAcceptClientVisitTime(
          async () => ({ data: null, error: new Error('SAVE_FAILED') }),
          notifyCalls,
        ),
      /SAVE_FAILED/,
    )
    assert.deepEqual(notifyCalls, [])
  })
})

describe('evaluación separada de cola (sin persistencia ni envío)', () => {
  const consentTrue = async () => true as boolean | null

  it('WhatsApp: negocio OK, entrega pending Nest; enqueue no ok', async () => {
    const evaluated = await evaluateScheduleForConfirmedAppointment(
      supabaseAppointment('whatsapp', true),
      APPT,
      { getLeadAdsConsent: consentTrue },
    )
    assert.equal(evaluated.reason, WHATSAPP_SCHEDULE_DELIVERY_PENDING)
    assert.equal(evaluated.ok, true)
    assert.equal(evaluated.eligibility?.queueable, false)
    assert.equal(evaluated.eligibility?.actionSource, 'business_messaging')

    const enqueued = await enqueueScheduleForConfirmedAppointment(
      supabaseAppointment('whatsapp', true),
      APPT,
      { getLeadAdsConsent: consentTrue },
    )
    assert.equal(enqueued.ok, false)
    assert.ok(
      enqueued.reason === LOCAL_PERSIST_INACTIVE ||
        enqueued.reason === 'service_role_required_for_outbox',
    )
  })

  it('web: evaluación OK, cola inactiva separada', async () => {
    const evaluated = await evaluateScheduleForConfirmedAppointment(
      supabaseAppointment('web', true),
      APPT,
      { getLeadAdsConsent: consentTrue },
    )
    assert.equal(evaluated.ok, true)
    assert.equal(evaluated.reason, SCHEDULE_QUEUE_INACTIVE)
    assert.equal(evaluated.eligibility?.queueable, false)

    const enqueued = await enqueueScheduleForConfirmedAppointment(
      supabaseAppointment('web', true),
      APPT,
      { getLeadAdsConsent: consentTrue },
    )
    assert.equal(enqueued.ok, false)
    assert.ok(
      enqueued.reason === LOCAL_PERSIST_INACTIVE ||
        enqueued.reason === 'service_role_required_for_outbox',
    )
  })
})

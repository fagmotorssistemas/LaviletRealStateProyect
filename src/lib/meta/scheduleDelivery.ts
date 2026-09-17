/**
 * Preparación + recuperación durable + pipeline web gated de Schedule.
 * Persistencia outbox solo vía service_role (no sesión asesor).
 * review_hold históricos nunca se promueven en lote.
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  flushLocalMetaOutbox,
  getLeadAdsConsent,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
  persistMetaConversion,
} from './localOutbox'
import { evaluateScheduleEligibility, type ScheduleEligibility } from './scheduleEligibility'
import {
  DELIVERY_PIPELINE_INACTIVE,
  FLUSH_NEST_INACTIVE,
  HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED,
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
  isScheduleLocalPersistEnabled,
  isScheduleRecoverEnabled,
  LOCAL_PERSIST_INACTIVE,
  planScheduleDelivery,
  type ScheduleDeliveryPlan,
} from './scheduleContract'

export type SchedulePrepareResult = {
  ok: boolean
  reason: string
  eligibility?: ScheduleEligibility
  plan?: ScheduleDeliveryPlan
  persisted?: boolean
  eventId?: string
  outboxStatus?: string
  persistAttempts?: number
  intentSaved?: boolean
  promoted?: boolean
  flushed?: boolean
}

const PERSIST_MAX_ATTEMPTS = 3

function logSafe(code: string, reason: string) {
  console.info(
    JSON.stringify({
      scope: 'meta_schedule_delivery',
      code,
      reason: String(reason).slice(0, 100),
    }),
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function confirmationUnixSeconds(confirmedAt: string | null | undefined): number {
  if (confirmedAt) {
    const ms = Date.parse(confirmedAt)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000)
  }
  return Math.floor(Date.now() / 1000)
}

/** Cliente service_role para outbox/intent. La sesión CRM no tiene GRANT. */
export function resolveScheduleAdminClient(
  deps?: { adminClient?: SupabaseClient | null },
): SupabaseClient | null {
  if (deps && 'adminClient' in deps) return deps.adminClient ?? null
  return tryCreateAdminClient()
}

export async function loadCtwaClidForAppointmentScope(
  supabase: SupabaseClient,
  scope: { tenantId: string; projectId: string; contactId: string },
): Promise<string | null> {
  const tenantId = String(scope.tenantId || '').trim()
  const projectId = String(scope.projectId || '').trim()
  const contactId = String(scope.contactId || '').trim()
  if (!tenantId || !projectId || !contactId) return null

  const { data, error } = await supabase
    .from('lv_whatsapp_ctwa_attribution')
    .select('ctwa_clid')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('contact_id', contactId)
    .order('captured_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data?.ctwa_clid) return null
  return String(data.ctwa_clid)
}

export type ScheduleDeliveryDeps = {
  getLeadAdsConsent?: typeof getLeadAdsConsent
  loadCtwa?: typeof loadCtwaClidForAppointmentScope
  ctwaClient?: SupabaseClient | null
  /** service_role para outbox + intent. Null = no persistir. */
  adminClient?: SupabaseClient | null
  persist?: typeof persistMetaConversion
  flush?: typeof flushLocalMetaOutbox
  wabaId?: string | null
  messagingDatasetId?: string | null
  allowLocalPersist?: boolean
  allowDelivery?: boolean
  allowFlush?: boolean
  persistAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

async function persistReviewHoldWithRetry(
  admin: SupabaseClient,
  input: Parameters<typeof persistMetaConversion>[1],
  deps: ScheduleDeliveryDeps,
) {
  const persist = deps.persist || persistMetaConversion
  const max = Math.max(1, deps.persistAttempts ?? PERSIST_MAX_ATTEMPTS)
  const wait = deps.sleep || sleep
  let lastError: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const result = await persist(admin, input)
      return { ...result, attempts: attempt }
    } catch (error) {
      lastError = error
      logSafe('persist_retry', `attempt_${attempt}`)
      if (attempt < max) await wait(40 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('persist_failed')
}

async function saveScheduleIntent(
  admin: SupabaseClient,
  appointment: {
    id: string
    meta_schedule_event_id?: string | null
    confirmed_at?: string | null
  },
  payload: Record<string, unknown>,
  lane: 'test' | 'live',
): Promise<{ eventId: string; eventTime: number; saved: boolean }> {
  const eventId =
    (appointment.meta_schedule_event_id &&
    /^[0-9a-f-]{36}$/i.test(appointment.meta_schedule_event_id)
      ? appointment.meta_schedule_event_id
      : null) || randomUUID()
  const eventTime = confirmationUnixSeconds(appointment.confirmed_at)

  const { error } = await admin
    .from('appointments')
    .update({
      meta_schedule_event_id: eventId,
      meta_schedule_event_time: eventTime,
      meta_schedule_delivery_lane: lane,
      meta_schedule_payload: payload,
      meta_schedule_intent_at: new Date().toISOString(),
    })
    .eq('id', appointment.id)

  if (error) {
    logSafe('intent_save_failed', error.message.slice(0, 80))
    return { eventId, eventTime, saved: false }
  }
  return { eventId, eventTime, saved: true }
}

/**
 * Promueve SOLO la fila review_hold de esta cita a pending tras revalidar.
 * No escanea ni promueve review_hold históricos.
 */
export async function promoteScheduleReviewHoldForAppointment(
  admin: SupabaseClient,
  appointmentId: string,
  deps: ScheduleDeliveryDeps = {},
): Promise<{ ok: boolean; reason: string; promoted: boolean }> {
  const id = String(appointmentId || '').trim()
  if (!id) return { ok: false, reason: 'missing_appointment', promoted: false }

  if (!(deps.allowDelivery === true || isScheduleDeliveryEnabled())) {
    return {
      ok: false,
      reason: DELIVERY_PIPELINE_INACTIVE,
      promoted: false,
    }
  }

  const { data: appointment, error } = await admin
    .from('appointments')
    .select('id, lead_id, status, channel, confirmed_by_client')
    .eq('id', id)
    .maybeSingle()

  if (error || !appointment?.lead_id) {
    return { ok: false, reason: 'appointment_query_error', promoted: false }
  }

  const readConsent = deps.getLeadAdsConsent || getLeadAdsConsent
  const adsConsent = await readConsent(admin, appointment.lead_id)
  const eligibility = evaluateScheduleEligibility({
    appointmentId: appointment.id,
    status: appointment.status,
    channel: appointment.channel,
    confirmedByClient: appointment.confirmed_by_client,
    leadId: appointment.lead_id,
    adsConsent,
  })

  if (!eligibility.businessOk || eligibility.channelKind !== 'web') {
    return {
      ok: false,
      reason: eligibility.reason || 'not_web_eligible',
      promoted: false,
    }
  }

  const key = eligibility.idempotencyKey
  const { data: row } = await admin
    .from('meta_capi_outbox')
    .select('id, status, event_id')
    .eq('idempotency_key', key)
    .maybeSingle()

  if (!row) return { ok: false, reason: 'outbox_row_missing', promoted: false }
  if (row.status === OUTBOX_FLUSHABLE_STATUS) {
    return { ok: true, reason: 'already_pending', promoted: false }
  }
  if (row.status !== OUTBOX_REVIEW_HOLD_STATUS) {
    return { ok: false, reason: `status_${row.status}`, promoted: false }
  }

  const { error: updErr } = await admin
    .from('meta_capi_outbox')
    .update({
      status: OUTBOX_FLUSHABLE_STATUS,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', row.id)
    .eq('status', OUTBOX_REVIEW_HOLD_STATUS)

  if (updErr) {
    return { ok: false, reason: 'promote_failed', promoted: false }
  }

  logSafe('promoted_current_only', HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED)
  return { ok: true, reason: 'promoted_to_pending', promoted: true }
}

export async function prepareScheduleDeliveryAfterConfirmation(
  supabase: SupabaseClient,
  appointmentId: string,
  deps: ScheduleDeliveryDeps = {},
): Promise<SchedulePrepareResult> {
  const id = String(appointmentId || '').trim()
  if (!id) return { ok: false, reason: 'missing_appointment' }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(
      'id, lead_id, status, channel, confirmed_by_client, confirmed_at, tenant_id, project_id, meta_schedule_event_id',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    logSafe('load_failed', 'appointment_query_error')
    return { ok: false, reason: 'appointment_query_error' }
  }
  if (!appointment?.lead_id) {
    return { ok: false, reason: 'appointment_without_lead' }
  }

  const readConsent = deps.getLeadAdsConsent || getLeadAdsConsent
  const adsConsent = await readConsent(supabase, appointment.lead_id)

  const eligibility = evaluateScheduleEligibility({
    appointmentId: appointment.id,
    status: appointment.status,
    channel: appointment.channel,
    confirmedByClient: appointment.confirmed_by_client,
    leadId: appointment.lead_id,
    adsConsent,
  })

  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone, name, email, contact_id')
    .eq('id', appointment.lead_id)
    .maybeSingle()

  let ctwaClid: string | null = null
  if (eligibility.channelKind === 'whatsapp') {
    const loadCtwa = deps.loadCtwa || loadCtwaClidForAppointmentScope
    const ctwaClient =
      deps.ctwaClient === null
        ? null
        : deps.ctwaClient || tryCreateAdminClient() || null
    if (ctwaClient) {
      ctwaClid = await loadCtwa(ctwaClient, {
        tenantId: String(appointment.tenant_id || ''),
        projectId: String(appointment.project_id || ''),
        contactId: String(lead?.contact_id || ''),
      })
    }
  }

  const plan = planScheduleDelivery({
    eligibility,
    leadId: appointment.lead_id,
    phone: lead?.phone,
    email: lead?.email,
    fullName: lead?.name,
    ctwaClid,
    wabaId: deps.wabaId ?? process.env.META_WABA_ID ?? null,
    messagingDatasetId:
      deps.messagingDatasetId ?? process.env.META_MESSAGING_DATASET_ID ?? null,
  })

  if (!eligibility.businessOk) {
    logSafe('skipped', eligibility.reason)
    return { ok: false, reason: eligibility.reason, eligibility, plan }
  }

  const admin = resolveScheduleAdminClient(deps)
  if (!admin) {
    logSafe('admin_required', 'service_role_unavailable')
    return {
      ok: false,
      reason: 'service_role_required_for_outbox',
      eligibility,
      plan,
    }
  }

  const lane =
    String(process.env.META_CAPI_DELIVERY_LANE || '').toLowerCase() === 'test'
      ? 'test'
      : 'live'

  const basePayload = {
    ...(plan.payload || {}),
    tenant_id: appointment.tenant_id || undefined,
    project_id: appointment.project_id || undefined,
    appointment_id: appointment.id,
  }

  // Intent durable siempre (aunque persist esté off / falle): conserva fecha real.
  const intent = await saveScheduleIntent(admin, appointment, basePayload, lane)

  const persistAllowed =
    (deps.allowLocalPersist === true || isScheduleLocalPersistEnabled()) &&
    plan.canPersistReviewHold &&
    plan.payload

  if (!persistAllowed) {
    const reason = plan.canPersistReviewHold
      ? LOCAL_PERSIST_INACTIVE
      : plan.blockers[0] || 'not_persistable'
    logSafe('plan_only', reason)
    return {
      ok: false,
      reason,
      eligibility,
      plan: {
        ...plan,
        blockers: plan.blockers.includes(LOCAL_PERSIST_INACTIVE)
          ? plan.blockers
          : [...plan.blockers, LOCAL_PERSIST_INACTIVE],
      },
      eventId: intent.eventId,
      intentSaved: intent.saved,
    }
  }

  let persistedRow: {
    inserted: boolean
    eventId: string
    status: string
    attempts: number
  } | null = null

  try {
    persistedRow = await persistReviewHoldWithRetry(
      admin,
      {
        eventName: 'Schedule',
        idempotencyKey: plan.idempotencyKey,
        eventId: intent.eventId,
        eventTime: intent.eventTime,
        leadId: appointment.lead_id,
        adsConsentRequired: true,
        payload: basePayload,
        status: OUTBOX_REVIEW_HOLD_STATUS,
      },
      deps,
    )
    logSafe(
      persistedRow.inserted ? 'persisted_review_hold' : 'duplicate_review_hold',
      plan.channelKind,
    )
  } catch {
    logSafe('persist_failed', 'outbox_error_after_retries')
    return {
      ok: false,
      reason: 'persist_failed',
      eligibility,
      plan,
      eventId: intent.eventId,
      intentSaved: intent.saved,
      persistAttempts: deps.persistAttempts ?? PERSIST_MAX_ATTEMPTS,
    }
  }

  let promoted = false
  let flushed = false
  const deliveryOn = deps.allowDelivery === true || isScheduleDeliveryEnabled()
  const flushOn = deps.allowFlush === true || isScheduleFlushEnabled()

  // Solo web + delivery on: promover ESTA cita (no históricos).
  if (deliveryOn && plan.channelKind === 'web') {
    const promo = await promoteScheduleReviewHoldForAppointment(admin, id, {
      ...deps,
      allowDelivery: true,
      getLeadAdsConsent: readConsent,
    })
    promoted = promo.promoted
    if (!promo.ok && promo.reason !== 'already_pending') {
      logSafe('promote_skipped', promo.reason)
    }
  } else if (!deliveryOn) {
    logSafe('delivery_gated', DELIVERY_PIPELINE_INACTIVE)
  }

  if (flushOn && plan.channelKind === 'web' && persistedRow.eventId) {
    const flush = deps.flush || flushLocalMetaOutbox
    await flush(admin, { limit: 5, eventIds: [persistedRow.eventId] })
    flushed = true
  } else if (!flushOn) {
    logSafe('flush_gated', FLUSH_NEST_INACTIVE)
  }

  return {
    ok: true,
    reason: persistedRow.inserted ? 'persisted_review_hold' : 'duplicate_review_hold',
    eligibility,
    plan: {
      ...plan,
      canFlushNest: false,
      blockers: [
        ...plan.blockers.filter((b) => b !== FLUSH_NEST_INACTIVE),
        ...(flushOn ? [] : [FLUSH_NEST_INACTIVE]),
        ...(deliveryOn ? [] : [DELIVERY_PIPELINE_INACTIVE]),
        HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED,
      ],
    },
    persisted: persistedRow.inserted,
    eventId: persistedRow.eventId,
    outboxStatus: promoted ? OUTBOX_FLUSHABLE_STATUS : OUTBOX_REVIEW_HOLD_STATUS,
    persistAttempts: persistedRow.attempts,
    intentSaved: intent.saved,
    promoted,
    flushed,
  }
}

/** Recover vía RPC service_role (inserta review_hold; nunca pending). */
export async function recoverMissingScheduleOutboxViaRpc(
  admin: SupabaseClient,
  limit = 50,
): Promise<{ ok: boolean; recovered: number; reason: string }> {
  if (!isScheduleRecoverEnabled()) {
    return { ok: false, recovered: 0, reason: 'recover_inactive' }
  }
  const { data, error } = await admin.rpc('lv_recover_missing_meta_schedule_outbox', {
    p_limit: limit,
  })
  if (error) {
    logSafe('recover_rpc_failed', error.message.slice(0, 80))
    return { ok: false, recovered: 0, reason: 'recover_rpc_failed' }
  }
  const recovered = typeof data === 'number' ? data : Number(data) || 0
  return { ok: true, recovered, reason: 'recovered' }
}

export async function recoverMissingScheduleReviewHold(
  supabase: SupabaseClient,
  appointmentId: string,
  deps: ScheduleDeliveryDeps = {},
): Promise<SchedulePrepareResult> {
  return prepareScheduleDeliveryAfterConfirmation(supabase, appointmentId, {
    ...deps,
    allowLocalPersist: deps.allowLocalPersist ?? isScheduleLocalPersistEnabled(),
  })
}

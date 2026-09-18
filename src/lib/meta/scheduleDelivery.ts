/**
 * Preparación Schedule: escrituras solo con controles ON.
 * Intent atómico inmutable vía RPC; fallo Meta no afecta la cita.
 * Promote/flush solo con delivery on; nunca pending si delivery off.
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  flushLocalMetaOutbox,
  getLeadAdsConsent,
  OUTBOX_FLUSHABLE_STATUS,
  OUTBOX_NEEDS_REVIEW_STATUS,
  OUTBOX_REVIEW_HOLD_STATUS,
  persistMetaConversion,
} from './localOutbox'
import { evaluateScheduleEligibility, type ScheduleEligibility } from './scheduleEligibility'
import {
  ALL_SCHEDULE_CONTROLS_OFF,
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
import { isScheduleWritePathEnabled } from './scheduleFlags'
import { resolveDeliveryLane } from './deliveryLane'

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
  intentImmutable?: boolean
  promoted?: boolean
  flushed?: boolean
  wroteSchedule?: boolean
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
  adminClient?: SupabaseClient | null
  persist?: typeof persistMetaConversion
  flush?: typeof flushLocalMetaOutbox
  registerIntent?: typeof registerMetaScheduleIntent
  wabaId?: string | null
  messagingDatasetId?: string | null
  allowLocalPersist?: boolean
  allowDelivery?: boolean
  allowFlush?: boolean
  persistAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

export type IntentRegisterResult = {
  ok: boolean
  inserted: boolean
  eventId: string
  eventTime: number
  channel: string
  reason?: string
}

/**
 * Registra intent una sola vez (RPC). Inmutable ante concurrencia.
 * Fallo → no lanza a la cita; el caller decide.
 */
export async function registerMetaScheduleIntent(
  admin: SupabaseClient,
  input: {
    appointmentId: string
    eventId: string
    eventTime: number
    lane: 'test' | 'live'
    channelKind: string
    payload: Record<string, unknown>
  },
): Promise<IntentRegisterResult> {
  const { data, error } = await admin.rpc('lv_register_meta_schedule_intent', {
    p_appointment_id: input.appointmentId,
    p_event_id: input.eventId,
    p_event_time: input.eventTime,
    p_lane: input.lane,
    p_channel: input.channelKind,
    p_payload: input.payload,
  })

  if (error) {
    logSafe('intent_rpc_failed', error.message.slice(0, 80))
    return {
      ok: false,
      inserted: false,
      eventId: input.eventId,
      eventTime: input.eventTime,
      channel: input.channelKind,
      reason: 'intent_rpc_failed',
    }
  }

  const row = (data || {}) as Record<string, unknown>
  if (row.ok === false) {
    return {
      ok: false,
      inserted: false,
      eventId: input.eventId,
      eventTime: input.eventTime,
      channel: input.channelKind,
      reason: String(row.reason || 'intent_rejected'),
    }
  }

  return {
    ok: true,
    inserted: Boolean(row.inserted),
    eventId: String(row.event_id || input.eventId),
    eventTime: Number(row.event_time || input.eventTime),
    channel: String(row.channel || input.channelKind),
  }
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

/** Promote solo con delivery on + revalidación. Nunca si delivery off. */
export async function promoteScheduleReviewHoldForAppointment(
  admin: SupabaseClient,
  appointmentId: string,
  deps: ScheduleDeliveryDeps = {},
): Promise<{ ok: boolean; reason: string; promoted: boolean }> {
  const id = String(appointmentId || '').trim()
  if (!id) return { ok: false, reason: 'missing_appointment', promoted: false }

  if (!(deps.allowDelivery === true || isScheduleDeliveryEnabled())) {
    return { ok: false, reason: DELIVERY_PIPELINE_INACTIVE, promoted: false }
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

  const { data: row } = await admin
    .from('meta_capi_outbox')
    .select('id, status, event_id')
    .eq('idempotency_key', eligibility.idempotencyKey)
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

  if (updErr) return { ok: false, reason: 'promote_failed', promoted: false }

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

  const persistOn = deps.allowLocalPersist === true || isScheduleLocalPersistEnabled()
  const deliveryOn = deps.allowDelivery === true || isScheduleDeliveryEnabled()
  const anyWrite = persistOn || deliveryOn || isScheduleWritePathEnabled()

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(
      'id, lead_id, status, channel, confirmed_by_client, confirmed_at, tenant_id, project_id, meta_schedule_event_id, meta_schedule_event_time',
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
    return { ok: false, reason: eligibility.reason, eligibility, plan, wroteSchedule: false }
  }

  const admin = resolveScheduleAdminClient(deps)
  if (!admin && (persistOn || deliveryOn)) {
    logSafe('admin_required', 'service_role_unavailable')
    return {
      ok: false,
      reason: 'service_role_required_for_outbox',
      eligibility,
      plan,
      wroteSchedule: false,
    }
  }

  // Delivery sin persist: promove review_hold web ya existente (p. ej. tras recover).
  if (!persistOn && deliveryOn && plan.channelKind === 'web' && admin) {
    const promo = await promoteScheduleReviewHoldForAppointment(admin, id, {
      ...deps,
      allowDelivery: true,
      getLeadAdsConsent: readConsent,
    })
    let flushed = false
    const flushOn = deps.allowFlush === true || isScheduleFlushEnabled()
    if (flushOn && promo.ok && (promo.promoted || promo.reason === 'already_pending')) {
      const { data: row } = await admin
        .from('meta_capi_outbox')
        .select('event_id')
        .eq('idempotency_key', plan.idempotencyKey)
        .maybeSingle()
      if (row?.event_id) {
        const flush = deps.flush || flushLocalMetaOutbox
        await flush(admin, { limit: 5, eventIds: [row.event_id] })
        flushed = true
      }
    }
    return {
      ok: promo.ok,
      reason: promo.reason,
      eligibility,
      plan,
      promoted: promo.promoted,
      flushed,
      wroteSchedule: false,
      outboxStatus: promo.promoted || promo.reason === 'already_pending'
        ? OUTBOX_FLUSHABLE_STATUS
        : undefined,
    }
  }

  // Controles todos off → cero escrituras Schedule.
  if (!persistOn && !anyWrite) {
    logSafe('no_writes', ALL_SCHEDULE_CONTROLS_OFF)
    return {
      ok: false,
      reason: ALL_SCHEDULE_CONTROLS_OFF,
      eligibility,
      plan: {
        ...plan,
        blockers: [...plan.blockers, ALL_SCHEDULE_CONTROLS_OFF, LOCAL_PERSIST_INACTIVE],
      },
      wroteSchedule: false,
    }
  }

  if (!persistOn) {
    logSafe('plan_only', LOCAL_PERSIST_INACTIVE)
    return {
      ok: false,
      reason: LOCAL_PERSIST_INACTIVE,
      eligibility,
      plan: {
        ...plan,
        blockers: plan.blockers.includes(LOCAL_PERSIST_INACTIVE)
          ? plan.blockers
          : [...plan.blockers, LOCAL_PERSIST_INACTIVE],
      },
      wroteSchedule: false,
    }
  }

  if (!plan.canPersistReviewHold || !plan.payload) {
    return {
      ok: false,
      reason: plan.blockers[0] || 'not_persistable',
      eligibility,
      plan,
      wroteSchedule: false,
    }
  }

  if (!admin) {
    logSafe('admin_required', 'service_role_unavailable')
    return {
      ok: false,
      reason: 'service_role_required_for_outbox',
      eligibility,
      plan,
      wroteSchedule: false,
    }
  }

  const lane =
    String(process.env.META_CAPI_DELIVERY_LANE || '').toLowerCase() === 'test'
      ? 'test'
      : resolveDeliveryLane()

  const basePayload = {
    ...plan.payload,
    tenant_id: appointment.tenant_id || undefined,
    project_id: appointment.project_id || undefined,
    appointment_id: appointment.id,
    channel_kind: plan.channelKind,
  }

  // event_id/time: reutilizar inmutables si ya existen; si no, proponer (RPC decide).
  const proposedEventId =
    (appointment.meta_schedule_event_id &&
    /^[0-9a-f-]{36}$/i.test(appointment.meta_schedule_event_id)
      ? appointment.meta_schedule_event_id
      : null) || randomUUID()
  const proposedEventTime =
    typeof appointment.meta_schedule_event_time === 'number' &&
    appointment.meta_schedule_event_time > 0
      ? appointment.meta_schedule_event_time
      : confirmationUnixSeconds(appointment.confirmed_at)

  const register = deps.registerIntent || registerMetaScheduleIntent
  const intent = await register(admin, {
    appointmentId: appointment.id,
    eventId: proposedEventId,
    eventTime: proposedEventTime,
    lane,
    channelKind: plan.channelKind,
    payload: basePayload,
  })

  // Fallo de intent no revierte la cita (ya confirmada).
  if (!intent.ok) {
    logSafe('intent_failed_cita_ok', intent.reason || 'intent_failed')
  }

  const holdStatus =
    plan.channelKind === 'whatsapp'
      ? OUTBOX_NEEDS_REVIEW_STATUS
      : OUTBOX_REVIEW_HOLD_STATUS
  const holdError =
    plan.channelKind === 'whatsapp'
      ? 'whatsapp_schedule_delivery_blocked'
      : null

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
        status: holdStatus,
        lastError: holdError,
      },
      deps,
    )
    logSafe(
      persistedRow.inserted ? 'persisted_hold' : 'duplicate_hold',
      `${plan.channelKind}:${holdStatus}`,
    )
  } catch {
    // Persist falló tras confirmación: intent puede existir para recover.
    logSafe('persist_failed_after_confirm', 'outbox_error_cita_ok')
    return {
      ok: false,
      reason: 'persist_failed',
      eligibility,
      plan,
      eventId: intent.eventId,
      intentSaved: intent.ok,
      intentImmutable: intent.ok && !intent.inserted,
      persistAttempts: deps.persistAttempts ?? PERSIST_MAX_ATTEMPTS,
      wroteSchedule: intent.ok,
    }
  }

  let promoted = false
  let flushed = false

  // Solo promote/flush web con delivery on (nunca pending si delivery off).
  if (deliveryOn && plan.channelKind === 'web') {
    const promo = await promoteScheduleReviewHoldForAppointment(admin, id, {
      ...deps,
      allowDelivery: true,
      getLeadAdsConsent: readConsent,
    })
    promoted = promo.promoted
  } else {
    logSafe('delivery_gated', DELIVERY_PIPELINE_INACTIVE)
  }

  const flushOn = deps.allowFlush === true || isScheduleFlushEnabled()
  if (flushOn && deliveryOn && plan.channelKind === 'web' && persistedRow.eventId) {
    const flush = deps.flush || flushLocalMetaOutbox
    await flush(admin, { limit: 5, eventIds: [persistedRow.eventId] })
    flushed = true
  } else {
    logSafe('flush_gated', FLUSH_NEST_INACTIVE)
  }

  return {
    ok: true,
    reason: persistedRow.inserted
      ? plan.channelKind === 'whatsapp'
        ? 'persisted_needs_review'
        : 'persisted_review_hold'
      : 'duplicate_hold',
    eligibility,
    plan: {
      ...plan,
      canFlushNest: false,
      blockers: [
        ...plan.blockers.filter((b) => b !== FLUSH_NEST_INACTIVE),
        ...(flushOn && deliveryOn ? [] : [FLUSH_NEST_INACTIVE]),
        ...(deliveryOn ? [] : [DELIVERY_PIPELINE_INACTIVE]),
        HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED,
      ],
    },
    persisted: persistedRow.inserted,
    eventId: persistedRow.eventId,
    outboxStatus: promoted
      ? OUTBOX_FLUSHABLE_STATUS
      : holdStatus,
    persistAttempts: persistedRow.attempts,
    intentSaved: intent.ok,
    intentImmutable: intent.ok && !intent.inserted,
    promoted,
    flushed,
    wroteSchedule: true,
  }
}

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
  return {
    ok: true,
    recovered: typeof data === 'number' ? data : Number(data) || 0,
    reason: 'recovered',
  }
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

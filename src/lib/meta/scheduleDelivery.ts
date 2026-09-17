/**
 * Persistencia fiable Schedule + recuperación si falla tras confirmar la cita.
 * Dedupe por schedule:{appointmentId}. Nunca flushea Nest/Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  getLeadAdsConsent,
  OUTBOX_REVIEW_HOLD_STATUS,
  persistMetaConversion,
} from './localOutbox'
import { evaluateScheduleEligibility, type ScheduleEligibility } from './scheduleEligibility'
import {
  FLUSH_NEST_INACTIVE,
  isScheduleFlushEnabled,
  isScheduleLocalPersistEnabled,
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

/**
 * First-touch CTWA del mismo tenant/proyecto/contacto que la cita.
 * Tabla `lv_whatsapp_ctwa_attribution` solo service_role; usar admin o cliente inyectado.
 */
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
  /** Cliente autorizado (service_role). Por defecto tryCreateAdminClient(). */
  ctwaClient?: SupabaseClient | null
  persist?: typeof persistMetaConversion
  wabaId?: string | null
  messagingDatasetId?: string | null
  allowLocalPersist?: boolean
  /** Intentos de persistencia (default 3). */
  persistAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

async function persistReviewHoldWithRetry(
  supabase: SupabaseClient,
  input: Parameters<typeof persistMetaConversion>[1],
  deps: ScheduleDeliveryDeps,
): Promise<{
  inserted: boolean
  eventId: string
  rowId: string | null
  status: string
  attempts: number
}> {
  const persist = deps.persist || persistMetaConversion
  const max = Math.max(1, deps.persistAttempts ?? PERSIST_MAX_ATTEMPTS)
  const wait = deps.sleep || sleep
  let lastError: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const result = await persist(supabase, input)
      return { ...result, attempts: attempt }
    } catch (error) {
      lastError = error
      logSafe('persist_retry', `attempt_${attempt}`)
      if (attempt < max) await wait(40 * attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('persist_failed')
}

/**
 * Tras confirmación: plan + opcional persist review_hold con reintentos.
 * Consent vigente re-leído. Dedupe schedule:{appointmentId}.
 * Payload usa datos del lead (no del asesor).
 */
export async function prepareScheduleDeliveryAfterConfirmation(
  supabase: SupabaseClient,
  appointmentId: string,
  deps: ScheduleDeliveryDeps = {},
): Promise<SchedulePrepareResult> {
  const id = String(appointmentId || '').trim()
  if (!id) return { ok: false, reason: 'missing_appointment' }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, lead_id, status, channel, confirmed_by_client, tenant_id, project_id')
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

  // Solo PII del lead; nunca del asesor/sesión.
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
    }
  }

  if (isScheduleFlushEnabled()) {
    logSafe('flush_blocked', FLUSH_NEST_INACTIVE)
  }

  try {
    const persisted = await persistReviewHoldWithRetry(
      supabase,
      {
        eventName: 'Schedule',
        idempotencyKey: plan.idempotencyKey,
        leadId: appointment.lead_id,
        adsConsentRequired: true,
        payload: {
          ...plan.payload!,
          // Aislamiento: scope de la cita en payload de revisión.
          tenant_id: appointment.tenant_id || undefined,
          project_id: appointment.project_id || undefined,
          appointment_id: appointment.id,
        },
        status: OUTBOX_REVIEW_HOLD_STATUS,
      },
      deps,
    )
    logSafe(
      persisted.inserted ? 'persisted_review_hold' : 'duplicate_review_hold',
      plan.channelKind,
    )
    return {
      ok: true,
      reason: persisted.inserted ? 'persisted_review_hold' : 'duplicate_review_hold',
      eligibility,
      plan: {
        ...plan,
        canFlushNest: false,
        blockers: plan.blockers.includes(FLUSH_NEST_INACTIVE)
          ? plan.blockers
          : [...plan.blockers, FLUSH_NEST_INACTIVE],
      },
      persisted: persisted.inserted,
      eventId: persisted.eventId,
      outboxStatus: persisted.status || OUTBOX_REVIEW_HOLD_STATUS,
      persistAttempts: persisted.attempts,
    }
  } catch {
    logSafe('persist_failed', 'outbox_error_after_retries')
    return {
      ok: false,
      reason: 'persist_failed',
      eligibility,
      plan,
      persistAttempts: deps.persistAttempts ?? PERSIST_MAX_ATTEMPTS,
    }
  }
}

/**
 * Recuperación: si la cita sigue elegible y no hay fila outbox, reintenta persist.
 * Idempotente vía schedule:{appointmentId}. No flushea.
 */
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

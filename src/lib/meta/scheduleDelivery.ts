/**
 * Preparación de entrega Schedule tras confirmación.
 * Persistencia de revisión → status review_hold (excluida de flush/drain).
 * CTWA acotado a tenant_id + project_id de la cita (servidor service_role).
 * Nunca flushea Nest ni envía a Meta.
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
}

function logSafe(code: string, reason: string) {
  console.info(
    JSON.stringify({
      scope: 'meta_schedule_delivery',
      code,
      reason: String(reason).slice(0, 100),
    }),
  )
}

/**
 * First-touch CTWA del mismo tenant/proyecto/contacto que la cita.
 * Tabla `lv_whatsapp_ctwa_attribution` solo service_role; usar admin o cliente inyectado.
 * No expone PII en logs.
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

/**
 * Tras confirmación: plan + opcional persist review_hold.
 * Consent vigente re-leído. Dedupe schedule:{appointmentId}.
 */
export async function prepareScheduleDeliveryAfterConfirmation(
  supabase: SupabaseClient,
  appointmentId: string,
  deps?: {
    getLeadAdsConsent?: typeof getLeadAdsConsent
    loadCtwa?: typeof loadCtwaClidForAppointmentScope
    /** Cliente autorizado (service_role). Por defecto tryCreateAdminClient(). */
    ctwaClient?: SupabaseClient | null
    persist?: typeof persistMetaConversion
    wabaId?: string | null
    messagingDatasetId?: string | null
    allowLocalPersist?: boolean
  },
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

  const readConsent = deps?.getLeadAdsConsent || getLeadAdsConsent
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
    const loadCtwa = deps?.loadCtwa || loadCtwaClidForAppointmentScope
    // Acceso autorizado: tabla CTWA solo service_role (no sesión CRM).
    const ctwaClient =
      deps?.ctwaClient === null
        ? null
        : deps?.ctwaClient || tryCreateAdminClient() || null
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
    wabaId: deps?.wabaId ?? process.env.META_WABA_ID ?? null,
    messagingDatasetId:
      deps?.messagingDatasetId ?? process.env.META_MESSAGING_DATASET_ID ?? null,
  })

  if (!eligibility.businessOk) {
    logSafe('skipped', eligibility.reason)
    return { ok: false, reason: eligibility.reason, eligibility, plan }
  }

  const persistAllowed =
    (deps?.allowLocalPersist === true || isScheduleLocalPersistEnabled()) &&
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
    const persist = deps?.persist || persistMetaConversion
    const persisted = await persist(supabase, {
      eventName: 'Schedule',
      idempotencyKey: plan.idempotencyKey,
      leadId: appointment.lead_id,
      adsConsentRequired: true,
      payload: plan.payload!,
      status: OUTBOX_REVIEW_HOLD_STATUS,
    })
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
    }
  } catch {
    logSafe('persist_failed', 'outbox_error')
    return { ok: false, reason: 'persist_failed', eligibility, plan }
  }
}

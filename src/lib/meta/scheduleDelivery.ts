/**
 * Preparación de entrega Schedule tras confirmación.
 * - Evalúa negocio + arma plan web/WhatsApp.
 * - Persistencia local opcional (META_SCHEDULE_LOCAL_PERSIST=true), con dedupe schedule:{appointmentId}.
 * - Nunca flushea Nest ni envía a Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadAdsConsent, persistMetaConversion } from './localOutbox'
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

async function loadCtwaClidForLead(
  supabase: SupabaseClient,
  leadId: string,
  getCtwa?: (contactId: number) => Promise<string | null>,
): Promise<string | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, contact_id, phone, name, email, meta_ads_consent')
    .eq('id', leadId)
    .maybeSingle()

  if (!lead) return null
  const contactRaw = lead.contact_id
  const contactId = Number(contactRaw)
  if (!getCtwa || !Number.isFinite(contactId) || contactId <= 0) {
    // Fallback: lectura directa first-touch por contacto textual si existe columna en leads.
    const { data: row } = await supabase
      .from('lv_whatsapp_ctwa_attribution')
      .select('ctwa_clid')
      .eq('contact_id', String(contactRaw || ''))
      .order('captured_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return row?.ctwa_clid ? String(row.ctwa_clid) : null
  }
  return getCtwa(contactId)
}

/**
 * Tras confirmación: plan de entrega + persistencia local opcional.
 * Consent vigente re-leído del lead. Dedupe por schedule:{appointmentId}.
 */
export async function prepareScheduleDeliveryAfterConfirmation(
  supabase: SupabaseClient,
  appointmentId: string,
  deps?: {
    getLeadAdsConsent?: typeof getLeadAdsConsent
    getCtwaClid?: (contactId: number) => Promise<string | null>
    persist?: typeof persistMetaConversion
    wabaId?: string | null
    /** Forzar intento de persist local (sigue requiriendo env o este flag en tests). */
    allowLocalPersist?: boolean
  },
): Promise<SchedulePrepareResult> {
  const id = String(appointmentId || '').trim()
  if (!id) return { ok: false, reason: 'missing_appointment' }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, lead_id, status, channel, confirmed_by_client')
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
    ctwaClid = await loadCtwaClidForLead(supabase, appointment.lead_id, deps?.getCtwaClid)
  }

  const plan = planScheduleDelivery({
    eligibility,
    leadId: appointment.lead_id,
    phone: lead?.phone,
    email: lead?.email,
    fullName: lead?.name,
    ctwaClid,
    wabaId: deps?.wabaId ?? process.env.META_WABA_ID ?? null,
  })

  if (!eligibility.businessOk) {
    logSafe('skipped', eligibility.reason)
    return { ok: false, reason: eligibility.reason, eligibility, plan }
  }

  const persistAllowed =
    (deps?.allowLocalPersist === true || isScheduleLocalPersistEnabled()) &&
    plan.canPersistLocal &&
    plan.payload

  if (!persistAllowed) {
    const reason = plan.canPersistLocal ? LOCAL_PERSIST_INACTIVE : plan.blockers[0] || 'not_persistable'
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
    // Defensa: esta preparación no activa flush.
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
    })
    logSafe(persisted.inserted ? 'persisted_local' : 'duplicate_local', plan.channelKind)
    return {
      ok: true,
      reason: persisted.inserted ? 'persisted_local' : 'duplicate_local',
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
    }
  } catch {
    logSafe('persist_failed', 'outbox_error')
    return { ok: false, reason: 'persist_failed', eligibility, plan }
  }
}

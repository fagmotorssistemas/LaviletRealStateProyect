/**
 * Schedule (Meta) — evaluación + preparación de entrega tras confirmación.
 *
 * Elegibilidad (PR #5): cerrada.
 * Entrega: plan web/WhatsApp + persistencia local opcional; flush Nest/Meta OFF.
 *
 * WhatsApp: exige identificadores de messaging/CTWA en el plan; Nest aún no los
 * reenvía. Sin CTWA se documenta `whatsapp_ctwa_clid_missing` (atribución floja).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadAdsConsent } from './localOutbox'
import {
  evaluateScheduleEligibility,
  type ScheduleEligibility,
} from './scheduleEligibility'
import { notifyScheduleIfRequestConfirmed as notifyIfConfirmed } from './scheduleAgendaHook'
import { prepareScheduleDeliveryAfterConfirmation } from './scheduleDelivery'

export const SCHEDULE_META_INTEGRATION_STATUS = 'evaluation_only_queue_separated' as const

/** Elegibilidad del PR #5: cerrada. */
export const SCHEDULE_ELIGIBILITY_REVIEW = 'closed' as const

/** @deprecated */
export const SCHEDULE_META_PENDING_HOOK =
  'pending_confirmed_visit_business_hook' as const

function logScheduleSafe(code: string, reason: string) {
  console.info(
    JSON.stringify({
      scope: 'meta_schedule',
      code,
      reason: String(reason).slice(0, 80),
    }),
  )
}

export type ScheduleEvaluateResult = {
  ok: boolean
  reason: string
  eligibility?: ScheduleEligibility
}

/**
 * Carga cita + consent y evalúa. No escribe outbox ni flushea Meta.
 */
export async function evaluateScheduleForConfirmedAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  deps?: { getLeadAdsConsent?: typeof getLeadAdsConsent },
): Promise<ScheduleEvaluateResult> {
  const id = String(appointmentId || '').trim()
  if (!id) {
    return { ok: false, reason: 'missing_appointment' }
  }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, lead_id, status, channel, confirmed_by_client')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    logScheduleSafe('load_failed', 'appointment_query_error')
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

  logScheduleSafe(
    eligibility.businessOk ? 'evaluated' : 'skipped',
    eligibility.reason,
  )

  return {
    ok: eligibility.businessOk,
    reason: eligibility.reason,
    eligibility,
  }
}

/**
 * Prepara entrega (plan + persist local gated). Nunca flushea Nest.
 */
export async function enqueueScheduleForConfirmedAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  deps?: { getLeadAdsConsent?: typeof getLeadAdsConsent },
): Promise<ScheduleEvaluateResult> {
  const prepared = await prepareScheduleDeliveryAfterConfirmation(supabase, appointmentId, {
    getLeadAdsConsent: deps?.getLeadAdsConsent,
  })
  logScheduleSafe('delivery_prepare', prepared.reason)
  return {
    ok: prepared.ok,
    reason: prepared.reason,
    eligibility: prepared.eligibility,
  }
}

/**
 * Gancho post-confirmación: prepara entrega. Por defecto sin persist ni flush.
 */
export async function afterAppointmentConfirmedForSchedule(
  supabase: SupabaseClient,
  appointmentId: string | null | undefined,
): Promise<ScheduleEvaluateResult | void> {
  const id = String(appointmentId || '').trim()
  if (!id) return
  try {
    const prepared = await prepareScheduleDeliveryAfterConfirmation(supabase, id)
    return {
      ok: prepared.ok,
      reason: prepared.reason,
      eligibility: prepared.eligibility,
    }
  } catch {
    logScheduleSafe('hook_error', 'swallowed')
  }
}

/** Tras save de request: solo si status === confirmed. */
export async function notifyScheduleIfRequestConfirmed(
  supabase: SupabaseClient,
  request: { status?: string | null; appointment_id?: string | null } | null | undefined,
  notify: typeof afterAppointmentConfirmedForSchedule = afterAppointmentConfirmedForSchedule,
): Promise<boolean> {
  return notifyIfConfirmed(supabase, request, notify)
}

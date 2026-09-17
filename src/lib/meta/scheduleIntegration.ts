/**
 * Schedule (Meta) — evaluación tras confirmación de visitas.
 *
 * Separación:
 * - Este módulo solo **evalúa** (y registra códigos sin PII).
 * - La cola activa (outbox / flush Nest / Pixel) está desconectada.
 *
 * WhatsApp: `business_messaging` es la intención futura de action_source;
 * la entrega sigue `whatsapp_delivery_pending_nest_contract` hasta verificar
 * el contrato completo Nest/Meta. Cambiar solo action_source no completa la integración.
 *
 * Nunca persiste ni envía eventos reales.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadAdsConsent } from './localOutbox'
import {
  evaluateScheduleEligibility,
  type ScheduleEligibility,
} from './scheduleEligibility'
import { notifyScheduleIfRequestConfirmed as notifyIfConfirmed } from './scheduleAgendaHook'

export const SCHEDULE_META_INTEGRATION_STATUS = 'evaluation_only_queue_separated' as const

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
 * Cola activa desconectada. No persiste.
 * WhatsApp nunca encola aquí (contrato Nest/Meta pendiente).
 */
export async function enqueueScheduleForConfirmedAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  deps?: { getLeadAdsConsent?: typeof getLeadAdsConsent },
): Promise<ScheduleEvaluateResult> {
  const evaluated = await evaluateScheduleForConfirmedAppointment(supabase, appointmentId, deps)
  if (!evaluated.eligibility?.businessOk) {
    return evaluated
  }
  const reason =
    evaluated.eligibility.channelKind === 'whatsapp'
      ? evaluated.reason
      : SCHEDULE_META_INTEGRATION_STATUS
  logScheduleSafe('queue_separated', reason)
  return {
    ok: false,
    reason,
    eligibility: evaluated.eligibility,
  }
}

/**
 * Gancho post-confirmación: solo evaluación. Nunca lanza ni encola.
 */
export async function afterAppointmentConfirmedForSchedule(
  supabase: SupabaseClient,
  appointmentId: string | null | undefined,
): Promise<ScheduleEvaluateResult | void> {
  const id = String(appointmentId || '').trim()
  if (!id) return
  try {
    return await evaluateScheduleForConfirmedAppointment(supabase, id)
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

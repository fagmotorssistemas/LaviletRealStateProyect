/**
 * Schedule (Meta) — integración con confirmación real de visitas.
 *
 * Emisión solo desde operación de negocio verificada (cita confirmada),
 * nunca desde /api/meta/enqueue.
 *
 * Por defecto: modo revisión (evalúa, no persiste, no flushea a Meta).
 * Persistencia local solo con META_SCHEDULE_PERSIST=true y opts.persist !== false.
 * Nunca envía eventos reales desde este módulo (no llama flush).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadAdsConsent, persistMetaConversion } from '@/lib/meta/localOutbox'
import {
  evaluateScheduleEligibility,
  isSchedulePersistEnabled,
  type ScheduleEligibility,
} from '@/lib/meta/scheduleEligibility'

export const SCHEDULE_META_INTEGRATION_STATUS = 'review_mode_no_persist' as const

/** @deprecated Preferir SCHEDULE_META_INTEGRATION_STATUS */
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

export type ScheduleEnqueueResult = {
  ok: boolean
  reason: string
  eventId?: string
  eligibility?: ScheduleEligibility
}

/**
 * Tras guardar una cita confirmada: evalúa Schedule.
 * No asume consentimiento por aceptar la cita.
 * No incluye horarios, lugar ni datos personales en logs.
 */
export async function enqueueScheduleForConfirmedAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  opts?: {
    /** Forzar evaluación aunque persist esté off (default true para el gancho). */
    evaluate?: boolean
    /** Escribir outbox local. Requiere META_SCHEDULE_PERSIST=true. */
    persist?: boolean
    /**
     * @deprecated Usar persist + META_SCHEDULE_PERSIST.
     * force=true sin persist habilitado solo evalúa (compat).
     */
    force?: boolean
  },
): Promise<ScheduleEnqueueResult> {
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

  const adsConsent = await getLeadAdsConsent(supabase, appointment.lead_id)
  const eligibility = evaluateScheduleEligibility({
    appointmentId: appointment.id,
    status: appointment.status,
    channel: appointment.channel,
    leadId: appointment.lead_id,
    adsConsent,
  })

  if (!eligibility.eligible) {
    logScheduleSafe('skipped', eligibility.reason)
    return { ok: false, reason: eligibility.reason, eligibility }
  }

  const persistWanted = opts?.persist === true || opts?.force === true
  const persistAllowed = isSchedulePersistEnabled() && persistWanted

  if (!persistAllowed) {
    logScheduleSafe('review', SCHEDULE_META_INTEGRATION_STATUS)
    return {
      ok: false,
      reason: SCHEDULE_META_INTEGRATION_STATUS,
      eligibility,
    }
  }

  // Persistencia local únicamente. No flush a Meta desde aquí.
  // Payload mínimo: sin horarios/lugar de la cita; identificadores para matching CAPI.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone, name, email')
    .eq('id', appointment.lead_id)
    .maybeSingle()

  if (!lead?.phone) {
    logScheduleSafe('skipped', 'lead_without_phone')
    return { ok: false, reason: 'lead_without_phone', eligibility }
  }

  try {
    const persisted = await persistMetaConversion(supabase, {
      eventName: 'Schedule',
      idempotencyKey: eligibility.idempotencyKey,
      leadId: lead.id,
      adsConsentRequired: true,
      payload: {
        action_source: eligibility.actionSource,
        phone: lead.phone,
        email: lead.email,
        full_name: lead.name,
        external_id: lead.id,
        // No incluir start_time, meeting_place, ni texto de la cita.
        appointment_channel: eligibility.channelKind,
      },
    })
    logScheduleSafe(
      persisted.inserted ? 'persisted' : 'duplicate',
      eligibility.channelKind,
    )
    return {
      ok: true,
      reason: persisted.inserted ? 'persisted' : 'duplicate',
      eventId: persisted.eventId,
      eligibility,
    }
  } catch {
    logScheduleSafe('persist_failed', 'outbox_error')
    return { ok: false, reason: 'persist_failed', eligibility }
  }
}

/**
 * Gancho post-confirmación: nunca lanza ni bloquea la agenda.
 * Por defecto solo evalúa (review); no envía eventos reales.
 */
export async function afterAppointmentConfirmedForSchedule(
  supabase: SupabaseClient,
  appointmentId: string | null | undefined,
): Promise<void> {
  const id = String(appointmentId || '').trim()
  if (!id) return
  try {
    await enqueueScheduleForConfirmedAppointment(supabase, id)
  } catch {
    logScheduleSafe('hook_error', 'swallowed')
  }
}

/**
 * Schedule (Meta) — integración con confirmación real de visitas.
 *
 * Emisión solo desde operación de negocio verificada (cita confirmada),
 * nunca desde /api/meta/enqueue.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadAdsConsent, persistMetaConversion } from '@/lib/meta/localOutbox'

export const SCHEDULE_META_INTEGRATION_STATUS =
  'pending_confirmed_visit_business_hook' as const

export async function enqueueScheduleForConfirmedAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; reason: string; eventId?: string }> {
  if (!opts?.force) {
    return {
      ok: false,
      reason: SCHEDULE_META_INTEGRATION_STATUS,
    }
  }

  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, lead_id, status, confirmed_by_client')
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appointment?.lead_id) {
    return { ok: false, reason: 'appointment_without_lead' }
  }

  const consent = await getLeadAdsConsent(supabase, appointment.lead_id)
  if (consent !== true) {
    return { ok: false, reason: 'no_ads_consent' }
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone, name, email')
    .eq('id', appointment.lead_id)
    .maybeSingle()

  if (!lead?.phone) {
    return { ok: false, reason: 'lead_without_phone' }
  }

  try {
    const persisted = await persistMetaConversion(supabase, {
      eventName: 'Schedule',
      idempotencyKey: `schedule:${appointmentId}`,
      leadId: lead.id,
      adsConsentRequired: true,
      payload: {
        action_source: 'system_generated',
        phone: lead.phone,
        email: lead.email,
        full_name: lead.name,
        external_id: lead.id,
      },
    })
    return {
      ok: true,
      reason: persisted.inserted ? 'persisted' : 'duplicate',
      eventId: persisted.eventId,
    }
  } catch (error) {
    console.error('persist Schedule', error)
    return { ok: false, reason: 'persist_failed' }
  }
}

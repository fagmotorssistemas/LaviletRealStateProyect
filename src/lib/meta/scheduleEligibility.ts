/**
 * Elegibilidad Schedule (Meta) tras confirmación de cita.
 * Sin I/O ni PII: solo reglas de negocio para revisión / tests.
 *
 * Consentimiento publicitario ≠ aceptar la cita.
 * WhatsApp ≠ conversión web (action_source distinto).
 */

export type ScheduleChannelKind = 'web' | 'whatsapp' | 'unknown'

export type ScheduleActionSource =
  | 'website'
  | 'business_messaging'
  | 'system_generated'
  | 'other'

export type ScheduleEligibilityInput = {
  appointmentId: string
  /** appointments.status */
  status: string | null | undefined
  /** appointments.channel — 'web' | 'whatsapp' | … */
  channel: string | null | undefined
  leadId: string | null | undefined
  /**
   * leads.meta_ads_consent.
   * Solo `true` autoriza. `null`/`undefined` = no comprobado; `false` = revocado/negado.
   * Aceptar la cita no implica consentimiento.
   */
  adsConsent: boolean | null | undefined
}

export type ScheduleEligibility = {
  eligible: boolean
  reason: string
  channelKind: ScheduleChannelKind
  actionSource: ScheduleActionSource
  idempotencyKey: string
}

export function scheduleIdempotencyKey(appointmentId: string): string {
  return `schedule:${String(appointmentId || '').trim()}`
}

export function classifyAppointmentChannel(
  channel: string | null | undefined,
): ScheduleChannelKind {
  const value = String(channel || '')
    .trim()
    .toLowerCase()
  if (value === 'whatsapp' || value === 'waba') return 'whatsapp'
  if (value === 'web' || value === 'website' || value === 'crm') return 'web'
  return 'unknown'
}

/** WhatsApp nunca se presenta como website. Canal desconocido → other (conservador). */
export function actionSourceForScheduleChannel(
  kind: ScheduleChannelKind,
): ScheduleActionSource {
  if (kind === 'whatsapp') return 'business_messaging'
  if (kind === 'web') return 'website'
  return 'other'
}

export function isConfirmedAppointmentStatus(status: string | null | undefined): boolean {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  return value === 'aceptado' || value === 'reprogramado'
}

/**
 * Decide si un Schedule sería elegible tras un guardado exitoso.
 * No asume consentimiento por el hecho de confirmar/aceptar la cita.
 */
export function evaluateScheduleEligibility(
  input: ScheduleEligibilityInput,
): ScheduleEligibility {
  const appointmentId = String(input.appointmentId || '').trim()
  const idempotencyKey = scheduleIdempotencyKey(appointmentId)
  const channelKind = classifyAppointmentChannel(input.channel)
  const actionSource = actionSourceForScheduleChannel(channelKind)

  const base = { channelKind, actionSource, idempotencyKey }

  if (!appointmentId) {
    return { eligible: false, reason: 'missing_appointment', ...base }
  }
  if (!input.leadId) {
    return { eligible: false, reason: 'appointment_without_lead', ...base }
  }
  if (!isConfirmedAppointmentStatus(input.status)) {
    return { eligible: false, reason: 'not_confirmed_status', ...base }
  }
  if (channelKind === 'unknown') {
    return { eligible: false, reason: 'unknown_channel', ...base }
  }
  if (input.adsConsent === true) {
    return { eligible: true, reason: 'eligible', ...base }
  }
  if (input.adsConsent === false) {
    return { eligible: false, reason: 'ads_consent_false', ...base }
  }
  return { eligible: false, reason: 'ads_consent_missing', ...base }
}

/** Persistencia local (outbox) solo si se autoriza explícitamente; por defecto off. */
export function isSchedulePersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_PERSIST || '')
    .trim()
    .toLowerCase() === 'true'
}

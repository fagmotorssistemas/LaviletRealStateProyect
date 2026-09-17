/**
 * Elegibilidad Schedule (Meta) tras confirmación de cita.
 * Sin I/O ni PII: solo reglas de negocio para revisión / tests.
 *
 * - Consentimiento publicitario ≠ aceptar la cita.
 * - WhatsApp ≠ conversión web.
 * - Cambiar action_source a business_messaging **no** completa la entrega:
 *   la cola WhatsApp queda pendiente del contrato Nest/Meta.
 * - La evaluación está separada de la cola activa (outbox/flush).
 */

export type ScheduleChannelKind = 'web' | 'whatsapp' | 'unknown'

export type ScheduleActionSource =
  | 'website'
  | 'business_messaging'
  | 'system_generated'
  | 'other'

/** Motivo estable cuando WhatsApp aún no puede encolarse. */
export const WHATSAPP_SCHEDULE_DELIVERY_PENDING =
  'whatsapp_delivery_pending_nest_contract' as const

/** Evaluación OK pero cola activa desconectada (revisión). */
export const SCHEDULE_QUEUE_INACTIVE = 'evaluation_ok_queue_inactive' as const

export type ScheduleEligibilityInput = {
  appointmentId: string
  /** appointments.status */
  status: string | null | undefined
  /** appointments.channel — 'web' | 'whatsapp' | … */
  channel: string | null | undefined
  leadId: string | null | undefined
  /**
   * leads.meta_ads_consent.
   * Solo `true` pasa el filtro de negocio. `null` = no comprobado; `false` = negado.
   * Aceptar la cita no implica consentimiento.
   */
  adsConsent: boolean | null | undefined
}

export type ScheduleEligibility = {
  /** Pasó filtros de negocio (estado confirmado, lead, consent, canal conocido). */
  businessOk: boolean
  /**
   * Puede escribirse en la cola activa (outbox).
   * Siempre false mientras la cola esté separada / WhatsApp sin contrato Nest.
   */
  queueable: boolean
  reason: string
  channelKind: ScheduleChannelKind
  /** Intención futura de action_source; no implica entrega lista. */
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

/** WhatsApp nunca como website. Desconocido → other (conservador). */
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
 * Evalúa negocio + si la cola activa podría usarse.
 * Por diseño actual: `queueable` siempre false (cola separada; WhatsApp pendiente Nest/Meta).
 */
export function evaluateScheduleEligibility(
  input: ScheduleEligibilityInput,
): ScheduleEligibility {
  const appointmentId = String(input.appointmentId || '').trim()
  const idempotencyKey = scheduleIdempotencyKey(appointmentId)
  const channelKind = classifyAppointmentChannel(input.channel)
  const actionSource = actionSourceForScheduleChannel(channelKind)

  const base = {
    businessOk: false,
    queueable: false as boolean,
    channelKind,
    actionSource,
    idempotencyKey,
  }

  if (!appointmentId) {
    return { ...base, reason: 'missing_appointment' }
  }
  if (!input.leadId) {
    return { ...base, reason: 'appointment_without_lead' }
  }
  if (!isConfirmedAppointmentStatus(input.status)) {
    return { ...base, reason: 'not_confirmed_status' }
  }
  if (channelKind === 'unknown') {
    return { ...base, reason: 'unknown_channel' }
  }
  if (input.adsConsent === false) {
    return { ...base, reason: 'ads_consent_false' }
  }
  if (input.adsConsent !== true) {
    return { ...base, reason: 'ads_consent_missing' }
  }

  // Negocio OK. Cola activa separada: no encolar desde este módulo.
  if (channelKind === 'whatsapp') {
    return {
      ...base,
      businessOk: true,
      queueable: false,
      reason: WHATSAPP_SCHEDULE_DELIVERY_PENDING,
    }
  }

  return {
    ...base,
    businessOk: true,
    queueable: false,
    reason: SCHEDULE_QUEUE_INACTIVE,
  }
}

/** La cola activa (outbox/flush) no se usa en esta revisión. */
export function isScheduleQueueActive(
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return false
}

/** @deprecated Cola separada; siempre false. */
export function isSchedulePersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isScheduleQueueActive(env)
}

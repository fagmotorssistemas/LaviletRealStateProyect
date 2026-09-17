/**
 * Elegibilidad Schedule (Meta) tras confirmación de cita.
 * Sin I/O ni PII: solo reglas de negocio para revisión / tests.
 *
 * - Consentimiento publicitario ≠ aceptar la cita.
 * - Exige evidencia de confirmación definitiva del cliente (`confirmed_by_client === true`).
 * - WhatsApp ≠ conversión web; `crm` **no** se mapea a website.
 * - Sin evidencia de canal → evaluación pendiente (no website).
 * - Cola activa separada (`queueable` siempre false en esta revisión).
 */

export type ScheduleChannelKind = 'web' | 'whatsapp' | 'pending' | 'unknown'

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

/** Canal sin evidencia web/WhatsApp clara (p. ej. crm o vacío). */
export const CHANNEL_PENDING_EVIDENCE = 'channel_pending_evidence' as const

/** Estado aceptado/reprogramado sin confirmed_by_client. */
export const CLIENT_CONFIRMATION_MISSING = 'client_confirmation_missing' as const

export type ScheduleEligibilityInput = {
  appointmentId: string
  /** appointments.status */
  status: string | null | undefined
  /** appointments.channel — solo `web`/`website` o `whatsapp`/`waba` son evidentes. */
  channel: string | null | undefined
  /**
   * appointments.confirmed_by_client.
   * Solo `true` cuenta como confirmación definitiva del cliente.
   */
  confirmedByClient: boolean | null | undefined
  leadId: string | null | undefined
  /**
   * leads.meta_ads_consent.
   * Solo `true` pasa el filtro de negocio. `null` = no comprobado; `false` = negado.
   * Aceptar la cita no implica consentimiento.
   */
  adsConsent: boolean | null | undefined
}

export type ScheduleEligibility = {
  /** Pasó filtros de negocio (estado, cliente, lead, consent, canal evidente). */
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

/**
 * Clasifica canal. `crm` y vacío no son website: quedan pendientes de evidencia.
 */
export function classifyAppointmentChannel(
  channel: string | null | undefined,
): ScheduleChannelKind {
  const value = String(channel || '')
    .trim()
    .toLowerCase()
  if (value === 'whatsapp' || value === 'waba') return 'whatsapp'
  if (value === 'web' || value === 'website') return 'web'
  if (!value || value === 'crm') return 'pending'
  return 'unknown'
}

/** WhatsApp nunca como website. Pending/unknown → other (conservador). */
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

export function hasClientConfirmationEvidence(
  confirmedByClient: boolean | null | undefined,
): boolean {
  return confirmedByClient === true
}

/**
 * Evalúa negocio + si la cola activa podría usarse.
 * Por diseño actual: `queueable` siempre false.
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
  if (!hasClientConfirmationEvidence(input.confirmedByClient)) {
    return { ...base, reason: CLIENT_CONFIRMATION_MISSING }
  }
  if (channelKind === 'pending') {
    return { ...base, reason: CHANNEL_PENDING_EVIDENCE }
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

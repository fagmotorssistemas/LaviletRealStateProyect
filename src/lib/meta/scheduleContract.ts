/**
 * Contrato de entrega Schedule: frontend → Nest → Meta.
 * Sin I/O. Separa web y WhatsApp; lista bloqueos concretos.
 *
 * Persistencia local (outbox) ≠ flush Nest ≠ envío Meta.
 */

import {
  actionSourceForScheduleChannel,
  scheduleIdempotencyKey,
  type ScheduleActionSource,
  type ScheduleChannelKind,
  type ScheduleEligibility,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'

/** Nest aún no tipa/reenvía estos campos en enqueueMetaEvent. */
export const NEST_MISSING_MESSAGING_FIELDS =
  'nest_payload_missing_messaging_fields' as const

export const WHATSAPP_CTWA_CLID_MISSING = 'whatsapp_ctwa_clid_missing' as const

export const WHATSAPP_PHONE_MISSING = 'whatsapp_phone_missing' as const

export const WEB_PHONE_MISSING = 'web_phone_missing' as const

export const LOCAL_PERSIST_INACTIVE = 'local_persist_inactive_review' as const

export const FLUSH_NEST_INACTIVE = 'flush_nest_inactive' as const

export type ScheduleIdentifierInput = {
  eligibility: ScheduleEligibility
  leadId: string
  phone: string | null | undefined
  /** Click-to-WhatsApp id; solo relevante en canal WhatsApp. */
  ctwaClid: string | null | undefined
  /** ID WABA / dataset messaging si el entorno lo tiene. */
  wabaId: string | null | undefined
  email?: string | null
  fullName?: string | null
  fbp?: string | null
  fbc?: string | null
  fbclid?: string | null
}

export type ScheduleDeliveryPlan = {
  channelKind: ScheduleChannelKind
  actionSource: ScheduleActionSource
  idempotencyKey: string
  /** Negocio + identificadores mínimos para armar fila local. */
  canBuildPayload: boolean
  /** Escribiría meta_capi_outbox (sigue gated por env en el runner). */
  canPersistLocal: boolean
  /** Enviar a Nest/Meta: siempre false hasta activación explícita. */
  canFlushNest: boolean
  blockers: string[]
  /**
   * Payload previsto para outbox (sin horarios de cita).
   * Puede incluir campos que Nest aún no reenvía (documentan el gap).
   */
  payload: Record<string, unknown> | null
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim())
}

/**
 * Identificadores WhatsApp (contrato marketing / Meta CTWA):
 * - phone (EMQ)
 * - action_source: business_messaging
 * - messaging_channel: whatsapp
 * - ctwa_clid cuando el clic vino de anuncio (si falta, atribución floja)
 * - waba / dataset messaging id
 *
 * Sin CTWA: el plan sigue armable a nivel “mensaje WhatsApp”, pero se registra
 * `whatsapp_ctwa_clid_missing` y no se considera listo para optimización CTWA.
 * Además Nest no acepta aún esos campos → NEST_MISSING_MESSAGING_FIELDS.
 */
export function planScheduleDelivery(input: ScheduleIdentifierInput): ScheduleDeliveryPlan {
  const { eligibility } = input
  const channelKind = eligibility.channelKind
  const actionSource = actionSourceForScheduleChannel(channelKind)
  const idempotencyKey = eligibility.idempotencyKey || scheduleIdempotencyKey('')
  const blockers: string[] = []

  if (!eligibility.businessOk) {
    return {
      channelKind,
      actionSource,
      idempotencyKey,
      canBuildPayload: false,
      canPersistLocal: false,
      canFlushNest: false,
      blockers: [eligibility.reason],
      payload: null,
    }
  }

  if (channelKind === 'whatsapp') {
    if (!hasText(input.phone)) blockers.push(WHATSAPP_PHONE_MISSING)
    if (!hasText(input.ctwaClid)) blockers.push(WHATSAPP_CTWA_CLID_MISSING)
    if (!hasText(input.wabaId)) blockers.push('whatsapp_waba_id_missing')
    // Contrato Nest incompleto aunque tengamos clid.
    blockers.push(WHATSAPP_SCHEDULE_DELIVERY_PENDING)
    blockers.push(NEST_MISSING_MESSAGING_FIELDS)
    blockers.push(FLUSH_NEST_INACTIVE)

    const canBuildPayload = hasText(input.phone)
    const payload = canBuildPayload
      ? {
          action_source: 'business_messaging' as const,
          messaging_channel: 'whatsapp',
          phone: String(input.phone).trim(),
          email: input.email || undefined,
          full_name: input.fullName || undefined,
          external_id: input.leadId,
          lead_id: input.leadId,
          ctwa_clid: hasText(input.ctwaClid) ? String(input.ctwaClid).trim() : undefined,
          waba_id: hasText(input.wabaId) ? String(input.wabaId).trim() : undefined,
          // Nest enqueueMetaEvent hoy no mapea ctwa_clid / messaging_channel / waba_id.
          _nest_gap: NEST_MISSING_MESSAGING_FIELDS,
        }
      : null

    return {
      channelKind,
      actionSource,
      idempotencyKey,
      canBuildPayload,
      // Persistencia local permitida solo con phone; CTWA ausente no impide fila local de revisión,
      // pero flush Nest sigue bloqueado.
      canPersistLocal: canBuildPayload,
      canFlushNest: false,
      blockers,
      payload,
    }
  }

  if (channelKind === 'web') {
    if (!hasText(input.phone)) blockers.push(WEB_PHONE_MISSING)
    blockers.push(FLUSH_NEST_INACTIVE)
    // Web no exige CTWA; cookies son opcionales (atribución floja sin ellas).
    const canBuildPayload = hasText(input.phone)
    const payload = canBuildPayload
      ? {
          action_source: 'website' as const,
          phone: String(input.phone).trim(),
          email: input.email || undefined,
          full_name: input.fullName || undefined,
          external_id: input.leadId,
          lead_id: input.leadId,
          fbp: input.fbp || undefined,
          fbc: input.fbc || undefined,
          fbclid: input.fbclid || undefined,
        }
      : null

    return {
      channelKind,
      actionSource,
      idempotencyKey,
      canBuildPayload,
      canPersistLocal: canBuildPayload,
      canFlushNest: false,
      blockers,
      payload,
    }
  }

  blockers.push(eligibility.reason || 'channel_not_deliverable')
  blockers.push(FLUSH_NEST_INACTIVE)
  return {
    channelKind,
    actionSource,
    idempotencyKey,
    canBuildPayload: false,
    canPersistLocal: false,
    canFlushNest: false,
    blockers,
    payload: null,
  }
}

/** Persistencia local solo si se autoriza explícitamente; flush Nest nunca desde aquí. */
export function isScheduleLocalPersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_LOCAL_PERSIST || '')
    .trim()
    .toLowerCase() === 'true'
}

export function isScheduleFlushEnabled(
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Activación real fuera de esta preparación.
  return false
}

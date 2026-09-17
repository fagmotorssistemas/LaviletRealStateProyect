/**
 * Contrato de entrega Schedule: frontend → Nest → Meta.
 * Sin I/O. Separa web y WhatsApp; lista bloqueos concretos verificados.
 *
 * Fuentes Meta (Business Messaging CAPI):
 * - Dataset ≠ WABA: el dataset se crea/obtiene desde el WABA; Graph recibe {DATASET_ID}/events.
 * - WhatsApp user_data exige whatsapp_business_account_id + ctwa_clid (docs Meta).
 * - Sin ctwa_clid no hay llamada CAPI de business messaging atribuible al anuncio CTWA
 *   (no es “atribución floja” opcional: el identificador es requerido en el contrato Meta).
 * - event_name Schedule en business_messaging: no verificado frente al allowlist Meta.
 * - No renombrar la cita a otro event_name para forzar aceptación Meta.
 */

import {
  actionSourceForScheduleChannel,
  scheduleIdempotencyKey,
  type ScheduleActionSource,
  type ScheduleChannelKind,
  type ScheduleEligibility,
  WHATSAPP_SCHEDULE_DELIVERY_PENDING,
} from './scheduleEligibility'
import {
  LOCAL_PERSIST_INACTIVE,
  FLUSH_NEST_INACTIVE,
  DELIVERY_PIPELINE_INACTIVE,
  HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED,
  isScheduleLocalPersistEnabled,
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
  isScheduleRecoverEnabled,
} from './scheduleFlags'

export {
  LOCAL_PERSIST_INACTIVE,
  FLUSH_NEST_INACTIVE,
  DELIVERY_PIPELINE_INACTIVE,
  HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED,
  isScheduleLocalPersistEnabled,
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
  isScheduleRecoverEnabled,
}

/** Nest tipa/mapea messaging fields; entrega BM Schedule sigue OFF (nombre + flush). */
export const NEST_MISSING_MESSAGING_FIELDS =
  'nest_payload_missing_messaging_fields' as const

/**
 * Sin ctwa_clid Meta no documenta envío CAPI business_messaging atribuible a CTWA.
 * No usar eufemismos de “atribución floja”.
 */
export const WHATSAPP_CTWA_CLID_REQUIRED = 'whatsapp_ctwa_clid_required' as const

export const WHATSAPP_PHONE_MISSING = 'whatsapp_phone_missing' as const

export const WHATSAPP_WABA_ID_MISSING = 'whatsapp_waba_id_missing' as const

/** Dataset messaging (destino Graph) distinto del WABA id. */
export const WHATSAPP_DATASET_ID_MISSING = 'whatsapp_dataset_id_missing' as const

/**
 * Schedule como event_name bajo action_source=business_messaging:
 * no figura en el ejemplo oficial Meta BM (Purchase) y reportes de Graph
 * (p. ej. subcode 2804066) rechazan Schedule. No declarar contrato completo.
 */
export const WHATSAPP_SCHEDULE_EVENT_NAME_UNVERIFIED =
  'whatsapp_schedule_event_name_unverified' as const

export const WEB_PHONE_MISSING = 'web_phone_missing' as const

export type ScheduleIdentifierInput = {
  eligibility: ScheduleEligibility
  leadId: string
  phone: string | null | undefined
  /** Click-to-WhatsApp id; requerido por Meta CAPI business_messaging. */
  ctwaClid: string | null | undefined
  /** WABA id (user_data.whatsapp_business_account_id). No es el dataset. */
  wabaId: string | null | undefined
  /** dataset_id destino Graph {DATASET_ID}/events — distinto del WABA. */
  messagingDatasetId: string | null | undefined
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
  canBuildPayload: boolean
  /** Solo filas review_hold (nunca pending). */
  canPersistReviewHold: boolean
  canFlushNest: boolean
  blockers: string[]
  payload: Record<string, unknown> | null
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim())
}

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
      canPersistReviewHold: false,
      canFlushNest: false,
      blockers: [eligibility.reason],
      payload: null,
    }
  }

  if (channelKind === 'whatsapp') {
    if (!hasText(input.phone)) blockers.push(WHATSAPP_PHONE_MISSING)
    if (!hasText(input.ctwaClid)) blockers.push(WHATSAPP_CTWA_CLID_REQUIRED)
    if (!hasText(input.wabaId)) blockers.push(WHATSAPP_WABA_ID_MISSING)
    if (!hasText(input.messagingDatasetId)) blockers.push(WHATSAPP_DATASET_ID_MISSING)
    blockers.push(WHATSAPP_SCHEDULE_EVENT_NAME_UNVERIFIED)
    blockers.push(WHATSAPP_SCHEDULE_DELIVERY_PENDING)
    blockers.push(FLUSH_NEST_INACTIVE)

    // Payload de revisión solo si hay teléfono; sin CTWA no es enviable a Meta CAPI BM.
    const canBuildPayload = hasText(input.phone)
    const metaReady =
      hasText(input.phone) &&
      hasText(input.ctwaClid) &&
      hasText(input.wabaId) &&
      hasText(input.messagingDatasetId)

    const payload = canBuildPayload
      ? {
          action_source: 'business_messaging' as const,
          messaging_channel: 'whatsapp',
          phone: String(input.phone).trim(),
          email: input.email || undefined,
          full_name: input.fullName || undefined,
          external_id: input.leadId,
          lead_id: input.leadId,
          // Campos Meta BM (Nest aún no los reenvía):
          ctwa_clid: hasText(input.ctwaClid) ? String(input.ctwaClid).trim() : undefined,
          whatsapp_business_account_id: hasText(input.wabaId)
            ? String(input.wabaId).trim()
            : undefined,
          messaging_dataset_id: hasText(input.messagingDatasetId)
            ? String(input.messagingDatasetId).trim()
            : undefined,
          meta_capi_ready: metaReady,
          _nest_gap: NEST_MISSING_MESSAGING_FIELDS,
        }
      : null

    return {
      channelKind,
      actionSource,
      idempotencyKey,
      canBuildPayload,
      canPersistReviewHold: canBuildPayload,
      canFlushNest: false,
      blockers,
      payload,
    }
  }

  if (channelKind === 'web') {
    if (!hasText(input.phone)) blockers.push(WEB_PHONE_MISSING)
    blockers.push(FLUSH_NEST_INACTIVE)
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
          // Nest hoy acepta Schedule+website vía enqueueMetaEvent (sin messaging fields).
          nest_event_name: 'Schedule',
        }
      : null

    return {
      channelKind,
      actionSource,
      idempotencyKey,
      canBuildPayload,
      canPersistReviewHold: canBuildPayload,
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
    canPersistReviewHold: false,
    canFlushNest: false,
    blockers,
    payload: null,
  }
}

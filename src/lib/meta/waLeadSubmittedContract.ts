/**
 * Contrato LeadSubmitted BM — sin I/O.
 * Fuente: Meta CAPI Business Messaging FAQ (LeadSubmitted; ctwa_clid requerido).
 *
 * Identificadores distintos (no intercambiables):
 * - META_MESSAGING_DATASET_ID → destino Graph `{dataset}/events` (nunca WABA, nunca pixel web).
 * - META_WABA_ID → solo `user_data.whatsapp_business_account_id`.
 */

export const WA_LEAD_SUBMITTED_EVENT = 'LeadSubmitted' as const
export const WA_LEAD_SUBMITTED_IDEMPOTENCY_PREFIX = 'wa_lead_submitted:' as const

export const WA_BLOCK_GREETING = 'greeting_only_not_conversion' as const
export const WA_BLOCK_NO_COMMERCIAL_INTEREST = 'commercial_interest_required' as const
export const WA_BLOCK_ADS_CONSENT = 'ads_consent_required' as const
export const WA_BLOCK_CTWA = 'whatsapp_ctwa_clid_required' as const
export const WA_BLOCK_WABA = 'whatsapp_waba_id_required' as const
export const WA_BLOCK_MESSAGING_DATASET = 'messaging_dataset_id_required' as const
export const WA_BLOCK_FEATURE_OFF = 'wa_lead_submitted_inactive' as const
export const WA_BLOCK_DELIVERY_OFF = 'wa_lead_submitted_delivery_inactive' as const

/** Eventos de scoring que evidencian interés comercial (no first_response solo). */
export const WA_COMMERCIAL_SCORE_EVENTS = [
  'asked_price',
  'asked_financing',
  'requested_visit',
  'asked_reservation',
  'declared_unit_type',
  'declared_purchase_purpose',
] as const

export type WaLeadSubmittedBlocker =
  | typeof WA_BLOCK_GREETING
  | typeof WA_BLOCK_NO_COMMERCIAL_INTEREST
  | typeof WA_BLOCK_ADS_CONSENT
  | typeof WA_BLOCK_CTWA
  | typeof WA_BLOCK_WABA
  | typeof WA_BLOCK_MESSAGING_DATASET
  | typeof WA_BLOCK_FEATURE_OFF
  | typeof WA_BLOCK_DELIVERY_OFF

export function waLeadSubmittedIdempotencyKey(leadId: string): string {
  return `${WA_LEAD_SUBMITTED_IDEMPOTENCY_PREFIX}${leadId}`
}

export function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export type WaLeadSubmittedPlanInput = {
  featureEnabled: boolean
  /** Informativo: Nest no claima LS si delivery OFF; no bloquea encolar pending. */
  deliveryEnabled: boolean
  greetingOnly: boolean
  commercialInterest: boolean
  /**
   * false solo si rechazo/revocación explícita (`meta_ads_consent === false`).
   * Ausente/null se trata como permitido en plan (no escribe consentimiento).
   */
  adsConsent: boolean
  ctwaClid: string | null | undefined
  wabaId: string | null | undefined
  messagingDatasetId: string | null | undefined
}

export type WaLeadSubmittedPlan = {
  canEnqueuePending: boolean
  blockers: WaLeadSubmittedBlocker[]
  /** Si hay interés pero faltan requisitos de envío Meta/consent. */
  retainAttention: boolean
}

/**
 * Meta BM exige ctwa_clid (+ WABA + messaging dataset). Sin CTWA no hay envío.
 * La atención CRM se conserva (retainAttention).
 */
export function planWaLeadSubmitted(input: WaLeadSubmittedPlanInput): WaLeadSubmittedPlan {
  const blockers: WaLeadSubmittedBlocker[] = []

  if (!input.featureEnabled) {
    blockers.push(WA_BLOCK_FEATURE_OFF)
    return { canEnqueuePending: false, blockers, retainAttention: true }
  }

  if (input.greetingOnly) {
    blockers.push(WA_BLOCK_GREETING)
    return { canEnqueuePending: false, blockers, retainAttention: true }
  }

  if (!input.commercialInterest) {
    blockers.push(WA_BLOCK_NO_COMMERCIAL_INTEREST)
    return { canEnqueuePending: false, blockers, retainAttention: true }
  }

  if (!input.adsConsent) blockers.push(WA_BLOCK_ADS_CONSENT)
  if (!hasText(input.ctwaClid)) blockers.push(WA_BLOCK_CTWA)
  if (!hasText(input.wabaId)) blockers.push(WA_BLOCK_WABA)
  if (!hasText(input.messagingDatasetId)) blockers.push(WA_BLOCK_MESSAGING_DATASET)
  // Delivery OFF: se anota pero Nest no claima; el FE sí puede dejar pending.
  if (!input.deliveryEnabled) blockers.push(WA_BLOCK_DELIVERY_OFF)

  const hardBlockers = blockers.filter(
    (b) =>
      b === WA_BLOCK_ADS_CONSENT ||
      b === WA_BLOCK_CTWA ||
      b === WA_BLOCK_WABA ||
      b === WA_BLOCK_MESSAGING_DATASET,
  )

  return {
    canEnqueuePending: hardBlockers.length === 0,
    blockers,
    retainAttention: true,
  }
}

export function buildWaLeadSubmittedPayload(input: {
  phone?: string | null
  fullName?: string | null
  email?: string | null
  leadId: string
  tenantId?: string | null
  projectId?: string | null
  contactId?: string | null
  ctwaClid: string
  wabaId: string
  messagingDatasetId: string
  blockReason?: string | null
}): Record<string, unknown> {
  return {
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    phone: input.phone || undefined,
    full_name: input.fullName || undefined,
    email: input.email || undefined,
    external_id: input.leadId,
    lead_id: input.leadId,
    tenant_id: input.tenantId || undefined,
    project_id: input.projectId || undefined,
    contact_id: input.contactId || undefined,
    ctwa_clid: input.ctwaClid,
    whatsapp_business_account_id: input.wabaId,
    messaging_dataset_id: input.messagingDatasetId,
    channel_kind: 'whatsapp',
    block_reason: input.blockReason || undefined,
  }
}

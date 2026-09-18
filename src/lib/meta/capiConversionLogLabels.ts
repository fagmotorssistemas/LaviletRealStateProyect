/** Motivos legibles para Marketing → CAPI (bitácora). */

export const META_CAPI_REASON_LABELS: Record<string, string> = {
  greeting_only_not_conversion: 'Solo saludo; no es conversión',
  commercial_interest_required: 'Sin interés comercial expresado por el cliente',
  ads_consent_required: 'Falta o se revocó el consentimiento de publicidad',
  whatsapp_ctwa_clid_required: 'Falta ctwa_clid (Click to WhatsApp)',
  whatsapp_waba_id_required: 'Falta META_WABA_ID (cuenta WhatsApp Business)',
  messaging_dataset_id_required: 'Falta META_MESSAGING_DATASET_ID (destino Graph)',
  waba_equals_messaging_dataset_misconfig:
    'Misconfiguración: WABA y dataset de mensajería no pueden ser el mismo ID',
  wa_lead_submitted_inactive: 'Feature LeadSubmitted apagada',
  wa_lead_submitted_delivery_inactive: 'Entrega LeadSubmitted apagada',
  already_registered: 'Ya registrado (mismo event_id)',
  duplicate: 'Duplicado concurrente; se conserva el event_id original',
  pending: 'Encolado en outbox',
  persist_failed: 'No se pudo persistir el intent',
  persist_unavailable: 'Persistencia no disponible',
  rpc_rejected: 'RPC rechazó el registro',
  ads_consent_revoked: 'Consentimiento revocado; outbox cancelado',
  business_messaging_identifiers_required: 'Faltan IDs BM (dataset / CTWA / WABA)',
  isolated_bm_test_probe: 'Prueba aislada BM (no cliente real)',
}

export function isMetaCapiProbeRow(row: {
  delivery_lane?: string | null
  idempotency_key?: string | null
  details?: Record<string, unknown>
}): boolean {
  if (row.details?.is_probe === true) return true
  if (row.details?.probe_kind === 'isolated_bm_test') return true
  if (String(row.idempotency_key || '').startsWith('wa_bm_test:')) return true
  return false
}

export const META_CAPI_STAGE_LABELS: Record<string, string> = {
  evaluated: 'Evaluado (no enviado)',
  blocked: 'Bloqueado (no enviado)',
  enqueued: 'Encolado local',
  backend_accepted: 'Aceptado por Nest (aún no Meta)',
  meta_accepted: 'Aceptado por Meta',
  meta_rejected: 'Rechazado por Meta',
}

/** Stages que representan conversión enviada / aceptada por Meta. */
export const META_CAPI_SENT_STAGES = new Set(['meta_accepted'])

export function labelMetaCapiReason(reason: string | null | undefined): string {
  if (!reason) return '—'
  return META_CAPI_REASON_LABELS[reason] || reason
}

export function labelMetaCapiStage(stage: string | null | undefined): string {
  if (!stage) return '—'
  return META_CAPI_STAGE_LABELS[stage] || stage
}

export function isMetaCapiSentStage(stage: string | null | undefined): boolean {
  return META_CAPI_SENT_STAGES.has(String(stage || ''))
}

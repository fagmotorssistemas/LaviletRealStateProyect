/**
 * Gate consentimiento LeadSubmitted (fuente autorizada: leads + evidencia).
 * meta_ads_consent === true no basta: hace falta mensaje, fecha y alcance whatsapp_ads.
 * Contacto / cookies / tracking_consent no autorizan.
 */

import {
  hasVerifiableWaAdsConsentEvidence,
  waAdsConsentEvidenceBlockReason,
  type WaAdsConsentEvidenceFields,
} from '@/lib/meta/waLeadSubmittedConsentEvidence'

export type WaLeadSubmittedConsentAction =
  | 'allow_send'
  | 'cancel_revoked'
  | 'hold_pending'

export type WaLeadSubmittedConsentDecision = {
  action: WaLeadSubmittedConsentAction
  reason: string
}

function normId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

function scopeMismatch(eventId: string | null, leadId: string | null): boolean {
  if (!eventId || !leadId) return false
  return eventId !== leadId
}

export function decideWaLeadSubmittedConsentGate(input: {
  queryOk: boolean
  leadFound: boolean
  metaAdsConsent: boolean | null | undefined
  leadTenantId?: string | null
  leadProjectId?: string | null
  eventTenantId?: string | null
  eventProjectId?: string | null
  eventContactId?: string | null
  evidenceMessage?: string | null
  evidenceAt?: string | null
  evidenceScope?: string | null
}): WaLeadSubmittedConsentDecision {
  const contactId = normId(input.eventContactId)
  if (!contactId) {
    return { action: 'hold_pending', reason: 'contact_scope_required' }
  }
  if (!input.queryOk) {
    return { action: 'hold_pending', reason: 'ads_consent_query_error' }
  }
  if (!input.leadFound) {
    return { action: 'hold_pending', reason: 'ads_consent_lead_absent' }
  }
  if (scopeMismatch(normId(input.eventTenantId), normId(input.leadTenantId))) {
    return { action: 'hold_pending', reason: 'tenant_scope_mismatch' }
  }
  if (scopeMismatch(normId(input.eventProjectId), normId(input.leadProjectId))) {
    return { action: 'hold_pending', reason: 'project_scope_mismatch' }
  }
  if (input.metaAdsConsent === false) {
    return { action: 'cancel_revoked', reason: 'ads_consent_false' }
  }

  const evidence: WaAdsConsentEvidenceFields = {
    meta_ads_consent: input.metaAdsConsent,
    meta_ads_consent_evidence_message: input.evidenceMessage,
    meta_ads_consent_evidence_at: input.evidenceAt,
    meta_ads_consent_scope: input.evidenceScope,
  }
  if (!hasVerifiableWaAdsConsentEvidence(evidence)) {
    return {
      action: 'hold_pending',
      reason: waAdsConsentEvidenceBlockReason(evidence) || 'ads_consent_not_true',
    }
  }
  return { action: 'allow_send', reason: 'ads_consent_true_with_evidence' }
}

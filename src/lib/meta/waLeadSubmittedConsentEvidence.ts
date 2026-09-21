/**
 * Evidencia verificable de consentimiento ads WhatsApp.
 * Contacto/cookies/tracking_consent no sustituyen meta_ads_consent + evidencia.
 */

import { hasText } from '@/lib/meta/waLeadSubmittedContract'
import { WA_ADS_CONSENT_SCOPE } from '@/lib/meta/waLeadSubmittedConsent'

export const WA_ADS_EVIDENCE_SCOPE = WA_ADS_CONSENT_SCOPE

export type WaAdsConsentEvidenceFields = {
  meta_ads_consent?: boolean | null
  meta_ads_consent_evidence_message?: string | null
  meta_ads_consent_evidence_at?: string | null
  meta_ads_consent_scope?: string | null
}

export function hasVerifiableWaAdsConsentEvidence(
  lead: WaAdsConsentEvidenceFields,
): boolean {
  if (lead.meta_ads_consent !== true) return false
  if (!hasText(lead.meta_ads_consent_evidence_message)) return false
  if (!hasText(lead.meta_ads_consent_evidence_at)) return false
  const scope = String(lead.meta_ads_consent_scope || '').trim()
  return scope === WA_ADS_EVIDENCE_SCOPE
}

export function waAdsConsentEvidenceBlockReason(
  lead: WaAdsConsentEvidenceFields,
): string | null {
  if (lead.meta_ads_consent === false) return 'ads_consent_false'
  if (lead.meta_ads_consent !== true) return 'ads_consent_not_true'
  if (!hasText(lead.meta_ads_consent_evidence_message)) {
    return 'ads_consent_evidence_message_required'
  }
  if (!hasText(lead.meta_ads_consent_evidence_at)) {
    return 'ads_consent_evidence_at_required'
  }
  if (String(lead.meta_ads_consent_scope || '').trim() !== WA_ADS_EVIDENCE_SCOPE) {
    return 'ads_consent_scope_required'
  }
  return null
}

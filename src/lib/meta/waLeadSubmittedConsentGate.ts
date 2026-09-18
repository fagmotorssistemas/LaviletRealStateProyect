/**
 * Gate consentimiento LeadSubmitted (fuente autorizada: leads.meta_ads_consent).
 * Solo === true autoriza. Misma semántica que Nest wa-lead-submitted-consent-gate.
 */

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
  if (input.metaAdsConsent === true) {
    return { action: 'allow_send', reason: 'ads_consent_true' }
  }
  return { action: 'hold_pending', reason: 'ads_consent_not_true' }
}

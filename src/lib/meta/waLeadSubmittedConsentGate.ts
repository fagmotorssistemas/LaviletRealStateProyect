/**
 * Gate consentimiento LeadSubmitted (fuente: leads.meta_ads_consent).
 * Configuración operativa: solo rechazo/revocación explícita (`=== false`) cancela.
 * Ausente/null no bloquea encolar ni enviar. No registra consentimiento ficticio.
 * Contacto / cookies / tracking_consent no autorizan ni sustituyen este gate.
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
  /** Conservados por compatibilidad de llamadas; ya no condicionan el envío. */
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

  // true, null o undefined: permitir (no convertir null→true en BD).
  return {
    action: 'allow_send',
    reason:
      input.metaAdsConsent === true
        ? 'ads_consent_true'
        : 'ads_consent_absent_allowed',
  }
}

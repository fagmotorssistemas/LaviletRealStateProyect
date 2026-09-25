export const CRM_QUALIFICATION_SIGNAL_KEY_PREFIX = 'wa_crm_qualified:' as const

export function isCrmQualificationDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    String(env.META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED || '')
      .trim()
      .toLowerCase() === 'true'
  )
}

export type CrmQualificationSignalBlocker =
  | 'not_a_persisted_evaluation'
  | 'not_warm_or_hot'
  | 'already_captured'
  | 'internal_contact'
  | 'test_contact'
  | 'ads_consent_revoked'
  | 'contact_identity_required'
  | 'original_ctwa_attribution_required'
  | 'backend_event_contract_pending'
  | 'feature_disabled'

export type CrmQualificationSignalPlan = {
  captureIntent: boolean
  eligibleForFutureDelivery: boolean
  idempotencyKey: string | null
  blockers: CrmQualificationSignalBlocker[]
}

/**
 * Contrato puro para la señal de calificación. No calcula temperatura ni puntos.
 * La única entrada válida es una evaluación ya persistida por el CRM.
 */
export function planCrmQualificationSignal(input: {
  leadId: string
  evaluationId?: string | null
  temperature?: string | null
  hasQualificationTransition?: boolean
  alreadyCaptured?: boolean
  internal?: boolean
  testContact?: boolean
  adsConsent?: boolean | null
  contactId?: string | null
  ctwaClid?: string | null
  backendEventName?: 'QualifiedLead' | null
  featureEnabled?: boolean
}): CrmQualificationSignalPlan {
  const blockers: CrmQualificationSignalBlocker[] = []
  const leadId = String(input.leadId || '').trim()
  const evaluated = Boolean(String(input.evaluationId || '').trim())

  if (!evaluated) blockers.push('not_a_persisted_evaluation')
  if (
    !['tibio', 'caliente'].includes(String(input.temperature)) ||
    input.hasQualificationTransition !== true
  )
    blockers.push('not_warm_or_hot')
  if (input.alreadyCaptured) blockers.push('already_captured')

  const captureIntent = Boolean(
    leadId &&
    evaluated &&
    ['tibio', 'caliente'].includes(String(input.temperature)) &&
    input.hasQualificationTransition === true &&
    !input.alreadyCaptured,
  )
  if (!captureIntent) {
    return {
      captureIntent: false,
      eligibleForFutureDelivery: false,
      idempotencyKey: null,
      blockers,
    }
  }

  if (input.internal) blockers.push('internal_contact')
  if (input.testContact) blockers.push('test_contact')
  if (input.adsConsent === false) blockers.push('ads_consent_revoked')
  if (!String(input.contactId || '').trim()) blockers.push('contact_identity_required')
  if (!String(input.ctwaClid || '').trim()) blockers.push('original_ctwa_attribution_required')
  if (input.backendEventName !== 'QualifiedLead') blockers.push('backend_event_contract_pending')
  if (input.featureEnabled !== true) blockers.push('feature_disabled')

  return {
    captureIntent: true,
    eligibleForFutureDelivery: blockers.length === 0,
    idempotencyKey: `${CRM_QUALIFICATION_SIGNAL_KEY_PREFIX}${leadId}`,
    blockers,
  }
}

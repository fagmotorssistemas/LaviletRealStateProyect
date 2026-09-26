import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectsWhatsappAdsConsentGrant,
  detectsWhatsappAdsConsentRevoke,
  WA_ADS_CONSENT_SCOPE,
} from '@/lib/meta/waLeadSubmittedConsent'
import {
  maybeRegisterWaLeadSubmitted,
  type WaLeadSubmittedResult,
} from '@/lib/meta/waLeadSubmittedDelivery'
import { linkOrphanEvidenceAndStampCommercialInterest } from '@/lib/meta/waLeadSubmittedEvidenceLink'

/**
 * Aplica grant/revoke de publicidad WhatsApp desde el mensaje del cliente
 * (evidencia fecha/mensaje/alcance). No precarga aceptación ni envía mensajes.
 */
export async function applyWhatsappAdsConsentFromClientMessage(input: {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>
  leadId: string
  currentMessage: string
  lead?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  let lead = { ...(input.lead || {}) }
  if (detectsWhatsappAdsConsentRevoke(input.currentMessage)) {
    try {
      await input.rpc('lv_set_whatsapp_meta_ads_consent', {
        p_lead_id: input.leadId,
        p_ads_consent: false,
        p_reason: 'revocó publicidad por WhatsApp',
        p_evidence_message: String(input.currentMessage).slice(0, 500),
        p_scope: WA_ADS_CONSENT_SCOPE,
      })
      lead = {
        ...lead,
        meta_ads_consent: false,
        meta_ads_consent_evidence_message: String(input.currentMessage).slice(0, 500),
        meta_ads_consent_scope: WA_ADS_CONSENT_SCOPE,
        meta_ads_consent_evidence_at: new Date().toISOString(),
      }
    } catch {
      /* soft-fail */
    }
    return lead
  }
  if (detectsWhatsappAdsConsentGrant(input.currentMessage, { fromBot: false })) {
    try {
      await input.rpc('lv_set_whatsapp_meta_ads_consent', {
        p_lead_id: input.leadId,
        p_ads_consent: true,
        p_reason: 'aceptó publicidad por WhatsApp',
        p_evidence_message: String(input.currentMessage).slice(0, 500),
        p_scope: WA_ADS_CONSENT_SCOPE,
      })
      lead = {
        ...lead,
        meta_ads_consent: true,
        meta_ads_consent_evidence_message: String(input.currentMessage).slice(0, 500),
        meta_ads_consent_scope: WA_ADS_CONSENT_SCOPE,
        meta_ads_consent_evidence_at: new Date().toISOString(),
      }
    } catch {
      /* soft-fail */
    }
  }
  return lead
}

/**
 * Evaluación LeadSubmitted del turno actual.
 * Independiente de que el bot responda: sirve para bot_paused / outside_test_lead.
 * Interés del turno = mensaje actual (+ scoreEvents). Si el mensaje comercial
 * llegó antes de existir el lead CRM, enlaza evidencia huérfana y sella interés
 * reciente (ventana corta) para que un grant posterior pueda convertir.
 * La aceptación sola no es interés. No convierte saludos por historial antiguo.
 */
export async function evaluateWaLeadSubmittedForCurrentTurn(input: {
  admin: SupabaseClient
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  lead: Record<string, unknown> & { id: string }
  contactId: number | string
  currentMessage: string
  sourceMessageSentAt?: string | null
  scoreEvents?: string[] | null
  recentOfferText?: string | null
  tenantId?: string | null
  projectId?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<WaLeadSubmittedResult> {
  let lead = { ...input.lead }
  if (input.rpc) {
    lead = {
      ...lead,
      ...(await applyWhatsappAdsConsentFromClientMessage({
        rpc: input.rpc,
        leadId: String(lead.id),
        currentMessage: input.currentMessage,
        lead,
      })),
    }
  }

  // Evidencia webhook puede preceder al lead: enlazar y recuperar sello reciente.
  try {
    const repaired = await linkOrphanEvidenceAndStampCommercialInterest({
      admin: input.admin,
      rpc: input.rpc,
      leadId: String(lead.id),
      contactId: input.contactId,
      kommoId:
        typeof lead.kommo_id === 'number' ? lead.kommo_id : null,
      recentOfferText: input.recentOfferText,
    })
    if (repaired.stampedAt) {
      lead = {
        ...lead,
        meta_wa_commercial_interest_at: repaired.stampedAt,
      }
    }
  } catch {
    /* soft-fail */
  }

  // Releer evidencia/consent desde DB (fuente autorizada; no confiar solo en memoria).
  const { data: fresh } = await input.admin
    .from('leads')
    .select(
      'id, phone, name, email, meta_ads_consent, meta_ads_consent_evidence_message, meta_ads_consent_evidence_at, meta_ads_consent_scope, meta_wa_lead_submitted_event_id, meta_wa_commercial_interest_at, tenant_id, project_id',
    )
    .eq('id', lead.id)
    .maybeSingle()

  const row = (fresh || lead) as Record<string, unknown>
  return maybeRegisterWaLeadSubmitted({
    admin: input.admin,
    lead: {
      id: String(row.id || lead.id),
      phone: (row.phone as string | null) ?? null,
      name: (row.name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      meta_ads_consent: row.meta_ads_consent as boolean | null,
      meta_ads_consent_evidence_message: row.meta_ads_consent_evidence_message as
        | string
        | null,
      meta_ads_consent_evidence_at: row.meta_ads_consent_evidence_at as string | null,
      meta_ads_consent_scope: row.meta_ads_consent_scope as string | null,
      tenant_id:
        (row.tenant_id as string | null) || input.tenantId || null,
      project_id:
        (row.project_id as string | null) || input.projectId || null,
      meta_wa_lead_submitted_event_id: row.meta_wa_lead_submitted_event_id as
        | string
        | null,
      meta_wa_commercial_interest_at:
        (row.meta_wa_commercial_interest_at as string | null) ||
        (lead.meta_wa_commercial_interest_at as string | null) ||
        null,
    },
    contactId: input.contactId,
    currentMessage: input.currentMessage,
    sourceMessageSentAt: input.sourceMessageSentAt,
    scoreEvents: input.scoreEvents,
    recentOfferText: input.recentOfferText,
    env: input.env,
  })
}

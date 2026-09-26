import 'server-only'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OUTBOX_FLUSHABLE_STATUS,
  persistMetaConversion,
} from '@/lib/meta/localOutbox'
import {
  WA_LEAD_SUBMITTED_EVENT,
  buildWaLeadSubmittedPayload,
  planWaLeadSubmitted,
  waLeadSubmittedIdempotencyKey,
  type WaLeadSubmittedBlocker,
} from '@/lib/meta/waLeadSubmittedContract'
import { evaluateWaLeadSubmittedEligibility } from '@/lib/meta/waLeadSubmittedEligibility'
import { linkOrphanEvidenceAndStampCommercialInterest } from '@/lib/meta/waLeadSubmittedEvidenceLink'
import { decideWaLeadSubmittedConsentGate } from '@/lib/meta/waLeadSubmittedConsentGate'
import {
  isWaLeadSubmittedDeliveryEnabled,
  isWaLeadSubmittedEnabled,
} from '@/lib/meta/waLeadSubmittedFlags'
import { resolveDeliveryLane } from '@/lib/meta/deliveryLane'

export type WaLeadSubmittedResult = {
  attempted: boolean
  /** skipped=flag OFF; blocked=motivo visible; enqueued=cola local; duplicate=mismo event_id */
  stage: 'skipped' | 'blocked' | 'enqueued' | 'duplicate'
  reason: string | null
  eventId: string | null
  blockers: WaLeadSubmittedBlocker[]
  retainAttention: boolean
}

async function logConversion(
  admin: SupabaseClient | null,
  input: {
    stage: string
    reason?: string | null
    leadId?: string | null
    contactId?: string | null
    tenantId?: string | null
    projectId?: string | null
    eventId?: string | null
    idempotencyKey?: string | null
    deliveryLane?: string | null
    details?: Record<string, unknown>
  },
) {
  if (!admin) return
  try {
    await admin.rpc('lv_log_meta_conversion', {
      p_stage: input.stage,
      p_event_name: WA_LEAD_SUBMITTED_EVENT,
      p_reason: input.reason ?? null,
      p_lead_id: input.leadId ?? null,
      p_contact_id: input.contactId ?? null,
      p_tenant_id: input.tenantId ?? null,
      p_project_id: input.projectId ?? null,
      p_event_id: input.eventId ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_delivery_lane: input.deliveryLane ?? null,
      p_details: input.details ?? {},
    })
  } catch {
    // Bitácora best-effort: nunca interrumpe CRM.
  }
}

/**
 * CTWA solo desde lv_whatsapp_ctwa_attribution con aislamiento tenant+proyecto+contacto.
 * Nunca acepta clid del navegador ni de payloads de cliente.
 */
export async function resolveScopedCtwaClid(
  admin: SupabaseClient,
  opts: {
    tenantId: string | null | undefined
    projectId: string | null | undefined
    contactId: string
  },
): Promise<string | null> {
  const tenantId = String(opts.tenantId || '').trim()
  const projectId = String(opts.projectId || '').trim()
  const contactId = String(opts.contactId || '').trim()
  if (!tenantId || !projectId || !contactId) return null

  const { data, error } = await admin
    .from('lv_whatsapp_ctwa_attribution')
    .select('ctwa_clid, tenant_id, project_id, contact_id')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('contact_id', contactId)
    .order('captured_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data?.ctwa_clid) return null
  if (
    String(data.tenant_id) !== tenantId ||
    String(data.project_id) !== projectId ||
    String(data.contact_id) !== contactId
  ) {
    return null
  }
  return String(data.ctwa_clid).trim() || null
}

/**
 * Tras interés comercial del turno actual: evalúa LeadSubmitted BM.
 * Soft-fail. No inventa consentimiento ni CTWA. Default flags OFF.
 *
 * Consentimiento/CTWA posteriores: un turno nuevo con interés comercial puede
 * encolar si ya hay evidencia+CTWA. No hay reenvío histórico indiscriminado.
 * event_id se conserva en reintentos (idempotency wa_lead_submitted:{lead_id}).
 */
export async function maybeRegisterWaLeadSubmitted(input: {
  admin?: SupabaseClient | null
  lead: {
    id: string
    phone?: string | null
    name?: string | null
    email?: string | null
    meta_ads_consent?: boolean | null
    meta_ads_consent_evidence_message?: string | null
    meta_ads_consent_evidence_at?: string | null
    meta_ads_consent_scope?: string | null
    tenant_id?: string | null
    project_id?: string | null
    meta_wa_lead_submitted_event_id?: string | null
    meta_wa_commercial_interest_at?: string | null
  }
  contactId: number | string
  currentMessage: string
  sourceMessageSentAt?: string | null
  scoreEvents?: string[] | null
  /** Última oferta bot/asesor con unidades (contexto; no backfill). */
  recentOfferText?: string | null
  history?: unknown
  behaviorSignals?: unknown
  env?: NodeJS.ProcessEnv
}): Promise<WaLeadSubmittedResult> {
  const env = input.env || process.env
  if (!isWaLeadSubmittedEnabled(env)) {
    return {
      attempted: false,
      stage: 'skipped',
      reason: 'wa_lead_submitted_inactive',
      eventId: null,
      blockers: ['wa_lead_submitted_inactive'],
      retainAttention: true,
    }
  }

  const admin = input.admin || null
  const contactId = String(input.contactId)
  const idempotencyKey = waLeadSubmittedIdempotencyKey(input.lead.id)

  // Fuente autorizada: consent + sello de interés (antes de elegibilidad).
  let consentRow: Record<string, unknown> | null = null
  let consentError: { message?: string } | null = null
  if (admin) {
    const read = await admin
      .from('leads')
      .select(
        'meta_ads_consent, meta_ads_consent_evidence_message, meta_ads_consent_evidence_at, meta_ads_consent_scope, tenant_id, project_id, meta_wa_lead_submitted_event_id, meta_wa_commercial_interest_at, phone, name, email',
      )
      .eq('id', input.lead.id)
      .maybeSingle()
    consentRow = (read.data as Record<string, unknown> | null) || null
    consentError = read.error
    if (consentRow?.meta_wa_commercial_interest_at) {
      input.lead.meta_wa_commercial_interest_at = String(
        consentRow.meta_wa_commercial_interest_at,
      )
    }
  }

  const tenantIdForCtwa =
    (consentRow?.tenant_id as string | null) || input.lead.tenant_id || null
  const projectIdForCtwa =
    (consentRow?.project_id as string | null) || input.lead.project_id || null

  // CTWA scoped antes de elegibilidad: habilita «más info sobre esto» con anuncio verificado.
  const ctwaClidEarly =
    admin && tenantIdForCtwa && projectIdForCtwa
      ? await resolveScopedCtwaClid(admin, {
          tenantId: tenantIdForCtwa,
          projectId: projectIdForCtwa,
          contactId,
        })
      : null
  const verifiedAdContext = Boolean(ctwaClidEarly)

  // Con CTWA ya resuelto: sellar interés desde evidencia huérfana (p. ej. «más info»).
  if (admin && !input.lead.meta_wa_commercial_interest_at) {
    try {
      const repaired = await linkOrphanEvidenceAndStampCommercialInterest({
        admin,
        leadId: input.lead.id,
        contactId,
        recentOfferText: input.recentOfferText,
        verifiedAdContext,
      })
      if (repaired.stampedAt) {
        input.lead.meta_wa_commercial_interest_at = repaired.stampedAt
      }
    } catch {
      /* soft-fail */
    }
  }

  // Interés del turno, o aceptación + sello reciente (grant ≠ interés).
  const eligibility = evaluateWaLeadSubmittedEligibility({
    currentMessage: input.currentMessage,
    scoreEvents: input.scoreEvents,
    recentOfferText: input.recentOfferText,
    commercialInterestAt: input.lead.meta_wa_commercial_interest_at,
    verifiedAdContext,
  })

  if (!eligibility.eligibleForConversion) {
    await logConversion(admin, {
      stage: 'blocked',
      reason: eligibility.blocker,
      leadId: input.lead.id,
      contactId,
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      details: {
        greeting_only: eligibility.greetingOnly,
        commercial_interest: eligibility.commercialInterest,
        turn_commercial_interest: eligibility.turnCommercialInterest,
        used_recent_interest_with_consent:
          eligibility.usedRecentInterestWithConsent,
        verified_ad_context: verifiedAdContext,
      },
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: eligibility.blocker,
      eventId: null,
      blockers: eligibility.blocker
        ? [eligibility.blocker as WaLeadSubmittedBlocker]
        : ['commercial_interest_required'],
      retainAttention: true,
    }
  }

  // Sellar interés del turno actual (no el grant de consentimiento).
  if (admin && eligibility.turnCommercialInterest) {
    const sourceMs = Date.parse(String(input.sourceMessageSentAt || ''))
    const stamped = Number.isFinite(sourceMs)
      ? new Date(sourceMs).toISOString()
      : new Date().toISOString()
    try {
      await admin
        .from('leads')
        .update({ meta_wa_commercial_interest_at: stamped })
        .eq('id', input.lead.id)
      input.lead.meta_wa_commercial_interest_at = stamped
    } catch {
      /* soft-fail */
    }
  }

  if (!admin) {
    return {
      attempted: true,
      stage: 'blocked',
      reason: 'persist_unavailable',
      eventId: null,
      blockers: [],
      retainAttention: true,
    }
  }

  const gate = decideWaLeadSubmittedConsentGate({
    queryOk: !consentError,
    leadFound: Boolean(consentRow),
    metaAdsConsent: consentRow?.meta_ads_consent as boolean | null | undefined,
    evidenceMessage: consentRow?.meta_ads_consent_evidence_message as
      | string
      | null,
    evidenceAt: consentRow?.meta_ads_consent_evidence_at
      ? String(consentRow.meta_ads_consent_evidence_at)
      : null,
    evidenceScope: consentRow?.meta_ads_consent_scope as string | null,
    leadTenantId: consentRow?.tenant_id as string | null | undefined,
    leadProjectId: consentRow?.project_id as string | null | undefined,
    eventTenantId: input.lead.tenant_id,
    eventProjectId: input.lead.project_id,
    eventContactId: contactId,
  })

  // Revocación: cancelar outbox LS pendiente antes de cualquier envío (defensa + bitácora).
  // El RPC lv_record_meta_ads_consent(false) ya cancela; esto cubre carrera/estado local.
  if (gate.action === 'cancel_revoked') {
    try {
      await admin
        .from('meta_capi_outbox')
        .update({
          status: 'cancelled',
          last_error: 'ads_consent_revoked',
        })
        .eq('idempotency_key', idempotencyKey)
        .in('status', ['pending', 'needs_review', 'review_hold'])
    } catch {
      /* soft-fail */
    }
    await logConversion(admin, {
      stage: 'blocked',
      reason: 'ads_consent_revoked',
      leadId: input.lead.id,
      contactId,
      tenantId:
        (consentRow?.tenant_id as string | null) || input.lead.tenant_id || null,
      projectId:
        (consentRow?.project_id as string | null) || input.lead.project_id || null,
      idempotencyKey,
      details: { gate: gate.action },
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: 'ads_consent_revoked',
      eventId: null,
      blockers: ['ads_consent_required'],
      retainAttention: true,
    }
  }

  const tenantId =
    (consentRow?.tenant_id as string | null) || input.lead.tenant_id || null
  const projectId =
    (consentRow?.project_id as string | null) || input.lead.project_id || null

  // Reutilizar CTWA ya resuelto (mismo aislamiento tenant+proyecto+contacto).
  const ctwaClid = ctwaClidEarly

  const wabaId = String(env.META_WABA_ID || '').trim()
  const messagingDatasetId = String(env.META_MESSAGING_DATASET_ID || '').trim()
  if (wabaId && messagingDatasetId && wabaId === messagingDatasetId) {
    await logConversion(admin, {
      stage: 'blocked',
      reason: 'waba_equals_messaging_dataset_misconfig',
      leadId: input.lead.id,
      contactId,
      tenantId,
      projectId,
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: 'waba_equals_messaging_dataset_misconfig',
      eventId: null,
      blockers: ['messaging_dataset_id_required', 'whatsapp_waba_id_required'],
      retainAttention: true,
    }
  }

  // No inventar true en BD: gate allow incluye null/ausente; false ya canceló arriba.
  const adsConsentOk = gate.action === 'allow_send'

  const deliveryEnabled = isWaLeadSubmittedDeliveryEnabled(env)
  const plan = planWaLeadSubmitted({
    featureEnabled: true,
    deliveryEnabled,
    greetingOnly: false,
    commercialInterest: true,
    adsConsent: adsConsentOk,
    ctwaClid,
    wabaId,
    messagingDatasetId,
  })

  await logConversion(admin, {
    stage: 'evaluated',
    reason: plan.blockers[0] || null,
    leadId: input.lead.id,
    contactId,
    tenantId,
    projectId,
    details: {
      commercial_interest: true,
      has_ctwa: Boolean(ctwaClid),
      ads_consent: adsConsentOk,
      delivery_enabled: deliveryEnabled,
      blockers: plan.blockers,
      gate: gate.action,
    },
  })

  if (!plan.canEnqueuePending) {
    const reason =
      gate.action !== 'allow_send'
        ? gate.reason
        : plan.blockers.find((b) => b !== 'wa_lead_submitted_delivery_inactive') ||
          plan.blockers[0] ||
          'blocked'
    await logConversion(admin, {
      stage: 'blocked',
      reason,
      leadId: input.lead.id,
      contactId,
      tenantId,
      projectId,
      details: { blockers: plan.blockers, gate: gate.action },
    })
    // No sellar event_id ni inventar éxito: permite reintento cuando llegue CTWA/consent.
    return {
      attempted: true,
      stage: 'blocked',
      reason,
      eventId: null,
      blockers: plan.blockers,
      retainAttention: true,
    }
  }

  const existingEventId =
    (consentRow?.meta_wa_lead_submitted_event_id as string | null) ||
    input.lead.meta_wa_lead_submitted_event_id ||
    null

  if (existingEventId) {
    // Conservar event_id; si quedó needs_review, subir a pending con el mismo id.
    const { data: outbox } = await admin
      .from('meta_capi_outbox')
      .select('id, status, event_id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (
      outbox &&
      (outbox.status === 'needs_review' || outbox.status === 'review_hold') &&
      ctwaClid
    ) {
      const { error: upgradeError } = await admin
        .from('meta_capi_outbox')
        .update({
          status: OUTBOX_FLUSHABLE_STATUS,
          last_error: null,
          payload: buildWaLeadSubmittedPayload({
            phone: (consentRow?.phone as string | null) || input.lead.phone,
            fullName: (consentRow?.name as string | null) || input.lead.name,
            email: (consentRow?.email as string | null) || input.lead.email,
            leadId: input.lead.id,
            tenantId,
            projectId,
            contactId,
            ctwaClid,
            wabaId,
            messagingDatasetId,
          }),
        })
        .eq('id', outbox.id)
        .in('status', ['needs_review', 'review_hold'])

      if (!upgradeError) {
        await logConversion(admin, {
          stage: 'enqueued',
          reason: 'upgraded_from_review',
          leadId: input.lead.id,
          contactId,
          tenantId,
          projectId,
          eventId: String(outbox.event_id || existingEventId),
          idempotencyKey,
          details: { delivery_enabled: deliveryEnabled },
        })
        return {
          attempted: true,
          stage: 'enqueued',
          reason: null,
          eventId: String(outbox.event_id || existingEventId),
          blockers: deliveryEnabled ? [] : ['wa_lead_submitted_delivery_inactive'],
          retainAttention: true,
        }
      }
    }

    await logConversion(admin, {
      stage: 'enqueued',
      reason: 'duplicate',
      leadId: input.lead.id,
      contactId,
      tenantId,
      projectId,
      eventId: String(existingEventId),
      idempotencyKey,
    })
    return {
      attempted: true,
      stage: 'duplicate',
      reason: 'already_registered',
      eventId: String(existingEventId),
      blockers: [],
      retainAttention: true,
    }
  }

  const eventId = randomUUID()
  const commercialAt = Date.parse(String(input.lead.meta_wa_commercial_interest_at || input.sourceMessageSentAt || ''))
  if (!Number.isFinite(commercialAt)) {
    return { attempted: true, stage: 'blocked', reason: 'commercial_interest_time_required', eventId: null, blockers: plan.blockers, retainAttention: true }
  }
  const eventTime = Math.floor(commercialAt / 1000)
  const payload = buildWaLeadSubmittedPayload({
    phone: (consentRow?.phone as string | null) || input.lead.phone,
    fullName: (consentRow?.name as string | null) || input.lead.name,
    email: (consentRow?.email as string | null) || input.lead.email,
    leadId: input.lead.id,
    tenantId,
    projectId,
    contactId,
    ctwaClid: ctwaClid!,
    wabaId,
    messagingDatasetId,
  })

  try {
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      'lv_register_wa_lead_submitted_intent',
      {
        p_lead_id: input.lead.id,
        p_event_id: eventId,
        p_event_time: eventTime,
        p_lane: resolveDeliveryLane(env),
        p_payload: payload,
        p_status: OUTBOX_FLUSHABLE_STATUS,
      },
    )

    let finalEventId: string = eventId
    let inserted = true
    if (!rpcError && rpcResult && typeof rpcResult === 'object') {
      const row = rpcResult as Record<string, unknown>
      if (row.ok === false) {
        await logConversion(admin, {
          stage: 'blocked',
          reason: String(row.reason || 'rpc_rejected'),
          leadId: input.lead.id,
          contactId,
          tenantId,
          projectId,
          details: { rpc: row },
        })
        return {
          attempted: true,
          stage: 'blocked',
          reason: String(row.reason || 'rpc_rejected'),
          eventId: null,
          blockers: plan.blockers,
          retainAttention: true,
        }
      }
      finalEventId = String(row.event_id || eventId)
      inserted = row.inserted === true
    } else {
      const persisted = await persistMetaConversion(admin, {
        eventName: WA_LEAD_SUBMITTED_EVENT,
        idempotencyKey,
        eventId,
        eventTime,
        payload,
        leadId: input.lead.id,
        adsConsentRequired: true,
        status: OUTBOX_FLUSHABLE_STATUS,
      })
      finalEventId = persisted.eventId
      inserted = persisted.inserted
      await admin
        .from('leads')
        .update({
          meta_wa_lead_submitted_event_id: finalEventId,
          meta_wa_lead_submitted_event_time: eventTime,
          meta_wa_lead_submitted_at: new Date().toISOString(),
        })
        .eq('id', input.lead.id)
        .is('meta_wa_lead_submitted_event_id', null)
    }

    await logConversion(admin, {
      stage: 'enqueued',
      reason: inserted ? (deliveryEnabled ? 'pending' : 'pending_delivery_off') : 'duplicate',
      leadId: input.lead.id,
      contactId,
      tenantId,
      projectId,
      eventId: finalEventId,
      idempotencyKey,
      details: { inserted, delivery_enabled: deliveryEnabled },
    })

    return {
      attempted: true,
      stage: inserted ? 'enqueued' : 'duplicate',
      reason: inserted ? null : 'duplicate',
      eventId: finalEventId,
      blockers: deliveryEnabled ? [] : ['wa_lead_submitted_delivery_inactive'],
      retainAttention: true,
    }
  } catch {
    await logConversion(admin, {
      stage: 'blocked',
      reason: 'persist_failed',
      leadId: input.lead.id,
      contactId,
      tenantId,
      projectId,
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: 'persist_failed',
      eventId: null,
      blockers: plan.blockers,
      retainAttention: true,
    }
  }
}

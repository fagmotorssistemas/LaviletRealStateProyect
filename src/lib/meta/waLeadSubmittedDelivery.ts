import 'server-only'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStoredCtwaClid } from '@/lib/integrations/automation/ctwa-lead-store'
import {
  OUTBOX_NEEDS_REVIEW_STATUS,
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
import { decideWaLeadSubmittedConsentGate } from '@/lib/meta/waLeadSubmittedConsentGate'
import {
  isWaLeadSubmittedDeliveryEnabled,
  isWaLeadSubmittedEnabled,
} from '@/lib/meta/waLeadSubmittedFlags'

export type WaLeadSubmittedResult = {
  attempted: boolean
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
 * Tras calificación comercial: evalúa LeadSubmitted BM.
 * Soft-fail. No inventa consentimiento ni CTWA. Default flags OFF.
 */
export async function maybeRegisterWaLeadSubmitted(input: {
  admin?: SupabaseClient | null
  lead: {
    id: string
    phone?: string | null
    name?: string | null
    email?: string | null
    meta_ads_consent?: boolean | null
    tenant_id?: string | null
    project_id?: string | null
    meta_wa_lead_submitted_event_id?: string | null
  }
  contactId: number | string
  currentMessage: string
  scoreEvents?: string[] | null
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

  if (input.lead.meta_wa_lead_submitted_event_id) {
    return {
      attempted: true,
      stage: 'duplicate',
      reason: 'already_registered',
      eventId: String(input.lead.meta_wa_lead_submitted_event_id),
      blockers: [],
      retainAttention: true,
    }
  }

  // Solo interés del turno actual (texto / score events). Engagement histórico no convierte.
  const eligibility = evaluateWaLeadSubmittedEligibility({
    currentMessage: input.currentMessage,
    scoreEvents: input.scoreEvents,
  })

  const ctwaClid = await getStoredCtwaClid(Number(input.contactId)).catch(() => null)
  // WABA ≠ dataset: IDs distintos; nunca usar uno como el otro ni fallback al pixel web.
  const wabaId = String(env.META_WABA_ID || '').trim()
  const messagingDatasetId = String(env.META_MESSAGING_DATASET_ID || '').trim()
  if (wabaId && messagingDatasetId && wabaId === messagingDatasetId) {
    await logConversion(input.admin || null, {
      stage: 'blocked',
      reason: 'waba_equals_messaging_dataset_misconfig',
      leadId: input.lead.id,
      contactId: String(input.contactId),
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      details: { note: 'META_WABA_ID no puede ser el dataset Graph' },
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
  const deliveryEnabled = isWaLeadSubmittedDeliveryEnabled(env)

  const plan = planWaLeadSubmitted({
    featureEnabled: true,
    deliveryEnabled,
    greetingOnly: eligibility.greetingOnly,
    commercialInterest: eligibility.commercialInterest,
    adsConsent: input.lead.meta_ads_consent === true,
    ctwaClid,
    wabaId,
    messagingDatasetId,
  })

  const admin = input.admin || null
  const contactId = String(input.contactId)

  await logConversion(admin, {
    stage: 'evaluated',
    reason: eligibility.blocker || plan.blockers[0] || null,
    leadId: input.lead.id,
    contactId,
    tenantId: input.lead.tenant_id,
    projectId: input.lead.project_id,
    details: {
      greeting_only: eligibility.greetingOnly,
      commercial_interest: eligibility.commercialInterest,
      has_ctwa: Boolean(ctwaClid),
      ads_consent: input.lead.meta_ads_consent === true,
      blockers: plan.blockers,
    },
  })

  if (!eligibility.eligibleForConversion) {
    await logConversion(admin, {
      stage: 'blocked',
      reason: eligibility.blocker,
      leadId: input.lead.id,
      contactId,
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      details: { blockers: plan.blockers },
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: eligibility.blocker,
      eventId: null,
      blockers: plan.blockers,
      retainAttention: true,
    }
  }

  if (!plan.canEnqueuePending) {
    const reason = plan.blockers[0] || 'blocked'
    // Persistencia needs_review solo cuando hay interés + feature on pero faltan Meta IDs/consent/delivery.
    // Sin consent o sin interés no se escribe outbox (evita falsas conversiones).
    const persistBlocked =
      plan.blockers.includes('whatsapp_ctwa_clid_required') ||
      plan.blockers.includes('whatsapp_waba_id_required') ||
      plan.blockers.includes('messaging_dataset_id_required') ||
      plan.blockers.includes('wa_lead_submitted_delivery_inactive')

    if (persistBlocked && admin && input.lead.meta_ads_consent === true) {
      const eventId = randomUUID()
      const eventTime = Math.floor(Date.now() / 1000)
      const payload = buildWaLeadSubmittedPayload({
        phone: input.lead.phone,
        fullName: input.lead.name,
        email: input.lead.email,
        leadId: input.lead.id,
        tenantId: input.lead.tenant_id,
        projectId: input.lead.project_id,
        contactId,
        ctwaClid: ctwaClid || '',
        wabaId: wabaId || '',
        messagingDatasetId: messagingDatasetId || '',
        blockReason: reason,
      })
      try {
        const persisted = await persistMetaConversion(admin, {
          eventName: WA_LEAD_SUBMITTED_EVENT,
          idempotencyKey: waLeadSubmittedIdempotencyKey(input.lead.id),
          eventId,
          eventTime,
          payload,
          leadId: input.lead.id,
          adsConsentRequired: true,
          status: OUTBOX_NEEDS_REVIEW_STATUS,
          lastError: reason,
        })
        await admin
          .from('leads')
          .update({
            meta_wa_lead_submitted_event_id: persisted.eventId,
            meta_wa_lead_submitted_event_time: eventTime,
            meta_wa_lead_submitted_at: new Date().toISOString(),
          })
          .eq('id', input.lead.id)
          .is('meta_wa_lead_submitted_event_id', null)
        await logConversion(admin, {
          stage: 'blocked',
          reason,
          leadId: input.lead.id,
          contactId,
          tenantId: input.lead.tenant_id,
          projectId: input.lead.project_id,
          eventId: persisted.eventId,
          idempotencyKey: waLeadSubmittedIdempotencyKey(input.lead.id),
          details: { blockers: plan.blockers, status: OUTBOX_NEEDS_REVIEW_STATUS },
        })
        return {
          attempted: true,
          stage: 'blocked',
          reason,
          eventId: persisted.eventId,
          blockers: plan.blockers,
          retainAttention: true,
        }
      } catch {
        // soft-fail
      }
    }

    await logConversion(admin, {
      stage: 'blocked',
      reason,
      leadId: input.lead.id,
      contactId,
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      details: { blockers: plan.blockers },
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason,
      eventId: null,
      blockers: plan.blockers,
      retainAttention: true,
    }
  }

  if (!admin || !ctwaClid) {
    return {
      attempted: true,
      stage: 'blocked',
      reason: 'persist_unavailable',
      eventId: null,
      blockers: plan.blockers,
      retainAttention: true,
    }
  }

  // Revocación / vigencia: consentimiento exactamente true en fuente autorizada.
  const { data: consentRow, error: consentError } = await admin
    .from('leads')
    .select('meta_ads_consent, tenant_id, project_id, meta_wa_lead_submitted_event_id')
    .eq('id', input.lead.id)
    .maybeSingle()

  const gate = decideWaLeadSubmittedConsentGate({
    queryOk: !consentError,
    leadFound: Boolean(consentRow),
    metaAdsConsent: consentRow?.meta_ads_consent,
    leadTenantId: consentRow?.tenant_id as string | null | undefined,
    leadProjectId: consentRow?.project_id as string | null | undefined,
    eventTenantId: input.lead.tenant_id,
    eventProjectId: input.lead.project_id,
    eventContactId: contactId,
  })

  if (gate.action !== 'allow_send') {
    await logConversion(admin, {
      stage: 'blocked',
      reason: gate.reason,
      leadId: input.lead.id,
      contactId,
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      details: { revalidated: true, gate: gate.action },
    })
    return {
      attempted: true,
      stage: 'blocked',
      reason: gate.reason,
      eventId: null,
      blockers: ['ads_consent_required'],
      retainAttention: true,
    }
  }
  if (consentRow!.meta_wa_lead_submitted_event_id) {
    return {
      attempted: true,
      stage: 'duplicate',
      reason: 'already_registered',
      eventId: String(consentRow!.meta_wa_lead_submitted_event_id),
      blockers: [],
      retainAttention: true,
    }
  }
  // Aislamiento tenant/proyecto: el payload lleva el scope del lead, no inventado.
  const tenantId = (consentRow!.tenant_id as string | null) || input.lead.tenant_id || null
  const projectId = (consentRow!.project_id as string | null) || input.lead.project_id || null

  const eventId = randomUUID()
  const eventTime = Math.floor(Date.now() / 1000)
  const payload = buildWaLeadSubmittedPayload({
    phone: input.lead.phone,
    fullName: input.lead.name,
    email: input.lead.email,
    leadId: input.lead.id,
    tenantId,
    projectId,
    contactId,
    ctwaClid,
    wabaId,
    messagingDatasetId,
  })

  try {
    // Prefer RPC durable si existe; fallback insert.
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      'lv_register_wa_lead_submitted_intent',
      {
        p_lead_id: input.lead.id,
        p_event_id: eventId,
        p_event_time: eventTime,
        p_lane:
          String(env.META_CAPI_DELIVERY_LANE || '').toLowerCase() === 'test'
            ? 'test'
            : 'live',
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
        idempotencyKey: waLeadSubmittedIdempotencyKey(input.lead.id),
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
      reason: inserted ? 'pending' : 'duplicate',
      leadId: input.lead.id,
      contactId,
      tenantId: input.lead.tenant_id,
      projectId: input.lead.project_id,
      eventId: finalEventId,
      idempotencyKey: waLeadSubmittedIdempotencyKey(input.lead.id),
      details: { inserted },
    })

    return {
      attempted: true,
      stage: inserted ? 'enqueued' : 'duplicate',
      reason: inserted ? null : 'duplicate',
      eventId: finalEventId,
      blockers: [],
      retainAttention: true,
    }
  } catch {
    await logConversion(admin, {
      stage: 'blocked',
      reason: 'persist_failed',
      leadId: input.lead.id,
      contactId,
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

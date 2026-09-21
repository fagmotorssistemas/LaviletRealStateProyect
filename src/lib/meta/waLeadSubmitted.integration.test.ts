/**
 * Integración LeadSubmitted BM (CRM → outbox) con mocks.
 * Flags OFF por defecto; no llama Nest ni Meta.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  maybeRegisterWaLeadSubmitted,
  resolveScopedCtwaClid,
} from './waLeadSubmittedDelivery'
import { decideWaLeadSubmittedConsentGate } from './waLeadSubmittedConsentGate'
import { planWaLeadSubmitted } from './waLeadSubmittedContract'
import { evaluateWaLeadSubmittedEligibility } from './waLeadSubmittedEligibility'
import { hasVerifiableWaAdsConsentEvidence } from './waLeadSubmittedConsentEvidence'

type Row = Record<string, unknown>

function mockAdmin(state: {
  lead: Row
  ctwaRows?: Row[]
  outbox?: Row | null
  logs?: Row[]
  inserts?: Row[]
}) {
  const logs = state.logs || []
  const inserts = state.inserts || []
  return {
    from(table: string) {
      return {
        select(_cols?: string) {
          const chain = {
            eq(col: string, val: unknown) {
              void col
              void val
              return chain
            },
            in() {
              return chain
            },
            order() {
              return chain
            },
            limit() {
              return chain
            },
            is() {
              return chain
            },
            async maybeSingle() {
              if (table === 'leads') return { data: state.lead, error: null }
              if (table === 'lv_whatsapp_ctwa_attribution') {
                const row = (state.ctwaRows || [])[0] || null
                return { data: row, error: null }
              }
              if (table === 'meta_capi_outbox') return { data: state.outbox || null, error: null }
              return { data: null, error: null }
            },
            async update(patch: Row) {
              if (table === 'leads') Object.assign(state.lead, patch)
              if (table === 'meta_capi_outbox' && state.outbox) Object.assign(state.outbox, patch)
              return {
                eq() {
                  return {
                    is() {
                      return { error: null }
                    },
                    in() {
                      return { error: null }
                    },
                  }
                },
              }
            },
          }
          return chain
        },
      }
    },
    async rpc(name: string, args: Row) {
      if (name === 'lv_log_meta_conversion') {
        logs.push({ name, ...args })
        return { data: 'log-id', error: null }
      }
      if (name === 'lv_register_wa_lead_submitted_intent') {
        if (state.lead.meta_ads_consent !== true) {
          return { data: { ok: false, reason: 'ads_consent_required' }, error: null }
        }
        if (!state.lead.meta_ads_consent_evidence_message) {
          return {
            data: { ok: false, reason: 'ads_consent_evidence_message_required' },
            error: null,
          }
        }
        if (state.lead.meta_wa_lead_submitted_event_id) {
          return {
            data: {
              ok: true,
              inserted: false,
              event_id: state.lead.meta_wa_lead_submitted_event_id,
            },
            error: null,
          }
        }
        state.lead.meta_wa_lead_submitted_event_id = args.p_event_id
        inserts.push(args)
        return {
          data: { ok: true, inserted: true, event_id: args.p_event_id },
          error: null,
        }
      }
      return { data: null, error: { message: `unknown rpc ${name}` } }
    },
  }
}

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LEAD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const envOn = {
  META_WA_LEAD_SUBMITTED_ENABLED: 'true',
  META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED: 'false',
  META_WABA_ID: '1410020224338488',
  META_MESSAGING_DATASET_ID: '4419657838288963',
} as NodeJS.ProcessEnv

describe('waLeadSubmitted integration', () => {
  it('caso elegible: encola pending con flags delivery OFF (Nest no claima)', async () => {
    const lead = {
      id: LEAD_ID,
      phone: '+593999',
      name: 'Ana',
      email: null,
      meta_ads_consent: true,
      meta_ads_consent_evidence_message: 'Acepto recibir publicidad y anuncios',
      meta_ads_consent_evidence_at: '2026-09-21T12:00:00.000Z',
      meta_ads_consent_scope: 'whatsapp_ads',
      tenant_id: TENANT_A,
      project_id: PROJECT_A,
      meta_wa_lead_submitted_event_id: null,
    }
    const admin = mockAdmin({
      lead,
      ctwaRows: [
        {
          ctwa_clid: 'Aff.REAL',
          tenant_id: TENANT_A,
          project_id: PROJECT_A,
          contact_id: '55',
        },
      ],
    })
    const result = await maybeRegisterWaLeadSubmitted({
      admin: admin as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero comprar un departamento de 2 dormitorios',
      scoreEvents: ['asked_price'],
      env: envOn,
    })
    assert.equal(result.stage, 'enqueued')
    assert.ok(result.eventId)
    assert.ok(result.blockers.includes('wa_lead_submitted_delivery_inactive'))
    assert.equal(lead.meta_wa_lead_submitted_event_id, result.eventId)
  })

  it('consentimiento ausente: bloquea con motivo, sin fingir éxito', async () => {
    const lead = {
      id: LEAD_ID,
      meta_ads_consent: null,
      meta_ads_consent_evidence_message: null,
      meta_ads_consent_evidence_at: null,
      meta_ads_consent_scope: null,
      tenant_id: TENANT_A,
      project_id: PROJECT_A,
      meta_wa_lead_submitted_event_id: null,
    }
    const admin = mockAdmin({
      lead,
      ctwaRows: [
        {
          ctwa_clid: 'Aff.REAL',
          tenant_id: TENANT_A,
          project_id: PROJECT_A,
          contact_id: '55',
        },
      ],
    })
    const result = await maybeRegisterWaLeadSubmitted({
      admin: admin as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero comprar un departamento de 2 dormitorios',
      env: envOn,
    })
    assert.equal(result.stage, 'blocked')
    assert.match(String(result.reason), /ads_consent/)
    assert.equal(result.eventId, null)
    assert.equal(lead.meta_wa_lead_submitted_event_id, null)
  })

  it('CTWA ausente: bloquea whatsapp_ctwa_clid_required sin sellar event_id', async () => {
    const lead = {
      id: LEAD_ID,
      meta_ads_consent: true,
      meta_ads_consent_evidence_message: 'Acepto recibir publicidad',
      meta_ads_consent_evidence_at: '2026-09-21T12:00:00.000Z',
      meta_ads_consent_scope: 'whatsapp_ads',
      tenant_id: TENANT_A,
      project_id: PROJECT_A,
      meta_wa_lead_submitted_event_id: null,
    }
    const admin = mockAdmin({ lead, ctwaRows: [] })
    const result = await maybeRegisterWaLeadSubmitted({
      admin: admin as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero agendar una visita al showroom',
      env: envOn,
    })
    assert.equal(result.stage, 'blocked')
    assert.equal(result.reason, 'whatsapp_ctwa_clid_required')
    assert.equal(result.eventId, null)
  })

  it('duplicados concurrentes: segundo intento conserva event_id', async () => {
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const lead = {
      id: LEAD_ID,
      meta_ads_consent: true,
      meta_ads_consent_evidence_message: 'Acepto publicidad',
      meta_ads_consent_evidence_at: '2026-09-21T12:00:00.000Z',
      meta_ads_consent_scope: 'whatsapp_ads',
      tenant_id: TENANT_A,
      project_id: PROJECT_A,
      meta_wa_lead_submitted_event_id: eventId,
    }
    const admin = mockAdmin({
      lead,
      ctwaRows: [
        {
          ctwa_clid: 'Aff.REAL',
          tenant_id: TENANT_A,
          project_id: PROJECT_A,
          contact_id: '55',
        },
      ],
      outbox: { id: 'o1', status: 'pending', event_id: eventId },
    })
    const result = await maybeRegisterWaLeadSubmitted({
      admin: admin as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero comprar departamento',
      env: envOn,
    })
    assert.equal(result.stage, 'duplicate')
    assert.equal(result.eventId, eventId)
  })

  it('aislamiento entre proyectos: CTWA con tenant distinto se descarta', async () => {
    const clid = await resolveScopedCtwaClid(
      {
        from() {
          return {
            select() {
              return {
                eq() {
                  return this
                },
                order() {
                  return this
                },
                limit() {
                  return this
                },
                async maybeSingle() {
                  return {
                    data: {
                      ctwa_clid: 'Aff.OTHER',
                      tenant_id: TENANT_B,
                      project_id: PROJECT_A,
                      contact_id: '55',
                    },
                    error: null,
                  }
                },
              }
            },
          }
        },
      } as never,
      { tenantId: TENANT_A, projectId: PROJECT_A, contactId: '55' },
    )
    assert.equal(clid, null)
  })

  it('cliente fuera del bot: elegibilidad por texto, sin depender de respuesta', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'Busco departamento 2 dormitorios para vivir',
    })
    assert.equal(r.eligibleForConversion, true)
    // bot_enabled no forma parte del contrato de elegibilidad
  })

  it('plan: delivery OFF no impide canEnqueuePending', () => {
    const p = planWaLeadSubmitted({
      featureEnabled: true,
      deliveryEnabled: false,
      greetingOnly: false,
      commercialInterest: true,
      adsConsent: true,
      ctwaClid: 'Aff',
      wabaId: '1410020224338488',
      messagingDatasetId: '4419657838288963',
    })
    assert.equal(p.canEnqueuePending, true)
    assert.ok(p.blockers.includes('wa_lead_submitted_delivery_inactive'))
  })

  it('evidencia: meta_ads_consent true sin mensaje no basta', () => {
    assert.equal(
      hasVerifiableWaAdsConsentEvidence({
        meta_ads_consent: true,
        meta_ads_consent_evidence_message: null,
        meta_ads_consent_evidence_at: '2026-09-21T12:00:00.000Z',
        meta_ads_consent_scope: 'whatsapp_ads',
      }),
      false,
    )
    const gate = decideWaLeadSubmittedConsentGate({
      queryOk: true,
      leadFound: true,
      metaAdsConsent: true,
      evidenceMessage: null,
      evidenceAt: '2026-09-21T12:00:00.000Z',
      evidenceScope: 'whatsapp_ads',
      eventContactId: '55',
      leadTenantId: TENANT_A,
      eventTenantId: TENANT_A,
      leadProjectId: PROJECT_A,
      eventProjectId: PROJECT_A,
    })
    assert.equal(gate.action, 'hold_pending')
  })

  it('llegada tardía: sin sellado previo, un turno nuevo con CTWA puede encolar', async () => {
    // Primer turno sin CTWA → blocked, event_id null
    const lead = {
      id: LEAD_ID,
      meta_ads_consent: true,
      meta_ads_consent_evidence_message: 'Acepto recibir publicidad y anuncios',
      meta_ads_consent_evidence_at: '2026-09-21T12:00:00.000Z',
      meta_ads_consent_scope: 'whatsapp_ads',
      tenant_id: TENANT_A,
      project_id: PROJECT_A,
      meta_wa_lead_submitted_event_id: null,
    }
    const admin1 = mockAdmin({ lead, ctwaRows: [] })
    const first = await maybeRegisterWaLeadSubmitted({
      admin: admin1 as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero comprar departamento',
      env: envOn,
    })
    assert.equal(first.stage, 'blocked')
    assert.equal(lead.meta_wa_lead_submitted_event_id, null)

    // Segundo turno (nuevo mensaje con interés): CTWA ya presente → encola
    const admin2 = mockAdmin({
      lead,
      ctwaRows: [
        {
          ctwa_clid: 'Aff.LATE',
          tenant_id: TENANT_A,
          project_id: PROJECT_A,
          contact_id: '55',
        },
      ],
    })
    const second = await maybeRegisterWaLeadSubmitted({
      admin: admin2 as never,
      lead: lead as never,
      contactId: 55,
      currentMessage: 'Quiero comprar un departamento de 2 dormitorios',
      env: envOn,
    })
    assert.equal(second.stage, 'enqueued')
    assert.ok(second.eventId)
  })
})

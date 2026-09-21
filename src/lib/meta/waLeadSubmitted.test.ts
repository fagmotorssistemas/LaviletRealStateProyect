import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WA_BLOCK_CTWA,
  WA_BLOCK_GREETING,
  planWaLeadSubmitted,
  waLeadSubmittedIdempotencyKey,
  buildWaLeadSubmittedPayload,
} from './waLeadSubmittedContract'
import { evaluateWaLeadSubmittedEligibility } from './waLeadSubmittedEligibility'
import {
  detectsWhatsappAdsConsentGrant,
  detectsWhatsappAdsConsentRevoke,
  clientAdsConsentUtterance,
} from './waLeadSubmittedConsent'
import { decideWaLeadSubmittedConsentGate } from './waLeadSubmittedConsentGate'
import {
  isMetaCapiSentStage,
  labelMetaCapiReason,
} from './capiConversionLogLabels'

describe('waLeadSubmittedEligibility', () => {
  it('saludo Hola: no conversión', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'Hola',
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.greetingOnly, true)
    assert.equal(r.blocker, WA_BLOCK_GREETING)
  })

  it('interés comercial por texto: elegible', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'Quiero comprar un departamento de 2 dormitorios',
    })
    assert.equal(r.eligibleForConversion, true)
    assert.equal(r.commercialInterest, true)
  })

  it('interés por evento asked_price sin saludo', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'Cuánto cuesta la suite 202',
      scoreEvents: ['asked_price'],
    })
    assert.equal(r.eligibleForConversion, true)
  })

  it('mensaje neutro sin eventos: no elegible', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'ok gracias',
      scoreEvents: ['first_response'],
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.blocker, 'commercial_interest_required')
  })

  it('engagement histórico (propertyInterest) no convierte ambiguo', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'ok',
      propertyInterest: true,
      scoreEvents: ['first_response'],
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.blocker, 'commercial_interest_required')
  })

  it('saludo con engagement histórico: sigue bloqueado', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'Buenos días',
      propertyInterest: true,
      scoreEvents: ['asked_price'],
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.greetingOnly, true)
  })
})

describe('waLeadSubmittedConsent', () => {
  it('iniciar conversación no concede', () => {
    assert.equal(detectsWhatsappAdsConsentGrant('Hola'), false)
    assert.equal(detectsWhatsappAdsConsentGrant('Quiero info del proyecto'), false)
  })

  it('frase genérica de publicidad no concede whatsapp_ads', () => {
    assert.equal(
      detectsWhatsappAdsConsentGrant('Acepto recibir publicidad y anuncios'),
      false,
    )
    assert.equal(detectsWhatsappAdsConsentGrant('Acepto publicidad'), false)
  })

  it('aceptación explícita de medición/publicidad Meta', () => {
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        'Acepto que usen mis datos para medición publicitaria de Meta',
      ),
      true,
    )
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        'Autorizo publicidad de Meta y anuncios de Facebook',
      ),
      true,
    )
  })

  it('no acepto publicidad nunca concede', () => {
    assert.equal(detectsWhatsappAdsConsentGrant('no acepto publicidad'), false)
    assert.equal(
      detectsWhatsappAdsConsentGrant('No acepto publicidad ni anuncios de Meta'),
      false,
    )
  })

  it('cita de otro mensaje no concede', () => {
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        '> Acepto que usen mis datos para medición publicitaria de Meta',
      ),
      false,
    )
    assert.equal(clientAdsConsentUtterance('> Acepto recibir publicidad'), null)
  })

  it('texto del bot / atribución no concede', () => {
    assert.equal(
      detectsWhatsappAdsConsentGrant('El bot dijo que acepto publicidad de Meta'),
      false,
    )
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        'Acepto que usen mis datos para medición publicitaria de Meta',
        { fromBot: true },
      ),
      false,
    )
  })

  it('revocación explícita', () => {
    assert.equal(
      detectsWhatsappAdsConsentRevoke('No quiero recibir publicidad'),
      true,
    )
  })
})

describe('planWaLeadSubmitted', () => {
  const base = {
    featureEnabled: true,
    deliveryEnabled: true,
    greetingOnly: false,
    commercialInterest: true,
    adsConsent: true,
    ctwaClid: 'Aff-TEST',
    wabaId: '123',
    messagingDatasetId: 'ds-msg',
  }

  it('sin CTWA: no pending; retención de atención', () => {
    const p = planWaLeadSubmitted({ ...base, ctwaClid: null })
    assert.equal(p.canEnqueuePending, false)
    assert.ok(p.blockers.includes(WA_BLOCK_CTWA))
    assert.equal(p.retainAttention, true)
  })

  it('sin consentimiento ads: bloqueo', () => {
    const p = planWaLeadSubmitted({ ...base, adsConsent: false })
    assert.equal(p.canEnqueuePending, false)
    assert.ok(p.blockers.includes('ads_consent_required'))
  })

  it('completo: puede pending', () => {
    const p = planWaLeadSubmitted(base)
    assert.equal(p.canEnqueuePending, true)
    assert.deepEqual(p.blockers, [])
  })

  it('delivery off: anota blocker pero puede pending', () => {
    const p = planWaLeadSubmitted({ ...base, deliveryEnabled: false })
    assert.equal(p.canEnqueuePending, true)
    assert.ok(p.blockers.includes('wa_lead_submitted_delivery_inactive'))
  })

  it('idempotency distinta de lead web', () => {
    const key = waLeadSubmittedIdempotencyKey('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    assert.equal(key.startsWith('wa_lead_submitted:'), true)
    assert.equal(key.startsWith('lead:'), false)
  })

  it('feature off: skipped', () => {
    const p = planWaLeadSubmitted({ ...base, featureEnabled: false })
    assert.equal(p.canEnqueuePending, false)
    assert.ok(p.blockers.includes('wa_lead_submitted_inactive'))
  })

  it('payload separa WABA de messaging dataset', () => {
    const payload = buildWaLeadSubmittedPayload({
      leadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ctwaClid: 'Aff',
      wabaId: 'WABA_ONLY',
      messagingDatasetId: 'MSG_DATASET_ONLY',
      tenantId: 'tenant-1',
      projectId: 'project-1',
    })
    assert.equal(payload.whatsapp_business_account_id, 'WABA_ONLY')
    assert.equal(payload.messaging_dataset_id, 'MSG_DATASET_ONLY')
    assert.equal(payload.action_source, 'business_messaging')
    assert.notEqual(
      payload.whatsapp_business_account_id,
      payload.messaging_dataset_id,
    )
  })
})

describe('waLeadSubmittedConsentGate', () => {
  const scoped = {
    queryOk: true,
    leadFound: true,
    metaAdsConsent: true as boolean | null,
    evidenceMessage: 'Acepto que usen mis datos para medición publicitaria de Meta',
    evidenceAt: '2026-09-21T12:00:00.000Z',
    evidenceScope: 'whatsapp_ads',
    leadTenantId: 't1',
    leadProjectId: 'p1',
    eventTenantId: 't1',
    eventProjectId: 'p1',
    eventContactId: 'c1',
  }

  it('true + evidencia permite envío', () => {
    assert.equal(decideWaLeadSubmittedConsentGate(scoped).action, 'allow_send')
  })

  it('true sin evidencia no permite envío', () => {
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, evidenceMessage: null }).action,
      'hold_pending',
    )
  })

  it('false / null / error / ausente no permiten envío', () => {
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, metaAdsConsent: false }).action,
      'cancel_revoked',
    )
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, metaAdsConsent: null }).action,
      'hold_pending',
    )
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, queryOk: false }).action,
      'hold_pending',
    )
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, leadFound: false }).action,
      'hold_pending',
    )
  })

  it('scope tenant/proyecto/contacto', () => {
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, eventContactId: '' }).reason,
      'contact_scope_required',
    )
    assert.equal(
      decideWaLeadSubmittedConsentGate({ ...scoped, eventTenantId: 'x' }).reason,
      'tenant_scope_mismatch',
    )
  })
})

describe('bitácora labels', () => {
  it('evaluated no es conversión enviada', () => {
    assert.equal(isMetaCapiSentStage('evaluated'), false)
    assert.equal(isMetaCapiSentStage('blocked'), false)
    assert.equal(isMetaCapiSentStage('enqueued'), false)
    assert.equal(isMetaCapiSentStage('meta_accepted'), true)
  })

  it('motivos legibles', () => {
    assert.match(
      labelMetaCapiReason('greeting_only_not_conversion'),
      /saludo/i,
    )
  })
})

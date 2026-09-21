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
import { waAdsConsentRequestBrief } from './waLeadSubmittedConsentRequest'
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

  it('selección de unidad ofrecida: me interesa el más grande CON oferta', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'me interesa mas el mas grande',
      recentOfferText:
        'Perfecto. Estas son las opciones disponibles: el penthouse 602; el penthouse 605.',
    })
    assert.equal(r.eligibleForConversion, true)
    assert.equal(r.commercialInterest, true)
    assert.equal(r.turnCommercialInterest, true)
  })

  it('sin oferta: «me interesa más el más grande» NO es interés inmobiliario', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'me interesa mas el mas grande',
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.blocker, 'commercial_interest_required')
  })

  it('oferta de asesor también habilita la selección', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'me interesa esa',
      recentOfferText:
        'Le comparto el departamento 301 y la suite 202 con sus metros.',
    })
    assert.equal(r.eligibleForConversion, true)
  })

  it('deíxis «esa» sin oferta: no elegible', () => {
    assert.equal(
      evaluateWaLeadSubmittedEligibility({
        currentMessage: 'me interesa esa',
      }).eligibleForConversion,
      false,
    )
  })

  it('aceptación sola (sin sello reciente) no es interés', () => {
    const msg =
      'Acepto que usen mis datos para medición publicitaria de Meta'
    assert.equal(detectsWhatsappAdsConsentGrant(msg), true)
    const r = evaluateWaLeadSubmittedEligibility({ currentMessage: msg })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.blocker, 'commercial_interest_required')
  })

  it('secuencia: interés sellado + aceptación encola (sin otro mensaje comercial)', () => {
    const stamped = new Date().toISOString()
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage:
        'Acepto que usen mis datos para medición publicitaria de Meta',
      commercialInterestAt: stamped,
    })
    assert.equal(r.eligibleForConversion, true)
    assert.equal(r.turnCommercialInterest, false)
    assert.equal(r.usedRecentInterestWithConsent, true)
  })

  it('sello antiguo no reutiliza interés (sin backfill)', () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage:
        'Acepto que usen mis datos para medición publicitaria de Meta',
      commercialInterestAt: old,
    })
    assert.equal(r.eligibleForConversion, false)
  })

  it('histórico propertyInterest no convierte mensaje ambiguo (sin backfill)', () => {
    const r = evaluateWaLeadSubmittedEligibility({
      currentMessage: 'ok',
      propertyInterest: true,
      scoreEvents: ['first_response'],
    })
    assert.equal(r.eligibleForConversion, false)
    assert.equal(r.blocker, 'commercial_interest_required')
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

  it('no acepto / rechazo nunca concede', () => {
    assert.equal(detectsWhatsappAdsConsentGrant('no acepto publicidad'), false)
    assert.equal(
      detectsWhatsappAdsConsentGrant('No acepto publicidad ni anuncios de Meta'),
      false,
    )
    assert.equal(
      detectsWhatsappAdsConsentGrant('Rechazo el consentimiento de Meta Ads'),
      false,
    )
  })

  it('preguntas no conceden', () => {
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        '¿Acepto que usen mis datos para medición publicitaria de Meta?',
      ),
      false,
    )
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        'Puedo autorizar publicidad de Meta?',
      ),
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
    assert.equal(
      detectsWhatsappAdsConsentGrant(
        '"Acepto que usen mis datos para medición publicitaria de Meta"',
      ),
      false,
    )
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
    assert.equal(
      detectsWhatsappAdsConsentRevoke(
        'Retiro mi consentimiento de medición de Meta',
      ),
      true,
    )
  })
})

describe('waLeadSubmittedConsentRequest', () => {
  it('script manual no activa bot y espera frase Meta', () => {
    const brief = waAdsConsentRequestBrief()
    assert.equal(brief.botAutoSend, false)
    assert.equal(brief.channel, 'advisor_manual_kommo')
    assert.match(brief.requestScript, /Meta/)
    assert.equal(
      detectsWhatsappAdsConsentGrant(brief.expectedReply),
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

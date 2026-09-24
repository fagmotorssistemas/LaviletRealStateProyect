import test from 'node:test'
import assert from 'node:assert/strict'
import { isCrmQualificationDeliveryEnabled, planCrmQualificationSignal } from './hotLeadSignal'

const base = {
  leadId: 'lead-1',
  evaluationId: 'evaluation-1',
  temperature: 'caliente',
  hasQualificationTransition: true,
  internal: false,
  testContact: false,
  adsConsent: true,
  contactId: '9431328',
  ctwaClid: 'ctwa-original',
  backendEventName: 'QualifiedLead' as const,
  featureEnabled: true,
}

test('captura una calificación tibia o caliente respaldada por evaluación persistida', () => {
  const plan = planCrmQualificationSignal(base)
  assert.equal(plan.captureIntent, true)
  assert.equal(plan.eligibleForFutureDelivery, true)
  assert.equal(plan.idempotencyKey, 'wa_crm_qualified:lead-1')
  assert.equal(planCrmQualificationSignal({ ...base, temperature: 'tibio' }).captureIntent, true)
})

test('la entrega QualifiedLead está apagada salvo true explícito', () => {
  assert.equal(isCrmQualificationDeliveryEnabled({} as NodeJS.ProcessEnv), false)
  assert.equal(
    isCrmQualificationDeliveryEnabled({
      META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED: 'false',
    } as NodeJS.ProcessEnv),
    false,
  )
  assert.equal(
    isCrmQualificationDeliveryEnabled({
      META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED: 'true',
    } as NodeJS.ProcessEnv),
    true,
  )
})

test('frío y ausencia de evaluación no crean intención', () => {
  for (const temperature of ['frio', null]) {
    assert.equal(planCrmQualificationSignal({ ...base, temperature }).captureIntent, false)
  }
  assert.deepEqual(planCrmQualificationSignal({ ...base, evaluationId: null }).blockers, [
    'not_a_persisted_evaluation',
  ])
  assert.equal(
    planCrmQualificationSignal({ ...base, hasQualificationTransition: false }).captureIntent,
    false,
  )
})

test('repeticiones conservan una sola identidad y los reintentos no generan otra clave', () => {
  const first = planCrmQualificationSignal(base)
  const retry = planCrmQualificationSignal(base)
  const repeated = planCrmQualificationSignal({
    ...base,
    evaluationId: 'evaluation-2',
    alreadyCaptured: true,
  })
  assert.equal(first.idempotencyKey, retry.idempotencyKey)
  assert.equal(repeated.captureIntent, false)
  assert.deepEqual(repeated.blockers, ['already_captured'])
})

test('internos, pruebas, revocación e identidad incompleta quedan retenidos', () => {
  const plan = planCrmQualificationSignal({
    ...base,
    internal: true,
    testContact: true,
    adsConsent: false,
    contactId: null,
    ctwaClid: null,
    backendEventName: null,
    featureEnabled: false,
  })
  assert.equal(plan.captureIntent, true)
  assert.equal(plan.eligibleForFutureDelivery, false)
  assert.deepEqual(plan.blockers, [
    'internal_contact',
    'test_contact',
    'ads_consent_revoked',
    'contact_identity_required',
    'original_ctwa_attribution_required',
    'backend_event_contract_pending',
    'feature_disabled',
  ])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { planHotLeadSignal } from './hotLeadSignal'

const base = {
  leadId: 'lead-1', evaluationId: 'evaluation-1', temperature: 'caliente',
  transitionedToHot: true,
  internal: false, testContact: false, adsConsent: true, contactId: '9431328',
  ctwaClid: 'ctwa-original', backendEventName: 'BACKEND_CONFIRMED_EVENT', featureEnabled: true,
}

test('captura solo una transición caliente respaldada por evaluación persistida', () => {
  const plan = planHotLeadSignal(base)
  assert.equal(plan.captureIntent, true)
  assert.equal(plan.eligibleForFutureDelivery, true)
  assert.equal(plan.idempotencyKey, 'wa_hot_qualified:lead-1')
})

test('frío, tibio y ausencia de evaluación no crean intención', () => {
  for (const temperature of ['frio', 'tibio', null]) {
    assert.equal(planHotLeadSignal({ ...base, temperature }).captureIntent, false)
  }
  assert.deepEqual(
    planHotLeadSignal({ ...base, evaluationId: null }).blockers,
    ['not_a_persisted_evaluation'],
  )
  assert.equal(planHotLeadSignal({ ...base, transitionedToHot: false }).captureIntent, false)
})

test('repeticiones conservan una sola identidad y los reintentos no generan otra clave', () => {
  const first = planHotLeadSignal(base)
  const retry = planHotLeadSignal(base)
  const repeated = planHotLeadSignal({ ...base, evaluationId: 'evaluation-2', alreadyCaptured: true })
  assert.equal(first.idempotencyKey, retry.idempotencyKey)
  assert.equal(repeated.captureIntent, false)
  assert.deepEqual(repeated.blockers, ['already_captured'])
})

test('internos, pruebas, revocación e identidad incompleta quedan retenidos', () => {
  const plan = planHotLeadSignal({
    ...base, internal: true, testContact: true, adsConsent: false,
    contactId: null, ctwaClid: null, backendEventName: null, featureEnabled: false,
  })
  assert.equal(plan.captureIntent, true)
  assert.equal(plan.eligibleForFutureDelivery, false)
  assert.deepEqual(plan.blockers, [
    'internal_contact', 'test_contact', 'ads_consent_revoked',
    'contact_identity_required', 'original_ctwa_attribution_required',
    'backend_event_contract_pending', 'feature_disabled',
  ])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizedNurtureRequest, nurtureWithCommercialProfile, rememberLeadNurture } from './lead-nurture-state'
import { normalizeTurnSemantics } from './turn-semantics'
import { object, type Row } from './data'

const firstAt = '2026-10-15T18:00:00.000Z'
const laterAt = '2026-10-16T18:00:00.000Z'
const futureMessage = 'Me interesa comprar cuando regrese a Ecuador en noviembre. Puede escribirme en noviembre.'
const futureEvidence = 'Me interesa comprar cuando regrese a Ecuador en noviembre'
const contactEvidence = 'Puede escribirme en noviembre'
const horizon = 'cuando regrese a Ecuador en noviembre'
const neutral: Row = { decision: 'unchanged', evidence: '', contact_permission: 'unchanged',
  contact_evidence: '', purchase_horizon: '', confidence: 'high' }
const futureRequest = (overrides: Row = {}): Row => ({ ...neutral, decision: 'future_interest',
  evidence: futureEvidence, purchase_horizon: horizon, ...overrides })
const acceptedFuture = (): Row => rememberLeadNurture({}, futureRequest({ contact_permission: 'accepted',
  contact_evidence: contactEvidence }), futureMessage, firstAt)

for (const message of [
  'Hola, buenos días', '', 'Aún no tengo presupuesto definido', 'Todavía no sé cuánto pondría de entrada',
  'Por ahora solo quiero conocer el proyecto',
]) {
  test(`a neutral extraction does not create future-purchase nurture: ${message || 'silence'}`, () => {
    const state = rememberLeadNurture({}, neutral, message, firstAt)
    assert.notEqual(state.active, true)
    assert.notEqual(state.future_interest, true)
    assert.notEqual(state.contact_consent, true)
  })
}

test('explicit future purchase alone remains inactive until contact is accepted', () => {
  const state = rememberLeadNurture({}, futureRequest(), futureMessage, firstAt)
  assert.equal(state.future_interest, true)
  assert.equal(state.active, false)
  assert.equal(state.purchase_horizon, horizon)
  assert.notEqual(state.contact_consent, true)
})

test('literal future purchase and independent contact agreement activate nurture', () => {
  const state = acceptedFuture()
  assert.equal(state.active, true)
  assert.equal(state.future_interest, true)
  assert.equal(state.contact_consent, true)
  assert.equal(state.evidence, futureEvidence)
  assert.equal(state.contact_evidence, contactEvidence)
  assert.equal(state.purchase_horizon, horizon)
  assert.equal(state.declared_at, firstAt)
})

test('a later contact agreement can complete an existing future-interest declaration', () => {
  const before = rememberLeadNurture({}, futureRequest(), futureMessage, firstAt)
  const current = 'Sí, puede contactarme el próximo mes'
  const after = rememberLeadNurture(before, { ...neutral, contact_permission: 'accepted',
    contact_evidence: current }, current, laterAt)
  assert.equal(after.active, true)
  assert.equal(after.evidence, futureEvidence)
  assert.equal(after.purchase_horizon, horizon)
  assert.equal(after.contact_evidence, current)
})

test('contact consent by itself does not invent a future-purchase decision', () => {
  const current = 'Sí, puede contactarme'
  const state = rememberLeadNurture({}, { ...neutral, contact_permission: 'accepted',
    contact_evidence: current }, current, firstAt)
  assert.equal(state.contact_consent, true)
  assert.equal(state.active, false)
  assert.notEqual(state.future_interest, true)
})

for (const current of ['¿Qué precio tiene el 304?', '¿Tiene piscina?', 'Hola, volví a escribir', '¿Hay disponibilidad?']) {
  test(`an ordinary current inquiry preserves the accepted future pause: ${current}`, () => {
    const before = acceptedFuture(), snapshot = structuredClone(before)
    const after = rememberLeadNurture(before, neutral, current, laterAt)
    assert.deepEqual(after, snapshot)
    assert.deepEqual(before, snapshot, 'Reading the pause does not mutate its saved evidence')
  })
}

test('resume now clears future interest so another contact permission cannot reactivate the old pause', () => {
  const before = acceptedFuture(), current = 'Ya regresé y quiero avanzar ahora con la compra'
  const resumed = rememberLeadNurture(before, { ...neutral, decision: 'resume_now', evidence: current }, current, laterAt)
  assert.equal(resumed.active, false)
  assert.equal(resumed.future_interest, false)
  assert.equal(resumed.resumed_evidence, current)
  const contact = 'Sí, puede escribirme'
  const after = rememberLeadNurture(resumed, { ...neutral, contact_permission: 'accepted',
    contact_evidence: contact }, contact, '2026-10-17T18:00:00.000Z')
  assert.equal(after.active, false)
  assert.equal(after.future_interest, false)
})

test('a contact stop deactivates nurture and removes its contact consent', () => {
  const current = 'Por favor, no me escriban más'
  const after = rememberLeadNurture(acceptedFuture(), { ...neutral, decision: 'stop_contact',
    evidence: current }, current, laterAt)
  assert.equal(after.active, false)
  assert.equal(after.contact_consent, false)
  assert.equal(after.contact_evidence, current)
})

test('an explicit contact refusal prevents a simultaneous future-interest declaration from activating', () => {
  const current = 'Me interesa comprar el próximo año, pero no me contacten'
  const after = rememberLeadNurture({}, { ...neutral, decision: 'future_interest',
    evidence: 'Me interesa comprar el próximo año', purchase_horizon: 'el próximo año',
    contact_permission: 'declined', contact_evidence: 'no me contacten' }, current, firstAt)
  assert.equal(after.active, false)
  assert.equal(after.contact_consent, false)
})

test('historical future and contact quotes cannot become declarations from a new greeting', () => {
  const request = futureRequest({ contact_permission: 'accepted', contact_evidence: contactEvidence })
  const normalized = normalizedNurtureRequest(request, 'Hola de nuevo')
  assert.equal(normalized.decision, 'unchanged')
  assert.equal(normalized.contact_permission, 'unchanged')
  assert.equal(normalized.evidence, '')
  assert.equal(normalized.purchase_horizon, '')
  assert.notEqual(rememberLeadNurture({}, request, 'Hola de nuevo', firstAt).active, true)
})

test('a historical contact quote cannot supply permission for a current future declaration', () => {
  const current = 'Me interesa comprar cuando regrese a Ecuador en noviembre'
  const after = rememberLeadNurture({}, futureRequest({ contact_permission: 'accepted',
    contact_evidence: 'Puede escribirme en noviembre' }), current, firstAt)
  assert.equal(after.future_interest, true)
  assert.equal(after.active, false)
  assert.notEqual(after.contact_consent, true)
})

test('an invented date or condition is removed rather than saved as a literal purchase horizon', () => {
  const normalized = normalizedNurtureRequest(futureRequest({ purchase_horizon: 'el 15 de noviembre' }), futureMessage)
  assert.equal(normalized.purchase_horizon, '')
  assert.equal(normalized.evidence, futureEvidence)
  assert.equal(rememberLeadNurture({}, futureRequest({ purchase_horizon: 'el 15 de noviembre',
    contact_permission: 'accepted', contact_evidence: contactEvidence }), futureMessage, firstAt).active, false)
})

test('future interest and contact agreement without a current horizon stay inactive', () => {
  const current = 'Me interesa comprar después. Puede escribirme.'
  const state = rememberLeadNurture({}, { ...neutral, decision: 'future_interest', evidence: 'Me interesa comprar después',
    contact_permission: 'accepted', contact_evidence: 'Puede escribirme.' }, current, firstAt)
  assert.equal(state.future_interest, true)
  assert.equal(state.contact_consent, true)
  assert.equal(state.active, false)
})

function manualProfile(overrides: Row = {}): Row {
  return { nutrition_active: true, contact_consent: true, nutrition_reason: 'Compra al regresar',
    nutrition_evidence: futureMessage, purchase_horizon: horizon, resume_at: null, updated_at: laterAt, ...overrides }
}

test('a newer manual pause supplies the declared future and contact agreement', () => {
  const previous = { active: false, future_interest: false, declared_at: firstAt }
  const state = nurtureWithCommercialProfile(previous, manualProfile())
  assert.equal(state.active, true)
  assert.equal(state.future_interest, true)
  assert.equal(state.contact_consent, true)
  assert.equal(state.declared_at, laterAt)
  assert.equal(state.evidence, futureMessage)
})

test('a newer manual deactivation is not overwritten by an older conversation pause', () => {
  const state = nurtureWithCommercialProfile(acceptedFuture(), manualProfile({ nutrition_active: false }))
  assert.equal(state.active, false)
  assert.equal(state.future_interest, false)
  assert.equal(state.declared_at, laterAt)
})

test('a newer customer reactivation is not reversed by an older manual pause', () => {
  const current = 'Ya quiero avanzar ahora en mi compra'
  const resumed = rememberLeadNurture(acceptedFuture(), { ...neutral, decision: 'resume_now', evidence: current }, current, laterAt)
  assert.deepEqual(nurtureWithCommercialProfile(resumed, manualProfile({ updated_at: firstAt })), resumed)
})

test('missing manual data cannot erase the saved conversation decision', () => {
  const before = acceptedFuture()
  assert.deepEqual(nurtureWithCommercialProfile(before, undefined), before)
  assert.deepEqual(nurtureWithCommercialProfile(before, {}), before)
})

test('a newer manual profile with no horizon is not enough to activate nurture', () => {
  const state = nurtureWithCommercialProfile({}, manualProfile({ purchase_horizon: '' }))
  assert.equal(state.active, false)
  assert.equal(state.future_interest, false)
})

test('medium confidence retains current literal future and contact evidence', () => {
  const after = rememberLeadNurture({}, futureRequest({ confidence: 'medium', contact_permission: 'accepted',
    contact_evidence: contactEvidence }), futureMessage, firstAt)
  assert.equal(after.active, true)
  assert.equal(after.contact_evidence, contactEvidence)
})

test('low-confidence nurture metadata cannot activate or alter a saved state', () => {
  const before = acceptedFuture(), current = 'No me contacten'
  assert.deepEqual(rememberLeadNurture(before, { ...neutral, confidence: 'low', decision: 'stop_contact',
    evidence: current }, current, laterAt), before)
  assert.deepEqual(normalizedNurtureRequest(futureRequest({ confidence: 'low' }), futureMessage), {})
})

test('turn semantics carries the validated nurture declaration into conversation memory without selecting a property', () => {
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'project_information',
    confidence: 'high', primary_evidence: futureMessage, nurture_request: futureRequest({
      contact_permission: 'accepted', contact_evidence: contactEvidence }) } }, futureMessage)
  assert.equal(object(semantics.nurture_request).decision, 'future_interest')
  assert.equal(rememberLeadNurture({}, semantics.nurture_request, futureMessage, firstAt).active, true)
  assert.notEqual(object(semantics.property).operation, 'select')
})

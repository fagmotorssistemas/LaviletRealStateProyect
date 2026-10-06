import test from 'node:test'
import assert from 'node:assert/strict'
import { financingCollection } from './financing-intake'
import { financingInputs, financingPendingQuestion } from './financing'
import { financingJourney } from './financing-stage'
import { reviewObligations } from './focused-review'
import { completeTurnReply } from './turn-completeness'
import { deliveredPendingQuestion } from './continuation-question'
import { withResponseReviewPolicy } from './response-review-policy'
import { object, type Row } from './data'

const partners = ['Banco Pichincha', 'Cooperativa JEP']
const personalFields = ['legal_name', 'national_id', 'applicant_type', 'monthly_income']

for (const partner of partners) test(`choosing ${partner} before consent preserves its invitation instead of requesting legal data`, () => {
  const choice = financingInputs({}, `Prefiero ${partner}`, '', { partners, current: {} })
  assert.equal(choice.partner, partner)
  assert.equal(choice.consent, null)
  const preference = financingJourney({}, choice, 'choice')
  assert.notEqual(preference.accepted, true)
  assert.equal(object(preference.partner_preference).name, partner)

  // This is the actual RPC envelope: continuation state without a consent
  // flag, and a lender that has been saved before the customer accepts.
  const intake = financingCollection({ active: true, state: 'continuacion_pendiente', selected_partner_name: partner }, {}, {}, partners)
  assert.ok(intake.reply.includes(partner))
  assert.match(intake.reply, /¿Le gustaría que iniciemos la revisión de su caso\?/)
  assert.doesNotMatch(intake.reply, /nombre|cédula|dependencia|independiente|ingreso/i)
  assert.deepEqual(intake.collection.requested_fields, ['financing_consent'])
  assert.equal(intake.collection.collection_allowed, false)
  assert.equal(intake.collection.selected_partner, partner)
  assert.equal(personalFields.some(field => intake.collection.requested_fields.includes(field)), false)
  assert.deepEqual(financingPendingQuestion(intake.reply, { financing_collection: intake.collection }), {})

  const acceptance = financingInputs({}, 'Sí, por favor', intake.reply, { partners,
    current: { explicit_consent: false, selected_partner_name: partner } })
  assert.equal(acceptance.consent, true)
  const accepted = financingJourney(preference, acceptance, 'acceptance')
  assert.equal(accepted.accepted, true)
  assert.equal(object(accepted.partner_preference).name, partner)
  const authorized = financingCollection({ active: true, state: 'identificacion_pendiente', selected_partner_name: partner }, {}, {}, partners)
  assert.deepEqual(authorized.collection.requested_fields, ['legal_name', 'national_id', 'applicant_type'])
  assert.equal(authorized.collection.collection_allowed, true)
  assert.match(authorized.reply, /nombres y apellidos completos|nombres completos/i)
  assert.match(authorized.reply, /cédula.*diez dígitos/)
  assert.match(authorized.reply, /dependencia.*independiente/)
  assert.equal(financingPendingQuestion(authorized.reply, { financing_collection: authorized.collection }).id, 'financing_data')
})

test('saved or supplied legal data does not bypass absent or explicitly false consent', () => {
  const saved = { selected_partner_name: 'Cooperativa JEP', full_name: 'Ana Paz', legal_name_confirmed: true,
    national_id: '0102030405', applicant_type: 'independiente', monthly_income: 4000 }
  for (const fin of [
    { ...saved, state: 'continuacion_pendiente' },
    { ...saved, state: 'nombre_pendiente', explicit_consent: false },
    { ...saved, state: 'cedula_pendiente', explicit_consent: false, journey: { accepted: true } },
    { ...saved, financing_state: 'continuacion_pendiente' },
  ]) {
    const intake = financingCollection(fin, { full_name: 'Ana Paz', complete: true }, { status: 'accepted' }, partners)
    assert.equal(intake.collection.state, 'continuacion_pendiente')
    assert.deepEqual(intake.collection.requested_fields, ['financing_consent'])
    assert.equal(intake.collection.collection_allowed, false)
    assert.match(intake.reply, /¿Le gustaría que iniciemos la revisión/)
    assert.doesNotMatch(intake.reply, /nombre|cédula|trabaja|ingreso/)
  }
})

test('an invalid document before acceptance is not turned into a demand to correct personal data', () => {
  for (const status of ['incomplete', 'invalid_length']) {
    const intake = financingCollection({ state: 'continuacion_pendiente', selected_partner_name: 'Banco Pichincha' },
      {}, { status }, partners)
    assert.deepEqual(intake.collection.requested_fields, ['financing_consent'])
    assert.doesNotMatch(intake.reply, /documento|dígitos|cédula|apellidos|trabaja/)
    assert.equal(object(intake.collection.document_validation).status, status)
    const obligation = reviewObligations({ financing_collection: intake.collection }, {}, {})
      .find(row => row.id === 'financing_collection')!
    assert.equal(obligation.collection_allowed, false)
    assert.match(String(obligation.instruction), /No solicite correcciones de documentos antes de la aceptación/)
    assert.doesNotMatch(String(obligation.instruction), /explique la longitud y solicite la cédula corregida/)
  }
})

test('accepted identity collection still corrects an invalid document and keeps every pending basic field', () => {
  const intake = financingCollection({ state: 'identificacion_pendiente', selected_partner_name: 'Cooperativa JEP' },
    {}, { status: 'incomplete' }, partners)
  assert.deepEqual(intake.collection.requested_fields, ['legal_name', 'national_id', 'applicant_type'])
  assert.match(intake.reply, /quedó incompleto.*diez dígitos/)
  assert.match(intake.reply, /nombres y apellidos completos/)
  assert.match(intake.reply, /dependencia.*independiente/)
  const obligation = reviewObligations({ financing_collection: intake.collection }, {}, {})
    .find(row => row.id === 'financing_collection')!
  assert.match(String(obligation.instruction), /explique la longitud y solicite la cédula corregida/)

  const progressed = financingCollection({ state: 'ingreso_pendiente', selected_partner_name: 'Cooperativa JEP',
    full_name: 'Ana Paz', legal_name_confirmed: true, national_id: '0102030405', applicant_type: 'independiente' },
    { full_name: 'Ana Paz', complete: true }, { status: 'accepted' }, partners)
  assert.deepEqual(progressed.collection.requested_fields, ['monthly_income'])
  assert.match(progressed.reply, /ingreso mensual/)
  assert.doesNotMatch(progressed.reply, /cédula|apellidos|iniciemos/)
})

test('lender selection and completed intake cannot re-open basic data collection', () => {
  const choose = financingCollection({ state: 'entidad_pendiente' }, {}, { status: 'invalid_length' }, partners)
  assert.deepEqual(choose.collection.requested_fields, ['selected_partner_name'])
  assert.equal(choose.collection.collection_allowed, false)
  assert.match(choose.reply, /Con cuál.*financiamiento/)
  assert.doesNotMatch(choose.reply, /cédula|nombre|dígitos/)
  assert.equal(financingPendingQuestion(choose.reply, { financing_collection: choose.collection }).id, 'financing_partner')

  const ready = financingCollection({ state: 'lista_para_revision', selected_partner_name: 'Cooperativa JEP' }, {}, {}, partners)
  assert.deepEqual(ready.collection.requested_fields, [])
  assert.equal(ready.collection.collection_allowed, false)
  assert.doesNotMatch(ready.reply, /\?/)
  assert.throws(() => financingCollection({ state: 'unknown' } as Row, {}, {}, partners), /UNKNOWN_FINANCING_STATE/)
})

test('the real final writer and review contracts preserve the consent invitation for both lenders', async () => {
  for (const partner of partners) for (const reviewing of [true, false]) {
    const intake = financingCollection({ state: 'continuacion_pendiente', selected_partner_name: partner },
      {}, { status: 'incomplete' }, partners)
    const question = { purpose: 'permission_to_continue', role: 'optional_continuation',
      missing_datum: 'Aceptación de la revisión', next_decision: 'Iniciar la recopilación después de aceptar',
      continuation_id: 'financing_invitation', continuation_act: 'financing' }
    const calls: string[] = [], failures: string[] = []
    const result = await withResponseReviewPolicy({ enabled: reviewing, updatedAt: null }, () => completeTurnReply({ current: `Prefiero ${partner}`, baseReply: intake.reply,
      verified: { catalog_search: { embeddingsEnabled: true }, financiamiento: { partners, current: { explicit_consent: false } } },
      audit: { source: 'financing', state: 'continuacion_pendiente', financing_collection: intake.collection,
        semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_instructions, input, _schema, _image, _file, _tone, task = 'data') => {
      try {
        calls.push(task)
        const obligation = (object(input).obligaciones_del_turno as Row[]).find(row => row.id === 'financing_collection')!
        assert.equal(obligation.collection_allowed, false)
        assert.deepEqual(obligation.requested_fields, ['financing_consent'])
        assert.equal(obligation.selected_partner, partner)
        assert.match(String(obligation.instruction), /antes de la aceptación/)
        return task === 'writing' ? { reply: intake.reply, requests: [{ fragment: 'R1', intent: 'Elegir entidad',
          request_type: 'action', status: 'answered', evidence: `Conserva ${partner} y pide aceptación`, fact_key: 'none' }], question }
          : { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [],
            question: { ...question, offered_action: 'financing_review' } }
      } catch (error) { failures.push(String(error)); throw error }
    }))
    assert.deepEqual(failures, [])
    assert.equal(result.reply, intake.reply)
    assert.equal(result.audit.status, reviewing ? 'checked' : 'review_disabled')
    assert.deepEqual(calls, reviewing ? ['writing', 'review'] : ['writing'])
    const pending = deliveredPendingQuestion(result.reply, { metadata: result.audit.question })
    assert.equal(pending.id, 'financing_invitation')
    assert.notEqual(pending.id, 'financing_data')
  }
})

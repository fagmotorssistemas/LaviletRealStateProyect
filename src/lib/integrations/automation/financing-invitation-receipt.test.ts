import test from 'node:test'
import assert from 'node:assert/strict'
import { financingInputs } from './financing'
import { financingInvitationReceipt, operationalFinancingInvitation } from './financing-invitation'
import { financingJourney } from './financing-stage'
import { authorityFixture } from './fixtures/typed-turn.fixture'

const context = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
const question = (text: string) => ({ text, continuation_id: 'financing_invitation', continuation_act: 'financing', purpose: 'permission_to_continue' })
const answer = { action_authority: authorityFixture('Sí, por supuesto', 'financing', 'accept'), turn_semantics: { primary_intent: 'answer_previous',
  answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: 'Sí, por supuesto', confidence: 'high' } } }

test('equivalent writer invitations authorize the same current answer through metadata, independently of vocabulary', () => {
  for (const reply of ['Podemos iniciar la revisión preliminar. ¿Le parece si procedemos?',
    'Podemos revisar su caso. ¿Damos ese paso?', '¿Comenzamos esa revisión?', 'Shall we proceed with the preliminary review?']) {
    const invitation = financingInvitationReceipt(question(reply))
    assert.equal(operationalFinancingInvitation(invitation), true)
    assert.equal(financingInputs(answer, 'Sí, por supuesto', reply, context,
      { kind: 'financing_consent', reply, invitation }).consent, true)
  }
})

test('legacy labels, prose, unrelated questions and stale delivery receipts cannot substitute for a delivered financing act', () => {
  const reply = '¿Desea iniciar la revisión financiera?'
  for (const step of [{ kind: 'financing_consent', reply }, { kind: 'unverified_offer', reply },
    { kind: 'financing_consent', reply: 'a different delivered message', invitation: financingInvitationReceipt(question(reply)) },
    { kind: 'commercial_question', reply, invitation: financingInvitationReceipt(question(reply)) },
    { kind: 'information_offer', reply, invitation: {} }]) {
    assert.equal(financingInputs(answer, 'Sí, por supuesto', reply, context, step).consent, null)
  }
  assert.equal(operationalFinancingInvitation(reply), false)
  for (const id of ['brochure_offer', 'unit_choice', 'reservation_invitation']) {
    assert.deepEqual(financingInvitationReceipt({ ...question(reply), continuation_id: id }), {})
  }
})

test('a delivered invitation cannot turn refusal, a condition, or an informational inquiry into application consent', () => {
  const reply = 'Podemos revisar su caso. ¿Damos ese paso?'
  const step = { kind: 'financing_consent', reply, invitation: financingInvitationReceipt(question(reply)) }
  for (const [current, kind] of [['No, gracias', 'negative'], ['Sí, solo si aseguran la aprobación', 'affirmative']]) {
    const extracted = { action_authority: authorityFixture(current, 'financing', kind === 'negative' ? 'decline' : 'accept',
      kind === 'negative' ? 'self' : 'conditional'), turn_semantics: { answer_to_previous: {
      question_id: 'financing_invitation', kind, evidence: current, confidence: 'high' } } }
    assert.equal(financingInputs(extracted, current, reply, context, step).consent, null)
  }
  const inquiry = '¿Cuáles son las cuotas aproximadas?'
  assert.equal(financingInputs({ financing_quote: { requested: true, evidence: inquiry },
    financing_consent: true }, inquiry, reply, context, step).consent, null)
})

test('a grounded acceptance containing solo is not mistaken for conditional permission', () => {
  const reply = 'Podemos revisar su caso. ¿Damos ese paso?'
  const step = { kind: 'financing_consent', reply, invitation: financingInvitationReceipt(question(reply)) }
  for (const current of ['Sí, solo avancemos con la revisión', 'Sí, solamente deseo que iniciemos esa revisión']) {
    const extracted = { action_authority: authorityFixture(current, 'financing', 'accept'), turn_semantics: { primary_intent: 'answer_previous',
      answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: current, confidence: 'high' } } }
    assert.equal(financingInputs(extracted, current, reply, context, step).consent, true)
  }
})

test('consulting a previous evaluation cannot start a new review through lexical matching', () => {
  const current = 'Quiero revisar la evaluación financiera que ya me hicieron'
  const extracted = { financing_consent: null, turn_semantics: { primary_intent: 'track_request', primary_evidence: current,
    confidence: 'high', requests: [{ domain: 'tracking', evidence: current, confidence: 'high' }] } }
  assert.equal(financingInputs(extracted, current, '', context).consent, null)
  assert.equal(financingInputs({}, 'Quiero iniciar la revisión con JEP', '', context).consent, null,
    'Missing current interpretation cannot be replaced with a new consent classifier')
})

test('a new current evidenced AI request can authorize review independently of its particular phrasing', () => {
  for (const current of ['Deseo que iniciemos mi revisión financiera', 'Quiero hacer la prueba con la JEP']) {
    const extracted = { action_authority: authorityFixture(current, 'financing'), turn_semantics: { primary_intent: 'ask_financing', confidence: 'high',
      primary_evidence: current, requests: [{ domain: 'financing', evidence: current, confidence: 'high' }] } }
    assert.equal(financingInputs(extracted, current, '', context).consent, true)
    const low = structuredClone(extracted)
    low.action_authority.financing = { ...low.action_authority.financing, confidence: 'low' }
    assert.equal(financingInputs(low, current, '', context).consent, null)
    const historical = structuredClone(extracted)
    historical.action_authority.financing = { ...historical.action_authority.financing, evidence: 'Un mensaje anterior' }
    assert.equal(financingInputs(historical, current, '', context).consent, null)
  }
})

test('an unresolved elliptical lender answer never clears the lender already persisted', () => {
  const current = 'Sí, esa'
  const saved = { ...context, current: { explicit_consent: true, selected_partner_name: 'Cooperativa JEP' } }
  const extracted = { financing_partner_choice: { kind: 'select', name: 'Cooperativa JEP', evidence: current, confidence: 'high' },
    turn_semantics: { answer_to_previous: { question_id: 'financing_partner', kind: 'affirmative', evidence: current, confidence: 'high' } } }
  const result = financingInputs(extracted, current, '¿Desea continuar con esa entidad?', saved)
  assert.equal(result.partner, null, 'No new selection without a typed unique lender referent')
  assert.equal(result.cleared_partner, null)
  assert.equal(saved.current.selected_partner_name, 'Cooperativa JEP')
  const journey = { accepted: true, partner_preference: { name: 'Cooperativa JEP', evidence: 'Prefiero JEP', source_message_id: 'prior' } }
  assert.deepEqual(financingJourney(journey, result, 'now'), journey)
})

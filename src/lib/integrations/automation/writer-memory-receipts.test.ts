import assert from 'node:assert/strict'
import test from 'node:test'
import { leadProfilePendingQuestion, rememberLeadIntroduction } from './lead-introduction'
import { rememberSalesReply } from './sales-policy'
import { type Row } from './data'

const profileQuestion = { continuation_id: 'lead_profile', continuation_act: 'profile',
  purpose: 'collect_lead_profile', text: 'Para enviárselo, compártame su nombre y su lugar de residencia actual.' }
const plan = { question_purpose: 'collect_profile', presentation: { required: true } }
const audit = (question: Row | null = profileQuestion, writer_receipts: Row = {}): Row => ({
  profile_introduction: plan,
  turn_completeness: { status: 'review_disabled', final_validation: { passed: true, policy: 'transport_only' },
    review_control: { enabled: false, source: 'project_setting' },
    follow_up: { usable: true }, question, writer_receipts },
})

test('profile pending question uses the writer receipt without reading wording or punctuation', () => {
  const receipt = leadProfilePendingQuestion('Una respuesta expresada de otra forma.', audit())
  assert.deepEqual(receipt, { id: 'lead_profile', act: 'profile', question: profileQuestion.text })
  assert.deepEqual(leadProfilePendingQuestion('¿Cuál es su nombre y dónde vive?', audit(null)), {})
})

test('a plan authorizes collection but cannot manufacture a delivered question', () => {
  assert.deepEqual(leadProfilePendingQuestion('¿Cuál es su nombre y dónde vive?', {
    profile_introduction: plan, turn_completeness: { status: 'review_disabled', final_validation: { passed: true } },
  }), {})
  assert.deepEqual(leadProfilePendingQuestion('Pregunta', { ...audit(), profile_introduction: { question_purpose: 'none' } }), {})
  assert.deepEqual(leadProfilePendingQuestion('Pregunta', audit({ ...profileQuestion, continuation_act: 'visit' })), {})
})

test('profile tracking accepts a typed pending receipt only without a writer question sheet', () => {
  assert.equal(leadProfilePendingQuestion('Texto opaco', { profile_introduction: plan,
    pending_question: { id: 'lead_profile', act: 'profile', question: profileQuestion.text } }).id, 'lead_profile')
  assert.deepEqual(leadProfilePendingQuestion('Texto opaco', { ...audit(null),
    pending_question: { id: 'lead_profile', act: 'profile', question: profileQuestion.text } }), {})
})

function remember(reply: string, writer_receipts: Row = {}, question: Row | null = profileQuestion) {
  return rememberLeadIntroduction({ previous: {}, planned: { reminder_count: 0 }, profile: {}, reply,
    audit: audit(question, writer_receipts), accepted: true, followUpUsable: true })
}

test('profile and brochure state follow typed receipts rather than the customer-facing response', () => {
  const absent = remember('Brochure: https://www.lavilett.com/brochure-la-vilet.pdf', {}, null)
  assert.equal(absent.brochure_sent, false)
  assert.equal(absent.presentation_sent, undefined)
  assert.equal(absent.request_sent, false)
  const delivered = remember('Otra forma de expresarlo.', { brochure_shared: true, project_presented: true })
  assert.equal(delivered.brochure_sent, true)
  assert.equal(delivered.presentation_sent, true)
  assert.equal(delivered.request_sent, true)
  assert.deepEqual(delivered.requested_fields, ['full_name', 'residence'])
  assert.equal(delivered.status, 'pending')
})

test('unaccepted transport never commits writer profile or brochure receipts', () => {
  const previous = { version: 3, brochure_sent: false }
  assert.deepEqual(rememberLeadIntroduction({ previous, planned: {}, profile: {}, reply: 'Texto',
    audit: audit(profileQuestion, { brochure_shared: true }), accepted: false, followUpUsable: true }), previous)
})

test('commercial output memory ignores reply text and historical bot phrasing when receipts are supplied', () => {
  const history = [{ role: 'bot', content: 'Tenemos crédito. ¿Le gustaría coordinar una visita? ¿Le gustaría que le muestre una opción?' }]
  const first = rememberSalesReply({}, history, 'Gracias', 'Tenemos crédito. ¿Le gustaría coordinar una visita?', undefined, {})
  const second = rememberSalesReply({}, history, 'Gracias', 'Hola.', undefined, {})
  assert.deepEqual(first, second)
  assert.equal(first.visit_invited, false)
  assert.equal(first.financing_mentioned, false)
  assert.equal(first.unit_options_offered, false)
})

test('commercial memory records delivered writer receipts and typed continuations', () => {
  const remembered = rememberSalesReply({}, [], 'Gracias', 'Texto opaco', undefined, {
    writerReceipts: { financing_mentioned: true, unit_options_offered: true },
    pendingQuestion: { id: 'visit_invitation', act: 'visit', question: 'Podemos organizar una visita.' },
  })
  assert.equal(remembered.visit_invited, true)
  assert.equal(remembered.financing_mentioned, true)
  assert.equal(remembered.unit_options_offered, true)
})

test('commercial memory still interprets customer finance questions and an evidenced refusal of a pending visit', () => {
  const remembered = rememberSalesReply({}, [], '¿Qué opciones de financiamiento tienen?', 'Texto opaco', undefined, {})
  assert.equal(remembered.financing_mentioned, true)
  const declined = rememberSalesReply({ visit_invited: true }, [], 'Ahora no', 'Texto opaco', {
    pendingQuestion: { id: 'visit_invitation', act: 'visit', question: 'Podemos organizar una visita.' },
    semantics: { answer_to_previous: { question_id: 'visit_invitation', kind: 'negative', confidence: 'high', evidence: 'Ahora no' } },
  }, {})
  assert.equal(declined.visit_declined, true)
})

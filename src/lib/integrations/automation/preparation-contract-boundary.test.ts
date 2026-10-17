import assert from 'node:assert/strict'
import test from 'node:test'
import { object } from './data'
import { leadIntroductionTurn, isProfileOnlyTurn } from './lead-introduction'
import { typedTurnFixture } from './fixtures/typed-turn.fixture'
import { replyLinkContract } from './response-plan'
import { BROCHURE_URL } from './project-material'
import { applyDecidedOpening, informationRequestOpening, variedReplyOpening, decidedOpening } from './response-openings'
import { unresolvedChoice } from './conversation-next-step'

for (const current of ['eh\nhola amigo', 'Buenas, ¿cómo le va?', 'Bonjour', '👋']) {
  test('profile preparation honors the shared social meaning: ' + current, () => {
    const extracted = typedTurnFixture(current)
    object(extracted.communication).kind = 'greeting_only'
    const turn = leadIntroductionTurn({ current, extracted, reply: 'Texto base sin modificar',
      audit: { source: 'project_overview' }, summary: {} })
    assert.equal(turn.applied, false)
    assert.equal(turn.reply, 'Texto base sin modificar')
    assert.equal(turn.audit.profile_introduction, undefined)
  })
}

for (const current of ['Prefiero guardar eso para mí', 'No quiero compartir mi nombre ni residencia', 'I would rather keep that private']) {
  test('profile refusal follows the extracted status without a phrase whitelist: ' + current, () => {
    const extracted = typedTurnFixture(current)
    extracted.lead_profile = { residence_status: 'declined', name_response: { status: 'declined' } }
    assert.equal(isProfileOnlyTurn(current, extracted), true)
    const turn = leadIntroductionTurn({ current, extracted, reply: 'Continuemos con su consulta',
      summary: { _lead_introduction: { status: 'pending', request_sent: true } } })
    assert.equal(object(turn.audit.profile_collection_decision).action, 'declined')
    assert.equal(object(turn.audit.profile_collection_decision).requires_question, false)
  })
}

test('a greeting with a substantive consultation retains that consultation and its profile policy', () => {
  const current = 'Hola amigo, quería conocer el proyecto', extracted = typedTurnFixture(current)
  extracted.requests = [{ domain: 'property', topics: ['project_overview'], request: 'Conocer el proyecto', evidence: current, confidence: 'high' }]
  object(extracted.turn_semantics).primary_intent = 'project_information'
  object(extracted.turn_semantics).primary_evidence = current
  object(extracted.turn_semantics).confidence = 'high'
  const turn = leadIntroductionTurn({ current, extracted, reply: '', audit: { source: 'project_overview' } })
  assert.equal(object(turn.audit.profile_collection_decision).action, 'capture')
  assert.deepEqual(object(turn.audit.profile_collection_decision).allowed_fields, ['full_name', 'current_residence'])
})

for (const reply of ['Con gusto. El 605 tiene tres dormitorios.', 'Buenos días. Los espacios exteriores tienen distintas áreas.',
  'No hemos confirmado una reserva; puedo explicarle el siguiente paso.', 'Hello! Let us review the selected home.']) {
  test('legacy opening helpers preserve every writer character: ' + reply, () => {
    const history = [{ role: 'bot', content: 'Con gusto. Aquí tiene información.' }]
    assert.equal(variedReplyOpening(reply, history), reply)
    assert.equal(informationRequestOpening(reply), reply)
    assert.equal(applyDecidedOpening(reply, 'Otra apertura', history), reply)
    assert.deepEqual(decidedOpening(reply, history), { prefix: '', removed_repetition: false })
  })
}

test('brochure and tour link obligations depend on typed intent, never words in the current message', () => {
  const url = 'https://www.lavilett.com/tour', current = 'Envíeme el brochure y el recorrido', extracted = typedTurnFixture(current)
  const neutral = replyLinkContract('', { unit_model: { url } }, { current, verified: { semantica_turno: extracted.turn_semantics } })
  assert.deepEqual(neutral.required_links, [])
  const positive = replyLinkContract('', { unit_model: { url }, brochure_intent: { requested: true } }, { current,
    verified: { semantica_turno: { ...object(extracted.turn_semantics), routing: { visual_target: 'unit' } } } })
  assert.deepEqual(new Set(positive.required_links), new Set([BROCHURE_URL, url]))
  const declined = replyLinkContract('', { unit_model: { url }, brochure_intent: { requested: false, reason: 'declined' } }, { current,
    verified: { semantica_turno: { routing: { visual_target: 'unit', visual_preference: 'decline' } } } })
  assert.deepEqual(declined.required_links, [])
})

test('a choice with several candidates needs a typed answer; the word o never establishes ambiguity', () => {
  const current = 'O sea, sí', pending = { id: 'unit_choice', act: 'choose_unit', candidate_ids: ['u602', 'u605'],
    question: '¿Qué unidad le gustaría revisar?' }, extracted = typedTurnFixture(current)
  assert.equal(unresolvedChoice(current, pending), null)
  object(extracted.turn_semantics).answer_to_previous = { question_id: 'unit_choice', kind: 'affirmative', evidence: current, confidence: 'high' }
  assert.equal(unresolvedChoice(current, pending, extracted)?.question, pending.question)
  object(extracted.turn_semantics).unit_choice = { kind: 'selected', unit_numbers: ['605'], evidence: current, confidence: 'high' }
  assert.equal(unresolvedChoice(current, pending, extracted), null)
})

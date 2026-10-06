import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { object, type Row } from './data'
import { leadIntroductionTurn, leadProfilePendingQuestion, leadProfileQuestionIssues, rememberLeadIntroduction } from './lead-introduction'
import { finalWriterContract } from './response-plan'
import { focusedReviewIssues, FOCUSED_REVIEW_VERSION, reviewObligations } from './focused-review'
import { BROCHURE_URL } from './project-material'

const name = { full_name: 'Carlos', evidence: { full_name: 'Me llamo Carlos' },
  sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Carlos' } } }
const requested: Row = { version: 3, status: 'pending', request_sent: true,
  requested_fields: ['full_name', 'residence'], reminder_count: 0, brochure_sent: false }
const profileQuestion = { text: '¿En qué ciudad vive actualmente?', purpose: 'collect_lead_profile',
  role: 'required_collection', missing_datum: 'current_residence', next_decision: 'Continuar la guía personalizada.',
  continuation_id: 'lead_profile_residence', continuation_act: 'profile' }
const step = (current: string, previous = requested, profile: Row = name, extra: Row = {}) => leadIntroductionTurn({
  current, summary: { _lead_introduction: previous, _lead_profile: name }, extracted: { lead_profile: profile,
    turn_semantics: { primary_intent: current.includes('precio') ? 'ask_price' : 'provide_profile', confidence: 'high' } },
  reply: 'Los precios son referenciales de lanzamiento y pueden cambiar. ¿Busca vivienda o un local para su negocio?',
  audit: { source: current.includes('precio') ? 'unit_price' : 'commercial' }, ...extra,
})
const remember = (turn: ReturnType<typeof step>, previous = requested, question: Row = profileQuestion,
  reply = turn.reply, accepted = true) => rememberLeadIntroduction({ previous, planned: turn.state, profile: name, reply,
  accepted, followUpUsable: true, audit: { ...turn.audit, turn_completeness: { status: 'checked', question } } })

describe('authorized profile capture and continued needs identification', () => {
  it('permits one residence reminder after a name-only answer and never insists on later name or price turns', () => {
    const partial = step('Me llamo Carlos')
    const decision = object(partial.audit.profile_collection_decision)
    assert.equal(decision.action, 'remind')
    assert.deepEqual(decision.allowed_fields, ['current_residence'])
    assert.deepEqual(decision.allowed_question_ids, ['lead_profile_residence'])
    assert.equal(decision.reminders_sent, 0)
    assert.ok(partial.reply.includes(BROCHURE_URL))
    const sent = remember(partial)
    assert.equal(sent.reminder_count, 1)
    for (const current of ['Me llamo Carlos', '¿Y qué precio tiene?', 'Me llamo Carlos, ¿y qué precio tiene?']) {
      const next = step(current, sent)
      const policy = object(next.audit.profile_collection_decision)
      assert.equal(policy.action, 'defer', current)
      assert.deepEqual(policy.allowed_question_ids, [], current)
      assert.equal(policy.reason, 'reminder_limit_reached', current)
      assert.match(next.reply, /vivienda o un local|información de alguna de estas opciones/)
      assert.doesNotMatch(next.reply, /ciudad|país|reside|vive actualmente/)
      assert.equal(next.state.reminder_count, 1)
    }
  })

  it('answers the commercial question before one residence reminder when the lead supplies only their name', () => {
    const turn = step('Me llamo Carlos\ny qué precio tiene?')
    const decision = object(turn.audit.profile_collection_decision)
    assert.equal(decision.action, 'remind')
    assert.equal(decision.reason, 'partial_profile_answer')
    assert.deepEqual(decision.allowed_fields, ['current_residence'])
    assert.match(turn.reply, /Mucho gusto, Carlos/)
    assert.match(turn.reply, /Los precios son referenciales/)
    assert.match(turn.reply, /en qué ciudad o país reside actualmente/)
    assert.ok(turn.reply.indexOf('Los precios son referenciales') < turn.reply.indexOf('reside actualmente'))
    assert.doesNotMatch(turn.reply, /¿Busca vivienda o un local/)
    assert.match(String(turn.state.continuation_reply), /vivienda o un local/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
    const contract = finalWriterContract(turn.reply, turn.audit, { current: 'Me llamo Carlos, y qué precio tiene?', verified: { perfil_lead: name } })
    assert.equal(object(contract.estado_comercial).requiere_captura, true)
    assert.deepEqual(object(object(contract.estado_comercial).profile_collection_decision), decision)
    assert.deepEqual(leadProfileQuestionIssues(profileQuestion, turn.audit), [])
    const sent = remember(turn)
    assert.equal(sent.reminder_count, 1)
    assert.equal(sent.collection_status, 'awaiting')
    assert.equal(sent.brochure_sent, true)
    const ignored = step('Quiero una vivienda', sent, {}, { reply: 'Tenemos opciones para vivienda. ¿Cuántos dormitorios necesita?' })
    assert.equal(object(ignored.audit.profile_collection_decision).action, 'defer')
    assert.match(ignored.reply, /Cuántos dormitorios necesita/)
    assert.doesNotMatch(ignored.reply, /reside|ciudad|país/)
    assert.equal(ignored.state.reminder_count, 1)
  })

  it('keeps the current needs continuation after a mixed name and price answer instead of a previous generic presentation', () => {
    const prior = { ...requested, continuation_reply: '¿Busca vivienda o un local para su negocio?' }
    const turn = step('Me llamo Carlos. ¿Qué precios tienen los departamentos de 3 dormitorios?', prior, name, {
      reply: 'Estos departamentos tienen precios referenciales desde $250.000. ¿Qué planta prefiere?',
      extracted: { lead_profile: name, turn_semantics: { primary_intent: 'ask_price', confidence: 'high',
        property: { category: 'departamento', filters: { bedrooms: 3 } } } },
      summary: { _lead_introduction: prior, _lead_profile: name,
        _property_context: { query: { category: 'departamento', filters: { bedrooms: 3 } } } },
    })
    assert.match(turn.reply, /precios referenciales desde \$250.000/)
    assert.match(turn.reply, /reside actualmente/)
    assert.doesNotMatch(turn.reply, /Qué planta|vivienda o un local/)
    assert.equal(turn.state.continuation_reply, '¿Qué planta prefiere?')
    const sent = remember(turn, prior)
    const resumed = step('Vivo en Quito', sent, { residence_city: 'Quito', residence_status: 'confirmed' }, {
      summary: { _lead_introduction: sent, _lead_profile: name,
        _property_context: { query: { category: 'departamento', filters: { bedrooms: 3 } } } },
      reply: 'El proyecto ofrece departamentos de 3 dormitorios.',
    })
    assert.match(resumed.reply, /Qué planta prefiere/)
    assert.doesNotMatch(resumed.reply, /Cuántos dormitorios|vivienda o un local|reside actualmente/)
  })

  it('does not let a profile-only name answer or a mixed query replace a protected operation question', () => {
    for (const source of ['financing', 'visit_intake', 'reservation_handoff']) for (const current of ['Me llamo Carlos', 'Me llamo Carlos, ¿qué precio tiene?']) {
      const reply = source === 'financing' ? '¿Me confirma sus apellidos completos para la revisión?'
        : source === 'visit_intake' ? '¿Qué horario prefiere para la cita?' : 'El equipo continuará su solicitud de reserva.'
      const turn = step(current, requested, name, { reply, audit: { source } })
      assert.equal(object(turn.audit.profile_collection_decision).action, 'defer', `${source}: ${current}`)
      assert.ok(turn.reply.includes(reply), source)
      assert.doesNotMatch(turn.reply, /reside|ciudad|país|brochure/)
      assert.equal(turn.state.reminder_count, 0)
    }
  })

  it('does not demand ignored or refused data, but keeps answering and receiving spontaneous profile facts', () => {
    for (const current of ['¿Qué precio tiene?', 'Prefiero no dar mis datos']) {
      const turn = step(current, requested, {}, { summary: { _lead_introduction: requested } })
      const decision = object(turn.audit.profile_collection_decision)
      assert.equal(decision.action, current.includes('Prefiero') ? 'declined' : 'defer')
      assert.deepEqual(decision.allowed_fields, [])
      assert.ok(turn.reply.includes(BROCHURE_URL))
      assert.doesNotMatch(turn.reply, /reside|ciudad|país|indicarnos su nombre/)
      assert.match(turn.reply, /vivienda o un local|información de alguna de estas opciones/)
      assert.deepEqual(leadProfileQuestionIssues(profileQuestion, turn.audit), ['lead_profile_question_not_authorized'])
    }
    const declined = { ...requested, collection_status: 'declined', status: 'complete', brochure_sent: true }
    const voluntary = step('Me llamo Carlos', declined)
    assert.match(voluntary.reply, /Mucho gusto, Carlos/)
    assert.equal(object(voluntary.audit.profile_collection_decision).action, 'declined')
    assert.doesNotMatch(voluntary.reply, /reside|ciudad|país/)
  })

  it('honors a normalized semantic residence refusal without a prescribed refusal phrase', () => {
    const turn = step('Ese detalle prefiero mantenerlo privado', requested,
      { residence_status: 'declined', evidence: { residence_response: 'Ese detalle prefiero mantenerlo privado' } })
    assert.equal(object(turn.audit.profile_collection_decision).action, 'declined')
    assert.deepEqual(object(turn.audit.profile_collection_decision).allowed_fields, [])
    assert.equal(turn.state.collection_status, 'declined')
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(turn.reply, /reside|ciudad|país/)
    const next = step('Me llamo Carlos', turn.state)
    assert.equal(object(next.audit.profile_collection_decision).action, 'declined')
    assert.doesNotMatch(next.reply, /reside|ciudad|país/)
  })

  it('distinguishes one clarification of origin from a confirmed residence in another city', () => {
    const origin = { ...name, declared_location: { city: 'Cuenca', kind: 'origin', evidence: 'Soy de Cuenca' },
      residence_candidate: { city: 'Cuenca', evidence: 'Soy de Cuenca' }, residence_status: 'pending_confirmation' }
    const clarification = step('Soy Carlos, soy de Cuenca', requested, origin)
    assert.equal(object(clarification.audit.profile_collection_decision).action, 'confirm')
    assert.match(clarification.reply, /Es también su lugar de residencia actual/)
    assert.ok(!clarification.reply.includes(BROCHURE_URL))
    const confirmed = step('Pero vivo en Quito', clarification.state, { residence_city: 'Quito', residence_status: 'confirmed' },
      { summary: { _lead_introduction: clarification.state, _lead_profile: origin } })
    assert.equal(object(confirmed.audit.profile_collection_decision).action, 'complete')
    assert.ok(confirmed.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(confirmed.reply, /Cuenca|reside|residencia actual/)
    assert.match(confirmed.reply, /información de alguna de estas opciones/)
    assert.deepEqual(leadProfileQuestionIssues(profileQuestion, confirmed.audit), ['lead_profile_question_not_authorized'])
  })

  it('counts only an accepted, authorized and actually emitted residence question, including review-disabled receipts', () => {
    const partial = step('Me llamo Carlos')
    assert.equal(remember(partial, requested, profileQuestion, partial.reply, false).reminder_count, 0)
    const omitted = remember(partial, requested, { purpose: 'none', continuation_id: 'none', continuation_act: 'other' }, 'Mucho gusto, Carlos.')
    assert.equal(omitted.reminder_count, 0)
    const wrong = { ...profileQuestion, continuation_id: 'lead_profile_name' }
    assert.deepEqual(leadProfileQuestionIssues(wrong, partial.audit), ['lead_profile_question_mismatch'])
    assert.deepEqual(leadProfilePendingQuestion(partial.reply, { ...partial.audit, turn_completeness: { status: 'checked', question: wrong } }), {})
    assert.equal(remember(partial, requested, wrong).reminder_count, 0)
    const audit = { ...partial.audit, turn_completeness: { status: 'review_disabled', question: { purpose: 'none', continuation_id: 'none', continuation_act: 'other' },
      review_control: { enabled: false, source: 'project_setting' }, final_validation: { policy: 'transport_only', passed: true } } }
    const withoutQuestion = rememberLeadIntroduction({ previous: requested, planned: partial.state, profile: name,
      reply: `Mucho gusto, Carlos. ${BROCHURE_URL}`, accepted: true, followUpUsable: true, audit })
    assert.equal(withoutQuestion.reminder_count, 0)
    assert.equal(withoutQuestion.brochure_sent, true)
  })

  it('requires an explicit semantic no-capture verdict when profile collection has been deferred', () => {
    const turn = step('¿Y qué precio tiene?', requested, {})
    const contract = finalWriterContract(turn.reply, turn.audit, { verified: { perfil_lead: name } })
    const permission = reviewObligations(turn.audit, {}, contract).find(row => row.id === 'profile_collection_permission')!
    assert.equal(permission.action, 'defer')
    assert.match(String(permission.instruction), /no se autoriza solicitar ni confirmar nombre o residencia/)
    const sentences = [{ id: 'S1', text: '¿Dónde vive actualmente?' }]
    const result = focusedReviewIssues({ review_contract: FOCUSED_REVIEW_VERSION, claims: [], factual_values: [], project_values: [],
      non_factual_sentence_ids: ['S1'], pending_checks: [], obligation_checks: [{ id: permission.id,
        verdict: 'violated', sentence_ids: ['S1'], reason: 'Solicita residencia a pesar de estar pospuesta.' }] }, sentences, [permission])
    assert.ok(result.issues.some(issue => issue.kind === 'commercial_content' && issue.obligation_id === permission.id))
    const unanswered = focusedReviewIssues({ review_contract: FOCUSED_REVIEW_VERSION, claims: [], factual_values: [], project_values: [],
      non_factual_sentence_ids: ['S1'], pending_checks: [], obligation_checks: [] }, sentences, [permission])
    assert.ok(unanswered.issues.some(issue => issue.code === 'invalid_obligation_review'))
  })
})

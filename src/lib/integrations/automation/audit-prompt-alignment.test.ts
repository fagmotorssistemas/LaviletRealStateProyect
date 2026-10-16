import test from 'node:test'
import assert from 'node:assert/strict'
import { CURRENT_TONE } from './conversation-tone'
import { toneDirection } from '@/lib/inmobiliaria/conversationTone'
import { DIALOGUE_WRITING_RULES } from './dialogue-writing-rules'
import { FINAL_WRITER_RULES, commercialStageContract, finalWriterContract } from './response-plan'
import { LEAD_INTRODUCTION_RULES, leadIntroductionTurn } from './lead-introduction'
import { RESPONSE_CONTENT_SCOPE_RULES } from './response-content-scope'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { BROCHURE_URL } from './project-material'
import { object, type Row } from './data'

const profileDecision = { version: 'profile-collection-v1', requires_question: true,
  action: 'capture', allowed_fields: ['full_name', 'current_residence'] }
const summary = 'La Vilet reúne suites, departamentos, penthouses y locales comerciales en Cuenca.'

// These assert the actual model contract, not whether generated prose contains
// particular greeting words. The server must leave that prose to the writer.
for (const firstContact of [true, false]) {
  test(`a greeting is controlled by conversation state, including the first information request: ${firstContact}`, async () => {
    const current = 'Me gustaría tener más información sobre una suite'
    const draft = firstContact ? 'Bienvenida a La Vilet. Podemos orientarle sobre las suites.'
      : 'Las suites ofrecen distintas distribuciones para que pueda comparar las opciones.'
    const verified: Row = { historial: firstContact ? [] : [
      { role: 'bot', content: 'Buenos días. Somos La Vilet. ¿En qué podemos orientarle?' },
    ] }
    const audit = { source: 'commercial', ...(firstContact ? { writer_greeting: 'Buenos días' } : {}) }
    const result = await withResponseReviewPolicy({ enabled: false, observationOnly: false, updatedAt: null }, () => completeTurnReply({
      current, baseReply: draft, verified, audit,
    }, async (rules, input, _schema, _image, _file, _tone, task) => {
      assert.equal(task, 'writing', 'disabled review must not gain a model invocation')
      const contract = object(object(input).contrato_redaccion)
      assert.equal(object(contract.saludo).requerido, firstContact)
      assert.match(String(rules), /con false continúe directamente, sin otro saludo ni presentación/)
      return { reply: draft, question: null, requests: [] }
    }))
    assert.equal(result.reply, draft, 'delivery preserves the writer message verbatim')
    assert.equal(result.needsAdvisor, false)
  })
}

test('all greeting directions respect a continuation, including a high warmth profile and verified time', () => {
  const warm = toneDirection({ style: 'cercano', warmth: 2, detail: 2 })
  for (const instructions of [warm, CURRENT_TONE.neutralGreeting, CURRENT_TONE.completeGreeting, FINAL_WRITER_RULES]) {
    assert.match(instructions, /saludo\.requerido/)
  }
  assert.doesNotMatch(warm, /En la primera solicitud de información, acompañe el saludo/)
  assert.match(CURRENT_TONE.neutralGreeting, /hora verificada orienta el saludo autorizado, no autoriza uno nuevo/)
  assert.match(FINAL_WRITER_RULES, /primera consulta de información no reinicia la conversación/)
})

test('an approved mixed-use summary and a generic introduction permit categories consistently', () => {
  const profile = { generic_introduction: true, brochure_deferred: true, question_purpose: 'collect_profile',
    collection_decision: profileDecision, presentation: { required: true, approved_summary: summary } }
  const contract = finalWriterContract('', { profile_introduction: profile })
  assert.equal(object(contract.estado_comercial).presentacion_sin_tipos, false)
  assert.equal(object(contract.presentacion).summary, summary)
  assert.match(DIALOGUE_WRITING_RULES, /generic_introduction=true por sí solo no prohíbe categorías/)
  assert.match(LEAD_INTRODUCTION_RULES, /generic_introduction=true por sí solo no restringe las categorías/)
  assert.doesNotMatch(DIALOGUE_WRITING_RULES, /Si generic_introduction=true, no introduzca todavía tipos/)
})

test('the basic introduction still postpones categories when no approved summary exists', () => {
  const stage = commercialStageContract({ profile_introduction: { generic_introduction: true, brochure_deferred: true,
    question_purpose: 'collect_profile', collection_decision: profileDecision, presentation: { required: true } } })
  assert.equal(stage.presentacion_sin_tipos, true)
  assert.equal(object(stage.objetivo_presentacion).link_offer_to_profile_request, true)
  assert.equal(object(stage.objetivo_presentacion).mandatory_justification, false,
    'linking the offer and request never imposes a fixed explanation or phrase')
  assert.equal(object(stage.brochure).accion, 'offer_after_profile')
})

test('brochure sequence links the offer to missing data without removing authorized delivery exceptions', () => {
  const prior = { status: 'pending', request_sent: true, requested_fields: ['full_name', 'residence'], reminder_count: 0 }
  const first = leadIntroductionTurn({ current: 'Quiero información', reply: 'Podemos ampliarle la información.', audit: { source: 'project_overview' } })
  const initial = commercialStageContract(first.audit)
  assert.equal(object(initial.brochure).accion, 'offer_after_profile')
  assert.equal(object(initial.objetivo_presentacion).link_offer_to_profile_request, true)
  for (const current of ['Envíeme el brochure', 'Prefiero no dar mis datos', 'Pero dígame el precio de los departamentos']) {
    const turn = leadIntroductionTurn({ current, reply: 'Podemos continuar con su consulta.',
      summary: { _lead_introduction: prior }, audit: { source: current === 'Envíeme el brochure' ? 'brochure' : 'commercial' } })
    const stage = commercialStageContract(turn.audit)
    assert.equal(object(stage.brochure).accion, 'share_now', current)
    assert.equal(stage.requiere_captura, false, current)
    assert.equal(stage.objetivo_presentacion, null, current)
    assert.equal(object(stage.brochure).url, BROCHURE_URL)
  }
})

test('presentation asks for a preferred name; an accepted financing process retains its own legal identity stage', () => {
  assert.match(LEAD_INTRODUCTION_RULES, /pida el nombre de presentación/)
  assert.match(LEAD_INTRODUCTION_RULES, /identidad legal completa y la cédula pertenecen al trámite financiero expresamente aceptado/)
  const legalQuestion = '¿Podría indicarme sus nombres y apellidos legales completos?'
  const turn = leadIntroductionTurn({ current: 'Sí, iniciemos la revisión', reply: legalQuestion,
    audit: { source: 'financing_collection', financing_collection: { collection_allowed: true, requested_fields: ['full_name'] } } })
  assert.equal(turn.reply, legalQuestion)
  assert.equal(turn.applied, false)
})

test('writer scope and introduction rules no longer grant the factual reviewer workflow authority', () => {
  assert.doesNotMatch(RESPONSE_CONTENT_SCOPE_RULES, /El revisor comprueba tanto respaldo factual como pertinencia|El revisor comprueba el propósito/)
  assert.doesNotMatch(LEAD_INTRODUCTION_RULES, /el revisor comprueba su significado|El revisor comprueba que se piden únicamente/)
  assert.match(RESPONSE_CONTENT_SCOPE_RULES, /no evalúa pertinencia, preguntas ni continuidad/)
  assert.match(LEAD_INTRODUCTION_RULES, /no evalúa la captura, la secuencia ni la continuidad/)
})

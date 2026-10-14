import test from 'node:test'
import assert from 'node:assert/strict'
import { protectInitialProjectPresentation } from './response-plan'
import { informationRequestOpening } from './response-openings'
import { completeTurnReply } from './turn-completeness'
import { leadIntroductionTurn } from './lead-introduction'
import { withResponseReviewPolicy } from './response-review-policy'
import { resolveTurnIntent } from './turn-intent'
import { toneDirection } from '@/lib/inmobiliaria/conversationTone'
import { configuredToneInstructions } from './tone-settings'
import { object, type Row } from './data'

const summary = 'La Vilet es un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca, con suites, departamentos, penthouses y locales comerciales.'
const presentation = 'La Vilet está ubicada en Puertas del Sol, Cuenca, y cuenta con suites, departamentos, penthouses y locales comerciales.'
const question = '¿Podría indicarme su nombre y en qué ciudad o país reside actualmente?'
const draft = `Hola, con gusto le comparto información. ${presentation}\n\nPara compartirle el brochure con los planos, ${question}`
const initial = { profile_introduction: { generic_introduction: true, stage: 'request', reason: 'first_substantive_project_contact',
  question, presentation: { required: true, approved_summary: summary } } }

test('a completed writer presentation survives both final preparation passes verbatim', () => {
  for (const status of ['checked', 'review_observed', 'review_disabled']) {
    const audit = { ...initial, turn_completeness: { status, initial_presentation: { source: 'writer' } } }
    const first = protectInitialProjectPresentation(draft, audit)
    assert.equal(first, draft)
    assert.equal(protectInitialProjectPresentation(first, audit), draft)
    assert.ok(first.includes(question))
  }
})

test('an incomplete or rejected route draft still uses the approved summary and a warm opening', () => {
  for (const status of ['unavailable', 'rejected_guard', 'rejected_review']) {
    const audit = { ...initial, turn_completeness: { status, initial_presentation: { source: 'writer' } } }
    const reply = protectInitialProjectPresentation('Hola. Los precios comienzan en $1.', audit)
    assert.match(reply, /^Con mucho gusto le comparto información\./)
    assert.ok(reply.includes(summary))
    assert.ok(reply.endsWith(question))
    assert.doesNotMatch(reply, /\$1/)
    assert.equal(protectInitialProjectPresentation(reply, audit), reply)
  }
})

test('an information opening recognizes an existing greeting and courtesy without doubling either', () => {
  assert.equal(informationRequestOpening(draft), draft)
  const warmed = informationRequestOpening(`Hola. ${presentation}`)
  assert.equal(informationRequestOpening(warmed), warmed)
})

for (const mode of ['blocking', 'observation', 'disabled']) {
  test(`the full writer and delivery preparation preserve the warm paraphrase: ${mode}`, async () => {
    const current = 'hola\nquiero informacion porfavor'
    const requests = [{ domain: 'property', confidence: 'high', topics: ['project_overview'], request: 'Información general', evidence: 'quiero informacion porfavor' }]
    const semantics = { primary_intent: 'project_information', primary_evidence: 'quiero informacion porfavor', confidence: 'high', requests,
      property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] }, budget: { status: 'not_discussed' } }
    const info: Row = { proyecto: { name: 'La Vilet' }, semantica_turno: semantics, solicitudes_interpretadas: requests,
      configuracion_presentacion_proyecto: { available: true, summary, source: 'Responsable del proyecto' },
      contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'property', uncertain: false } }) }
    const intro = leadIntroductionTurn({ current, projectInfo: info, extracted: { requests, turn_semantics: semantics },
      reply: '¿Qué desea conocer?', audit: { source: 'project_overview', resolved_turn_intent: info.contrato_turno } })
    let reviews = 0
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'observation', updatedAt: null }, () => completeTurnReply({
      current, baseReply: intro.reply, verified: info,
      audit: { ...intro.audit, writer_greeting: 'Hola', semantic_review_enabled: true, business_risk_review_enabled: true },
    }, async (_rules, input, _schema, _image, _file, _tone, task) => {
      if (task === 'writing') return { reply: draft, question: { text: question, purpose: 'collect_lead_profile', role: 'required_collection',
        missing_datum: 'Nombre y residencia actual', next_decision: 'collect_profile', continuation_id: 'lead_profile', continuation_act: 'profile' },
        requests: (object(input).referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id, intent: 'Información general',
          request_type: 'general_information', status: 'answered', evidence: presentation, fact_key: null })) }
      reviews++
      assert.equal(object(input).borrador, draft)
      return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: null }
    }))
    assert.equal(result.reply, draft)
    assert.equal(result.needsAdvisor, false)
    assert.equal(reviews, mode === 'disabled' ? 0 : 1)
    assert.equal(object(result.audit.initial_presentation).source, 'writer')
    const audit = { ...intro.audit, turn_completeness: result.audit }
    assert.equal(protectInitialProjectPresentation(result.reply, audit, { current, verified: info }), draft)
    assert.equal(protectInitialProjectPresentation(draft, audit, { current, verified: info }), draft)
  })
}

test('high warmth gives positive instructions and the reviewer receives no tone profile', async () => {
  const settings = { style: 'cercano' as const, warmth: 2, detail: 2 }
  const directions = toneDirection(settings)
  assert.match(directions, /lenguaje cotidiano/)
  assert.match(directions, /acompañe el saludo con una apertura amable/)
  assert.match(directions, /conecte naturalmente la respuesta con el siguiente paso/)
  assert.match(directions, /sin imponerla en todos los mensajes/)
  assert.doesNotMatch(directions, /Los criterios de revisión deben aceptar/)
  assert.equal(await configuredToneInstructions('Compruebe hechos.', settings, 'review'), 'Compruebe hechos.')
  assert.equal(await configuredToneInstructions('Extraiga datos.', settings, 'data'), 'Extraiga datos.')
})

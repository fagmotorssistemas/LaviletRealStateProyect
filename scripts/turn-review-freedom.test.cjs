/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { completeTurnReply, turnCompletenessIssues } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { checkReviewDecision } = require('../src/lib/integrations/automation/turn-review-checks.ts')
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true,
  operational_goal_preserved: true, question_has_purpose: true, question: { purpose: 'none', missing_datum: '', next_decision: '', clarifies: [] }, missing_fact_fragments: [], review_issues: [], claims: [], factual_values: [] }
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '' }
const candidate = (current, reply) => ({ reply, requests: [{ fragment: current, intent: 'Orientar la consulta actual',
  request_type: 'general_information', status: 'answered', evidence: 'Responde la inquietud con los hechos y orientación pertinente', fact_key: null }], question: noQuestion })
const guidance = fragment => ({ fragment, subject: 'Distribución familiar', polarity: 'uncertainty', claim_kind: 'contextual_guidance',
  verdict: 'supported', evidence: 'Orientación condicionada a sus necesidades, sin garantizar comodidad ni capacidad.', evidence_source: 'contextual_reasoning', evidence_ids: [] })
function sequence(...answers) {
  const calls = []
  return { calls, generate: async (...args) => {
    calls.push(args)
    assert.ok(answers.length, 'No debe exceder las llamadas previstas')
    const answer = answers.shift()
    return typeof answer === 'function' ? answer(...args) : answer
  } }
}

test('family suitability guidance survives the full writer/reviewer/catalogue pipeline without an imposed question', async () => {
  const current = '¿Me alcanzarán tres dormitorios para una familia de seis?'
  const facts = 'Disponemos de departamentos y penthouses de tres dormitorios.'
  const advice = 'Para seis personas podrían resultar ajustados, según cómo prefieran distribuirse; algunas familias comparten habitaciones.'
  const ending = 'Podemos revisar las distribuciones para que evalúen si se adaptan a sus necesidades.'
  const reply = `${facts} ${advice} ${ending}`
  const units = [{ id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3 },
    { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3 }]
  const input = { current, baseReply: 'Departamento 202: 3 dormitorios. Penthouse 602: 3 dormitorios. ¿Cuál desea?',
    verified: { catalogo: units }, audit: { semantic_review_enabled: true, verified_catalog: true, catalog_results: { units } } }
  const mock = sequence(candidate(current, reply), (_rules, context) => ({ ...approved,
    claims: [{ fragment: 'S1', subject: 'Opciones de vivienda', polarity: 'affirmation', claim_kind: 'project_fact', verdict: 'supported',
      evidence: 'Ambas categorías tienen opciones de tres dormitorios.', evidence_source: 'verified_context',
      evidence_ids: context.evidencia_afirmaciones.filter(source => source.path.startsWith('evidencia_turno.units.')).map(source => source.id) },
    guidance(advice), guidance(ending)],
    factual_values: units.map(unit => ({ fragment: 'S1', unit_id: unit.id, field: 'bedrooms', value: 3, operator: 'eq', upper_value: null })) }))
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.question.purpose, 'none')
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(mock.calls.length, 2)
  assert.equal(mock.calls[0][1].respuesta_base, undefined)
  assert.equal(mock.calls[0][2].properties.requests.items.required.includes('base_status'), false)
  assert.equal(mock.calls[1][2].required.includes('review_issues'), true)
})

test('an unexplained reviewer veto is repaired as metadata while preserving the draft byte for byte', async () => {
  const current = '¿Podríamos compartir habitaciones?'
  const reply = 'Algunas familias comparten habitaciones; conviene evaluar cómo prefieren distribuirse.'
  const review = { ...approved, claims: [guidance(reply)] }
  const mock = sequence(candidate(current, reply), { ...review, answers_supported: false }, review)
  const result = await completeTurnReply({ current, baseReply: '¿Cuántos dormitorios necesita?', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.equal(result.audit.repair_attempts[0].issues[0].code, 'unexplained_review_failure')
  assert.equal(mock.calls[2][1].respuesta_propuesta, reply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'review'])
})

test('editorial preferences are observable without vetoing a supported answer', async () => {
  const current = '¿Podemos evaluar las distribuciones?'
  const reply = 'Podemos revisar las distribuciones según sus necesidades.'
  const review = { ...approved, claims: [guidance(reply)], question_has_purpose: false, answered_content_preserved: false,
    review_issues: [{ check: 'answered_content_preserved', kind: 'editorial', source: 'draft', fragment: reply,
      reason: 'Sería posible terminar con una pregunta, pero la respuesta atiende la consulta.' }] }
  const mock = sequence(candidate(current, reply), review)
  const result = await completeTurnReply({ current, baseReply: '¿Qué unidad desea?', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.editorial_observations.length, 1)
  assert.equal(mock.calls.length, 2)
})

test('catalogue facts absent from the draft can be removed by reviewer repair without rewriting a greeting', async () => {
  const current = 'Gracias, soy Carlos'
  const reply = 'Mucho gusto, Carlos.'
  const unit = { id: 'd202', unit_number: '202', category: 'departamento', published_commercial_price: 210000 }
  const bad = { ...approved, factual_values: [{ fragment: 'S1', unit_id: 'd202', field: 'published_commercial_price', value: 210000, operator: 'eq', upper_value: null }] }
  const mock = sequence(candidate(current, reply), bad, approved)
  const result = await completeTurnReply({ current, baseReply: 'Hola.', verified: { catalogo: [unit] }, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.equal(result.audit.repair_attempts[0].issues[0].code, 'numeric_relation_not_in_reply')
})

test('a persistent review defect uses bounded recovery and never a catalogue list as an answer to suitability', async () => {
  const current = '¿Será cómodo para mi familia?'
  const reply = 'Podemos evaluar las distribuciones según sus necesidades.'
  const bad = { ...approved, claims: [guidance('Esta afirmación no aparece en el borrador.')] }
  const mock = sequence(candidate(current, reply), bad, bad)
  const result = await completeTurnReply({ current, baseReply: 'Departamento 202: tres dormitorios. Penthouse 602: tres dormitorios.',
    verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.equal(result.audit.recovery.pending, true)
  assert.equal(result.audit.recovery.base_used, false)
  assert.doesNotMatch(result.reply, /202|602|tres dormitorios/)
  assert.match(result.reply, /pendiente/)
  assert.equal(result.needsAdvisor, false)
  assert.equal(mock.calls.length, 3)
})

test('content defects require a literal, current reason and trigger a localized rewrite with independent review', async () => {
  const current = '¿Será cómodo para mi familia?'
  const draft = 'Tenemos opciones de vivienda.'
  const repaired = 'La comodidad depende de cómo prefieran distribuirse; podemos revisar las distribuciones.'
  const badReview = { ...approved, all_requests_considered: false, review_issues: [{ check: 'all_requests_considered', kind: 'content',
    source: 'current_request', fragment: current, reason: 'La respuesta enumera categorías sin atender la inquietud sobre comodidad.' }] }
  const mock = sequence(candidate(current, draft), badReview, candidate(current, repaired), { ...approved, claims: [guidance(repaired)] })
  const result = await completeTurnReply({ current, baseReply: draft, verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, repaired)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.repair_attempts[0].target, 'commercial_draft')
  assert.equal(mock.calls.length, 4)
  const invalid = checkReviewDecision({ ...badReview, review_issues: [{ ...badReview.review_issues[0], fragment: 'consulta antigua' }] }, current, draft)
  assert.equal(invalid.issues[0].kind, 'review_metadata')
})

test('reviewed household distribution advice permits digits as well as words without inventing property attributes', async () => {
  const current = 'Somos seis, ¿podría funcionar para nuestra familia?'
  for (const count of ['2', 'dos']) {
    const reply = `Podrían distribuirse de a ${count} por habitación, si esa opción les resulta cómoda; podemos evaluar sus preferencias.`
    const mock = sequence(candidate(current, reply), { ...approved, claims: [guidance(reply)] })
    const result = await completeTurnReply({ current, baseReply: '¿Cuántos dormitorios desea?', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit.final_validation))
    assert.equal(result.reply, reply)
    assert.equal(mock.calls.length, 2)
  }
})

test('a template cannot authorize a completed action, while a verified receipt can be worded freely', () => {
  const draft = 'Hemos registrado su solicitud.'
  const input = { current: 'Quiero solicitar una visita', verified: {}, baseReply: draft }
  assert.ok(turnCompletenessIssues(input, draft, noQuestion).includes('new_operational_claim'))
  assert.deepEqual(turnCompletenessIssues({ ...input, baseReply: 'Su solicitud está registrada.',
    audit: { registration_verified: true, action: 'submitted' } }, draft, noQuestion), [])
})

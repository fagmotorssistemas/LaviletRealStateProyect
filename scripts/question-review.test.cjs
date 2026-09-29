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
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { leadProfilePendingQuestion } = require('../src/lib/integrations/automation/lead-introduction.ts')

const profileQuestion = { purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia actual',
  next_decision: 'Compartir el brochure y orientar según su interés', clarifies: [] }
const writerProfileQuestion = { purpose: profileQuestion.purpose, missing_datum: profileQuestion.missing_datum,
  next_decision: profileQuestion.next_decision }
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true,
  operational_goal_preserved: true, question_has_purpose: true, missing_fact_fragments: [], review_issues: [] }
const current = 'Buenas tardes, estoy interesado'
const project = 'La Vilet está ubicada en Puertas del Sol, Cuenca.'
const actualQuestion = '¿podría indicarme su nombre y en qué ciudad o país reside actualmente?'
const goodReply = `${project} Para compartirle el brochure y brindarle una guía personalizada, ${actualQuestion}`
function profileInput() {
  const profile = { sources: {}, residence_status: 'unknown' }
  return { current, baseReply: goodReply, verified: { project, lead: { name: null }, perfil_lead: profile },
    audit: { source: 'project_overview', profile_introduction: { stage: 'request', question_purpose: 'collect_profile',
      question: actualQuestion, missing_fields: ['full_name', 'residence'], profile_state: profile,
      generic_introduction: true, brochure_deferred: true, brochure_required: false, name_acknowledgement: null } } }
}
const covered = (fragment, changes = {}) => ({ fragment, intent: 'Responder la consulta actual', request_type: 'general_information',
  status: 'answered', evidence: 'Atiende la consulta y avanza según los datos pendientes.', fact_key: null, ...changes })
const draft = (reply = goodReply, question = writerProfileQuestion) => ({ reply, requests: [covered(current)], question })
const review = (question = profileQuestion, changes = {}) => ({ ...approved, question, ...changes })
function sequence(...answers) {
  const calls = []
  return { calls, generate: async (...args) => {
    calls.push(args)
    assert.ok(answers.length, 'La ejecución excedió las llamadas de IA previstas')
    const next = answers.shift()
    return typeof next === 'function' ? next(...args) : next
  } }
}

test('question text is code-owned: old copied casing or paraphrases do not reject an unchanged profile reply', async () => {
  for (const oldText of ['¿Podría indicarme su nombre y en qué ciudad o país reside actualmente?', '¿Cómo se llama y dónde vive?', undefined]) {
    const writerQuestion = { purpose: profileQuestion.purpose, missing_datum: profileQuestion.missing_datum,
      next_decision: profileQuestion.next_decision, ...(oldText === undefined ? {} : { text: oldText }) }
    const mock = sequence(draft(goodReply, writerQuestion), review())
    const result = await completeTurnReply(profileInput(), mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, goodReply)
    assert.equal(result.audit.question.text, actualQuestion)
    assert.deepEqual(result.audit.repair_attempts, [])
    assert.equal(mock.calls.length, 2)
    assert.equal(mock.calls[0][2].properties.question.properties.text, undefined)
    assert.equal(mock.calls[0][2].properties.question.required.includes('text'), false)
    assert.ok(mock.calls[1][2].required.includes('question'))
    assert.deepEqual(mock.calls[1][2].properties.question.required, ['purpose', 'missing_datum', 'next_decision', 'clarifies'])
    assert.equal(mock.calls[1][1].pregunta.text, actualQuestion)
  }
})

test('independent review corrects the question meaning without rewriting correct client-facing text', async () => {
  const wrongMetadata = { purpose: 'coordinate_visit', missing_datum: 'Fecha de visita', next_decision: 'Agendar una visita' }
  const mock = sequence(draft(goodReply, wrongMetadata), review())
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.equal(result.audit.question.purpose, 'collect_lead_profile')
  assert.equal(result.audit.question.missing_datum, profileQuestion.missing_datum)
  assert.equal(result.audit.semantic_review.question_metadata.corrected, true)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review'])
})

test('direct writer callers cannot promote a CRM name when the conversation profile is empty', async () => {
  const input = profileInput()
  input.verified.lead = { name: 'Carlos CRM' }
  const mock = sequence(draft(), review())
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(mock.calls[0][1].contexto_verificado.lead.name, null)
  assert.equal(mock.calls[0][1].contexto_verificado.perfil_lead.name_status, 'unconfirmed')
  assert.doesNotMatch(result.reply, /Carlos/)
})

test('invalid canonical reviewer question repairs only the review and preserves the exact draft', async () => {
  const brokenReview = review({ ...profileQuestion, clarifies: ['Una solicitud que el cliente no expresó'] })
  const mock = sequence(draft(), brokenReview, review())
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'review'])
  assert.equal(mock.calls[1][1].respuesta_propuesta, goodReply)
  assert.equal(mock.calls[2][1].respuesta_propuesta, goodReply)
  assert.match(mock.calls[2][1].reparacion_revision.instruccion, /No reescriba el mensaje/)
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.ok(result.audit.repair_attempts[0].issues.some(issue => issue.code === 'invalid_review_question_metadata'))
})

test('a new review cannot omit canonical question metadata through the legacy compatibility path', async () => {
  const mock = sequence(draft(), { ...approved }, review())
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'review'])
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
})

test('the reviewer rejects a missing required name and the writer repairs the commercial question with its stage context', async () => {
  const incompleteQuestion = '¿En qué ciudad reside actualmente?'
  const incomplete = `${project} Para compartirle el brochure y brindarle una guía personalizada, ${incompleteQuestion}`
  const reason = 'Falta solicitar el nombre: full_name y residence figuran entre los datos pendientes.'
  const failedReview = review({ ...profileQuestion, missing_datum: 'Residencia actual' }, { operational_goal_preserved: false,
    review_issues: [{ check: 'operational_goal_preserved', kind: 'content', source: 'draft', fragment: incompleteQuestion, reason }] })
  const mock = sequence(draft(incomplete), failedReview, draft(), review())
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'writing', 'review'])
  assert.equal(result.audit.repair_attempts[0].target, 'commercial_draft')
  assert.equal(result.audit.repair_attempts[0].issues[0].check, 'operational_goal_preserved')
  assert.deepEqual(mock.calls[2][1].estado_operativo.profile_introduction.missing_fields, ['full_name', 'residence'])
  assert.equal(mock.calls[2][1].reparacion.evaluacion_anterior.review_issues[0].reason, reason)
  assert.equal(mock.calls[2][1].contexto_verificado.lead.name, null)
})

test('the system retains the initial category rule and gives concrete commercial repair instructions', async () => {
  const premature = `Tenemos suites y departamentos. ${goodReply}`
  const mock = sequence(draft(premature), draft(), review())
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'writing', 'review'])
  const correction = mock.calls[1][1].reparacion.correcciones_concretas.find(item => item.code === 'lead_profile_categories_premature')
  assert.equal(correction.owner, 'system')
  assert.equal(correction.repair_owner, 'writer')
  assert.match(correction.instruction, /Elimine la enumeración/)
  assert.deepEqual(correction.missing_fields, ['full_name', 'residence'])
})

test('an omitted mandatory profile question is blocked even when question metadata describes one', async () => {
  const mock = sequence(draft(project), draft(project))
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.ok(result.audit.issues.includes('lead_profile_question_missing'))
  assert.equal(result.audit.recovery.pending, true)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'writing'])
  assert.deepEqual(leadProfilePendingQuestion(result.reply, { ...profileInput().audit, turn_completeness: result.audit }), {})
})

test('a semantically approved profile paraphrase keeps its pending purpose without a vocabulary gate', async () => {
  const question = '¿Cómo prefiere que me dirija a usted y en qué ciudad tiene su hogar actualmente?'
  const reply = `${project} Para remitirle el folleto y ayudarle según sus necesidades, ${question}`
  const mock = sequence(draft(reply), review())
  const input = profileInput()
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(result.audit.repair_attempts, [])
  const pending = leadProfilePendingQuestion(reply, { ...input.audit, turn_completeness: result.audit })
  assert.equal(pending.id, 'lead_profile')
  assert.equal(pending.question, question)
})

test('two real clarification questions do not require copied evidence or clear another missing project fact', async () => {
  const price = '¿Cuánto cuesta?', policy = '¿Aceptan mascotas?'
  const current = `${price} ${policy}`
  const questions = '¿Qué unidad desea consultar? ¿Se refiere al precio total o al valor de entrada?'
  const reply = `Debo verificar la política de mascotas. ${questions}`
  const question = { purpose: 'clarify_request', missing_datum: 'Unidad y tipo de valor', next_decision: 'Consultar el valor solicitado' }
  const candidate = { reply, question, requests: [
    covered(price, { request_type: 'clarification', status: 'clarification', fact_key: 'price', evidence: 'La referencia y el tipo de valor del cliente son ambiguos.' }),
    covered(policy, { request_type: 'specific_fact', status: 'missing_fact', fact_key: 'policy', evidence: 'No consta una política verificada.' }),
  ] }
  const mock = sequence(candidate, review({ ...question, clarifies: [price] }, { missing_fact_fragments: [price, policy] }))
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.audit.question.text, questions)
  assert.deepEqual(result.audit.question.clarifies, [price])
  assert.deepEqual(result.audit.handoff_assessments.map(item => item.outcome), ['missing_fact', 'clarification_needed'])
  assert.deepEqual(result.unresolved, [policy])
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(mock.calls.length, 2)
})

test('a reviewer timeout cannot turn a writer missing-fact label into an advisor handoff', async () => {
  const current = 'Quiero conocer las opciones'
  const reply = '¿Qué tipo de propiedad le interesa?'
  const question = { purpose: 'clarify_request', missing_datum: 'Tipo de propiedad', next_decision: 'Presentar opciones' }
  const mock = sequence({ reply, question, requests: [covered(current, {
    status: 'missing_fact', evidence: 'El cliente no ha indicado qué tipo de propiedad desea.', fact_key: null,
  })] }, () => { throw Error('REVIEW_TIMEOUT') })
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'unavailable')
  assert.equal(result.audit.semantic_review.status, 'not_performed')
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.audit.handoff_assessments, [])
  assert.deepEqual(result.audit.pending_missing_fact_fragments, [current])
  assert.equal(result.audit.handoff_validation_status, 'pending_response_review')
  assert.equal(result.audit.recovery.pending, true)
})

test('invalid reviewer metadata keeps potential gaps pending without authorizing a handoff', async () => {
  const current = '¿Aceptan mascotas?'
  const reply = 'No tengo una política verificada sobre mascotas.'
  const question = { purpose: 'none', missing_datum: '', next_decision: '' }
  const broken = review({ ...question, clarifies: ['Una consulta que el cliente no hizo'] }, { missing_fact_fragments: [current] })
  const mock = sequence({ reply, question, requests: [covered(current, {
    request_type: 'specific_fact', status: 'missing_fact', evidence: 'No consta una política verificada.', fact_key: 'policy',
  })] }, broken, broken)
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.audit.pending_missing_fact_fragments, [current])
  assert.equal(result.audit.pending_gap_assessments[0].outcome, 'missing_fact')
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.equal(result.audit.recovery.pending, true)
})

test('an unchanged draft without questions still requires review before a real information gap can authorize handoff', async () => {
  const current = '¿Aceptan mascotas?'
  const reply = 'No tengo una política verificada sobre mascotas.'
  const question = { purpose: 'none', missing_datum: '', next_decision: '' }
  const mock = sequence({ reply, question, requests: [covered(current, {
    request_type: 'specific_fact', status: 'missing_fact', evidence: 'No consta una política verificada.', fact_key: 'policy',
  })] }, review({ ...question, clarifies: [] }, { missing_fact_fragments: [current] }))
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.independent_review, true)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review'])
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [current])
})

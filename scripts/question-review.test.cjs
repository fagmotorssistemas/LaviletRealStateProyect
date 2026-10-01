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
const { scopePolicyContext } = require('../src/lib/integrations/automation/scope-response.ts')

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
const review = (question = profileQuestion, changes = {}) => ({ ...approved, question, opening_property_type_sentence_ids: [], ...changes })
function sequence(...answers) {
  const calls = []
  return { calls, generate: async (...args) => {
    calls.push(args)
    assert.ok(answers.length, 'La ejecución excedió las llamadas de IA previstas')
    const next = answers.shift()
    return typeof next === 'function' ? next(...args) : next
  } }
}

test('residential continuation accepts approved prose despite the old paraphrased question reference', async () => {
  const current = 'gracias, quiero algo para vivir'
  const reply = '¿Cuántos dormitorios necesita o prefiere?'
  const question = { purpose: 'clarify_request', missing_datum: 'bedrooms', next_decision: 'Presentar opciones según los dormitorios.' }
  for (const links of [
    { clarifies: ['gracias', 'quiero algo para vivir', 'busca un departamento para vivir'] },
    { clarifies_request_ids: ['R1', 'R999'] },
    { clarifies_request_ids: ['R1'] },
  ]) {
    const mock = sequence({ reply, question, requests: [covered(current, { status: 'clarification' })] },
      review({ ...question, ...links }, { claims: [], factual_values: [], project_values: [], factual_inventory_complete: true }))
    const result = await completeTurnReply({ current, baseReply: '¿Qué tipo de vivienda desea?', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, reply)
    assert.deepEqual(result.audit.repair_attempts, [])
    assert.equal(mock.calls.length, 2)
    assert.ok(!result.audit.question.clarifies.includes('busca un departamento para vivir'))
    assert.equal(mock.calls[1][2].properties.question, undefined, 'The factual reviewer no longer repeats writer question metadata')
    assert.ok(mock.calls[1][2].required.includes('review_contract'))
    assert.deepEqual(mock.calls[1][1].referencias_solicitud.map(row => row.id), ['R1'])
  }
})

test('reference IDs clarify one request without hiding a separate unresolved policy', async () => {
  const price = '¿Cuánto cuesta?', policy = '¿Aceptan mascotas?', current = `${price} ${policy}`
  const reply = 'Debo verificar la política de mascotas. ¿Qué unidad desea cotizar?'
  const question = { purpose: 'clarify_request', missing_datum: 'Unidad', next_decision: 'Consultar su precio' }
  const requests = [covered(price, { status: 'clarification', fact_key: 'price' }),
    covered(policy, { status: 'missing_fact', fact_key: 'policy' })]
  const mock = sequence({ reply, question, requests }, (_rules, context, schema) => {
    const selected = context.referencias_solicitud.find(row => row.text === price)
    assert.ok(schema.properties.question.properties.clarifies_request_ids.items.enum.includes(selected.id))
    return review({ ...question, clarifies_request_ids: [selected.id, 'R999'] }, { missing_fact_fragments: [price, policy] })
  })
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(result.audit.question.clarifies, [price])
  assert.deepEqual(result.unresolved, [policy])
  assert.equal(result.audit.semantic_review.question_metadata.reference_warnings.length, 1)
})

test('both models receive the same remote-residence policy even while scope remains uncertain', async () => {
  const current = 'vivo en Portugal, ¿hay algún inconveniente?'
  const reply = 'Puede recibir información a distancia; un asesor debe confirmar la modalidad de firma y cierre.'
  const policy = { policy_id: 'remote-information', version: 1,
    policy_content: 'Residir fuera de Ecuador no impide recibir información. El asesor debe confirmar firma y cierre.' }
  const verified = scopePolicyContext({ politicas_negocio: [policy], business_policy_context: { status: 'loaded', available_count: 1 } }, { kind: 'neutral', uncertain: true })
  const question = { purpose: 'none', missing_datum: '', next_decision: '' }
  const mock = sequence((_rules, context) => {
    assert.deepEqual(context.contexto_verificado.politicas_negocio, [policy])
    return { reply, question, requests: [covered(current)] }
  }, (_rules, context) => {
    assert.deepEqual(context.contexto_verificado.politicas_negocio, [policy])
    const source = context.evidencia_afirmaciones.find(row => row.path === 'contexto_verificado.politicas_negocio.0')
    assert.ok(source)
    return review({ ...question, clarifies_request_ids: [] }, { claims: [{ fragment: 'S1', subject: 'Atención remota',
      polarity: 'affirmation', claim_kind: 'project_fact', verdict: 'supported', evidence: 'Política publicada de información remota y límites de cierre.',
      evidence_source: 'verified_context', evidence_ids: [source.id] }], factual_values: [], project_values: [], factual_inventory_complete: true })
  })
  const result = await completeTurnReply({ current, baseReply: '¿Qué desea consultar?', verified, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(result.audit.business_policy_sources, [policy])
})

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
    assert.deepEqual(mock.calls[1][2].properties.question.required, ['purpose', 'role', 'missing_datum', 'next_decision', 'clarifies_request_ids'])
    assert.deepEqual(mock.calls[1][2].properties.question.properties.clarifies_request_ids.items.enum, ['R1'])
    assert.equal(mock.calls[1][1].pregunta.text, actualQuestion)
    assert.deepEqual(mock.calls[1][1].referencias_solicitud, [{ id: 'R1', text: current }])
    assert.deepEqual(mock.calls[1][2].properties.review_issues.items.properties.fragment.enum, ['S1', 'S2', 'R1'])
    assert.equal(mock.calls[1][2].properties.review_issues.items.properties.source, undefined)
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

test('an empty next decision is derived only from the verified profile stage without rewriting the question', async () => {
  const mock = sequence(draft(goodReply, { ...writerProfileQuestion, next_decision: '' }), review({ ...profileQuestion, next_decision: '' }))
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.match(result.audit.question.next_decision, /Entregar el brochure/)
  assert.equal(result.audit.semantic_review.question_metadata.next_decision_source, 'verified_profile_stage')
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(result.needsAdvisor, false)
})

test('an unspecified next decision outside a verified stage stays empty and does not veto useful prose or authorize action', async () => {
  const reply = '¿Qué distribución prefiere conocer?'
  const question = { purpose: 'choose_property', missing_datum: 'Distribución preferida', next_decision: '' }
  const mock = sequence({ reply, question, requests: [covered(current)] }, review({ ...question, clarifies: [] }))
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.audit.question.next_decision, '')
  assert.equal(result.audit.semantic_review.question_metadata.next_decision_source, 'not_specified')
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.operational_action_verified, false)
})

test('foreign-residence reply with brochure gets an empty numeric review despite a populated catalogue', async () => {
  const message = 'Me llamo Carlos y ahora resido en Colombia. ¿Habrá algún problema si vivo lejos?'
  const reply = 'Mucho gusto, Carlos. Puede revisar la información desde Colombia. Le comparto el brochure: https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf. Podemos brindarle una guía personalizada.'
  const question = { purpose: 'none', missing_datum: '', next_decision: '' }
  const mock = sequence({ reply, requests: [covered(message)], question }, (_rules, context, schema) => {
    assert.equal(context.cifras_del_borrador, undefined, 'The focused reviewer extracts the actual assertions rather than receiving redundant numeric guesses')
    assert.equal(schema.properties.factual_values.maxItems, 80)
    return { ...approved, question: { ...question, clarifies: [] }, claims: [], factual_values: [] }
  })
  const result = await completeTurnReply({ current: message, baseReply: reply,
    verified: { catalogo: Array.from({ length: 40 }, (_, index) => ({ id: `unit-${index}`, unit_number: String(200 + index),
      category: 'departamento', bedrooms: 3, area_internal_m2: 72.18 + index })),
      perfil_lead: { full_name: 'Carlos', sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Carlos' } } } },
    audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(result.audit.semantic_review.numeric_review_scope.source, 'reviewer_inventory')
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review'])
})

test('a commercial opening repair does not spend the independent reviewer metadata repair', async () => {
  const input = profileInput()
  input.audit.semantic_review_enabled = true
  input.verified.proyecto = { description: project }
  const premature = `Tenemos suites y departamentos. ${goodReply}`
  const question = { ...profileQuestion, next_decision: '' }
  const reviewed = (fragment) => (_rules, context) => review(question, { factual_values: [], claims: [{ fragment,
    subject: 'Ubicación del proyecto', polarity: 'affirmation', claim_kind: 'project_fact', verdict: 'supported',
    evidence: 'Ubicación verificada del proyecto', evidence_source: 'verified_context',
    evidence_ids: [context.evidencia_afirmaciones.find(item => item.path === 'contexto_verificado.proyecto').id] }] })
  for (const repaired of [true, false]) {
    const badFragment = 'La Vilet se encuentra ubicada en Puertas del Sol, Cuenca.'
    const mock = sequence(draft(premature), review(profileQuestion, { claims: [], factual_values: [], opening_property_type_sentence_ids: ['S1'] }), draft(goodReply, question), reviewed(badFragment), reviewed(repaired ? 'S1' : badFragment))
    const result = await completeTurnReply(input, mock.generate)
    assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'writing', 'review', 'review'])
    assert.deepEqual(result.audit.repair_attempts.map(attempt => attempt.target), ['commercial_draft', 'review_metadata'])
    assert.deepEqual(result.audit.repair_budget, { writer: { limit: 1, used: 1 }, review_metadata: { limit: 1, used: 1 } })
    assert.equal(mock.calls[3][1].respuesta_propuesta, goodReply)
    assert.equal(mock.calls[4][1].respuesta_propuesta, goodReply)
    for (const call of [mock.calls[3], mock.calls[4]]) {
      const variants = call[2].properties.claims.items.anyOf
      assert.ok(Array.isArray(variants) && variants.length)
      for (const variant of variants) {
        assert.deepEqual(variant.properties.fragment.enum, ['S1', 'S2'])
        const { claim_kind: kinds, verdict: verdicts, evidence_ids: ids } = variant.properties
        assert.equal(kinds.enum.includes('lead_statement'), false)
        if (verdicts.enum.includes('supported') && !kinds.enum.includes('contextual_guidance')) {
          assert.equal(ids.minItems, 1)
          for (const id of ids.items.enum) assert.ok(call[1].evidencia_afirmaciones.some(source => source.id === id && kinds.enum.includes(source.kind)))
        } else assert.equal(ids.maxItems, 0)
      }
    }
    assert.equal(result.audit.status, repaired ? 'checked' : 'rejected_review', JSON.stringify(result.audit))
    assert.equal(result.needsAdvisor, false)
    if (repaired) {
      assert.equal(result.reply, goodReply)
      assert.equal(result.audit.semantic_review.claims[0].fragment, project)
      assert.equal(result.audit.semantic_review.question_metadata.next_decision_source, 'verified_profile_stage')
    } else assert.equal(result.audit.recovery.pending, true)
  }
})

test('an auxiliary question defect cannot waive a semantic opening violation or spend a metadata retry', async () => {
  const input = profileInput()
  const premature = `${project} Ofrecemos espacios para residir y para actividades comerciales. Para compartirle el brochure y brindarle una guía personalizada, ${actualQuestion}`
  const stageViolation = review(profileQuestion, { question: undefined, opening_property_type_sentence_ids: ['S2'] })
  const mock = sequence(draft(premature), stageViolation, draft(), review())
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'writing', 'review'])
  assert.deepEqual(result.audit.repair_attempts.map(attempt => attempt.target), ['commercial_draft'])
  assert.equal(result.audit.repair_attempts[0].issues[0].code, 'lead_profile_categories_premature')
  assert.deepEqual(mock.calls[1][2].properties.opening_property_type_sentence_ids.items.enum, ['S1', 'S2', 'S3'])
  assert.deepEqual(mock.calls[3][2].properties.opening_property_type_sentence_ids.items.enum, ['S1', 'S2'])
})

test('the explicit opening assessment rejects premature property types even when other review flags approve them', async () => {
  const premature = `${project} Ofrecemos unidades residenciales modernas y espacios comerciales. Para compartirle el brochure y brindarle una guía personalizada, ${actualQuestion}`
  const stageViolation = review(profileQuestion, { opening_property_type_sentence_ids: ['S2'] })
  const mock = sequence(draft(premature), stageViolation, draft(premature), stageViolation)
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.ok(result.audit.issues.includes('lead_profile_categories_premature'))
  assert.equal(result.audit.commercial_continuation.checks.operational_goal_preserved, false)
  assert.equal(result.audit.recovery.pending, true)
  assert.equal(result.audit.repair_budget.writer.used, 1)
  assert.equal(result.audit.repair_budget.review_metadata.used, 0)
  assert.equal(result.needsAdvisor, false)
  assert.equal(mock.calls.length, 4)
})

test('an invalid question trace link is advisory and cannot veto an approved draft', async () => {
  const brokenReview = review({ ...profileQuestion, clarifies: ['Una solicitud que el cliente no expresó'] })
  const mock = sequence(draft(), brokenReview)
  const result = await completeTurnReply(profileInput(), mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, goodReply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review'])
  assert.equal(mock.calls[1][1].respuesta_propuesta, goodReply)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(result.audit.semantic_review.question_metadata.reference_warnings[0].code, 'question_reference_ignored')
  assert.deepEqual(result.audit.question.clarifies, [])
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

test('irrelevant question metadata cannot veto a draft without questions or change its verified gap', async () => {
  const current = '¿Aceptan mascotas?'
  const reply = 'No tengo una política verificada sobre mascotas.'
  const question = { purpose: 'none', missing_datum: '', next_decision: '' }
  const broken = review({ ...question, clarifies: ['Una consulta que el cliente no hizo'] }, { missing_fact_fragments: [current] })
  const mock = sequence({ reply, question, requests: [covered(current, {
    request_type: 'specific_fact', status: 'missing_fact', evidence: 'No consta una política verificada.', fact_key: 'policy',
  })] }, broken, broken)
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [current])
  assert.deepEqual(result.audit.question.clarifies, [])
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(mock.calls.length, 2)
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

/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { leadProfilePendingQuestion } = require('../src/lib/integrations/automation/lead-introduction.ts')
const { scopePolicyContext } = require('../src/lib/integrations/automation/scope-response.ts')
const pass = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
const block = (statement, authoritative_fact, category = 'hard_fact') => ({ review_contract: 'content-review-v1', verdict: 'block',
  findings: [{ category, statement, reason: 'La afirmación no tiene respaldo en la fuente autorizada.', authoritative_fact }] })
const current = 'Buenas tardes, estoy interesado'
const project = 'La Vilet está ubicada en Puertas del Sol, Cuenca.'
const actualQuestion = '¿Podría indicarme su nombre y en qué ciudad o país reside actualmente?'
const goodReply = `${project} Para compartirle el brochure, ${actualQuestion}`
const profileQuestion = (text = actualQuestion) => ({ text, purpose: 'collect_lead_profile', role: 'required_capture',
  missing_datum: 'Nombre y residencia actual', next_decision: 'Compartir el brochure', continuation_id: 'lead_profile', continuation_act: 'profile' })
const noQuestion = { text: '', purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const covered = (fragment, changes = {}) => ({ fragment, intent: 'Atender la consulta actual', request_type: 'general_information',
  status: 'answered', evidence: 'Información disponible para la consulta.', fact_key: null, ...changes })
const draft = (reply = goodReply, question = profileQuestion(), requests = [covered(current)]) => ({ reply, question, requests })
function profileInput() {
  const profile = { sources: {}, residence_status: 'unknown' }
  return { current, baseReply: goodReply, verified: { project, lead: { name: null }, perfil_lead: profile },
    audit: { source: 'project_overview', semantic_review_enabled: true, profile_introduction: { stage: 'request', question_purpose: 'collect_profile',
      question: actualQuestion, missing_fields: ['full_name', 'residence'], profile_state: profile,
      generic_introduction: true, brochure_deferred: true, brochure_required: false, name_acknowledgement: null } } }
}
function sequence(...answers) {
  const calls = []
  return { calls, generate: async (...args) => {
    calls.push(args)
    assert.ok(answers.length, 'Unexpected extra model request')
    const next = answers.shift()
    return typeof next === 'function' ? next(...args) : next
  } }
}
const tasks = mock => mock.calls.map(call => call[6])
const checked = (result, reply) => {
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.audit.server_semantic_validation, false)
  assert.equal(result.needsAdvisor, false)
}

test('residential continuation preserves writer question metadata without deriving it from paraphrases', async () => {
  const reply = '¿Cuántos dormitorios prefiere?'
  const question = { text: reply, purpose: 'choose_property', missing_datum: 'Dormitorios', next_decision: 'Revisar opciones',
    continuation_id: 'property_bedrooms', continuation_act: 'choose_bedrooms' }
  const mock = sequence(draft(reply, question), pass)
  const result = await completeTurnReply({ current: 'Quiero algo para vivir', baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.equal(result.audit.question.text, reply)
  assert.equal(result.audit.question.continuation_id, 'property_bedrooms')
  assert.deepEqual(tasks(mock), ['writing', 'review'])
  assert.equal(mock.calls[1][2].properties.question, undefined)
})

test('price clarification and a missing policy remain separate writer requests without creating a handoff', async () => {
  const price = '¿Cuánto cuesta?', policy = '¿Aceptan mascotas?'
  const reply = 'Necesito confirmar la política de mascotas. ¿Qué unidad desea cotizar?'
  const question = { ...profileQuestion('¿Qué unidad desea cotizar?'), purpose: 'clarify_request', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }
  const requests = [covered(price, { status: 'clarification', fact_key: 'price' }), covered(policy, { status: 'missing_fact', fact_key: 'policy' })]
  const mock = sequence(draft(reply, question, requests), pass)
  const result = await completeTurnReply({ current: `${price} ${policy}`, baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.deepEqual(result.audit.requests.map(row => ({ fragment: row.fragment, status: row.status, fact_key: row.fact_key })),
    requests.map(row => ({ fragment: row.fragment, status: row.status, fact_key: row.fact_key })))
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.audit.operational_action_verified, false)
})

test('writer and factual reviewer receive the same published remote-residence policy', async () => {
  const policy = { policy_id: 'remote-information', version: 1, policy_content: 'Residir fuera de Ecuador permite recibir información; el asesor confirma firma y cierre.' }
  const verified = scopePolicyContext({ politicas_negocio: [policy], business_policy_context: { status: 'loaded', available_count: 1 } }, { kind: 'neutral', uncertain: true })
  const reply = 'Podemos compartir información a distancia; el asesor debe confirmar la modalidad de firma y cierre.'
  const mock = sequence((_rules, context) => {
    assert.deepEqual(context.contexto_verificado.politicas_negocio, [policy])
    return draft(reply, noQuestion)
  }, (_rules, context) => {
    assert.ok(context.fuentes_autorizadas.otros_hechos_y_politicas.some(source => JSON.stringify(source.value).includes('remote-information')))
    return pass
  })
  checked(await completeTurnReply({ current: 'Vivo en Portugal, ¿hay algún inconveniente?', baseReply: reply, verified }, mock.generate), reply)
})

test('profile wording and its text metadata belong to the writer, not to a code question extractor', async () => {
  for (const text of [actualQuestion, '¿Cómo prefiere que le llame y dónde reside actualmente?']) {
    const reply = `${project} Para enviarle el brochure, ${text}`
    const mock = sequence(draft(reply, profileQuestion(text)), pass)
    const result = await completeTurnReply(profileInput(), mock.generate)
    checked(result, reply)
    assert.equal(result.audit.question.text, text)
    assert.equal(mock.calls[0][2].properties.question.properties.text.type, 'string')
    assert.equal(mock.calls[1][2].properties.question, undefined)
  }
})

test('the factual reviewer cannot correct or replace the writer question purpose', async () => {
  const question = { ...profileQuestion(), next_decision: '' }
  const mock = sequence(draft(goodReply, question), pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.equal(result.audit.question.next_decision, '')
  assert.equal(result.audit.question.purpose, 'collect_lead_profile')
  assert.equal(mock.calls[1][2].properties.question, undefined)
})

test('direct writer callers cannot promote an unconfirmed CRM name to a declared name', async () => {
  const input = profileInput()
  input.verified.lead = { name: 'Carlos CRM' }
  const mock = sequence(draft(), pass)
  checked(await completeTurnReply(input, mock.generate), goodReply)
  assert.equal(mock.calls[0][1].contexto_verificado.lead.name, null)
  assert.equal(mock.calls[0][1].contexto_verificado.perfil_lead.name_status, 'unconfirmed')
})

test('a missing next-decision label is not invented from the planned profile stage', async () => {
  const mock = sequence(draft(goodReply, { ...profileQuestion(), next_decision: '' }), pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.equal(result.audit.question.next_decision, '')
  assert.deepEqual(result.audit.repair_attempts, [])
})

test('an unspecified next decision outside a verified stage authorizes no operation', async () => {
  const reply = '¿Qué distribución prefiere conocer?'
  const question = { text: reply, purpose: 'choose_property', missing_datum: 'Distribución', next_decision: '', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }
  const mock = sequence(draft(reply, question), pass)
  const result = await completeTurnReply({ current, baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.equal(result.audit.operational_action_verified, false)
})

test('a foreign-residence brochure reply has no code-generated numeric inventory even with a large catalogue', async () => {
  const reply = 'Puede revisar la información desde Colombia. Le comparto el brochure: https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf.'
  const mock = sequence(draft(reply, noQuestion), (_rules, context, schema) => {
    assert.equal(context.cifras_del_borrador, undefined)
    assert.equal(schema.properties.factual_values, undefined)
    assert.equal(context.borrador, reply)
    return pass
  })
  const result = await completeTurnReply({ current: 'Resido en Colombia', baseReply: reply,
    verified: { catalogo: Array.from({ length: 40 }, (_, index) => ({ id: `u${index}`, category: 'departamento', bedrooms: 3 })) } }, mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('one factual writer repair is separate from one review JSON-envelope retry', async () => {
  const wrong = 'La Vilet está en Quito.'
  const mock = sequence(draft(wrong), block('Ubicación en Quito', project), draft(), { verdict: 'pass' }, pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'writing', 'review', 'review'])
  assert.equal(result.audit.repair_attempts.length, 1)
  assert.equal(result.audit.semantic_review.metadata_retries, 1)
  assert.equal(mock.calls[4][1].borrador, goodReply)
})

test('malformed auxiliary question metadata cannot waive an AI factual rejection', async () => {
  const wrong = 'La Vilet está en Quito.'
  const mock = sequence(draft(wrong, { purpose: 'invalid' }), block('Ubicación en Quito', project), draft(), pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'writing', 'review'])
})

test('supported project categories do not regain a server opening veto', async () => {
  const reply = `Ofrecemos suites, departamentos, penthouses y locales comerciales. ${goodReply}`
  const mock = sequence(draft(reply), pass)
  checked(await completeTurnReply(profileInput(), mock.generate), reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('unknown auxiliary trace references cannot rewrite supported writer prose', async () => {
  const mock = sequence(draft(goodReply, { ...profileQuestion(), clarifies: ['Una referencia antigua'] }), pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.deepEqual(result.audit.repair_attempts, [])
})

test('legacy reviewer fields are rejected as a JSON contract and retried on the same draft', async () => {
  const mock = sequence(draft(), { ...pass, question: {} }, pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'review'])
  assert.equal(mock.calls[1][1].borrador, mock.calls[2][1].borrador)
})

test('required profile fields reach the writer while factual review keeps its limited authority', async () => {
  const mock = sequence((_rules, context) => {
    assert.deepEqual(context.estado_operativo.profile_introduction.missing_fields, ['full_name', 'residence'])
    return draft()
  }, (_rules, _context, schema) => {
    assert.deepEqual(Object.keys(schema.properties), ['review_contract', 'verdict', 'findings'])
    return pass
  })
  checked(await completeTurnReply(profileInput(), mock.generate), goodReply)
})

test('opening instructions remain writer responsibilities without code-spliced corrections', async () => {
  const mock = sequence(draft(), pass)
  const result = await completeTurnReply(profileInput(), mock.generate)
  checked(result, goodReply)
  assert.equal(mock.calls[0][1].estado_operativo.profile_introduction.generic_introduction, true)
  assert.deepEqual(result.audit.text_transformations, [])
  assert.equal(result.audit.server_continuation_completion, null)
})

test('an omitted profile question does not acquire a pending question from the plan', async () => {
  const input = profileInput(), mock = sequence(draft(project, noQuestion), pass)
  const result = await completeTurnReply(input, mock.generate)
  checked(result, project)
  assert.deepEqual(leadProfilePendingQuestion(project, { ...input.audit, turn_completeness: result.audit }), {})
})

test('a freely worded profile question retains its actual typed pending referent', async () => {
  const text = '¿Cómo prefiere que me dirija a usted y en qué ciudad tiene su hogar actualmente?'
  const reply = `${project} Para remitirle el folleto, ${text}`
  const input = profileInput(), mock = sequence(draft(reply, profileQuestion(text)), pass)
  const result = await completeTurnReply(input, mock.generate)
  checked(result, reply)
  assert.deepEqual(leadProfilePendingQuestion(reply, { ...input.audit, turn_completeness: result.audit }), { id: 'lead_profile', act: 'profile', question: text })
})

test('two clarifications preserve a separate missing policy without treating request labels as actions', async () => {
  const price = '¿Cuánto cuesta?', policy = '¿Aceptan mascotas?'
  const text = '¿Qué unidad desea consultar? ¿Se refiere al precio total o a la entrada?'
  const reply = `Necesito confirmar la política de mascotas. ${text}`
  const requests = [covered(price, { status: 'clarification', fact_key: 'price' }), covered(policy, { status: 'missing_fact', fact_key: 'policy' })]
  const mock = sequence(draft(reply, { ...profileQuestion(text), purpose: 'clarify_request', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }, requests), pass)
  const result = await completeTurnReply({ current: `${price} ${policy}`, baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.equal(result.audit.requests.length, 2)
  assert.equal(result.audit.operational_action_verified, false)
})

test('a reviewer timeout cannot turn missing-fact writer metadata into a claimed advisor handoff', async () => {
  const mock = sequence(draft('¿Qué tipo de propiedad desea conocer?', noQuestion, [covered(current, { status: 'missing_fact' })]), () => { throw Error('REVIEW_TIMEOUT') })
  await assert.rejects(completeTurnReply(profileInput(), mock.generate), /REVIEW_TIMEOUT/)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('a policy uncertainty statement needs no question and cannot authorize a commercial operation', async () => {
  const reply = 'Necesito confirmar la política de mascotas.'
  const mock = sequence(draft(reply, noQuestion, [covered('¿Aceptan mascotas?', { status: 'missing_fact', fact_key: 'policy' })]), pass)
  const result = await completeTurnReply({ current: '¿Aceptan mascotas?', baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.deepEqual(result.audit.question, {})
  assert.equal(result.audit.operational_action_verified, false)
})

test('an unchanged missing-policy answer receives factual review without independently creating a handoff', async () => {
  const reply = 'Necesito confirmar la política de mascotas.'
  const mock = sequence(draft(reply, noQuestion, [covered('¿Aceptan mascotas?', { status: 'missing_fact', fact_key: 'policy' })]), pass)
  const result = await completeTurnReply({ current: '¿Aceptan mascotas?', baseReply: reply, verified: {} }, mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.changed, false)
})

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
const { completeTurnReply, turnCompletenessIssues, safeRentalCreditBase } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { protectedSentences } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { operationalCopyIssues } = require('../src/lib/integrations/automation/operational-copy.ts')
const { leadIntroductionTurn, PROFILE_INVITATION } = require('../src/lib/integrations/automation/lead-introduction.ts')
const { BROCHURE_URL } = require('../src/lib/integrations/automation/project-material.ts')
const { replyLinkContract, replyLinkIssues, reservationOperationalIssues, MAX_REPLY_CHARACTERS } = require('../src/lib/integrations/automation/response-plan.ts')
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '' }
const covered = (fragment, base_status = 'answered', status = 'answered') => ({ fragment, intent: 'Responder la solicitud actual', request_type: ['clarification', 'outside_scope'].includes(status) ? status : 'specific_fact', base_status, status, evidence: 'Respuesta verificada' })
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true, operational_goal_preserved: true, question_has_purpose: true, missing_fact_fragments: [], factual_values: [] }
function assertPending(result, ...rejectedReplies) {
  assert.equal(result.audit.recovery?.pending, true)
  assert.equal(result.audit.recovery?.base_used, false)
  assert.equal(result.audit.fallback_validation.passed, false)
  assert.equal(result.audit.draft_rejected, true)
  assert.match(result.reply, /pendiente/)
  for (const rejected of rejectedReplies) assert.notEqual(result.reply, rejected)
}

test('published business policies reach writer and reviewer with the same version and survive the response audit', async () => {
  const { changeBusinessPolicy, emptyPolicy, publishedBusinessPolicies } = require('../src/lib/inmobiliaria/businessPolicies.ts')
  const current = '¿Pueden darme información aunque resida en Colombia?'
  const reply = 'Podemos compartir información del proyecto con residentes en Colombia.'
  const stored = changeBusinessPolicy({}, { action: 'publish', id: 'remote-information', value: {
    ...emptyPolicy(), title: 'Información a distancia', content: reply, scope: 'Solo información, sin confirmar condiciones de compra.', source: 'Equipo comercial',
  } }, 'admin', '2026-09-30T16:00:00Z')
  const policies = publishedBusinessPolicies(stored, 'preventa', '2026-09-30T16:00:00Z')
  let calls = 0, modelAssertionError
  const result = await completeTurnReply({ current, baseReply: reply, verified: { politicas_negocio: policies }, audit: { semantic_review_enabled: true } }, async (instructions, context) => {
    try {
    calls++
    assert.deepEqual(context.contexto_verificado.politicas_negocio, policies)
    if (calls === 1) {
      assert.match(instructions, /Residencia en el extranjero y nacionalidad son conceptos distintos/)
      return { reply, requests: [covered(current)], question: noQuestion }
    }
    assert.match(instructions, /Respalde garantías, requisitos y condiciones en las políticas/)
    const source = context.evidencia_afirmaciones.find(item => item.path === 'contexto_verificado.politicas_negocio.0')
    assert.deepEqual(source.value, { ref: 'contexto_verificado.politicas_negocio.0' })
    assert.equal(context.contexto_verificado.politicas_negocio[0].version, 1)
    return { ...approved, question: { ...noQuestion, clarifies: [] }, review_issues: [], claims: [{ fragment: 'S1', subject: 'Información a distancia',
      polarity: 'affirmation', claim_kind: 'project_fact', verdict: 'supported', evidence: 'Política publicada de información a distancia',
      evidence_source: 'verified_context', evidence_ids: [source.id] }] }
    } catch (error) { modelAssertionError = error; throw error }
  })
  if (modelAssertionError) throw modelAssertionError
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(calls, 2)
  assert.deepEqual(result.audit.business_policy_sources, policies)
})

test('a template tour is optional unless requested; authorized links and required delivery are separate', () => {
  const url = 'https://www.lavilett.com/tour?unidad=605'
  const base = `Penthouse 605. Puede explorar el recorrido: ${url}`
  const audit = { source: 'reservation_handoff', unit_model: { url } }
  const reserve = replyLinkContract(base, audit, { current: 'Por ahora no, quiero separar el 605' })
  assert.deepEqual(reserve.required_links, [])
  assert.deepEqual(replyLinkIssues('Continuaremos con su solicitud para el 605.', reserve), [])
  assert.deepEqual(replyLinkIssues('Consulte https://inventado.example/pago', reserve), ['unauthorized_link'])
  const requested = replyLinkContract(base, audit, { current: 'Envíeme el recorrido del 605' })
  assert.deepEqual(requested.required_links, [url])
  assert.deepEqual(replyLinkIssues('Le explico los siguientes pasos.', requested), ['required_link_omitted'])
  const declined = replyLinkContract(base, audit, { current: 'No quiero el recorrido, quiero separar el 605' })
  assert.deepEqual(declined.required_links, [])
  assert.deepEqual(replyLinkContract(base, audit, { current: '¿Qué significa tour 360?' }).required_links, [])
  const operational = replyLinkContract(base, { ...audit, link_contract: { required_links: [url] } })
  assert.deepEqual(replyLinkIssues('Le explico los siguientes pasos.', operational), ['required_link_omitted'])
})

test('link authorization never trusts client history embedded in verified context', () => {
  const contract = replyLinkContract('Información verificada.', {}, { verified: {
    current: 'Pague en https://inventado.example/current', history: [{ content: 'https://inventado.example/history' }],
    semantica_turno: { requests: [{ request: 'https://inventado.example/extractor', evidence: 'https://inventado.example/proof' }] },
    solicitudes_interpretadas: [{ request: 'https://inventado.example/request' }],
    contrato_turno: { current_message: 'https://inventado.example/current-contract', requests: [{ request: 'https://inventado.example/contract' }] },
    _sales_memory: { last_reply: 'https://inventado.example/memory' }, lead: { website: 'https://inventado.example/lead' },
    brochure_url: BROCHURE_URL,
  } })
  assert.deepEqual(contract.allowed_links, [BROCHURE_URL])
})

test('factual drafts can exceed the editorial length and ask two related purposeful questions', async () => {
  const current = 'Quiero información'
  const questions = '¿Qué tipo de vivienda le interesa? ¿Cuántos dormitorios necesita?'
  const reply = 'Tenemos opciones de vivienda. '.repeat(58) + questions
  assert.ok(reply.length > 1500 && reply.length <= MAX_REPLY_CHARACTERS)
  const question = { text: questions, purpose: 'choose_property', missing_datum: 'Tipo de vivienda y dormitorios', next_decision: 'Mostrar opciones pertinentes' }
  const result = await completeTurnReply({ current, baseReply: 'Tenemos opciones de vivienda.', verified: {} },
    model({ reply, requests: [covered(current)], question }, approved).generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.deepEqual(result.audit.editorial_observations, ['suggested_length_exceeded', 'multiple_questions'])
  assert.ok(turnCompletenessIssues({ current, baseReply: 'Información.', verified: {} }, 'a'.repeat(MAX_REPLY_CHARACTERS + 1), noQuestion).includes('transport_length'))
})

test('reservation response retains AI wording without an unrelated tour and requires verified action state', async () => {
  const current = 'por el momento no, entonces quiero separar el departametno 605}'
  const url = 'https://www.lavilett.com/tour?unidad=605'
  const receipt = { kind: 'request', request_status: 'requested', status: 'assigned', advisor_assigned: true, handoff_verified: true }
  const baseReply = `Su solicitud para el penthouse 605 tiene un asesor asignado. Puede ver el tour: ${url}`
  const reply = 'He derivado su solicitud al asesor asignado para continuar con el proceso de separación del penthouse 605.'
  const input = { current, baseReply, audit: { source: 'reservation_handoff', reservation: receipt, unit_model: { url } },
    verified: { catalogo: [{ id: 'p605', unit_number: '605', category: 'penthouse' }] } }
  const result = await completeTurnReply(input, model({ reply, requests: [covered(current)], question: noQuestion }, approved).generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(result.audit.operational_action_verified, true)
  assert.deepEqual(result.audit.link_contract.required_links, [])
  assert.ok(reservationOperationalIssues('El penthouse 605 ya está reservado para usted.', input.audit).includes('reservation_not_confirmed'))
  assert.ok(reservationOperationalIssues('Su reserva está confirmada.', input.audit).includes('reservation_not_confirmed'))
  assert.deepEqual(reservationOperationalIssues('El penthouse 605 todavía no está reservado. Su solicitud está registrada.', input.audit), [])
  const queued = { ...input.audit, reservation: { ...receipt, status: 'queued', advisor_assigned: false } }
  assert.ok(reservationOperationalIssues('Ya tiene un asesor asignado.', queued).includes('advisor_assignment_not_verified'))
  assert.deepEqual(reservationOperationalIssues('Su solicitud está en cola para asignar un asesor.', queued), [])
  assert.deepEqual(reservationOperationalIssues('Su asesor asignado continuará con la solicitud.', {
    ...input.audit, reservation: { ...receipt, status: 'acknowledged' },
  }), [])
  assert.deepEqual(reservationOperationalIssues('He registrado su nombre.', { source: 'reservation_handoff' }), [])
})

function introductionFixture() {
  const current = 'Quiero información'
  const plan = leadIntroductionTurn({ current,
    reply: `La Vilet reúne suites, departamentos y locales comerciales. Aquí tiene el brochure: ${BROCHURE_URL} ¿Qué opción le interesa?`,
    audit: { source: 'project_overview', semantic_review_enabled: true },
    extracted: { turn_semantics: { primary_intent: 'project_information' } },
  })
  const question = { text: PROFILE_INVITATION, purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia actual', next_decision: 'Entregar el brochure y continuar la consulta comercial' }
  const input = { current, baseReply: plan.reply, audit: plan.audit,
    verified: { brochure_url: BROCHURE_URL, project: 'La Vilet, proyecto inmobiliario ubicado en Puertas del Sol, Cuenca, con privacidad y comodidad.' } }
  const candidate = { reply: plan.reply, requests: [covered(current)], question }
  const review = { ...approved, opening_property_type_sentence_ids: [], claims: [{ fragment: plan.reply, subject: 'Presentación verificada y solicitud de perfil', polarity: 'affirmation',
    verdict: 'supported', evidence: 'Información del proyecto y plan de presentación', evidence_source: 'verified_context' }] }
  return { current, plan, input, candidate, review }
}

test('writer and reviewer share the price objective while allowing natural prose and a profile question', async () => {
  const current = 'Precio'
  const contract = { version: 'turn-intent-v1', objective: 'ask_price', required_facts: ['price'] }
  const baseReply = `Los precios parten de $100.000 USD. ${PROFILE_INVITATION}`
  const reply = `Hola. Con gusto: los precios parten de $100.000 USD. ${PROFILE_INVITATION}`
  const question = { text: PROFILE_INVITATION, purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia', next_decision: 'Compartir brochure y orientar la consulta' }
  const generate = model({ reply, requests: [covered(current)], question }, approved)
  const result = await completeTurnReply({ current, baseReply,
    audit: { resolved_turn_intent: contract }, verified: { respuesta_precio_verificada: 'Desde $100.000 USD.' } }, generate.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(generate.calls.length, 2)
  for (const call of generate.calls) {
    assert.deepEqual(call[1].contrato_turno, contract)
    assert.match(call[0], /CONTRATO COMPARTIDO DEL TURNO/)
  }
  assert.deepEqual(result.audit.resolved_turn_intent, contract)
})

test('a writer cannot replace a requested available price with a catalogue description', async () => {
  const current = 'sobre suites'
  const baseReply = 'Las suites parten de $100.000 USD.'
  const contract = { version: 'turn-intent-v1', objective: 'ask_price', required_facts: ['price'] }
  const candidate = { reply: 'Tenemos suites de un dormitorio.', requests: [covered(current)], question: noQuestion }
  const review = { ...approved, claims: [], answers_supported: false }
  const result = await completeTurnReply({ current, baseReply,
    audit: { semantic_review_enabled: true, resolved_turn_intent: contract },
    verified: { respuesta_precio_verificada: baseReply } }, model(candidate, review, candidate, review).generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.ok(result.audit.issues.includes('review_check_failed:answers_supported'))
  assertPending(result, baseReply, candidate.reply)
  assert.equal(result.needsAdvisor, false)
})

test('fallback is held to the same price objective without inventing a missing price', async () => {
  const input = { current: 'Precio', baseReply: 'Tenemos suites de un dormitorio.',
    audit: { resolved_turn_intent: { objective: 'ask_price', required_facts: ['price'] } },
    verified: { respuesta_precio_verificada: 'Desde $100.000 USD.' } }
  const unavailable = async () => { throw new Error('test service unavailable') }
  const result = await completeTurnReply(input, unavailable)
  assert.equal(result.audit.fallback_validation.passed, false)
  assert.ok(result.audit.fallback_validation.issues.includes('turn_price_unanswered'))
  assert.notEqual(result.reply, input.baseReply)
  assert.equal(result.needsAdvisor, false)
  const noPrices = await completeTurnReply({ ...input, baseReply: 'No hay un rango publicado; necesito conocer la categoría.',
    verified: {} }, unavailable)
  assertPending(noPrices, 'No hay un rango publicado; necesito conocer la categoría.')
  assert.doesNotMatch(noPrices.reply, /\$|100[.,]000/)
})

test('the real writer keeps the initial residence invitation, purpose and deferred brochure', async () => {
  const { plan, input, candidate, review } = introductionFixture()
  assert.equal(plan.audit.profile_introduction.stage, 'request')
  const mock = model(candidate, review)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.ok(result.reply.includes(PROFILE_INVITATION))
  assert.doesNotMatch(result.reply, /suites|departamentos|penthouses|locales comerciales/)
  assert.equal(result.reply.includes(BROCHURE_URL), false)
  assert.equal(result.audit.question.purpose, 'collect_lead_profile')
  assert.match(mock.calls[0][0], /APERTURA Y PERFIL DEL LEAD/)
  assert.equal(mock.calls[0][1].estado_operativo.profile_introduction.brochure_deferred, true)
  assert.equal(result.audit.repair_attempts.length, 0)
})

test('premature categories are repaired and a removed profile purpose is blocked by the real writer pipeline', async () => {
  const { input, candidate, review } = introductionFixture()
  const premature = { ...candidate, reply: `Tenemos suites, departamentos, penthouses y locales comerciales. ${PROFILE_INVITATION}` }
  const stageReview = { ...review, claims: [], factual_values: [], opening_property_type_sentence_ids: ['S1'] }
  const repaired = await completeTurnReply(input, model(premature, stageReview, candidate, review).generate)
  assert.equal(repaired.audit.status, 'checked')
  assert.equal(repaired.audit.repair_attempts.length, 1)
  assert.ok(repaired.audit.repair_attempts[0].issues.some(issue => issue.code === 'lead_profile_categories_premature'))
  assert.ok(repaired.reply.includes(PROFILE_INVITATION))
  assert.doesNotMatch(repaired.reply, /suites|departamentos|penthouses|locales comerciales/)

  const shortQuestion = '¿Podría indicarnos su nombre y en qué ciudad o país reside actualmente?'
  const missingPurpose = { ...candidate, reply: `La Vilet está en Puertas del Sol, Cuenca. ${shortQuestion}`,
    question: { ...candidate.question, text: shortQuestion } }
  const missingPurposeReview = { ...review, operational_goal_preserved: false }
  const blocked = await completeTurnReply(input, model(missingPurpose, missingPurposeReview, missingPurposeReview, missingPurpose, missingPurposeReview).generate)
  assert.equal(blocked.audit.status, 'rejected_review')
  assert.ok(blocked.audit.issues.includes('review_check_failed:operational_goal_preserved'))
  assertPending(blocked, missingPurpose.reply)
  assert.equal(blocked.needsAdvisor, false)

  const prematureBrochure = { ...candidate, reply: candidate.reply + '\n' + BROCHURE_URL }
  const brochureReview = { ...review, claims: [], operational_goal_preserved: false }
  const deferred = await completeTurnReply(input, model(prematureBrochure, brochureReview, prematureBrochure, brochureReview).generate)
  assert.equal(deferred.audit.status, 'rejected_review')
  assert.ok(deferred.audit.issues.includes('review_check_failed:operational_goal_preserved'))
  assert.equal(deferred.reply.includes(BROCHURE_URL), false)
})

test('the real writer delivers the verified brochure and resumes a purposeful commercial question after profile data', async () => {
  const { plan: opening } = introductionFixture()
  const current = 'Soy Carlos y vivo en Madrid'
  const plan = leadIntroductionTurn({ current, summary: { _lead_introduction: opening.state },
    extracted: { lead_profile: { full_name: 'Carlos', evidence: { full_name: 'Soy Carlos' }, residence_city: 'Madrid' } },
    reply: 'Gracias por la información.', audit: { source: 'commercial', semantic_review_enabled: true } })
  assert.equal(plan.audit.profile_introduction.stage, 'deliver')
  const question = { text: '¿Le gustaría que le compartamos información de alguna de estas opciones?',
    purpose: 'choose_property', missing_datum: 'Tipo de inmueble de interés', next_decision: 'Presentar las opciones de la categoría elegida' }
  const candidate = { reply: plan.reply, requests: [covered(current)], question }
  const review = { ...approved, claims: [{ fragment: plan.reply, subject: 'Brochure y categorías del proyecto', polarity: 'affirmation', verdict: 'supported',
    evidence: 'Brochure oficial y opciones registradas del proyecto', evidence_source: 'verified_context' }] }
  const input = { current, baseReply: plan.reply, audit: plan.audit,
    verified: { brochure_url: BROCHURE_URL, project: 'La Vilet reúne suites, departamentos, penthouses y locales comerciales.' } }
  const result = await completeTurnReply(input, model(candidate, review).generate)
  assert.equal(result.audit.status, 'checked')
  assert.ok(result.reply.includes(BROCHURE_URL))
  assert.ok(result.reply.includes(question.text))
  assert.doesNotMatch(result.reply, /podría indicarnos|desde dónde|desde qué ciudad/)
  assert.equal(result.audit.question.purpose, 'choose_property')
  assert.equal(result.needsAdvisor, false)
  const missingBrochure = { ...candidate, reply: plan.reply.replace(BROCHURE_URL, '') }
  const repaired = await completeTurnReply(input, model(missingBrochure, candidate, review).generate)
  assert.equal(repaired.audit.status, 'checked')
  assert.ok(repaired.audit.repair_attempts[0].issues.includes('required_link_omitted'))
  assert.ok(repaired.reply.includes(BROCHURE_URL))
  const forgedLink = { ...candidate, reply: plan.reply.replace(BROCHURE_URL, 'https://example.invalid/brochure.pdf') }
  const blocked = await completeTurnReply(input, model(forgedLink).generate)
  assert.equal(blocked.audit.status, 'rejected_guard')
  assert.ok(blocked.audit.issues.includes('unauthorized_link'))
  assertPending(blocked, forgedLink.reply)
  assert.doesNotMatch(blocked.reply, /example\.invalid/)
})

test('writer and independent reviewer share a declared location without treating it as confirmed residence', async () => {
  const { plan: opening } = introductionFixture()
  const current = 'claro, Carlos y soy de Cuenca'
  const profile = { full_name: 'Carlos', residence_status: 'pending_confirmation',
    declared_location: { city: 'Cuenca', kind: 'origin', evidence: 'soy de Cuenca' },
    residence_candidate: { city: 'Cuenca', country: null, evidence: 'soy de Cuenca' } }
  const plan = leadIntroductionTurn({ current, summary: { _lead_introduction: opening.state },
    extracted: { lead_profile: profile }, reply: '', audit: { source: 'commercial' } })
  const reply = `Mucho gusto, Carlos. Aquí tiene el brochure digital completo del proyecto: ${BROCHURE_URL}\nEntiendo que es de Cuenca. ¿Actualmente vive allí?`
  const candidate = { reply, requests: [covered(current)], question: { text: '¿Actualmente vive allí?', purpose: 'collect_lead_profile',
    missing_datum: 'Confirmar si Cuenca es su residencia actual', next_decision: 'Completar el perfil de residencia y continuar la orientación' } }
  const generate = model(candidate, approved)
  const result = await completeTurnReply({ current, baseReply: plan.reply, audit: plan.audit,
    verified: { perfil_lead: profile, brochure_url: BROCHURE_URL } }, generate.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, false)
  assert.equal(generate.calls.length, 2)
  for (const call of generate.calls) {
    assert.equal(call[1].estado_operativo.profile_introduction.profile_state.residence_status, 'pending_confirmation')
    assert.equal(call[1].estado_operativo.profile_introduction.candidate.city, 'Cuenca')
    assert.match(call[0], /NO residencia confirmada/)
  }
  const falseClaim = { ...candidate, reply: reply.replace('Entiendo que es de Cuenca', 'Como vive en Cuenca') }
  const rejected = await completeTurnReply({ current, baseReply: plan.reply, audit: plan.audit,
    verified: { perfil_lead: profile, brochure_url: BROCHURE_URL } }, model(falseClaim, falseClaim).generate)
  assert.equal(rejected.audit.status, 'rejected_guard')
  assert.ok(rejected.audit.issues.includes('lead_profile_unconfirmed_residence'))
  assert.equal(rejected.needsAdvisor, false)
})

test('pending visit routing yields to current evidenced commercial requests, but keeps mixed requests', () => {
  const { visitRoutePermission } = require('../src/lib/integrations/automation/route-consistency.ts')
  for (const domain of ['property', 'financing', 'project']) {
    const requests=[{domain,confidence:'high'}]
    assert.equal(visitRoutePermission(requests, {}, {kind:'none',confidence:'high'}).allowed,false)
    assert.equal(visitRoutePermission([...requests,{domain:'visit',confidence:'high'}], {}, {kind:'request_visit',confidence:'high'}).allowed,true)
  }
  assert.equal(visitRoutePermission([], {}, {kind:'accept_visit_preference',confidence:'high'}).allowed,true)
})

test('operational questions are assessed by purpose instead of number or template presence', () => {
  const base='Atendemos de 09:00 a 18:00.'
  const draft=base+' ¿Qué día le conviene?'
  assert.equal(operationalCopyIssues(base,draft,{evidence_review:true}).includes('question_count'),false)
  assert.equal(operationalCopyIssues(base,draft,{}).includes('operational_question_added'),false)
  assert.equal(operationalCopyIssues(base,draft+' ¿Mañana?',{evidence_review:true}).includes('question_count'),false)
  assert.equal(turnCompletenessIssues({current:'¿Cuándo puedo ir?',baseReply:base,verified:{},audit:{source:'visit_intake',semantic_review_enabled:true}},draft,noQuestion).includes('question_without_purpose'),false)
})

test('a fallback with an explicitly unanswered request cannot be marked valid', async () => {
  const current='¿Cuántos dormitorios tiene?'
  const candidate={reply:'Tiene 999 dormitorios.',requests:[covered(current,'unanswered')],question:noQuestion}
  const result=await completeTurnReply({current,baseReply:'Nuestro horario de atención es de lunes a viernes.',verified:{}},model(candidate,candidate).generate)
  assert.equal(result.audit.fallback_validation.passed,false)
  assert.ok(result.audit.fallback_validation.issues.includes('fallback_unanswered_request'))
  assert.doesNotMatch(result.reply,/lunes a viernes/)
  assert.equal(result.needsAdvisor,false)
})

test('project quantities use subject evidence rather than an isolated numeric allowlist',async()=>{
  const current='Quiero información'
  const reply='El proyecto cuenta con sistemas de seguridad 24 horas.'
  const input={current,baseReply:'El proyecto cuenta con medidas de seguridad.',verified:{instalaciones:[{amenity_name:'Sistemas de seguridad 24h',description:'Vigilancia permanente'}]},audit:{semantic_review_enabled:true}}
  const candidate={reply,requests:[covered(current)],question:noQuestion}
  const review={...approved,claims:[{fragment:reply,subject:'Seguridad',polarity:'affirmation',verdict:'supported',evidence:'Sistemas de seguridad 24h',evidence_source:'verified_context'}]}
  const projectReview = (_rules, context) => ({ ...review, project_values: [{ fragment: 'S1', source_id: context.evidencia_turno.project_facts[0].id, dimension: 'duration', measurement_unit: 'hour', value: 24 }] })
  const result=await completeTurnReply(input,model(candidate,projectReview).generate)
  assert.equal(result.reply,reply)
  assert.equal(result.audit.status,'checked')
  assert.equal(result.audit.semantic_review.project_values[0].value,24)
  assert.equal(result.audit.final_validation.validated_text,reply)
  const bad={...candidate,reply:reply.replace('24','48')}
  const badReview = (...args) => ({...projectReview(...args), project_values: projectReview(...args).project_values.map(f => ({...f,value:48}))})
  const denied=await completeTurnReply(input,model(bad,badReview,badReview,bad,badReview).generate)
  assert.equal(denied.audit.status,'rejected_review')
  assert.ok(denied.audit.semantic_review.validation_details.some(f => f.code==='project_quantity_mismatch'))
  assert.equal(denied.needsAdvisor,false)
})

test('approved clarification is not a missing project fact even when reviewer marks it missing', async()=>{
  const current='cual es el precio?'
  const reply='El precio depende de la opción. ¿De qué propiedad le gustaría conocer el precio?'
  const question={text:'¿De qué propiedad le gustaría conocer el precio?',purpose:'clarify_request',missing_datum:'Unidad',next_decision:'Consultar precio de la unidad'}
  const candidate={reply,question,requests:[{...covered(current),fact_key:'price',evidence:reply}]}
  const input={current,baseReply:question.text,verified:{},audit:{source:'unit_price'}}
  const result=await completeTurnReply(input,model(candidate,{...approved,missing_fact_fragments:[current]}).generate)
  assert.equal(result.reply,reply)
  assert.equal(result.needsAdvisor,false)
  assert.deepEqual(result.unresolved,[])
  assert.equal(result.audit.handoff_assessments[0].outcome,'clarification_needed')
  const missing='¿Aceptan mascotas?'
  const mixed=await completeTurnReply({...input,current:current+' '+missing},model({...candidate,requests:[...candidate.requests,{...covered(missing,'missing_fact','missing_fact'),fact_key:'policy'}]}, {...approved,missing_fact_fragments:[current,missing]}).generate)
  assert.equal(mixed.needsAdvisor,true)
  assert.deepEqual(mixed.unresolved,[missing])
})

test('contradictory missing-fact labels are retried and cannot independently authorize handoff',async()=>{
  const current='¿Qué condiciones hay?'
  const reply='Las condiciones necesitan precisión.'
  const candidate={reply,question:noQuestion,requests:[covered(current)]}
  const review={...approved,missing_fact_fragments:[current]}
  // Force independent review even for identical prose.
  const checked=await completeTurnReply({current,baseReply:'Podemos orientarle.',verified:{}},model(candidate,review,candidate,review).generate)
  assert.equal(checked.needsAdvisor,false)
  assert.equal(checked.audit.repair_attempts.length,1)
  assert.equal(checked.audit.handoff_assessments[0].outcome,'review_conflict')
})

test('handoff notice preserves the reviewed question and does not duplicate notices',()=>{
  const {withHandoffNotice}=require('../src/lib/integrations/automation/handoff-copy.ts')
  const reply='Podemos revisar opciones. ¿Qué unidad le interesa?'
  const notice='Un asesor revisará la política pendiente.'
  const final=withHandoffNotice(reply,notice)
  assert.ok(final.endsWith(reply))
  assert.equal(withHandoffNotice(final,notice),final)
})

test('general financing preserves the original complete draft and audits actual normalizations', async () => {
  const current='y que opciones de financiamiento tiene?'
  const reply='En cuanto a financiamiento, La Vilet no ofrece crédito directo, pero puede solicitar financiamiento hipotecario a través de Banco Pichincha o la Cooperativa JEP.'
  const input={current,baseReply:'Podemos revisar un crédito con Banco Pichincha o Cooperativa JEP.',verified:{},audit:{source:'financing'}}
  const candidate={reply,requests:[covered(current)],question:noQuestion}
  const mock=model(candidate,approved)
  const result=await completeTurnReply(input,mock.generate)
  assert.equal(result.reply,reply)
  assert.deepEqual(result.audit.text_transformations,[])
  assert.match(mock.calls[1][0],/coherencia del mensaje actual/)
  const adjusted=await completeTurnReply({...input,normalizeReply:text=>text.replace('En cuanto a financiamiento, ','')},model(candidate,approved).generate)
  assert.equal(adjusted.audit.text_transformations[0].before,reply)
  assert.equal(adjusted.audit.text_transformations[0].after,adjusted.reply)
  const broken={...candidate,reply:reply.replace('no ofrece crédito directo','')}
  const rejectedReview={...approved,answered_content_preserved:false}
  const repaired=await completeTurnReply(input,model(broken,rejectedReview,candidate,approved).generate)
  assert.equal(repaired.reply,reply)
  assert.equal(repaired.audit.repair_attempts.length,1)
})

test('commercial budget objection permits choosing alternatives or financing and records its purpose', async () => {
  const current = 'Tengo un presupuesto limitado'
  const baseReply = 'Penthouse 805: USD 550.000. ¿Qué planta prefiere?'
  const reply = 'Entiendo. El penthouse 805 tiene un precio referencial de USD 550.000, sujeto a cambios. Podemos revisar alternativas verificadas o conversar sobre financiamiento. ¿Prefiere comparar alternativas o revisar financiamiento para el penthouse?'
  const question = {text:'¿Prefiere comparar alternativas o revisar financiamiento para el penthouse?',purpose:'permission_to_continue',missing_datum:'Camino preferido',next_decision:'Comparar alternativas o revisar financiamiento conservando el interés en el penthouse'}
  const input = {current,baseReply,preserveOperationalQuestion:true,verified:{property_context:{selected_ids:['p805']},catalogo:[{id:'p805',category:'penthouse',unit_number:'805',price:550000}]},audit:{source:'property_budget_deferred'}}
  const candidate = {reply,requests:[covered(current)],question}
  const mock = model(candidate,approved)
  const result = await completeTurnReply(input,mock.generate)
  assert.equal(result.audit.status,'checked')
  assert.equal(result.reply,reply)
  assert.deepEqual(result.audit.commercial_continuation.selected_units,['penthouse 805'])
  assert.equal(result.audit.commercial_continuation.question.next_decision,question.next_decision)
  assert.equal(result.audit.commercial_continuation.checks.operational_goal_preserved,true)
  assert.equal(mock.calls[0][1].preserveOperationalQuestion,false)
  assert.equal(mock.calls[0][1].contrato_redaccion.decisiones_protegidas,false)
  assert.match(mock.calls[1][0],/no autoriza.*selecci|no.*selecciones|no afirme.*solo porque se solicitó/)
  const denied = {...approved,operational_goal_preserved:false}
  const rejected = await completeTurnReply(input,model(candidate,denied,candidate,denied).generate)
  assert.equal(rejected.audit.status,'rejected_review')
  assert.ok(rejected.audit.issues.includes('review_check_failed:operational_goal_preserved'))
  assert.equal(rejected.audit.commercial_continuation.checks.operational_goal_preserved,false)
})

test('recorded category maxima expressed as hasta pass review and final catalog without repair', async () => {
  const {validateCatalogReply}=require('../src/lib/integrations/automation/catalog-dialogue.ts')
  const {factualValueIssues}=require('../src/lib/integrations/automation/semantic-review.ts')
  const {turnEvidence}=require('../src/lib/integrations/automation/turn-evidence.ts')
  const units=[{id:'d202',unit_number:'202',category:'departamento',bedrooms:3,area_internal_m2:120.83},
    {id:'p602',unit_number:'602',category:'penthouse',bedrooms:3,area_internal_m2:142.09},
    {id:'p605',unit_number:'605',category:'penthouse',bedrooms:3,area_internal_m2:140.53}]
  const current='busco departamentos de 5 o 6 dormitorios'
  const reply='Por el momento, La Vilet no cuenta con departamentos de 5 o 6 dormitorios en su catálogo. Sin embargo, la opción más amplia disponible son los departamentos y penthouses de 3 dormitorios. Los departamentos de esta categoría ofrecen hasta 120,83 m² interiores, mientras que los penthouses llegan hasta 142,09 m² interiores, ambos con áreas exteriores y ambientes cómodos para la vida familiar.'
  const audit={semantic_review_enabled:true,verified_catalog:true,catalog_query:{category:'departamento',scope:'catalog',filters:{bedrooms_any:[5,6]}},catalog_results:{units:[],complete:true,unknown_unit_ids:[]},alternative_results:{units}}
  const facts=[{unit_id:'group:departamento:3:max',field:'area_internal_m2',value:120.83,operator:'lte',upper_value:null,fragment:'departamentos de esta categoría ofrecen hasta 120,83 m² interiores'},
    {unit_id:'group:penthouse:3:max',field:'area_internal_m2',value:142.09,operator:'lte',upper_value:null,fragment:'penthouses llegan hasta 142,09 m² interiores'}]
  const review={...approved,factual_values:facts,claims:[{fragment:reply.split('. ')[0]+'.',subject:'sin departamentos de 5 o 6 dormitorios',polarity:'affirmation',verdict:'supported',evidence:'consulta completa sin coincidencias',evidence_source:'catalog_no_results'},
    {fragment:reply,subject:'alternativas',polarity:'affirmation',verdict:'supported',evidence:'máximos verificados',evidence_source:'verified_context'}]}
  const mock=model({reply,requests:[covered(current)],question:noQuestion},review)
  const result=await completeTurnReply({current,baseReply:'Departamentos de 3 dormitorios, hasta 120,83 m². Penthouses de 3 dormitorios, hasta 142,09 m².',verified:{},audit},mock.generate)
  assert.equal(result.audit.status,'checked')
  assert.equal(result.reply,reply)
  assert.equal(mock.calls.length,2)
  assert.deepEqual(result.audit.repair_attempts,[])
  assert.equal(validateCatalogReply(reply,{...audit,semantic_review:result.audit.semantic_review}).valid,true)
  const evidence=turnEvidence({},audit)
  const exaggerated=reply.replace('142,09','150')
  const bad={...facts[1],value:150,fragment:facts[1].fragment.replace('142,09','150')}
  assert.equal(factualValueIssues([bad],exaggerated,[...units,...evidence.groups])[0].code,'catalog_endpoint_mismatch')
})

test('catalog comparisons compute bounds and final catalog failures share the single repair budget', async () => {
  const unit = {id:'p605',unit_number:'605',category:'penthouse',bedrooms:3,bathrooms_full:3,area_internal_m2:140.53,area_exterior_m2:23.01}
  const current='Me interesa el 605'
  const baseReply='Penthouse 605: 140,53 m² interiores y 23,01 m² exteriores.'
  const input={current,baseReply,verified:{catalogo:[unit]},audit:{semantic_review_enabled:true,verified_catalog:true,catalog_results:{units:[unit]}}}
  const reply='El penthouse 605 tiene más de 140 m² interiores y 23,01 m² de área exterior.'
  const candidate={reply,requests:[covered(current)],question:noQuestion}
  const review={...approved,claims:[{fragment:reply,subject:'605',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],
    factual_values:[{fragment:reply,unit_id:'p605',field:'area_internal_m2',operator:'gt',value:140,upper_value:null},{fragment:reply,unit_id:'p605',field:'area_exterior_m2',value:23.01}]}
  const accepted=await completeTurnReply(input,model(candidate,review).generate)
  assert.equal(accepted.audit.status,'checked')
  assert.equal(accepted.reply,reply)
  const bad={...candidate,reply:'Penthouse 605: 23,01 m² interiores.'}
  const dishonestReview={...approved,claims:[{...review.claims[0],fragment:bad.reply}],factual_values:[{fragment:bad.reply,unit_id:'p605',field:'area_internal_m2',value:23.01}]}
  const mock=model(bad,dishonestReview,dishonestReview,candidate,review)
  const repaired=await completeTurnReply(input,mock.generate)
  assert.equal(repaired.reply,reply)
  assert.equal(repaired.audit.status,'checked')
  assert.equal(repaired.audit.repair_attempts.length,2)
  assert.equal(repaired.audit.repair_attempts[0].issues[0].code,'catalog_value_mismatch')
  assert.equal(mock.calls.length,5)
})

test('semantic review permits omitting irrelevant base numbers but checks unit-value relationships', async () => {
  const current = 'Quiero conocer el penthouse'
  const input = { current, baseReply: 'Departamento 502: 120,83 m². Penthouse 602: 142,09 m².',
    audit: { semantic_review_enabled: true }, verified: { catalogo: [
      { id: 'd502', category: 'departamento', unit_number: '502', area_internal_m2: 120.83 },
      { id: 'p602', category: 'penthouse', unit_number: '602', area_internal_m2: 142.09 },
    ] } }
  const reply = 'El penthouse 602 ofrece 142,09 m² interiores.'
  const claim = { fragment: reply, subject: 'p602', polarity: 'affirmation', verdict: 'supported', evidence: 'p602 area_internal_m2=142.09', evidence_source: 'verified_context' }
  const candidate = { reply, requests: [covered(current)], question: noQuestion }
  const review = { ...approved, claims: [claim], factual_values: [{ fragment: reply, unit_id: 'p602', field: 'area_internal_m2', value: 142.09 }] }
  const mock = model(candidate, review)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(mock.calls.length, 2)
  const swapped = await completeTurnReply(input, model(candidate, { ...review, factual_values: [{ ...review.factual_values[0], unit_id: 'd502' }] }).generate)
  assert.equal(swapped.audit.status, 'rejected_review')
  assertPending(swapped, input.baseReply, candidate.reply)
  const unsupported = await completeTurnReply(input, model(candidate, { ...review, claims: [{ ...claim, verdict: 'unsupported' }] }).generate)
  assert.equal(unsupported.audit.status, 'rejected_review')
  const unanswered = await completeTurnReply(input, model(candidate, { ...review, all_requests_considered: false }).generate)
  assert.equal(unanswered.audit.status, 'rejected_review')
})

test('opening suggestion does not replace the writer chosen wording', async () => {
  const input = { current: 'Quiero información', baseReply: 'Claro que sí, con mucho gusto. Tenemos departamentos.', verified: {} }
  const candidate = { reply: 'Tenemos departamentos.', requests: [covered(input.current)], question: noQuestion }
  const result = await completeTurnReply(input, model(candidate, approved).generate)
  assert.equal(result.reply, candidate.reply)
  assert.equal(result.audit.opening_decision.applied, false)
  const repeated = await completeTurnReply({ ...input, history: [{ role: 'bot', content: 'Claro que sí, con mucho gusto. Le ayudo.' }] }, model(candidate, approved).generate)
  assert.equal(repeated.reply, 'Tenemos departamentos.')
  assert.equal(repeated.audit.opening_decision.removed_repetition, true)
})

test('semantic review records evidence and leaves unsupported unrepaired claims pending', async () => {
  const current = 'Quiero información', reply = 'Ofrecemos departamentos.'
  const input = { current, baseReply: 'Tenemos departamentos.', verified: { categorias: ['departamento'] }, audit: { semantic_review_enabled: true } }
  const candidate = { reply, requests: [covered(current)], question: noQuestion }
  const claim = { fragment: reply, subject: 'departamentos', polarity: 'affirmation', verdict: 'supported', evidence: 'categorias: departamento', evidence_source: 'verified_context' }
  const mock = model(candidate, { ...approved, claims: [claim] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.semantic_review.claims.length, 1)
  assert.equal(mock.calls.length, 2)
  for (const verdict of ['unsupported', 'contradicted', 'neutral']) {
    const rejected = await completeTurnReply(input, model(candidate, { ...approved, claims: [{ ...claim, verdict }] }).generate)
    assert.equal(rejected.audit.status, 'rejected_review')
    assertPending(rejected, input.baseReply, candidate.reply)
  }
})
test('Carlos price category switch uses catalogue evidence and accepts natural wording', async () => {
  const current = 'Y cuál es el precio del penthhphse?'
  const units = [{ id: 'd502', category: 'departamento', unit_number: '502', published_commercial_price: 310000 },
    { id: 'p602', category: 'penthouse', unit_number: '602', published_commercial_price: 550000 }]
  const input = { current, baseReply: 'Las opciones van de $250.000 a $310.000 USD. ¿Le gustaría coordinar una visita?',
    preserveOperationalQuestion: true, audit: { source: 'unit_price', verified_price_only: true },
    verified: { catalogo: units, politica_comercial: { precios_autorizados: true, precios_aproximados: true },
      semantica_turno: { property: { category: 'penthouse' } }, referencia_unidad: { reason: 'remembered', matches: [units[0]] } } }
  const good = 'Los penthouses tienen un precio referencial de lanzamiento de $550.000 USD y pueden cambiar.'
  const candidate = reply => ({ reply, requests: [covered(current)], question: noQuestion })
  const mock = model(candidate(good), approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, good)
  assert.deepEqual(result.audit.price_evidence.units.map(unit => unit.price_usd), [550000])
  assert.equal(mock.calls[0][1].respuesta_base, undefined)
  assert.match(mock.calls[0][1].contexto_verificado.respuesta_precio_verificada, /550[.,]000/)
  const repaired = await completeTurnReply(input, model(candidate(good.replace('550.000', '999.000')), candidate(good), approved).generate)
  assert.equal(repaired.reply, good)
  assert.equal(repaired.audit.repair_attempts.length, 1)
  const rejected = await completeTurnReply(input, model(candidate(good.replace('550.000', '999.000')), candidate(good.replace('550.000', '999.000'))).generate)
  assert.equal(rejected.audit.status, 'rejected_guard')
  assertPending(rejected, good)
  assert.doesNotMatch(rejected.reply, /310[.,]000|999[.,]000/)
})
test('invalid coverage records exact field and expectation without accepting the draft', async () => {
  const input = { current: 'Prefiero los departamentos', baseReply: 'Respuesta base.', verified: {} }
  const cases = [
    { requests: [covered('prefiero los departamentos')], question: noQuestion, field: 'requests[0].fragment' },
    { requests: null, question: noQuestion, field: 'requests:' },
    { requests: [{ ...covered(input.current), status: 'invented' }], question: noQuestion, field: 'requests[0].status' },
  ]
  for (const { field, ...metadata } of cases) {
    const candidate = { reply: 'Redacción propuesta.', ...metadata }
    const mock = model(candidate, candidate)
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.audit.status, 'invalid_coverage')
    assertPending(result, input.baseReply)
    assert.equal(mock.calls.length, 2)
    assert.equal(result.audit.repair_attempts[0].final_status, 'invalid_coverage')
    assert.ok(result.audit.issues.some(issue => issue.includes(field) && issue.includes('recibido') && issue.includes('se esperaba')))
  }
})

test('invalid coverage diagnostics protect personal data in rejected values', async () => {
  const candidate = {
    reply: 'Hola.', requests: [covered('contacto: privado@example.com')], question: noQuestion,
  }
  const result = await completeTurnReply({ current: 'Hola', baseReply: 'Hola.', verified: {} }, model(candidate, candidate).generate)
  assert.equal(result.audit.status, 'invalid_coverage')
  assert.ok(result.audit.issues[0].includes('[correo protegido]'))
  assert.ok(!JSON.stringify(result.audit.issues).includes('privado@example.com'))
})
function model(...answers) {
  const calls = []
  const generate = async (...args) => { calls.push(args); const next = answers[calls.length - 1]; if (next instanceof Error) throw next; return typeof next === 'function' ? next(...args) : next }
  return { generate, calls }
}

test('Carlos catalogue metadata is repaired without changing his final answer or question', async () => {
  const current = 'Lo que yo quisiera es un departamento de 5 dormitorios.'
  const question = { text: '¿Le gustaría revisar las alternativas disponibles?', purpose: 'permission_to_continue', missing_datum: 'Aceptación', next_decision: 'Mostrar alternativas' }
  const baseReply = 'Actualmente no contamos con departamentos de 5 dormitorios. Tenemos departamentos de 3 dormitorios, hasta 120,83 m² interiores, y penthouses de 3 dormitorios, hasta 142,09 m² interiores. ' + question.text
  const reply = baseReply.replace('Actualmente', 'En este momento')
  const input = { current, baseReply, verified: {}, audit: { source: 'catalog_search', verified_catalog: true, semantic_review_enabled: true,
    catalog_query: { scope: 'catalog', filters: { bedrooms: 5 } },
    catalog_results: { units: [], complete: true, unknown_unit_ids: [] },
    alternative_results: { units: [{ id: 'd202', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 },
      { id: 'p602', category: 'penthouse', bedrooms: 3, area_internal_m2: 142.09 }] } } }
  const invalid = { reply, requests: [covered(current), covered(question.text)], question }
  const valid = { reply, requests: [covered(current)], question }
  const review = { ...approved, claims: [
    { fragment: 'S1', subject: 'departamentos de cinco dormitorios', polarity: 'negation', verdict: 'supported',
      evidence: 'Consulta completa sin coincidencias.', evidence_source: 'catalog_no_results' },
    { fragment: 'S2', subject: 'alternativas de tres dormitorios', polarity: 'affirmation', verdict: 'supported',
      evidence: 'Alternativas de catálogo y máximos de categoría.', evidence_source: 'verified_context' },
  ], factual_values: [
    { fragment: 'S2', unit_id: 'group:departamento:3:max', field: 'area_internal_m2', value: 120.83, operator: 'lte', upper_value: null },
    { fragment: 'S2', unit_id: 'group:penthouse:3:max', field: 'area_internal_m2', value: 142.09, operator: 'lte', upper_value: null },
  ] }
  const mock = model(invalid, valid, review)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.requests.length, 1)
  assert.equal(result.audit.repair_attempts[0].final_status, 'checked')
  assert.match(result.audit.repair_attempts[0].issues[0], /requests\[1\].fragment/)
  assert.equal(mock.calls.length, 3)
  assert.equal(mock.calls[1][1].reparacion.borrador, reply)
  assert.equal(mock.calls[1][1].reparacion.metadatos.requests.length, 2)
  assert.equal(mock.calls[2][6], 'review')
})

test('a wrong reviewer unit binding is repaired on the same exact-value draft, even with a disputed content flag', async () => {
  const current = '¿Qué opción amplia tienen para mi familia?'
  const reply = 'El penthouse 602 tiene 142,09 m² interiores.'
  const units = [
    { id: 'p601', unit_number: '601', category: 'penthouse', area_internal_m2: 106.58 },
    { id: 'p602', unit_number: '602', category: 'penthouse', area_internal_m2: 142.09 },
  ]
  const factual = { fragment: 'S1', unit_id: 'p601', field: 'area_internal_m2', value: 142.09, operator: 'eq', upper_value: null }
  const reviewerQuestion = { ...noQuestion, clarifies: [] }
  const rejected = { ...approved, answers_supported: false, question: reviewerQuestion, claims: [], factual_values: [factual],
    review_issues: [{ check: 'answers_supported', kind: 'content', source: 'draft', fragment: 'S1', reason: 'El valor no corresponde a la unidad indicada en la ficha.' }] }
  const corrected = { ...approved, question: reviewerQuestion, claims: [], factual_values: [{ ...factual, unit_id: 'p602' }], review_issues: [] }
  const mock = model({ reply, requests: [covered(current)], question: noQuestion }, rejected, corrected)
  const result = await completeTurnReply({ current, baseReply: reply, audit: { semantic_review_enabled: true }, verified: { catalogo: units } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(result.audit.repair_attempts.map(item => item.target), ['review_metadata'])
  assert.equal(mock.calls.length, 3)
  assert.equal(mock.calls[1][1].respuesta_propuesta, mock.calls[2][1].respuesta_propuesta)
})

test('metadata repair keeps factual guards and cannot rewrite the draft', async () => {
  const input = { current: 'Quiero información', baseReply: 'Tenemos departamentos.', verified: {} }
  for (const reply of ['Tenemos departamentos de 999 m².', 'Tenemos departamentos. https://inventado.example/ficha']) {
    const invalid = { reply, requests: [covered('Pregunta del bot')], question: noQuestion }
    const valid = { reply, requests: [covered(input.current)], question: noQuestion }
    const mock = model(invalid, valid)
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.audit.status, 'rejected_guard')
    assertPending(result, input.baseReply)
    assert.equal(mock.calls.length, 2)
  }
  const mock = model({ reply: input.baseReply, requests: null, question: {} },
    { reply: 'Otra respuesta.', requests: [covered(input.current)], question: noQuestion })
  const result = await completeTurnReply(input, mock.generate)
  assert.deepEqual(result.audit.issues, ['metadata_repair_changed_reply'])
  assertPending(result, input.baseReply)
})

test('repair cannot hide omitted requests even when reply equals the base', async () => {
  const input = { current: 'Quiero información. ¿Aceptan mascotas?', baseReply: 'Tenemos departamentos.', verified: {} }
  const mock = model({ reply: input.baseReply, requests: [covered('Pregunta del bot')], question: noQuestion },
    { reply: input.baseReply, requests: [covered('Quiero información.')], question: noQuestion },
    { ...approved, all_requests_considered: false })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.equal(result.audit.repair_attempts[0].final_status, 'rejected_review')
  assert.equal(mock.calls.length, 3)
})

test('repair service failure falls back and records its final status', async () => {
  const input = { current: 'Hola', baseReply: 'Hola.', verified: {} }
  const mock = model({ reply: 'Hola.', requests: null, question: noQuestion }, new Error('unavailable'))
  const result = await completeTurnReply(input, mock.generate)
  assertPending(result, input.baseReply)
  assert.equal(result.audit.repair_attempts[0].final_status, 'invalid_coverage')
  assert.equal(result.audit.repair_attempts[0].failure, 'repair_call_failed')
  assert.equal(mock.calls.length, 2)
})

test('final writer receives a route-specific contract for information, price and financing', async () => {
  for (const [source, baseReply, extra] of [
    ['project_overview', 'Conozca La Vilet: https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf', {}],
    ['unit_price', 'El precio es $250.000.', { verified_price_only: true }],
    ['financing_question', 'Podemos orientarle con Banco Pichincha.', {}],
  ]) {
    const mock = model({ reply: baseReply, requests: [covered('Quiero conocer las opciones')], question: noQuestion })
    const verified = source === 'unit_price' ? { price: 250000 } : { brochure_url: BROCHURE_URL }
    const result = await completeTurnReply({ current: 'Quiero conocer las opciones', baseReply, verified, audit: { source, ...extra } }, mock.generate)
    const contract = mock.calls[0][1].contrato_redaccion
    assert.equal(contract.ruta, source)
    assert.equal(contract.decisiones_protegidas, source === 'financing_question')
    assert.deepEqual(result.audit.writer_contract, contract)
    assert.equal(result.reply, baseReply)
    if (source === 'project_overview') {
      assert.equal(contract.enlaces_obligatorios.length, 0)
      assert.equal(contract.enlaces_permitidos.length, 1)
    }
    if (source === 'unit_price') assert.deepEqual(contract.cifras_obligatorias, [])
  }
})

test('protected route checks the semantic goal instead of matching the literal question', async () => {
  const baseReply = 'Tenemos alternativas. ¿Qué planta prefiere?'
  const question = { text: '¿Qué planta prefiere?', purpose: 'choose_property', missing_datum: 'Planta', next_decision: 'Filtrar alternativas' }
  const input = { current: 'Quiero ver alternativas', baseReply, verified: {}, audit: { source: 'financing_selection_required' }, preserveOperationalQuestion: true }
  const draft = 'Con gusto le mostramos las alternativas. ¿Qué planta prefiere?'
  const mock = model({ reply: draft, requests: [covered(input.current)], question }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, draft)
  assert.equal(result.changed, true)
  const changed = 'Tenemos alternativas. ¿Cuál es su presupuesto?'
  const changedCandidate = { reply: changed, requests: [covered(input.current)], question: { ...question, text: '¿Cuál es su presupuesto?' } }
  const goalRejected = { ...approved, operational_goal_preserved: false }
  const bad = model(changedCandidate, goalRejected, changedCandidate, goalRejected)
  const rejected = await completeTurnReply(input, bad.generate)
  assertPending(rejected, baseReply, changedCandidate.reply)
  assert.ok(rejected.audit.issues.includes('review_check_failed:operational_goal_preserved'))
  assert.equal(bad.calls.length, 4)
  const paraphrase = { reply: 'Tenemos alternativas. ¿En cuál planta le gustaría revisar opciones?', requests: [covered(input.current)],
    question: { ...question, text: '¿En cuál planta le gustaría revisar opciones?' } }
  assert.equal((await completeTurnReply(input, model(paraphrase, approved).generate)).reply, paraphrase.reply)
})

test('visit rewrite without verified scheduling evidence stays pending without confirming or splicing times', async () => {
  const current = 'Me parece bien mañana a las 4 de la tarde'
  const baseReply = 'Revisaremos la disponibilidad para mañana, viernes 18 de septiembre a las 4 p. m. en nuestra oficina. Le avisaremos cuando el equipo confirme el horario.'
  const candidate = 'Hemos recibido su preferencia para mañana a las 4 p. m. en nuestra oficina. Le avisaremos cuando el equipo confirme.'
  const mock = model({reply:candidate,requests:[covered(current)],question:noQuestion},approved)
  const result = await completeTurnReply({current,baseReply,verified:{},audit:{source:'visit_intake'}},mock.generate)
  assertPending(result,baseReply,candidate)
  assert.equal(result.audit.status,'rejected_guard')
  assert.doesNotMatch(result.reply,/confirmada|4 p\. m\./)
  assert.equal(result.needsAdvisor,false)
})
test('sentence protection keeps both morning and afternoon abbreviations intact',()=>{
  for(const time of ['4 p. m.','9 a. m.','16:00.']) {
    const parts=protectedSentences(`Horario: ${time} Confirmaremos disponibilidad.`)
    assert.equal(parts[0],`Horario: ${time}`)
  }
})
test('appointment guards preserve office, pending status and complete times in both writing stages',()=>{
  const base='Revisaremos disponibilidad para recibirle en nuestra oficina mañana a las 4 p. m.'
  for(const [draft,issue] of [
    ['Gracias por confirmar. Revisaremos disponibilidad mañana a las 4 p. m. en nuestra oficina.','ambiguous_visit_confirmation'],
    ['Revisaremos disponibilidad para visitar el proyecto mañana a las 4 p. m.','visit_location_changed'],
    ['Revisaremos disponibilidad mañana a las 4 p. en nuestra oficina.','truncated_visit_time'],
  ]) {
    assert.ok(operationalCopyIssues(base,draft,{source:'visit_intake'}).includes(issue))
    assert.ok(turnCompletenessIssues({current:'mañana',baseReply:base,verified:{},audit:{source:'visit_intake'}},draft,noQuestion).includes(issue))
  }
  assert.deepEqual(operationalCopyIssues(base,'Recibimos su preferencia para mañana a las 4 p. m. en nuestra oficina; revisaremos disponibilidad.',{source:'visit_intake'}),[])
  assert.deepEqual(operationalCopyIssues('Su cita está confirmada en nuestra oficina a las 4 p. m.','Su cita está confirmada en nuestra oficina a las 4 p. m.',{action:'visit_confirm'}),[])
})

test('coverage repair cannot add commercial offers to a passive response or drop its requested facts', async () => {
  const current = 'Cuánto vale el departamento y aceptan mascotas?'
  const baseReply = 'El precio es $250.000. La política de mascotas debe verificarla el equipo.'
  const input = { current, baseReply, verified: { _sales_memory: { passive_sales: true }, price: 250000 } }
  const draft = baseReply + ' También podemos orientarle sobre financiamiento con JEP.'
  const mock = model({ reply: draft, requests: [covered(current)], question: noQuestion })
  const result = await completeTurnReply(input, mock.generate)
  assertPending(result, baseReply, draft)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.ok(result.audit.issues.includes('unsolicited_sales_offer'))
  assert.match(mock.calls[0][0], /MODO INFORMATIVO/)
})

test('answers three independent requests including a concern without question marks, with two bounded calls', async () => {
  const input = { current: 'Qué opciones tienen\nQuisiera comprar pero no sé si me alcanza\nCuál es el valor de las viviendas?', baseReply: 'Tenemos suites y departamentos.', verified: { range: '$210.000 a $550.000', partners: ['Banco Pichincha', 'Cooperativa JEP'], launch: true } }
  const reply = 'Tenemos suites y departamentos desde $210.000 hasta $550.000, como referencia de lanzamiento. Si necesita financiar la compra, podemos acompañarle a revisar opciones con Banco Pichincha o Cooperativa JEP.'
  const requests = input.current.split('\n').map((fragment, index) => covered(fragment, index ? 'unanswered' : 'answered'))
  const mock = model({ reply, requests, question: noQuestion }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.changed, true)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.requests.length, 3)
  assert.equal(mock.calls.length, 2)
})

test('a complete answer requires one review and records a specific purpose rather than a filler question', async () => {
  const input = { current: 'Sí ayúdeme en el financiamiento, el local lo quiero para rentarlo, influye?', baseReply: 'Podemos revisar opciones con Banco Pichincha o Cooperativa JEP. El uso previsto ayuda a orientar la compra; debemos verificar si una entidad considera ese uso en su evaluación. ¿Con cuál entidad desea continuar?', verified: { partners: ['Banco Pichincha', 'Cooperativa JEP'] }, preserveOperationalQuestion: true }
  const question = { text: '¿Con cuál entidad desea continuar?', purpose: 'choose_financing_partner', missing_datum: 'Entidad elegida', next_decision: 'Preparar la revisión con la entidad que autorice el cliente' }
  const mock = model({ reply: input.baseReply, requests: [covered('Sí ayúdeme en el financiamiento'), covered('el local lo quiero para rentarlo, influye?', 'missing_fact', 'missing_fact')], question }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.changed, false)
  assert.equal(mock.calls.length, 2)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, ['el local lo quiero para rentarlo, influye?'])
  assert.equal(result.audit.question.purpose, 'choose_financing_partner')
})

test('a house, its floors and direct credit remain three requests without pretending to sell houses', async () => {
  const input = { current: 'Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?', baseReply: 'No ofrecemos crédito directo. Podemos revisar opciones con Banco Pichincha o Cooperativa JEP.', verified: { products: ['suites', 'departamentos', 'locales'], houses: false } }
  const reply = 'La Vilet ofrece suites, departamentos y locales comerciales en Cuenca; no casas, así que no corresponde indicar pisos de una casa. No ofrecemos crédito directo. Podemos revisar opciones con Banco Pichincha o Cooperativa JEP.'
  const mock = model({ reply, requests: [covered('Quiero una casa de 300 mil', 'unanswered', 'outside_scope'), covered('cuántos pisos tiene la casa?', 'unanswered', 'outside_scope'), covered('Y tienen crédito directo?')], question: noQuestion }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.reply, reply)
})

test('ambiguous options clarify two plausible paths and do not require an advisor', async () => {
  const input = { current: 'Qué opciones tengo?', baseReply: 'No ofrecemos crédito directo.', verified: { partners: ['Banco Pichincha', 'Cooperativa JEP'], products: ['suites', 'departamentos'] } }
  const reply = 'Si se refiere a financiamiento, podemos revisar opciones con Banco Pichincha o Cooperativa JEP. Si desea comparar viviendas, también podemos orientarle entre suites y departamentos. ¿Por cuál de estas opciones desea continuar?'
  const question = { text: '¿Por cuál de estas opciones desea continuar?', purpose: 'clarify_request', missing_datum: 'Si busca información de financiamiento o de vivienda', next_decision: 'Mostrar la alternativa del ámbito elegido' }
  const mock = model({ reply, requests: [covered(input.current, 'clarification', 'clarification')], question }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.reply, reply)
})

test('model failure leaves the query pending without sending an unreviewed template', async () => {
  const result = await completeTurnReply({current:'¿Qué opciones tengo?',baseReply:'No ofrecemos crédito directo.',verified:{}},async()=>{throw Error('offline')})
  assertPending(result,'No ofrecemos crédito directo.')
  assert.equal(result.needsAdvisor,false)
})

test('unknown concrete facts preserve answered information and return only missing fragments', async () => {
  const input = { current: 'Qué precio tiene el 202? Tiene certificación acústica?', baseReply: 'El departamento 202 tiene un valor referencial de $250.000.',
    verified: { catalogo: [{ id: 'd202', unit_number: '202', category: 'departamento', published_commercial_price: 250000 }] } }
  const reply = 'El departamento 202 tiene un valor referencial de $250.000. La certificación acústica necesita verificarse.'
  const mock = model({ reply, requests: [covered('Qué precio tiene el 202?'), covered('Tiene certificación acústica?', 'missing_fact', 'missing_fact')], question: noQuestion }, { ...approved, missing_fact_fragments: ['Tiene certificación acústica?'] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, ['Tiene certificación acústica?'])
  assert.ok(result.reply.startsWith(input.baseReply))
})

test('invented historical fragments and fictitious URLs never pass source validation', async () => {
  const input = { current: 'Qué incluye el 202?', baseReply: 'El 202 tiene balcón.', verified: { catalogo: [{ id: 'd202', unit_number: '202', spaces: ['balcón'] }] } }
  const invalid = { reply: input.baseReply, requests: [covered('Quiero una cita mañana')], question: noQuestion }
  const invented = model(invalid, invalid)
  assert.equal((await completeTurnReply(input, invented.generate)).audit.status, 'invalid_coverage')
  const badLink = model({ reply: input.baseReply + ' https://inventado.example/202', requests: [covered(input.current)], question: noQuestion })
  const result = await completeTurnReply(input, badLink.generate)
  assertPending(result, input.baseReply)
  assert.deepEqual(result.audit.issues, ['unauthorized_link'])
  assert.equal(badLink.calls.length, 1)
})

test('price and punctuation checks do not replace semantic review of commercial actions', () => {
  const input = { current: 'Quisiera visitar el 202.', baseReply: 'El 202 cuesta $250.000. ¿Qué fecha le vendría bien?',
    verified: { catalogo: [{ id: 'd202', unit_number: '202', published_commercial_price: 250000 }] }, preserveOperationalQuestion: true }
  const issues = turnCompletenessIssues(input, 'El 202 cuesta $300.000.', noQuestion)
  assert.ok(issues.includes('numbers_changed'))
  assert.equal(issues.includes('operational_question_omitted'), false)
  assert.deepEqual(turnCompletenessIssues(input, 'El 202 cuesta $250.000. Indíqueme la fecha que prefiere.', noQuestion), [])
  assert.ok(!turnCompletenessIssues(input, 'Ya hemos confirmado su cita para el 202 de $250.000.', noQuestion).includes('new_operational_claim'))
})

test('a URL query is not mistaken for a client-facing question and verified catalogue prices can be formatted', () => {
  const input = { current: 'Ubicación y precio?', baseReply: 'Mapa: https://maps.google.com/?q=Cuenca',
    verified: { price: 250000, ubicacion: 'https://maps.google.com/?q=Cuenca' } }
  assert.deepEqual(turnCompletenessIssues(input, 'El precio es $250.000. Mapa: https://maps.google.com/?q=Cuenca', noQuestion), [])
})

test('a template alone cannot authorize its numeric facts or material destinations', () => {
  const baseReply = 'La unidad 202 cuesta $250.000. Consulte https://inventado.example/reserva'
  const issues = turnCompletenessIssues({ current: 'Quiero información', baseReply, verified: {} }, baseReply, noQuestion)
  assert.ok(issues.includes('numbers_changed'))
  assert.ok(issues.includes('unauthorized_link'))
})

test('a meaningless question and unverified income claim are rejected by independent review without retries', async () => {
  const input = { current: 'El local es para rentarlo, eso influye en el crédito?', baseReply: 'Podemos revisar las opciones.', verified: {} }
  const reply = 'Los ingresos futuros por renta respaldan el crédito.'
  const mock = model({ reply, requests: [{ ...covered(input.current, 'missing_fact', 'missing_fact'), fact_key: 'policy' }], question: noQuestion }, { ...approved, answers_supported: false })
  const result = await completeTurnReply(input, mock.generate)
  assertPending(result, input.baseReply)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.audit.pending_missing_fact_fragments, [input.current])
  assert.equal(mock.calls.length, 1)
})

test('optional CTA purpose failure does not generate an urgent handoff', async () => {
  const input = { current: 'Qué productos tienen?', baseReply: 'Tenemos suites, departamentos y locales comerciales.', verified: {} }
  const draft = { reply: input.baseReply + ' ¿Qué opina?', requests: [covered(input.current)], question: { text: '¿Qué opina?', purpose: 'none', missing_datum: '', next_decision: '' } }
  const rejected = { ...approved, question_has_purpose: false }
  const mock = model(draft, rejected, draft, rejected)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'rejected_review')
})

test('provider errors preserve the pending turn without pretending that an advisor was notified', async () => {
  const input = { current: 'Sí, con JEP', baseReply: 'Continuamos con Cooperativa JEP. ¿Cuál es su nombre completo?', verified: {} }
  const mock = model(new Error('provider unavailable'))
  const result = await completeTurnReply(input, mock.generate)
  assertPending(result, input.baseReply)
  assert.equal(result.changed, true)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'unavailable')
})

test('missing required facts are repaired by the writer instead of splicing template sentences', async () => {
  const input = { current: 'Qué opciones y precios tienen?', baseReply: 'Tenemos departamentos de 2 o 3 dormitorios.',
    verified: { price_range: '$250.000 a $550.000', catalogo: [{ id: 'd2', bedrooms: 2 }, { id: 'd3', bedrooms: 3 }] } }
  const draft = { reply: 'Los valores referenciales van de $250.000 a $550.000.', requests: [covered(input.current, 'unanswered')], question: noQuestion }
  const revised = { ...draft, reply: 'Los departamentos de 2 o 3 dormitorios tienen valores referenciales de $250.000 a $550.000.' }
  const mock = model(draft, { ...approved, all_requests_considered: false }, revised, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, revised.reply)
  assert.match(result.reply, /250\.000 a \$550\.000/)
  assert.equal(mock.calls[2][1].reparacion.borrador, draft.reply)
  assert.equal(mock.calls[3][1].respuesta_propuesta, result.reply)
  assert.equal(result.needsAdvisor, false)
})

test('does not mistake optional question metadata for an actual question or reject a valid answer without one', async () => {
  const input = { current: 'Qué opciones tengo?', baseReply: 'Tenemos viviendas.', verified: { partners: ['Cooperativa JEP'] } }
  const mock = model({ reply: 'Tenemos viviendas. Puede revisar financiamiento con Cooperativa JEP.', requests: [covered(input.current, 'clarification')],
    question: { text: '¿Quiere revisar financiamiento?', purpose: 'choose_financing_partner', missing_datum: 'Entidad', next_decision: 'Revisar opciones' } }, { ...approved, question_has_purpose: false })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.changed, true)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.question.purpose, 'none')
})

test('a false rental-income claim never survives even if the provider is unavailable', async () => {
  const current = 'Sí ayúdeme en el financiamiento. El local lo quiero para rentarlo, eso influye en algo?'
  const baseReply = 'Podemos revisar opciones con Banco Pichincha o Cooperativa JEP. El hecho de que planee rentarlo respalda la solicitud porque genera ingresos. ¿Con cuál entidad desea continuar?'
  const input = { current, baseReply, verified: {}, preserveOperationalQuestion: true }
  const result = await completeTurnReply(input, model(new Error('provider unavailable')).generate)
  assert.doesNotMatch(result.reply, /rentarlo respalda|porque genera ingresos/)
  assertPending(result, baseReply)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.changed, true)
  assert.equal(result.audit.unsupported_rental_claim_removed, true)
  assert.ok(result.audit.pending_missing_fact_fragments.length > 0)
  assert.ok(result.audit.pending_missing_fact_fragments.every(fragment => current.includes(fragment)))
})

test('a rental purpose alone does not force handoff or suppress a valid conditional explanation', () => {
  const baseReply = 'No podemos asegurar que los ingresos futuros respalden el crédito. ¿Con cuál entidad desea continuar?'
  assert.equal(safeRentalCreditBase(baseReply, 'Quiero rentarlo', {}).removed, false)
  const removed = safeRentalCreditBase('Rentar el local respalda su solicitud.', 'Lo quiero para rentarlo.', {})
  assert.equal(removed.removed, true)
  assert.deepEqual(removed.unresolved, [])
})

function comparisonTurn(current = 'y cual es la diferencia entre cada uno?') {
  const { catalogDialogueReply } = require('../src/lib/integrations/automation/catalog-dialogue.ts')
  const catalogo = [
    { id: 'u202', unit_number: '202', category: 'departamento', bedrooms: 3, bathrooms_full: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03, floor_number: 2 },
    { id: 'u302', unit_number: '302', category: 'departamento', bedrooms: 3, bathrooms_full: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03, floor_number: 3 },
    { id: 'u304', unit_number: '304', category: 'departamento', bedrooms: 2, bathrooms_full: 2, area_internal_m2: 109.69, area_exterior_m2: 34.59, floor_number: 3 },
  ]
  const planned = catalogDialogueReply({ catalogo, referencia_unidad: { query: { group: 'residential', category: 'departamento', operation: 'compare' } } })
  const question = { text: planned.audit.progressive_selection.question, purpose: 'choose_property',
    missing_datum: 'La unidad que el cliente desea conocer mejor', next_decision: 'Mostrar detalles de la unidad que el cliente elija' }
  return { current, baseReply: planned.reply, verified: { catalogo }, audit: planned.audit, question }
}

test('a complete catalogue comparison contradicts an erroneous missing-fact claim without a handoff', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: input.baseReply, requests: [{ ...covered(input.current, 'missing_fact', 'missing_fact'), fact_key: 'catalog_comparison' }], question: input.question }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.audit.handoff_assessments[0].outcome, 'answered_by_catalog')
})

test('catalogue coverage never hides an additional missing pet policy', async () => {
  const comparison = 'cual es la diferencia entre cada uno?'
  const missing = 'Aceptan mascotas?'
  const input = comparisonTurn(comparison + ' ' + missing)
  const mock = model({ reply: input.baseReply.replace(input.question.text, `La política de mascotas debe verificarse. ${input.question.text}`), requests: [
    { ...covered(comparison, 'missing_fact', 'missing_fact'), fact_key: 'catalog_comparison' },
    { ...covered(missing, 'missing_fact', 'missing_fact'), fact_key: 'policy' },
  ], question: input.question }, { ...approved, missing_fact_fragments: [missing] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [missing])
  assert.deepEqual(result.audit.missing_fact_fragments, [missing])
})

test('a rejected rewrite cannot turn an unanswered fact into a request for an advisor', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: input.baseReply + ' Tiene 999 m² interiores.', requests: [covered(input.current, 'unanswered', 'missing_fact')], question: input.question })
  const result = await completeTurnReply(input, mock.generate)
  assertPending(result, input.baseReply)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.draft_rejected, true)
})

test('independent reviewer fragments are recorded and checked against catalogue evidence', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: 'Estas son las diferencias. ' + input.baseReply, requests: [covered(input.current)], question: input.question },
    { ...approved, missing_fact_fragments: [input.current] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.audit.missing_fact_fragments, [input.current])
  assert.equal(result.audit.handoff_assessments[0].outcome, 'answered_by_catalog')
  assert.ok(result.audit.base_preview)
  assert.ok(result.audit.proposed_preview)
  assert.ok(result.audit.final_preview)
})

test('a vague comparison claim cannot erase a mixed policy question or fill a missing measurement', async () => {
  const { catalogCoversFragment } = require('../src/lib/integrations/automation/coverage-evidence.ts')
  const input = comparisonTurn()
  assert.equal(catalogCoversFragment('cual es la diferencia entre cada uno y cuánto es la alícuota?', 'catalog_comparison', input.audit), false)
  assert.equal(catalogCoversFragment('diferencias de aislamiento acústico?', 'catalog_comparison', input.audit), false)
  const incomplete = structuredClone(input.audit)
  incomplete.catalog_results.units[0].area_internal_m2 = null
  incomplete.catalog_coverage.known_fields = incomplete.catalog_coverage.known_fields.filter(key => key !== 'area_internal_m2')
  assert.equal(catalogCoversFragment(input.current, 'catalog_comparison', incomplete), false)
  for (const field of ['bedrooms', 'area_exterior_m2']) {
    const zero = structuredClone(input.audit)
    zero.catalog_results.units[0][field] = 0
    zero.catalog_coverage.known_fields = zero.catalog_coverage.known_fields.filter(key => key !== field)
    assert.equal(catalogCoversFragment(input.current, 'catalog_comparison', zero), false)
  }
  const missingBaths = structuredClone(input.audit)
  missingBaths.catalog_results.units.forEach(unit => { unit.bathrooms_full = null })
  missingBaths.catalog_coverage.known_fields = missingBaths.catalog_coverage.known_fields.filter(key => key !== 'bathrooms_full')
  assert.equal(catalogCoversFragment('qué diferencias hay entre los baños de cada uno?', 'catalog_comparison', missingBaths), false)
})

test('an unchanged answer with an omitted request still receives independent coverage review', async () => {
  const comparison = 'cual es la diferencia entre cada uno?'
  const missing = 'Aceptan mascotas?'
  const input = comparisonTurn(comparison + ' ' + missing)
  const mock = model({ reply: input.baseReply, requests: [covered(comparison)], question: input.question },
    { ...approved, all_requests_considered: false, missing_fact_fragments: [missing] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(mock.calls.length, 3)
  assert.equal(result.audit.repair_attempts[0].failure, 'repair_call_failed')
  assert.equal(result.audit.independent_review, true)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.audit.pending_missing_fact_fragments, [missing])
  assert.equal(result.audit.status, 'rejected_review')
})

test('commercial continuation recommendations are observations and meaning is independently reviewed', async () => {
  const input = comparisonTurn()
  const paraphrase = '¿Cuál de estos departamentos desea que revisemos con más detalle?'
  const natural = input.baseReply.replace(input.question.text, paraphrase)
  const candidate = { reply: natural, requests: [covered(input.current)], question: { ...input.question, text: paraphrase } }
  const mock = model(candidate, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, natural)
  assert.equal(result.audit.question.text, paraphrase)
  assert.equal(result.audit.question.purpose, 'choose_property')
  assert.equal(result.needsAdvisor, false)
  assert.equal(mock.calls.length, 2)
  for (const [reply, question, issue] of [
    [input.baseReply.replace(input.question.text, '').trim(), noQuestion, 'commercial_next_question_missing'],
    [input.baseReply.replace(input.question.text, '¿Qué presupuesto tiene previsto para la compra?'),
      { text: '¿Qué presupuesto tiene previsto para la compra?', purpose: 'collect_financing_required', missing_datum: 'Presupuesto total', next_decision: 'Iniciar revisión financiera' }, 'commercial_next_question_changed'],
  ]) {
    const candidate = { reply, requests: [covered(input.current)], question }
    const accepted = await completeTurnReply(input, model(candidate, approved).generate)
    assert.equal(accepted.audit.status, 'checked', issue)
    assert.ok(accepted.audit.editorial_observations.includes(issue), JSON.stringify(accepted.audit))
    assert.equal(accepted.reply, reply, issue)
    const failedGoal = { ...approved, operational_goal_preserved: false }
    const rejected = await completeTurnReply(input, model(candidate, failedGoal, candidate, failedGoal).generate)
    assert.equal(rejected.audit.status, 'rejected_review')
    assert.ok(rejected.audit.issues.includes('review_check_failed:operational_goal_preserved'))
  }
})

test('catalogue evidence cannot answer attributes or comparisons of an absent unit', () => {
  const { catalogCoversFragment } = require('../src/lib/integrations/automation/coverage-evidence.ts')
  const { audit } = comparisonTurn()
  assert.equal(catalogCoversFragment('cuantos dormitorios tiene el departamento 202?', 'bedrooms', audit), true)
  assert.equal(catalogCoversFragment('cuantos dormitorios tiene el departamento 999?', 'bedrooms', audit), false)
  assert.equal(catalogCoversFragment('en que planta esta la unidad 999?', 'floor_number', audit), false)
  assert.equal(catalogCoversFragment('diferencias entre departamentos 202 y 999?', 'catalog_comparison', audit), false)
  assert.equal(catalogCoversFragment('cuantos dormitorios tiene la suite 202?', 'bedrooms', audit), false)
  audit.catalog_results.units.push({ ...audit.catalog_results.units[0], id: 'u601', unit_number: '601', category: 'penthouse' })
  assert.equal(catalogCoversFragment('cuantos dormitorios tiene el departamento 601?', 'bedrooms', audit), false)
  assert.equal(catalogCoversFragment('cuantos dormitorios tiene el penthouse 601?', 'bedrooms', audit), true)
})


test('reviewer repairs nonliteral claim evidence once without rewriting the commercial draft', async () => {
 const current='Y no tiene algo de 5 habitaciones?';
 const reply='No tenemos viviendas de 5 dormitorios. Los departamentos ofrecen hasta 120,83 m2 interiores.';
 const input={ current, baseReply:'No tenemos viviendas de 5 dormitorios. Departamentos: 120,83 m2 interiores.', audit:{semantic_review_enabled:true}, verified:{catalogo:[{id:'d',area_internal_m2:120.83}]} };
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const fact={unit_id:'d',field:'area_internal_m2',value:120.83,fragment:'S2'};
 const review={...approved,claims:[{fragment:'Los departamentos tienen superficies amplias.',subject:'alternativas',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],factual_values:[fact]};
 for(const success of [true,false]) {
  const responses=[candidate,review,{...review,claims:review.claims.map(claim=>({...claim,fragment:success?reply:claim.fragment}))}];
  let calls=0;
  const result=await completeTurnReply(input,async()=>responses[calls++]);
  assert.equal(calls,3,JSON.stringify(result.audit));
  if(success)assert.equal(result.reply,reply);else assertPending(result,input.baseReply,reply);
  assert.equal(result.audit.status,success?'checked':'rejected_review');
  assert.equal(result.audit.repair_attempts[0].target,'review_metadata');
  assert.equal(result.audit.repair_attempts[0].issues[0].code,'claim_fragment_not_in_reply');
 }
 const responses=[candidate,review,{...review,factual_values:[]}];let calls=0;
 const omitted=await completeTurnReply(input,async()=>responses[calls++]);
 assert.equal(omitted.audit.status,'rejected_review');
 assert.equal(calls,3);
});

test('optional and repeated openings retain the reviewed draft and repetition is observable',async()=>{
 const current='Si claro, muchas gracias';const baseReply='Tenemos departamentos.';
 const candidate={reply:'Perfecto, gracias a usted. Tenemos departamentos.',requests:[covered(current)],question:noQuestion};
 const accepted=await completeTurnReply({current,baseReply,verified:{}},model(candidate,approved).generate);
 assert.equal(accepted.reply,candidate.reply);
 const repeated=await completeTurnReply({current,baseReply,verified:{},history:[{role:'bot',content:'Perfecto, le ayudo.'}]},model(candidate,approved).generate);
 assert.equal(repeated.reply,candidate.reply);
 assert.deepEqual(repeated.audit.editorial_observations,['repeated_courtesy']);
});

test('unambiguous unit numbers are resolved without rewriting or another model call', async () => {
 const current='que opciones tiene para familia';
 const baseReply='Tenemos penthouses de 2 dormitorios.';
 const reply='Puede revisar penthouses de 2 dormitorios.';
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const review={...approved,claims:[{fragment:reply,subject:'penthouses',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],
  factual_values:[{unit_id:'603',field:'bedrooms',value:2,fragment:'penthouses de 2 dormitorios'}]};
 let calls=0;
 const result=await completeTurnReply({current,baseReply,audit:{semantic_review_enabled:true},verified:{catalogo:[{id:'uuid603',unit_number:'603',bedrooms:2}]}},async()=>[candidate,review][calls++]);
 assert.equal(calls,2);
 assert.equal(result.reply,reply);
 assert.equal(result.audit.status,'checked');
 assert.deepEqual(result.audit.semantic_review.reference_corrections,[{code:'unit_number_resolved',from:'603',to:'uuid603'}]);
 assert.equal(result.audit.repair_attempts.length,0);
});

test('historical reviewer references expose only implicated units from the same saved contract', () => {
 const {reviewReferenceSnapshot}=require('../src/lib/integrations/automation/semantic-review.ts');
 assert.deepEqual(reviewReferenceSnapshot({}),[]);
 const snapshot=reviewReferenceSnapshot({turn_completeness:{semantic_review:{validation_details:[{unit_id:'603'}]},
  writer_contract:{hechos_protegidos:[{id:'uuid603',unit_number:'603',category:'penthouse',private:'not exposed'}, {id:'uuid604',unit_number:'604'}]}}});
 assert.deepEqual(snapshot,[{id:'uuid603',unit_number:'603',category:'penthouse'}]);
});

test('empty search retains verified alternatives for writer, reviewer, aggregate checks and final guard', async () => {
 const {turnEvidence}=require('../src/lib/integrations/automation/turn-evidence.ts');
 const {validateCatalogReply}=require('../src/lib/integrations/automation/catalog-dialogue.ts');
 const units=[{id:'d202',unit_number:'202',category:'departamento',bedrooms:3,area_internal_m2:120.83},
  {id:'p602',unit_number:'602',category:'penthouse',bedrooms:3,area_internal_m2:142.09},
  {id:'p605',unit_number:'605',category:'penthouse',bedrooms:3,area_internal_m2:140.53}];
 const current='me interesa alguna opcion de 5 o 6 cuartos';
 const reply='La Vilet no dispone de viviendas de 5 o 6 dormitorios. Los departamentos de 3 dormitorios alcanzan hasta 120,83 m² interiores y los penthouses de 3 dormitorios hasta 142,09 m² interiores.';
 const audit={semantic_review_enabled:true,verified_catalog:true,catalog_query:{scope:'catalog',group:'residential',filters:{bedrooms:null,bedrooms_any:[5,6]}},
  catalog_results:{units:[],unit_ids:[],complete:true,unknown_unit_ids:[]},alternative_results:{units,unit_ids:units.map(u=>u.id),query:{filters:{bedrooms:3}}}};
 const facts=[{fragment:'S2',unit_id:'group:departamento:3:max',field:'area_internal_m2',value:120.83},
  {fragment:'S2',unit_id:'group:penthouse:3:max',field:'area_internal_m2',value:142.09}];
 const claims=[{fragment:'S1',subject:'viviendas 5 o 6 dormitorios',polarity:'negation',verdict:'supported',evidence:'consulta completa sin coincidencias',evidence_source:'catalog_no_results'},
  {fragment:'S2',subject:'alternativas',polarity:'affirmation',verdict:'supported',evidence:'grupos calculados',evidence_source:'verified_context'}];
 const mock=model({reply,requests:[covered(current)],question:noQuestion},{...approved,claims,factual_values:facts});
 const result=await completeTurnReply({current,baseReply:'No tenemos viviendas de 6 dormitorios. Departamentos de 3 dormitorios: 120,83 m². Penthouses de 3 dormitorios: 142,09 m².',verified:{catalogo:[]},audit},mock.generate);
 assert.equal(result.audit.status,'checked',JSON.stringify(result.audit));
 assert.equal(result.reply,reply);assert.equal(mock.calls.length,2);
 assert.equal(result.audit.semantic_review.evidence_summary.unit_count,3);
 assert.equal(validateCatalogReply(reply,{...audit,semantic_review:result.audit.semantic_review}).valid,true);
 const evidence=turnEvidence({catalogo:[]},audit);
 assert.deepEqual(evidence.query_result_ids,[]);assert.deepEqual(evidence.alternative_ids,units.map(u=>u.id));
 assert.equal(evidence.groups.find(g=>g.id==='group:penthouse:3:max').area_internal_m2,142.09);
 assert.equal(evidence.groups.find(g=>g.id==='group:penthouse:3:min').area_internal_m2,140.53);
 for(const call of mock.calls) assert.deepEqual(call[1].evidencia_turno.units.map(u=>u.id),
  units.map(u=>call[6]==='review'?u.id:u.unit_number));
});

test('reference normalization never changes numbers or resolves ambiguous unit numbers', () => {
 const {normalizeReviewReferences,turnEvidence}=require('../src/lib/integrations/automation/turn-evidence.ts');
 const {factualValueIssues}=require('../src/lib/integrations/automation/semantic-review.ts');
 const units=[{id:'a',unit_number:'602',category:'penthouse',bedrooms:3,area_internal_m2:142.09}];
 const reply='El penthouse 602 tiene 5 dormitorios.';
 const review={factual_values:[{unit_id:'602',fragment:'S1',field:'bedrooms',value:5}]};
 const normalized=normalizeReviewReferences(review,units,reply);
 assert.equal(normalized.review.factual_values[0].value,5);
 assert.equal(factualValueIssues(normalized.review.factual_values,reply,units)[0].code,'catalog_value_mismatch');
 const ambiguous=normalizeReviewReferences(review,[...units,{...units[0],id:'b'}],reply);
 assert.equal(ambiguous.review.factual_values[0].unit_id,'602');
 const partial=turnEvidence({catalogo:[...units,{id:'b',category:'penthouse',bedrooms:3,area_internal_m2:null}]});
 assert.equal(partial.groups.find(g=>g.id==='group:penthouse:3:max').area_internal_m2,undefined);
 const conflict=turnEvidence({}, {verified_catalog:true,catalog_results:{units},alternative_results:{units:[{...units[0],bedrooms:5}]}});
 assert.equal(conflict.conflicts[0].kind,'system_evidence');
});

test('a commercial defect has one rewrite and independent recheck; a repeated defect falls back',async()=>{
 const current='Detalles del penthouse';const baseReply='Penthouse 602: 3 dormitorios.';
 const input={current,baseReply,verified:{catalogo:[{id:'p',unit_number:'602',bedrooms:3}]},audit:{semantic_review_enabled:true}};
 const candidate=reply=>({reply,requests:[covered(current)],question:noQuestion});
 const review=(reply,value)=>({...approved,claims:[{fragment:'S1',subject:'p',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],
  factual_values:[{unit_id:'p',field:'bedrooms',value,fragment:'S1'}]});
 const bad='El penthouse 602 tiene 5 dormitorios.',good='El penthouse 602 tiene 3 dormitorios.';
 for(const repaired of [true,false]){
  const mock=model(candidate(bad),review(bad,5),review(bad,5),candidate(repaired?good:bad),review(repaired?good:bad,repaired?3:5));
  const result=await completeTurnReply(input,mock.generate);
  assert.equal(mock.calls.length,5);if(repaired)assert.equal(result.reply,good);else assertPending(result,baseReply,bad);
  assert.equal(result.audit.status,repaired?'checked':'rejected_review');
  assert.equal(result.audit.repair_attempts.length,2);
  assert.equal(result.audit.repair_attempts[1].target,'commercial_draft');
  assert.equal(mock.calls[3][1].reparacion.controles[0].code,'catalog_value_mismatch');
 }
});

test('unknown reference gets one metadata repair and cannot bypass checks by omitting facts',async()=>{
 const current='Detalles del penthouse',reply='El penthouse 602 tiene 3 dormitorios.';
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const fact={unit_id:'unknown',field:'bedrooms',value:3,fragment:'S1'};
 const review={...approved,claims:[{fragment:'S1',subject:'p',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],factual_values:[fact]};
 for(const repaired of [true,false]){
  const mock=model(candidate,review,{...review,factual_inventory_complete:repaired,factual_values:repaired?[{...fact,unit_id:'p'}]:[]});
  const result=await completeTurnReply({current,baseReply:'Penthouse 602: 3 dormitorios.',audit:{semantic_review_enabled:true},verified:{catalogo:[{id:'p',unit_number:'602',bedrooms:3}]}},mock.generate);
  assert.equal(mock.calls.length,3);assert.equal(result.audit.repair_attempts.length,1);
  assert.equal(result.audit.status,repaired?'checked':'rejected_review');
  assert.equal(mock.calls[2][1].respuesta_propuesta,reply);
 }
});

test('PRECIO repairs only reviewer metadata for a supported interval and a paraphrased claim', async () => {
 const current='PRECIO';
 const reply='Los precios van desde $145.000 hasta $550.000 USD. Estos son valores referenciales sujetos a cambios.';
 const units=[{id:'low',unit_number:'101',category:'suite',published_commercial_price:145000},
  {id:'high',unit_number:'605',category:'penthouse',published_commercial_price:550000}];
 const claim=(fragment,subject)=>({fragment,subject,polarity:'affirmation',verdict:'supported',evidence:'Precios publicados y condicion referencial verificados',evidence_source:'verified_context'});
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const first={...approved,claims:[claim('S1','precios'),claim('Los precios son valores referenciales sujetos a cambios.','condiciones')],factual_values:[
  {unit_id:'price',field:'published_commercial_price',value:145000,operator:'gte',upper_value:550000,fragment:'S1'},
  {unit_id:'price_reference',field:'published_commercial_price',value:145000,operator:'eq',upper_value:550000,fragment:'S1'}]};
 const repaired={...approved,claims:[claim('S1','precios'),claim('S2','condiciones')],factual_values:[
  {unit_id:'group:context:all:range',field:'published_commercial_price',value:145000,operator:'between',upper_value:550000,fragment:'S1'}]};
 const mock=model(candidate,first,repaired);
 const result=await completeTurnReply({current,baseReply:reply,verified:{catalogo:units},audit:{semantic_review_enabled:true}},mock.generate);
 assert.equal(result.audit.status,'checked',JSON.stringify(result.audit));
 assert.equal(result.reply,reply);assert.equal(mock.calls.length,3);
 assert.equal(result.audit.repair_attempts.length,1);
 assert.equal(result.audit.repair_attempts[0].target,'review_metadata');
 assert.deepEqual(mock.calls.map(call=>call[6]),['writing','review','review']);
 assert.equal(mock.calls[2][1].respuesta_propuesta,reply);
 assert.ok(result.audit.repair_attempts[0].issues.some(issue=>issue.code==='claim_fragment_not_in_reply'));
 assert.ok(result.audit.repair_attempts[0].issues.some(issue=>issue.code==='invalid_unit_fact'));
});

test('scoped interval references validate both endpoints across natural price wording', () => {
 const {turnEvidence}=require('../src/lib/integrations/automation/turn-evidence.ts');
 const {factualValueIssues}=require('../src/lib/integrations/automation/semantic-review.ts');
 const catalog=[{id:'a',category:'departamento',bedrooms:2,published_commercial_price:210000},
  {id:'b',category:'departamento',bedrooms:3,published_commercial_price:310000},
  {id:'c',category:'penthouse',bedrooms:3,published_commercial_price:550000}];
 const evidence=turnEvidence({catalogo:catalog});
 const validated=[...evidence.units,...evidence.groups];
 for(const fragment of ['Los departamentos cuestan entre $210.000 y $310.000 USD.',
  'El rango es de USD 210.000 a USD 310.000.',
  'Los valores van desde $210.000 hasta $310.000.',
  'El precio es $210.000 - $310.000 USD.']) {
  const fact={fragment,unit_id:'group:departamento:all:range',field:'published_commercial_price',value:210000,upper_value:310000,operator:'between'};
  assert.deepEqual(factualValueIssues([fact],fragment,validated),[],fragment);
  const bad=fragment.replaceAll('310.000','550.000');
  assert.equal(factualValueIssues([{...fact,fragment:bad,upper_value:550000}],bad,validated)[0].code,'catalog_range_mismatch');
 }
 for(const [fragment,unit_id,value,operator] of [
  ['Desde $210.000 USD.','group:departamento:all:min',210000,'gte'],
  ['Hasta USD 310.000.','group:departamento:all:max',310000,'lte']]) {
  assert.deepEqual(factualValueIssues([{fragment,unit_id,field:'published_commercial_price',value,operator,upper_value:null}],fragment,validated),[]);
 }
});

test('current authorized price quote supplies exact ranges despite unpriced or unavailable catalogue rows',async()=>{
 const {unitPriceQuote}=require('../src/lib/integrations/automation/price-reply.ts');
 const current='PRECIO';
 const catalogo=[{id:'priced-low',unit_number:'101',category:'suite',published_commercial_price:145000},
  {id:'priced-high',unit_number:'605',category:'penthouse',published_commercial_price:550000},
  {id:'unpriced',unit_number:'202',category:'departamento',published_commercial_price:null},
  {id:'sold',unit_number:'603',category:'penthouse',published_commercial_price:700000,status:'vendido'},
  {id:'private',unit_number:'301',category:'suite',published_commercial_price:100000,is_published:false}];
 const verified={catalogo,alcance_negocio:'property',politica_comercial:{precios_autorizados:true,precios_aproximados:true}};
 const quote=unitPriceQuote(verified,current,{});assert.equal(quote.quoted,true);
 const reply=quote.reply;
 const review={...approved,claims:[{fragment:reply,subject:'cotizacion actual',polarity:'affirmation',verdict:'supported',evidence:'Unidades disponibles con precio publicado',evidence_source:'verified_context'}],
  factual_values:[{fragment:'S1',unit_id:'group:price_quote:all:range',field:'published_commercial_price',value:145000,upper_value:550000,operator:'between'}]};
 const mock=model({reply,requests:[covered(current)],question:noQuestion},review);
 const result=await completeTurnReply({current,baseReply:reply,verified,audit:{source:'unit_price',verified_price_only:true,semantic_review_enabled:true,
  price_evidence:{units:[{id:'stale',price_usd:10000}]}}},mock.generate);
 assert.equal(result.audit.status,'checked',JSON.stringify(result.audit));assert.equal(mock.calls.length,2);
 assert.equal(result.reply,reply);
 const groups=mock.calls[1][1].evidencia_turno.groups;
 assert.equal(groups.find(group=>group.id==='group:context:all:range').published_commercial_price,undefined);
 const quoted=groups.find(group=>group.id==='group:price_quote:all:range');
 assert.deepEqual(quoted.member_ids,['priced-low','priced-high']);
 assert.equal(quoted.published_commercial_price,145000);
 assert.equal(quoted.upper_values.published_commercial_price,550000);
 assert.equal(quoted.source_scope,'current_price_quote');
 assert.deepEqual(result.audit.price_evidence.units.map(unit=>unit.id),['priced-low','priced-high']);
});

test('metadata repair cannot hide a wrong price, omit an endpoint or erase claims',async()=>{
 const current='Precio';const baseReply='Los precios van desde $145.000 hasta $550.000 USD.';
 const units=[{id:'a',published_commercial_price:145000},{id:'b',published_commercial_price:550000}];
 const validClaim={fragment:'S1',subject:'precios',polarity:'affirmation',verdict:'supported',evidence:'Precios verificados',evidence_source:'verified_context'};
 for(const scenario of ['wrong_price','missing_endpoint','missing_claim']) {
  const reply=scenario==='wrong_price'?baseReply.replace('550.000','600.000'):baseReply;
  const upper=scenario==='wrong_price'?600000:550000;
  const first={...approved,claims:[{...validClaim,fragment:scenario==='missing_claim'?'S1':'Los valores del proyecto son referenciales.'}],factual_values:[
   {fragment:'S1',unit_id:'price',field:'published_commercial_price',value:145000,upper_value:upper,operator:'gte'}]};
  const repaired={...approved,factual_inventory_complete:scenario==='wrong_price',claims:scenario==='missing_claim'?[]:[validClaim],factual_values:[scenario==='missing_endpoint'
   ?{fragment:'S1',unit_id:'group:context:all:min',field:'published_commercial_price',value:145000,upper_value:null,operator:'gte'}
   :{fragment:'S1',unit_id:'group:context:all:range',field:'published_commercial_price',value:145000,upper_value:upper,operator:'between'}]};
  const mock=model({reply,requests:[covered(current)],question:noQuestion},first,repaired,
    ...(scenario==='wrong_price'?[new Error('writer correction unavailable')]:[]));
  const result=await completeTurnReply({current,baseReply,verified:{catalogo:units},audit:{semantic_review_enabled:true}},mock.generate);
  assert.equal(result.audit.status,'rejected_review',scenario+JSON.stringify(result.audit));
  assert.equal(mock.calls.length,scenario==='wrong_price'?4:3,scenario);assertPending(result,baseReply,reply);
  assert.equal(result.audit.repair_attempts[0].target,'review_metadata');
  assert.ok(result.audit.semantic_review.validation_details.some(issue=>issue.code===({wrong_price:'catalog_range_mismatch',missing_endpoint:'incomplete_fact_inventory',missing_claim:'incomplete_fact_inventory'})[scenario]));
 }
});

test('unsupported claims remain content defects even when their citations are malformed',()=>{
 const {reviewClaims}=require('../src/lib/integrations/automation/semantic-review.ts');
 for(const verdict of ['unsupported','contradicted']) {
  const checked=reviewClaims([{fragment:'not in draft',subject:'reservation',polarity:'affirmation',verdict,evidence:'No reservation receipt',evidence_source:'verified_context'}],'Su solicitud fue recibida.');
  assert.equal(checked.valid,false);
  assert.ok(checked.issues.some(issue=>issue.kind==='commercial_content'));
  assert.ok(checked.issues.some(issue=>issue.kind==='review_metadata'));
 }
});

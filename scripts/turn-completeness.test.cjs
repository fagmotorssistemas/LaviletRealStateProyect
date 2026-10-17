/* eslint-disable @typescript-eslint/no-require-imports */
// The 80 scenarios retain the business subjects of the former suite. Review
// inventories, prose regex vetoes and reviewer-owned CTAs were retired. Their
// replacements test the current boundary: writer metadata, AI factual findings,
// bounded JSON repair, verified operation receipts and transport-only code.
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { completeTurnReply, turnCompletenessIssues, protectedSentences, safeRentalCreditBase } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { replyLinkContract, replyLinkIssues, MAX_REPLY_CHARACTERS } = require('../src/lib/integrations/automation/response-plan.ts')
const { BROCHURE_URL } = require('../src/lib/integrations/automation/project-material.ts')
const { requireReviewedResponse } = require('../src/lib/integrations/automation/response-review-recovery.ts')
const pass = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '', role: 'none', continuation_id: 'none', continuation_act: 'other' }
const request = (fragment, changes = {}) => ({ fragment, intent: 'Atender la consulta', request_type: 'specific_fact', status: 'answered', evidence: 'Fuentes del turno', fact_key: null, ...changes })
const unit = { id: 'u202', unit_number: '202', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83, area_exterior_m2: 27.03, floor_number: 2, published_commercial_price: 250000, is_published: true, status: 'disponible' }
const penthouse = { id: 'u605', unit_number: '605', category: 'penthouse', bedrooms: 3, area_internal_m2: 140.53, published_commercial_price: 337272, is_published: true, status: 'disponible' }
const pricePolicy = { precios_autorizados: true, precios_aproximados: true }
const confirmedProfile = { full_name: 'Carlos', residence_city: 'Cuenca', residence_status: 'confirmed',
  sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Carlos' } } }
const profileQuestion = { text: '¿Cómo se llama y dónde reside actualmente?', purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia',
  next_decision: 'Enviar el brochure', role: 'required_capture', continuation_id: 'lead_profile', continuation_act: 'profile' }
const profilePlan = { stage: 'request', question_purpose: 'collect_profile', missing_fields: ['full_name', 'residence'], profile_state: {}, generic_introduction: true }

function scenario(current, reply, extra = {}) {
  return { current, baseReply: extra.baseReply || reply, verified: extra.verified || {},
    audit: { semantic_review_enabled: true, ...extra.audit }, ...extra }
}
function supported(name, fixture) {
  test(name, async () => {
    const calls = [], draft = { reply: fixture.reply, question: fixture.question || noQuestion,
      requests: Object.hasOwn(fixture, 'requests') ? fixture.requests : [request(fixture.current)], writer_receipts: fixture.receipts || {} }
    const result = await completeTurnReply(scenario(fixture.current, fixture.reply, fixture), async (rules, context, schema, _a, _b, _c, role) => {
      calls.push({ role, context, schema })
      if (role === 'writing') {
        fixture.writerCheck?.(rules, context, schema)
        return draft
      }
      assert.equal(context.borrador, fixture.reply)
      assert.deepEqual(Object.keys(schema.properties), ['review_contract', 'verdict', 'findings'])
      fixture.reviewCheck?.(rules, context, schema)
      return pass
    })
    assert.equal(result.reply, fixture.reply)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.audit.server_semantic_validation, false)
    assert.deepEqual(result.audit.text_transformations, [])
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(calls.map(call => call.role), ['writing', 'review'])
    fixture.resultCheck?.(result, calls)
  })
}
function finding(fixture) {
  return { review_contract: 'content-review-v1', verdict: 'block', findings: [{ category: fixture.category || 'hard_fact',
    statement: fixture.wrong, reason: fixture.reason || 'Contradice el respaldo autorizado del turno.', authoritative_fact: fixture.authority }] }
}
function repaired(name, fixture, exhausted = false) {
  test(name, async () => {
    const roles = []; let writes = 0
    const verdict = finding(fixture)
    const result = await completeTurnReply(scenario(fixture.current, fixture.correct, fixture), async (_rules, context, _schema, _a, _b, _c, role) => {
      roles.push(role)
      if (role === 'writing') {
        writes++
        if (writes > 1) assert.deepEqual(context.reparacion.hallazgos_revisor, verdict.findings)
        return { reply: writes === 1 || exhausted ? fixture.wrong : fixture.correct, question: noQuestion }
      }
      return context.borrador === fixture.wrong ? verdict : pass
    })
    assert.deepEqual(roles, ['writing', 'review', 'writing', 'review'])
    assert.equal(result.audit.repair_attempts.length, exhausted ? 2 : 1)
    if (exhausted) {
      assert.equal(result.audit.status, 'rejected_review')
      assert.equal(result.audit.recovery.pending, true)
      assert.throws(() => requireReviewedResponse(result.audit), /RESPONSE_REVIEW_EXHAUSTED/)
    } else {
      assert.equal(result.reply, fixture.correct)
      assert.equal(result.audit.status, 'checked')
      assert.doesNotThrow(() => requireReviewedResponse(result.audit))
    }
    assert.equal(result.needsAdvisor, false)
  })
}
function envelope(name, invalid, fixture = {}) {
  test(name, async () => {
    const reply = fixture.reply || 'Podemos revisar las opciones con calma.'
    const roles = []; let reviews = 0
    const result = await completeTurnReply(scenario(fixture.current || 'Quisiera orientación', reply, fixture), async (_rules, context, _schema, _a, _b, _c, role) => {
      roles.push(role)
      if (role === 'writing') return { reply, question: fixture.question || noQuestion }
      assert.equal(context.borrador, reply)
      return ++reviews === 1 ? invalid : pass
    })
    assert.equal(result.reply, reply)
    assert.equal(result.audit.status, 'checked')
    assert.equal(result.audit.semantic_review.metadata_retries, 1)
    assert.deepEqual(result.audit.repair_attempts, [])
    assert.deepEqual(roles, ['writing', 'review', 'review'])
  })
}
function providerFailure(name, fixture) {
  test(name, async () => {
    let calls = 0
    await assert.rejects(completeTurnReply(scenario(fixture.current, fixture.reply, fixture), async () => {
      calls++; throw Error('PROVIDER_UNAVAILABLE')
    }), /PROVIDER_UNAVAILABLE/)
    assert.equal(calls, 1)
  })
}

// 01–14: policies, presentation, pricing, brochure and declared profile.
supported('published business policies reach writer and factual reviewer with their current version', {
  current: '¿Puedo recibir información desde Colombia?', reply: 'Puede recibir información a distancia; el asesor confirma firma y cierre.',
  verified: { politicas_negocio: [{ policy_id: 'remote', version: 2, policy_content: 'Información a distancia; firma y cierre sujetos a confirmación.' }] },
  writerCheck: (_rules, context) => assert.equal(context.contexto_verificado.politicas_negocio[0].version, 2),
  reviewCheck: (_rules, context) => assert.ok(context.fuentes_autorizadas.otros_hechos_y_politicas.some(source => JSON.stringify(source.value).includes('remote'))),
})
test('tour-link planning separates optional material from a requested or explicitly required delivery', () => {
  const url = 'https://www.lavilett.com/tour?unidad=605', audit = { source: 'reservation_handoff', unit_model: { url } }
  assert.deepEqual(replyLinkContract(`Recorrido: ${url}`, audit, { current: 'Quiero separar el 605' }).required_links, [])
  const requested = replyLinkContract(`Recorrido: ${url}`, audit, { current: 'Envíeme el recorrido del 605' })
  assert.deepEqual(requested.required_links, [url])
  assert.deepEqual(replyLinkIssues('Le explico los pasos.', requested), ['required_link_omitted'])
})
test('link planning never promotes a client-provided URL into an authorized material source', () => {
  const contract = replyLinkContract('Información verificada.', {}, { verified: { current: 'https://inventado.example/pago',
    history: [{ content: 'https://inventado.example/historial' }], brochure_url: BROCHURE_URL } })
  assert.deepEqual(contract.allowed_links, [BROCHURE_URL])
})
supported('a complete factual reply may exceed editorial length and carry two related writer questions', {
  current: 'Quiero revisar opciones', reply: 'Podemos revisar las distribuciones disponibles. '.repeat(42) + '¿Qué tipo le interesa? ¿Cuántos dormitorios prefiere?',
  question: { ...profileQuestion, text: '¿Qué tipo le interesa? ¿Cuántos dormitorios prefiere?', purpose: 'choose_property', continuation_id: 'property_bedrooms', continuation_act: 'choose_bedrooms' },
  resultCheck: result => assert.deepEqual(result.audit.editorial_observations, []),
})
supported('a reservation-status reply preserves writer wording and derives operation status only from the receipt', {
  current: 'Quiero iniciar la reserva del 605', reply: 'Su solicitud para iniciar la reserva del 605 está registrada; el equipo continuará con usted.',
  verified: { catalogo: [penthouse] }, audit: { source: 'reservation_handoff', reservation: { handoff_verified: true, request_id: 'r605', status: 'requested' } },
  resultCheck: result => assert.equal(result.audit.operational_action_verified, true),
})
supported('a price answer keeps its typed profile question and current price evidence', {
  current: '¿Qué precio tiene el 202?', reply: 'El departamento 202 cuesta USD 250.000. Para compartirle el brochure, ¿cómo se llama y dónde reside actualmente?',
  verified: { catalogo: [unit], politica_comercial: pricePolicy }, question: profileQuestion, audit: { profile_introduction: profilePlan },
  reviewCheck: (_rules, context) => assert.ok(context.fuentes_autorizadas.unidades.some(item => item.published_commercial_price === 250000)),
})
supported('a completed profile leaves the current bedroom question in the writer plan', {
  current: '¿Qué precio tienen?', reply: 'Hay opciones desde USD 250.000. ¿Cuántos dormitorios prefiere?',
  verified: { perfil_lead: confirmedProfile, catalogo: [unit], politica_comercial: pricePolicy,
    siguiente_paso_comercial: { action: 'discover_bedrooms', question: '¿Cuántos dormitorios prefiere?' } },
  writerCheck: (_rules, context) => assert.equal(context.contexto_verificado.siguiente_paso_comercial.action, 'discover_bedrooms'),
})
supported('the current requested-price objective reaches the writer even when its draft is concise', {
  current: '¿Cuánto cuesta el 202?', reply: 'Su valor publicado es USD 250.000.', verified: { catalogo: [unit], politica_comercial: pricePolicy },
  audit: { resolved_turn_intent: { objective: 'ask_price', required_facts: ['price'], requests: [{ domain: 'property', topics: ['purchase_price'], evidence: '¿Cuánto cuesta el 202?' }] } },
  writerCheck: (_rules, context) => assert.equal(context.contrato_turno.objective, 'ask_price'),
})
repaired('an invented available price is repaired through an AI hard-fact finding', {
  current: '¿Qué precio tiene?', wrong: 'La unidad 202 cuesta USD 200.000.', correct: 'La unidad 202 cuesta USD 250.000.', authority: 'El catálogo del 202 publica USD 250.000.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy },
})
supported('the opening keeps a naturally phrased residence invitation and deferred brochure', {
  current: 'Quisiera información', reply: 'Bienvenido a La Vilet. Para compartirle nuestro brochure, ¿cómo se llama y dónde reside actualmente?',
  question: profileQuestion, audit: { profile_introduction: profilePlan },
  writerCheck: (_rules, context) => assert.deepEqual(context.estado_operativo.profile_introduction.missing_fields, ['full_name', 'residence']),
})
supported('supported general categories do not regain the retired premature-category code veto', {
  current: 'Quiero conocer el proyecto', reply: 'La Vilet reúne suites, departamentos, penthouses y locales comerciales en Cuenca.',
  verified: { proyecto: { description: 'Proyecto de uso mixto con suites, departamentos, penthouses y locales comerciales en Cuenca.' } },
})
supported('brochure delivery is recorded from its writer receipt and never from a plan alone', {
  current: 'Soy Carlos y vivo en Cuenca', reply: `Le comparto el brochure: ${BROCHURE_URL}`, verified: { perfil_lead: confirmedProfile },
  receipts: { brochure_shared: true }, resultCheck: result => assert.equal(result.audit.writer_receipts.brochure_shared, true),
})
supported('a mixed-use clarification can include its pending brochure without a server rewrite', {
  current: 'Me interesan los locales comerciales', reply: `También contamos con locales comerciales. Puede revisar el brochure aquí: ${BROCHURE_URL}`,
  receipts: { brochure_shared: true }, verified: { catalogo: [{ id: 'lc11', unit_number: 'LC-11', category: 'local' }] },
})
supported('an unconfirmed location remains a residence candidate rather than a confirmed fact', {
  current: 'Estoy en Madrid', reply: '¿Madrid es su ciudad de residencia actual?',
  verified: { perfil_lead: { residence_candidate: { city: 'Madrid' }, residence_status: 'pending_confirmation' } },
  writerCheck: (_rules, context) => assert.notEqual(context.contexto_verificado.perfil_lead.residence_status, 'confirmed'),
})

// 15–29: operational state, alternative requirements, ranges and categories.
supported('current evidenced commercial requests remain separate from a pending visit', {
  current: 'Antes de la visita, ¿cuánto cuesta el 202?', reply: 'El 202 tiene un precio publicado de USD 250.000.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy, visit_dialogue_plan: { current_kind: 'other' } },
  audit: { resolved_turn_intent: { objective: 'ask_price', requests: [{ domain: 'property', topics: ['purchase_price'] }] } },
  writerCheck: (_rules, context) => assert.equal(context.contrato_turno.objective, 'ask_price'),
})
supported('a purposeful operational question is carried by writer metadata rather than punctuation counting', {
  current: 'Quiero coordinar una visita', reply: '¿Qué día prefiere? ¿En qué horario podría asistir?',
  question: { ...profileQuestion, text: '¿Qué día prefiere? ¿En qué horario podría asistir?', purpose: 'coordinate_visit', continuation_id: 'visit_preference', continuation_act: 'visit' },
})
supported('unanswered writer coverage labels cannot manufacture a fallback or execute an advisor handoff', {
  current: '¿Qué requisitos tienen?', reply: 'Necesito confirmar ese requisito.', requests: [request('¿Qué requisitos tienen?', { status: 'unanswered' })],
  resultCheck: result => assert.equal(result.audit.operational_action_verified, false),
})
supported('project quantities retain their subject and reach factual AI review as authorized sources', {
  current: '¿Cuántas plantas comerciales tendrá?', reply: 'El proyecto contempla dos plantas comerciales.',
  verified: { proyecto: { description: 'El proyecto contempla dos plantas comerciales.' } },
  reviewCheck: (_rules, context) => assert.ok(JSON.stringify(context.fuentes_autorizadas).includes('plantas comerciales')),
})
supported('a clarification about a missing reference remains distinct from missing project facts', {
  current: '¿Cuánto cuesta?', reply: '¿Qué unidad desea consultar?', requests: [request('¿Cuánto cuesta?', { status: 'clarification' })],
  question: { ...profileQuestion, text: '¿Qué unidad desea consultar?', purpose: 'clarify_request', continuation_id: 'unit_choice', continuation_act: 'choose_unit' },
})
supported('contradictory auxiliary coverage labels do not independently authorize a commercial handoff', {
  current: '¿Qué unidad es?', reply: '¿Se refiere al departamento 202?', requests: [request('¿Qué unidad es?', { status: 'missing_fact' })],
  resultCheck: result => assert.deepEqual(result.unresolved, []),
})
supported('a truthful handoff notice stays intact with its single emitted question', {
  current: 'Quiero hablar con un asesor', reply: 'Su solicitud quedó registrada. ¿Hay algo más que desee añadir?',
  audit: { handoff_result: { verified: true, id: 'handoff' } }, resultCheck: result => assert.equal(result.audit.operational_action_verified, true),
})
supported('general financing preserves paragraphs without server text normalization', {
  current: '¿Cómo funciona el financiamiento?', reply: 'Puede revisar las alternativas bancarias.\n\nLa entidad confirma sus condiciones después de evaluar la solicitud.',
  verified: { politicas_negocio: [{ policy_content: 'Las entidades evalúan cada solicitud.' }] },
})
supported('a budget concern keeps the commercial plan without converting a financing offer into consent', {
  current: 'No sé si me alcance', reply: 'Podemos revisar alternativas de financiamiento si le interesa.', receipts: { offered_action: 'information' },
  resultCheck: result => assert.equal(result.audit.operational_action_verified, false),
})
supported('category maxima expressed as hasta remain natural writer prose for factual review', {
  current: '¿Hasta qué precio llegan los departamentos?', reply: 'Los departamentos llegan hasta USD 250.000.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy },
})
repaired('a comparison uses the same bounded writer repair when the AI detects a wrong surface', {
  current: '¿Cuál tiene mayor área?', wrong: 'El departamento 202 tiene 140,53 m² interiores.', correct: 'El penthouse 605 tiene 140,53 m² interiores; el departamento 202 tiene 120,83 m².',
  authority: '202: 120,83 m²; 605: 140,53 m².', verified: { catalogo: [unit, penthouse] },
})
supported('irrelevant base figures can be omitted while unit-value relationships reach the reviewer', {
  current: '¿Cuántos dormitorios tiene el 202?', baseReply: 'El 202 cuesta USD 250.000 y tiene tres dormitorios.', reply: 'El departamento 202 tiene tres dormitorios.',
  verified: { catalogo: [unit] },
})
supported('an opening suggestion does not replace the greeting chosen by the writer', {
  current: 'Buenas tardes', baseReply: 'Buenas tardes, con gusto.', reply: 'Bienvenido a La Vilet. ¿En qué podemos ayudarle?',
})
repaired('persistent unsupported statements remain pending without an invented replacement message', {
  current: '¿La renta garantiza mi crédito?', wrong: 'La renta futura garantiza su crédito.', correct: 'La entidad debe evaluar su solicitud.',
  authority: 'No existe una garantía bancaria documentada.', category: 'business_guardrail',
}, true)
supported('a category switch uses current penthouse evidence rather than historical apartment prices', {
  current: 'Ahora prefiero el penthouse 605, ¿qué precio tiene?', reply: 'El penthouse 605 tiene un precio publicado de USD 337.272.',
  verified: { catalogo: [penthouse], politica_comercial: pricePolicy },
  reviewCheck: (_rules, context) => assert.equal(context.fuentes_autorizadas.unidades.find(item => item.id === 'u605').published_commercial_price, 337272),
})

// 30–41: metadata, delivery routes and appointments.
supported('invalid auxiliary coverage cannot withhold otherwise approved writer prose', {
  current: 'Quiero información', reply: 'Podemos orientarle sobre el proyecto.', requests: null,
  resultCheck: result => assert.deepEqual(result.audit.requests, []),
})
supported('original customer data remains in the writer context without promoting rejected metadata to facts', {
  current: 'Mi presupuesto es 100 y somos cinco', reply: 'Podemos revisar sus necesidades.', requests: [{ fragment: 'Una referencia antigua', status: 'broken' }],
  writerCheck: (_rules, context) => assert.equal(context.mensaje_actual, 'Mi presupuesto es 100 y somos cinco'),
  resultCheck: result => assert.equal(result.audit.operational_action_verified, false),
})
envelope('Carlos reviewer metadata repair preserves the final answer and writer question', { ...pass, claims: [] }, {
  current: '¿Qué precio tiene el 605?', reply: 'Su precio publicado es USD 337.272.', verified: { catalogo: [penthouse], politica_comercial: pricePolicy },
})
envelope('an obsolete reviewer unit-binding sheet is retried without changing an exact-value draft', { ...pass, factual_values: [{ unit_id: 'wrong', value: 120.83 }] }, {
  current: '¿Qué área tiene el 202?', reply: 'El departamento 202 tiene 120,83 m² interiores.', verified: { catalogo: [unit] },
})
envelope('review-envelope repair cannot rewrite the commercial draft', { review_contract: 'focused-review-v1', claims: [] }, {
  current: '¿Dónde está el proyecto?', reply: 'La Vilet está en Cuenca.', verified: { proyecto: { city: 'Cuenca' } },
})
supported('omitted-request labels remain visible to diagnosis but never become operation authorization', {
  current: '¿Precio y política de mascotas?', reply: 'El 202 cuesta USD 250.000.', verified: { catalogo: [unit], politica_comercial: pricePolicy },
  requests: [request('¿Precio y política de mascotas?', { status: 'unanswered' })],
  resultCheck: result => assert.equal(result.audit.requests[0].status, 'unanswered'),
})
providerFailure('a writer provider failure propagates without falling back to an unreviewed commercial base', {
  current: '¿Qué opciones hay?', reply: 'Tenemos departamentos disponibles.',
})
supported('the final writer receives its route-specific information contract', {
  current: 'Quiero información', reply: 'Podemos explicarle el proyecto.', audit: { source: 'project_overview' },
  writerCheck: (_rules, context) => assert.equal(typeof context.contrato_redaccion, 'object'),
})
supported('a protected financing question may be paraphrased without literal text matching', {
  current: 'Quiero continuar con la revisión financiera', reply: '¿Con qué entidad desea que continuemos?',
  question: { text: '¿Con qué entidad desea que continuemos?', purpose: 'choose_financing_partner', continuation_id: 'financing_partner', continuation_act: 'financing' },
})
repaired('a visit rewrite cannot claim confirmation when only a request was recorded', {
  current: 'Mañana a las cuatro', wrong: 'Su cita de mañana a las cuatro está confirmada.', correct: 'Registramos su preferencia para mañana a las cuatro; falta confirmar disponibilidad.',
  category: 'business_guardrail', authority: 'La solicitud está pendiente, no confirmada.', audit: { visit_result: { status: 'awaiting_advisor' } },
})
test('sentence-protection compatibility preserves the entire writer text including time abbreviations', () => {
  const reply = 'Podemos revisar horarios de 10 a. m. y de 4 p. m.'
  assert.deepEqual(protectedSentences(reply), [reply])
})
repaired('appointment location and complete time are corrected by an AI finding instead of prose guards', {
  current: 'La cita en oficina a las cuatro', wrong: 'Su visita a la obra está confirmada a las 4 p.',
  correct: 'Su solicitud para la oficina a las 4 p. m. está pendiente de confirmación.', category: 'business_guardrail',
  authority: 'Solo hay una solicitud pendiente para oficina a las 4 p. m.', audit: { visit_result: { status: 'awaiting_advisor', location_type: 'office' } },
})

// 42–59: information mode, multiple requests, unsupported promises and errors.
supported('information-only mode reaches the writer without a new code-level commercial-offer classifier', {
  current: 'Solo quiero conocer el proyecto', reply: '¿Qué le gustaría conocer sobre La Vilet?',
  verified: { interaction_mode: { mode: 'information_only' } },
  writerCheck: (rules, context) => {
    assert.match(rules, /information_only/)
    assert.equal(context.contexto_verificado.interaction_mode.mode, 'information_only')
  },
})
supported('three independent requests remain present with two bounded model calls', {
  current: '¿Qué opciones hay?\nNo sé si me alcanza\n¿Cuánto cuestan?', reply: 'Podemos revisar las opciones, sus precios publicados y las alternativas bancarias.',
  requests: [request('¿Qué opciones hay?'), request('No sé si me alcanza'), request('¿Cuánto cuestan?')],
  resultCheck: result => assert.equal(result.audit.requests.length, 3),
})
supported('a financing-partner question retains its actual purpose without inferring missing bank policy', {
  current: 'Quiero financiar un local para rentarlo, ¿influye?', reply: 'La entidad debe confirmar cómo evalúa ese uso. ¿Con cuál desea continuar?',
  question: { text: '¿Con cuál desea continuar?', purpose: 'choose_financing_partner', continuation_id: 'financing_partner', continuation_act: 'financing' },
  requests: [request('Quiero financiar un local para rentarlo, ¿influye?', { status: 'missing_fact', fact_key: 'policy' })],
  resultCheck: result => assert.equal(result.audit.question.purpose, 'choose_financing_partner'),
})
supported('house, floors and direct-credit requests remain separate without claiming to sell houses', {
  current: 'Quiero una casa, ¿cuántos pisos tiene? ¿Dan crédito directo?', reply: 'El proyecto ofrece viviendas en edificio; no contamos con casas ni crédito directo.',
  verified: { proyecto: { description: 'Suites, departamentos y penthouses; sin casas ni crédito directo.' } },
  requests: [request('Quiero una casa', { status: 'outside_scope' }), request('¿Cuántos pisos tiene?', { status: 'outside_scope' }), request('¿Dan crédito directo?')],
})
supported('ambiguous options may clarify finance versus property without requesting an advisor', {
  current: '¿Qué opciones tengo?', reply: '¿Se refiere a las viviendas o a las alternativas de financiamiento?',
  question: { ...profileQuestion, text: '¿Se refiere a las viviendas o a las alternativas de financiamiento?', purpose: 'clarify_request', continuation_id: 'property_category', continuation_act: 'choose_category' },
})
providerFailure('model failure leaves the turn to operational recovery without an unreviewed template', { current: '¿Qué opciones tengo?', reply: 'No ofrecemos crédito directo.' })
supported('known price and unverified acoustic certification remain distinct in the writer request record', {
  current: '¿Precio del 202 y certificación acústica?', reply: 'El 202 cuesta USD 250.000. Necesito confirmar si tiene certificación acústica.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy }, requests: [request('¿Precio del 202?'), request('¿Certificación acústica?', { status: 'missing_fact' })],
  resultCheck: result => assert.equal(result.audit.requests.filter(row => row.status === 'missing_fact').length, 1),
})
repaired('an invented payment URL is rejected through AI review using the authorized material sources', {
  current: '¿Cómo reservo?', wrong: 'Pague su reserva en https://inventado.example/reserva.', correct: 'El asesor debe explicarle los pasos para solicitar la reserva.',
  category: 'business_guardrail', authority: 'No existe un enlace de pago autorizado.',
})
test('price spelling and punctuation never grant code authority to judge commercial actions', () => {
  const data = scenario('¿Puedo visitar el 202?', 'El 202 cuesta USD 250.000.', { verified: { catalogo: [unit] } })
  assert.deepEqual(turnCompletenessIssues(data, 'El 202 cuesta USD 300.000. Su cita está confirmada.'), [])
})
test('a map URL query remains ordinary writer prose for the transport validator', () => {
  const reply = 'Mapa: https://maps.google.com/?q=Cuenca. El precio es USD 250.000.'
  assert.deepEqual(turnCompletenessIssues(scenario('¿Ubicación y precio?', reply), reply), [])
})
repaired('a template is not evidence authorizing an invented material destination or numeric price', {
  current: 'Quiero información', wrong: 'El 202 cuesta USD 900.000; pague en https://inventado.example/reserva.',
  correct: 'El precio publicado del 202 es USD 250.000.', authority: 'El catálogo publica USD 250.000 y no autoriza ese destino de pago.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy },
})
repaired('an unverified rental-income approval promise is blocked after one bounded writer repair', {
  current: '¿La renta influye en el crédito?', wrong: 'Los ingresos futuros de renta aseguran su aprobación.', correct: 'La entidad debe confirmar cómo evaluará el uso previsto.',
  category: 'business_guardrail', authority: 'No existe aprobación ni garantía documentada de la entidad.',
}, true)
supported('an optional CTA never generates an urgent advisor handoff by its wording alone', {
  current: '¿Qué productos tienen?', reply: 'Ofrecemos suites, departamentos, penthouses y locales comerciales. ¿Qué opina?',
  question: noQuestion, resultCheck: result => assert.equal(result.audit.operational_action_verified, false),
})
providerFailure('provider errors never pretend that an advisor received the lead', {
  current: 'Sí, con JEP', reply: 'Continuaremos con JEP cuando se confirme la revisión.',
})
supported('required options and price facts stay in the writer objective instead of server sentence splicing', {
  current: '¿Qué opciones y precios tienen?', reply: 'El departamento 202 tiene tres dormitorios y un precio publicado de USD 250.000.',
  verified: { catalogo: [unit], politica_comercial: pricePolicy },
  audit: { resolved_turn_intent: { objective: 'ask_price', requests: [{ domain: 'property', topics: ['property_options', 'purchase_price'] }] } },
  writerCheck: (_rules, context) => assert.deepEqual(context.contrato_turno.requests[0].topics, ['property_options', 'purchase_price']),
})
supported('absent question metadata is not reconstructed from an optional textual invitation', {
  current: '¿Qué opciones hay?', reply: 'Podemos revisar las alternativas. ¿Desea continuar?', question: { purpose: 'choose_financing_partner' },
  resultCheck: result => assert.deepEqual(result.audit.question, {}),
})
providerFailure('unavailable provider cannot cause a risky rental-income base to be delivered as fallback', {
  current: 'Quiero financiar un local para rentarlo', reply: 'La renta futura respalda automáticamente el crédito.',
})
test('rental-purpose prose is never rewritten or removed by the compatibility helper', () => {
  for (const reply of ['No podemos asegurar que la renta respalde el crédito.', 'Rentar el local respalda su solicitud.']) {
    assert.deepEqual(safeRentalCreditBase(reply, 'Quiero rentarlo', {}), { reply, removed: false, unresolved: [] })
  }
})

// 60–80: comparison scope, missing policy, absent inventory and review recovery.
supported('a complete comparison does not independently authorize a missing-fact handoff', {
  current: '¿Qué diferencia hay entre el 202 y el 605?', reply: 'El 605 tiene 140,53 m² interiores y el 202 tiene 120,83 m².',
  verified: { catalogo: [unit, penthouse] }, requests: [request('¿Qué diferencia hay entre el 202 y el 605?', { fact_key: 'catalog_comparison' })],
})
supported('catalogue comparison keeps a separate missing pet-policy request visible', {
  current: 'Compare el 202 y el 605; ¿aceptan mascotas?', reply: 'El 605 tiene mayor superficie interior. Necesito confirmar la política de mascotas.',
  verified: { catalogo: [unit, penthouse] }, requests: [request('Compare el 202 y el 605'), request('¿Aceptan mascotas?', { status: 'missing_fact', fact_key: 'policy' })],
})
repaired('a rejected rewrite cannot turn an unsupported bank fact into an advisor operation', {
  current: '¿La renta asegura mi crédito?', wrong: 'Su crédito está aprobado por la renta futura.', correct: 'La entidad debe evaluar su solicitud.',
  category: 'business_guardrail', authority: 'No existe evaluación ni aprobación bancaria registrada.',
}, true)
supported('the factual reviewer records its own statements without a code-owned claim-fragment inventory', {
  current: '¿Qué área tiene el 202?', reply: 'Cuenta con 120,83 m² interiores.', verified: { catalogo: [unit] },
  reviewCheck: (_rules, _context, schema) => assert.equal(schema.properties.claims, undefined),
})
supported('a vague comparison does not convert an absent measurement or pet policy into a fact', {
  current: '¿Es más amplio y aceptan mascotas?', reply: 'Necesito confirmar las dimensiones de la opción que menciona y la política de mascotas.',
  requests: [request('¿Es más amplio?', { status: 'clarification' }), request('¿Aceptan mascotas?', { status: 'missing_fact' })],
})
supported('an unchanged answer still receives factual review while omitted requests remain writer metadata', {
  current: '¿Área y precio del 202?', reply: 'El 202 tiene 120,83 m² interiores.', verified: { catalogo: [unit] },
  requests: [request('¿Área del 202?'), request('¿Precio del 202?', { status: 'unanswered' })],
  resultCheck: result => assert.equal(result.changed, false),
})
supported('commercial continuation recommendations reach the writer without reviewer-owned next steps', {
  current: 'Me interesa el 605', reply: 'Podemos ampliar la información del penthouse 605.',
  verified: { catalogo: [penthouse], siguiente_paso_comercial: { action: 'await_reservation', instruction: 'Conserve la decisión pendiente.' } },
  reviewCheck: (_rules, _context, schema) => assert.equal(schema.properties.question, undefined),
})
repaired('catalogue evidence for one unit cannot support attributes of an absent unit', {
  current: '¿El 999 tiene 120,83 m²?', wrong: 'El 999 tiene 120,83 m² interiores.', correct: 'No tengo una ficha verificada del 999 para confirmar esa superficie.',
  authority: 'Solo se suministró la ficha del 202.', verified: { catalogo: [unit] },
})
envelope('nonliteral reviewer statement wording is accepted without literal source-fragment matching', { ...pass, statement: 'A legacy top-level claim' }, {
  current: '¿Dónde está?', reply: 'El proyecto se encuentra en Cuenca.', verified: { proyecto: { city: 'Cuenca' } },
})
supported('optional and repeated greetings retain writer prose without server editorial observations', {
  current: 'Gracias', reply: 'Buenos días. Con gusto podemos continuar.',
  history: [{ role: 'bot', content: 'Buenos días, bienvenido.' }], resultCheck: result => assert.deepEqual(result.audit.editorial_observations, []),
})
supported('unambiguous unit numbers remain available as source data without code inference over the draft', {
  current: '¿Área del 202?', reply: 'El 202 tiene 120,83 m² interiores.', verified: { catalogo: [unit] },
  reviewCheck: (_rules, context) => assert.equal(context.fuentes_autorizadas.unidades[0].unit_number, '202'),
})
supported('historical references do not promote an unavailable unit back into current source evidence', {
  current: '¿Qué precio tiene el 605?', reply: 'Su precio publicado es USD 337.272.', verified: { catalogo: [penthouse], politica_comercial: pricePolicy },
  history: [{ role: 'bot', content: 'Antes revisamos el 202.' }],
  reviewCheck: (_rules, context) => assert.deepEqual(context.fuentes_autorizadas.unidades.map(item => item.id), ['u605']),
})
supported('an empty exact-bedroom search keeps verified alternatives separate from the unmet requirement', {
  current: 'Quiero cinco dormitorios', reply: 'No contamos con opciones de cinco dormitorios. Podemos revisar alternativas de tres si le interesa.',
  verified: { catalogo: [penthouse] }, audit: { verified_catalog: true,
    catalog_query: { operation: 'search', group: 'residential', filters: { bedrooms: 5 } }, catalog_results: { complete: true, units: [] },
    alternative_results: { units: [penthouse] } },
})
test('transport validation never resolves ambiguous references or normalizes numeric meaning', () => {
  const reply = 'El 202 o el 302 tiene ciento veinte coma ochenta y tres metros cuadrados.'
  assert.deepEqual(turnCompletenessIssues(scenario('¿Cuál es?', reply), reply), [])
  assert.deepEqual(turnCompletenessIssues(scenario('¿Cuál es?', reply), '120.8'), [])
  assert.deepEqual(turnCompletenessIssues(scenario('¿Cuál es?', reply), 'x'.repeat(MAX_REPLY_CHARACTERS + 1)), ['transport_length'])
})
repaired('a persistent commercial factual defect exhausts one rewrite and stays pending for recovery', {
  current: '¿Puedo reservar sin evaluación?', wrong: 'Su unidad está reservada y su crédito aprobado.', correct: 'Puede solicitar orientación al equipo.',
  category: 'business_guardrail', authority: 'No existen comprobantes de reserva ni aprobación bancaria.',
}, true)
envelope('an obsolete reference sheet gets one envelope retry and cannot waive the factual-review contract', { review_contract: 'business-risk-v2', facts: [], verdict: 'pass', findings: [] })
envelope('a price interval keeps its complete draft while obsolete reviewer fields are repaired', { ...pass, factual_values: [] }, {
  current: '¿Qué precios tienen?', reply: 'Los precios van desde USD 250.000 hasta USD 337.272.', verified: { catalogo: [unit, penthouse], politica_comercial: pricePolicy },
})
supported('scoped price interval endpoints reach AI review with their correct unit prices', {
  current: '¿Qué precios tienen estas dos opciones?', reply: 'Estas opciones van desde USD 250.000 hasta USD 337.272.',
  verified: { catalogo: [unit, penthouse], politica_comercial: pricePolicy },
  reviewCheck: (_rules, context) => assert.deepEqual(context.fuentes_autorizadas.unidades.map(item => item.published_commercial_price).sort((a, b) => a - b), [250000, 337272]),
})
supported('current authorized priced rows remain separate from an unpriced catalogue option', {
  current: '¿Qué precios están publicados?', reply: 'El 202 cuesta USD 250.000 y el 605 USD 337.272.',
  verified: { catalogo: [unit, penthouse, { id: 'unknown', unit_number: '604', category: 'penthouse', published_commercial_price: null }], politica_comercial: pricePolicy },
  reviewCheck: (_rules, context) => assert.equal(context.fuentes_autorizadas.unidades.filter(item => item.published_commercial_price != null).length, 2),
})
repaired('review-envelope metadata cannot hide a materially wrong price endpoint', {
  current: '¿Qué rango tienen estas opciones?', wrong: 'Estas opciones van desde USD 250.000 hasta USD 550.000.', correct: 'Estas opciones van desde USD 250.000 hasta USD 337.272.',
  authority: 'Los precios de las dos opciones suministradas son USD 250.000 y USD 337.272.', verified: { catalogo: [unit, penthouse], politica_comercial: pricePolicy },
})
repaired('an unsupported policy remains a factual AI rejection regardless of obsolete citation sheets', {
  current: '¿Puedo modificar cualquier espacio?', wrong: 'Puede modificar libremente todos los espacios.', correct: 'Debemos confirmar las modificaciones permitidas por el proyecto.',
  authority: 'No existe una política publicada autorizando modificaciones sin restricciones.', category: 'unsupported_policy',
})

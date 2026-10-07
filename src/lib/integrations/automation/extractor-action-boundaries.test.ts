import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'

function extraction(message: string): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.events = []
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = []
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'other'
  semantics.primary_evidence = message
  semantics.answer_to_previous = { kind: 'none', question_id: 'none', evidence: '', confidence: 'low' }
  return raw
}
async function interpret(message: string, raw: Row, context: Row = {}) {
  const before = structuredClone(raw)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message, ...context },
    { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
  assert.equal(calls, 1)
  assert.deepEqual(raw, before, 'The captured model output remains unchanged')
  return result
}
function visit(evidence: string, kind = 'request_visit'): Row {
  return { kind, purpose: kind === 'accept_visit_preference' ? 'accept_alternative' : 'coordination',
    target: 'project', destination: 'office', evidence, confidence: 'high' }
}
function request(domain: string, evidence: string): Row { return { domain, evidence, request: evidence, confidence: 'high' } }
const reservation = 'Quiero reservar el departamento 302'
for (const evidence of [reservation, 'reservar el departamento 302']) {
  test('a reservation clause cannot also authorize an advisor or visit: ' + evidence, async () => {
    const raw = extraction(reservation)
    raw.events = ['requested_visit', 'asked_reservation']
    raw.requested_advisor = true
    raw.action_evidence = { requested_advisor: evidence, opt_out: null, consent_granted: null }
    raw.visit_intent = visit(evidence)
    raw.requests = [request('advisor', evidence), request('visit', evidence), request('property', reservation)]
    object(raw.turn_semantics).reservation = { kind: 'request', evidence: reservation, confidence: 'high', unit_numbers: ['302'] }
    const result = await interpret(reservation, raw)
    assert.equal(result.extracted.requested_advisor, false)
    assert.equal(result.extracted.visit_intent, null)
    assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
    assert.equal(object(result.semantics.reservation).kind, 'request')
    assert.deepEqual(object(result.semantics.reservation).unit_numbers, ['302'])
    assert.deepEqual(result.requests.map(r => r.domain), ['property'])
  })
}

test('a compound reservation preserves independent current requests for an advisor and visit', async () => {
  const advisor = 'quiero hablar con un asesor', actualVisit = 'quiero visitar la oficina'
  const message = reservation + '. Además ' + advisor + ' y ' + actualVisit
  const raw = extraction(message)
  raw.events = ['requested_visit']
  raw.requested_advisor = true
  raw.action_evidence = { requested_advisor: advisor, opt_out: null, consent_granted: null }
  raw.visit_intent = visit(actualVisit)
  raw.requests = [request('property', reservation), request('advisor', advisor), request('visit', actualVisit)]
  object(raw.turn_semantics).reservation = { kind: 'request', evidence: reservation, confidence: 'high', unit_numbers: ['302'] }
  const result = await interpret(message, raw)
  assert.equal(result.extracted.requested_advisor, true)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
  assert.equal(result.requests.length, 3)
})

test('the same full quote may contain a genuinely compound reservation and visit', async () => {
  const message = reservation + ' y quiero visitar la oficina'
  const raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(message)
  raw.requests = [request('visit', message)]
  object(raw.turn_semantics).reservation = { kind: 'request', evidence: message, confidence: 'high', unit_numbers: ['302'] }
  const result = await interpret(message, raw)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.equal(result.requests[0].domain, 'visit')
})

for (const message of ['Quiero hablar con un asesor', '¿Para qué días dispone citas?']) {
  test('a mistaken visit event and primary intent do not authorize a visit: ' + message, async () => {
    const raw = extraction(message)
    raw.events = ['requested_visit']
    object(raw.turn_semantics).primary_intent = 'request_visit'
    const domain = message.includes('asesor') ? 'advisor' : 'visit'
    raw.requests = [request(domain, message)]
    if (domain === 'advisor') {
      raw.requested_advisor = true
      raw.action_evidence = { requested_advisor: message, opt_out: null, consent_granted: null }
    } else raw.visit_intent = { ...visit(message, 'visit_information'), purpose: 'availability_information' }
    const result = await interpret(message, raw)
    assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
    assert.notEqual(result.semantics.primary_intent, 'request_visit')
    if (domain === 'advisor') assert.equal(result.extracted.requested_advisor, true)
    else assert.equal(object(result.extracted.visit_intent).kind, 'visit_information')
    assert.equal(result.requests.length, 1)
  })
}

test('a literal legacy visit request retains its scoring event without a typed intent', async () => {
  const message = 'Quiero agendar una visita a la oficina', raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = null
  object(raw.turn_semantics).primary_intent = 'request_visit'
  const result = await interpret(message, raw)
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
  assert.equal(result.semantics.primary_intent, 'request_visit')
})

test('accepting a property alternative drops a mistaken visit event and request as well as its intent', async () => {
  const message = 'Sí, revisemos las opciones de tres', raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(message, 'accept_visit_preference')
  raw.requests = [request('visit', message), request('property', message)]
  object(raw.turn_semantics).answer_to_previous = { question_id: 'property_requirements', kind: 'affirmative', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'property_requirements', question: '¿Desea revisar tres dormitorios?' } })
  assert.equal(result.extracted.visit_intent, null)
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
  assert.deepEqual(result.requests.map(r => r.domain), ['property'])
  assert.equal(object(result.semantics.answer_to_previous).kind, 'affirmative')
})

for (const evidence of ['sólo quiero información', 'vivo en España']) {
  test('passive profile or information cannot create a purchase purpose: ' + evidence, async () => {
    const message = 'No quiero dar mi nombre, vivo en España; sólo quiero información'
    const raw = extraction(message)
    raw.purchase_purpose = 'vivir'
    raw.declaration_evidence = { preferred_category: null, purchase_purpose: evidence }
    raw.events = ['declared_purchase_purpose']
    raw.residence_country = 'España'
    raw.profile_evidence = { full_name: null, residence_city: null, residence_country: 'vivo en España' }
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), group: 'residential',
      evidence, confidence: 'high', operation: 'none' }
    const previous = { datos_confirmados: { proposito: 'invertir' } }
    const result = await interpret(message, raw, { pregunta_pendiente: { id: 'lead_profile' }, resumen: previous })
    assert.equal(result.extracted.residence_country, 'España')
    assert.equal(result.extracted.purchase_purpose, null)
    assert.ok(!(result.extracted.events as string[]).includes('declared_purchase_purpose'))
    assert.equal(object(result.semantics.property).group, null)
    assert.equal(object(rememberInterpretedTurn(previous, message, result.extracted, result.semantics).datos_confirmados).proposito, 'invertir')
    assert.equal(object(previous.datos_confirmados).proposito, 'invertir')
  })
}

for (const [evidence, purpose] of [
  ['busco para vivir con mi familia', 'vivir'], ['sólo quiero información para invertir', 'invertir'],
  ['quiero una segunda vivienda', 'segunda_vivienda'], ['busco un local para mi negocio', 'negocio'],
  ['quiero un hogar donde criar a mis hijos', 'vivir'],
]) test('an independent use declaration survives profile information: ' + evidence, async () => {
  const message = 'Vivo en España, pero ' + evidence, raw = extraction(message)
  raw.purchase_purpose = purpose
  raw.declaration_evidence = { preferred_category: null, purchase_purpose: evidence }
  raw.events = ['declared_purchase_purpose']
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'lead_profile' } })
  assert.equal(result.extracted.purchase_purpose, purpose)
  assert.ok((result.extracted.events as string[]).includes('declared_purchase_purpose'))
})

test('a short answer to the purpose question keeps its declared use', async () => {
  const message = 'Para vivir', raw = extraction(message)
  raw.purchase_purpose = 'vivir'
  raw.declaration_evidence = { preferred_category: null, purchase_purpose: message }
  raw.events = ['declared_purchase_purpose']
  object(raw.turn_semantics).answer_to_previous = { question_id: 'property_purpose', kind: 'value', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'property_purpose', question: '¿Lo busca para vivir o invertir?' } })
  assert.equal(result.extracted.purchase_purpose, 'vivir')
})


for (const question of ['¿Desea iniciar la revisión financiera?', '¿Desea reservar esta unidad?', '¿Desea visitar la oficina?', '']) {
  test('accepting financing does not authorize unrelated tracking: ' + question, async () => {
    const message = 'Sí, deseo iniciar la revisión de financiamiento', raw = extraction(message)
    raw.consent_granted = true
    raw.financing_consent = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    raw.requests = [request('financing', message)]
    const previous = { tracking_consent: true }
    const result = await interpret(message, raw, { ultima_pregunta: question, resumen: previous })
    assert.equal(result.extracted.tracking_consent, false)
    assert.equal(previous.tracking_consent, true)
  })
}
for (const message of ['Acepto recibir novedades', 'Quiero que me envíen actualizaciones del proyecto', 'Deseo recibir mensajes de seguimiento']) {
  test('current explicit tracking permission remains valid: ' + message, async () => {
    const raw = extraction(message)
    raw.consent_granted = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    assert.equal((await interpret(message, raw)).extracted.tracking_consent, true)
  })
}
for (const question of ['¿Desea recibir novedades del proyecto?', '¿Puedo mantenerlo informado sobre el proyecto?']) {
  test('a short yes accepts an actual tracking invitation: ' + question, async () => {
    const message = 'Sí, por favor', raw = extraction(message)
    raw.consent_granted = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    assert.equal((await interpret(message, raw, { ultima_pregunta: question })).extracted.tracking_consent, true)
  })
}
for (const message of ['No quiero recibir novedades', 'Sólo si bajan los precios deseo recibir novedades', 'Cuando me interese quiero recibir mensajes']) {
  test('tracking refusal and conditional permission cannot opt in: ' + message, async () => {
    const raw = extraction(message)
    raw.consent_granted = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    assert.equal((await interpret(message, raw, { ultima_pregunta: '¿Desea recibir novedades?' })).extracted.tracking_consent, false)
  })
}
test('an ambiguous yes cannot accept tracking and another pending decision', async () => {
  const message = 'Sí', raw = extraction(message)
  raw.consent_granted = true
  raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
  const result = await interpret(message, raw, { ultima_pregunta: '¿Desea recibir novedades? ¿Quiere iniciar la revisión financiera?' })
  assert.equal(result.extracted.tracking_consent, false)
})
test('a tracking refusal takes priority over an opt-in clause', async () => {
  const message = 'Acepto recibir novedades, pero no me escriban más', raw = extraction(message)
  raw.consent_granted = true
  raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: 'Acepto recibir novedades' }
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, true)
  assert.equal(result.extracted.tracking_consent, false)
})
function floorExtraction(message: string): Row {
  const raw = extraction(message)
  raw.requests = [request('property', message)]
  object(raw.turn_semantics).primary_intent = 'select_property'
  object(raw.turn_semantics).answer_to_previous = { question_id: 'property_floor', kind: 'value', evidence: message, confidence: 'high' }
  object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), group: 'residential',
    operation: 'select', reference_kind: 'relative', evidence: message, confidence: 'high',
    filters: { floor_number: 3 }, filter_evidence: { floor_number: message } }
  raw.catalog_request = { purpose: 'select', metric: 'floor_number', requirements: [{ field: 'floor_number', operator: 'eq',
    value: 3, upper_value: null, strength: 'required', evidence: message }], semantic_preferences: [], evidence: message, confidence: 'high' }
  return raw
}
test('a selected floor refines search and catalogue rather than selecting a unit', async () => {
  const message = 'La tercera planta por favor', raw = floorExtraction(message)
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'property_floor', question: '¿Qué planta prefiere?' } })
  assert.equal(object(result.semantics.property).operation, 'search')
  assert.equal(object(object(result.semantics.property).filters).floor_number, 3)
  assert.equal(object(result.semantics.catalog_request).purpose, 'search')
  assert.deepEqual(object(result.semantics.property).unit_numbers, [])
})
for (const choice of ['unit', 'selector']) {
  test('a genuine unit choice preserves selection alongside a floor: ' + choice, async () => {
    const message = choice === 'unit' ? 'Quiero el departamento 302 en la tercera planta' : 'Quiero la primera opción de la tercera planta'
    const raw = floorExtraction(message), property = object(object(raw.turn_semantics).property)
    if (choice === 'unit') { property.unit_numbers = ['302']; property.reference_kind = 'explicit' }
    else { property.selector = 'first'; property.query_scope = 'offered' }
    const result = await interpret(message, raw)
    assert.equal(object(result.semantics.property).operation, 'select')
    assert.equal(object(result.semantics.catalog_request).purpose, 'select')
    assert.ok(!(result.semantics.normalization_issues as string[]).includes('floor_preference_is_not_unit_selection'))
  })
}
for (const operation of ['details', 'compare']) {
  test('current informational property evidence recovers a wrongly proposed action: ' + operation, async () => {
    const message = '¿Alcanzan tres dormitorios para una familia de seis?', raw = extraction(message)
    object(raw.turn_semantics).primary_intent = 'ask_reservation'
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), operation, group: 'residential', evidence: message, confidence: 'high' }
    raw.requests = [request('property', message)]
    const result = await interpret(message, raw)
    assert.equal(result.semantics.primary_intent, 'project_information')
    assert.equal(result.semantics.confidence, 'high')
    assert.equal(object(result.semantics.interpretation).extractor_primary_intent, 'ask_reservation')
    assert.equal(object(result.semantics.reservation).kind, 'none')
    assert.equal(result.extracted.requested_advisor, false)
  })
}
for (const boundary of ['search', 'advisor', 'historical', 'short_answer']) {
  test('informational recovery does not promote unrelated or historical actions: ' + boundary, async () => {
    const message = boundary === 'short_answer' ? 'Sí' : '¿Me explica las opciones?', raw = extraction(message)
    object(raw.turn_semantics).primary_intent = 'ask_reservation'
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), operation: boundary === 'search' ? 'search' : 'details', evidence: message, confidence: 'high' }
    raw.requests = [request('property', message)]
    if (boundary === 'advisor') raw.requests.push(request('advisor', message))
    if (boundary === 'short_answer') object(raw.turn_semantics).answer_to_previous = { question_id: 'property_requirements', kind: 'affirmative', evidence: message, confidence: 'high' }
    if (boundary === 'historical') {
      object(object(raw.turn_semantics).property).evidence = 'Un mensaje anterior'
      let calls = 0
      await assert.rejects(interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } }))
      assert.equal(calls, 2)
    } else assert.notEqual((await interpret(message, raw, { pregunta_pendiente: { id: 'property_requirements' } })).semantics.primary_intent, 'project_information')
  })
}


for (const message of ['Está bien', 'Bueno está bien', 'Sí, me interesa', 'Me parece bien', 'De acuerdo']) {
  test('valid current tracking acceptance preserves its meaning: ' + message, async () => {
    const raw = extraction(message)
    raw.consent_granted = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'affirmative', evidence: message, confidence: 'high' }
    const result = await interpret(message, raw, { ultima_pregunta: '¿Desea que le mantengamos informado de novedades del proyecto?' })
    assert.equal(result.extracted.tracking_consent, true)
  })
}
for (const message of ['Me gustaría que me mantengan informado', 'Quiero que me mantengan informado', 'Manténgame informada, por favor']) {
  test('direct current requests to stay informed retain tracking permission: ' + message, async () => {
    const raw = extraction(message)
    raw.consent_granted = true
    raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
    assert.equal((await interpret(message, raw)).extracted.tracking_consent, true)
  })
}
test('explicit independent tracking and financial permissions survive together', async () => {
  const finance = 'Deseo iniciar la revisión financiera', tracking = 'quiero recibir novedades del proyecto'
  const message = finance + ' y ' + tracking, raw = extraction(message)
  raw.consent_granted = raw.financing_consent = true
  raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: tracking }
  raw.requests = [request('financing', finance), request('tracking', tracking)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.financing_consent, true)
  assert.equal(result.extracted.tracking_consent, true)
})
test('a semantic affirmative with another actual request cannot borrow tracking permission', async () => {
  const message = 'Sí, deseo iniciar revisión financiera', raw = extraction(message)
  raw.consent_granted = true
  raw.action_evidence = { requested_advisor: null, opt_out: null, consent_granted: message }
  raw.requests = [request('financing', message)]
  object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'affirmative', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw, { ultima_pregunta: '¿Desea recibir novedades?' })
  assert.equal(result.extracted.tracking_consent, false)
})

function capacityExtraction(): Row {
  const message = '¿Alcanzan tres dormitorios para una familia de seis?', raw = extraction(message)
  object(raw.turn_semantics).primary_intent = 'ask_reservation'
  raw.requests = [request('property', message)]
  object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), group: 'residential', operation: 'none',
    evidence: message, confidence: 'high' }
  object(raw.turn_semantics).housing_quantities = [
    { dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'unspecified', evidence: message, confidence: 'high' },
    { dimension: 'people', values: [6], role: 'context', count_basis: 'total', evidence: message, confidence: 'high' },
  ]
  return raw
}
test('a current capacity evaluation recovers offered details when the operation was omitted', async () => {
  const raw = capacityExtraction(), message = '¿Alcanzan tres dormitorios para una familia de seis?'
  const result = await interpret(message, raw, { contexto_propiedades: { query: { group: 'residential', filters: { bedrooms: 3 } },
    offered_ids: ['unit-302', 'unit-602'] } })
  assert.equal(result.semantics.primary_intent, 'project_information')
  assert.equal(result.semantics.confidence, 'high')
  assert.equal(object(result.semantics.property).operation, 'details')
  assert.equal(object(result.semantics.property).query_scope, 'offered')
  assert.equal(object(result.semantics.property).reference_kind, 'followup')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
  assert.equal((result.semantics.housing_quantities as Row[])[0].role, 'evaluation')
  assert.equal(object(result.semantics.household).occupants, 6)
  assert.ok((result.semantics.normalization_issues as string[]).includes('current_evaluation_restores_known_property_reference'))
})
for (const boundary of ['no_offered_options', 'new_requirement', 'current_filter', 'other_request']) {
  test('capacity recovery cannot invent a reference or erase a new requirement: ' + boundary, async () => {
    const raw = capacityExtraction(), message = '¿Alcanzan tres dormitorios para una familia de seis?'
    const context = boundary === 'no_offered_options' ? {} : { contexto_propiedades: { offered_ids: ['unit-302'] } }
    if (boundary === 'new_requirement') (object(raw.turn_semantics).housing_quantities as Row[])[0].role = 'requirement'
    if (boundary === 'current_filter') {
      object(object(raw.turn_semantics).property).filters = { min_area_m2: 100 }
      object(object(raw.turn_semantics).property).filter_evidence = { min_area_m2: message }
    }
    if (boundary === 'other_request') raw.requests = [request('property', message), request('advisor', message)]
    const result = await interpret(message, raw, context)
    assert.notEqual(object(result.semantics.property).operation, 'details')
    assert.ok(!(result.semantics.normalization_issues as string[]).includes('current_evaluation_restores_known_property_reference'))
  })
}
for (const [status, amount, message] of [
  ['no_defined_budget', null, 'Todavía no he definido mi presupuesto'],
  ['amount', 400000, 'Mi presupuesto es de 400 mil dólares'],
  ['unknown', null, 'No estoy seguro de mi presupuesto'],
] as const) {
  test('an exclusive current typed budget answer keeps budget scope: ' + status, async () => {
    const raw = extraction(message)
    raw.events = ['asked_price']
    object(raw.turn_semantics).primary_intent = 'ask_price'
    object(raw.turn_semantics).budget = { status, amount, evidence: message, confidence: 'high' }
    const result = await interpret(message, raw, { pregunta_pendiente: { id: 'budget_amount', question: '¿Tiene un presupuesto establecido?' } })
    assert.equal(result.semantics.primary_intent, 'discuss_budget')
    assert.equal(result.semantics.confidence, 'high')
    assert.equal(object(result.semantics.budget).status, status)
    assert.equal(object(result.semantics.budget).amount, amount)
    assert.ok(!(result.extracted.events as string[]).includes('asked_price'))
    assert.equal(object(result.semantics.interpretation).extractor_primary_intent, 'ask_price')
  })
}
test('a budget answer with an independent price question preserves both actual scopes', async () => {
  const budget = 'Mi presupuesto es de 400 mil dólares', price = '¿Qué precio tiene el departamento 302?'
  const message = budget + '. ' + price, raw = extraction(message)
  raw.events = ['asked_price']
  object(raw.turn_semantics).primary_intent = 'ask_price'
  object(raw.turn_semantics).budget = { status: 'amount', amount: 400000, evidence: budget, confidence: 'high' }
  raw.requests = [request('property', price)]
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'budget_amount', question: '¿Tiene un presupuesto establecido?' } })
  assert.equal(result.semantics.primary_intent, 'ask_price')
  assert.ok((result.extracted.events as string[]).includes('asked_price'))
  assert.equal(object(result.semantics.budget).amount, 400000)
})


for (const [message, evidence] of [
  ['No agendar una visita por ahora', 'agendar una visita'],
  ['No programar una cita', 'programar una cita'],
  ['No agenden una visita', 'agenden una visita'],
  ['Nunca quiero una visita', 'quiero una visita'],
  ['Si bajan los precios me gustaría visitar la oficina', 'me gustaría visitar la oficina'],
] as const) test('a typed visit cannot borrow permission from a negated or conditional clause: ' + message, async () => {
  const raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(evidence)
  object(raw.turn_semantics).primary_intent = 'request_visit'
  raw.requests = [request('visit', evidence)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.visit_intent, null)
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
  assert.notEqual(result.semantics.primary_intent, 'request_visit')
  assert.ok((result.semantics.normalization_issues as string[]).includes('visit_request_is_refused_or_conditional'))
})
test('a genuinely independent positive visit survives an earlier refusal', async () => {
  const positive = 'quiero visitar la oficina', message = 'No quiero una visita al edificio, pero ' + positive
  const raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(positive)
  raw.requests = [request('visit', positive)]
  const result = await interpret(message, raw)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
})


test('a visit quoted from another person cannot become the current lead request', async () => {
  const quoted = 'quiero agendar una visita', price = 'Yo sólo quiero saber los precios'
  const message = 'Mi amigo escribió «' + quoted + '». ' + price, raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(quoted)
  raw.requests = [request('visit', quoted), request('property', price)]
  object(raw.turn_semantics).primary_intent = 'request_visit'
  const result = await interpret(message, raw)
  assert.equal(result.extracted.visit_intent, null)
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
  assert.notEqual(result.semantics.primary_intent, 'request_visit')
  assert.ok((result.semantics.normalization_issues as string[]).includes('visit_request_is_refused_or_conditional'))
  assert.ok(result.requests.some(r => r.domain === 'property' && r.evidence === price))
})
test('an independent own visit request survives a visit attributed to someone else', async () => {
  const quoted = 'quiero agendar una visita', own = 'Yo también quiero visitar la oficina'
  const message = 'Mi amigo escribió «' + quoted + '». ' + own, raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(own)
  raw.requests = [request('visit', own)]
  object(raw.turn_semantics).primary_intent = 'request_visit'
  const result = await interpret(message, raw)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
  assert.equal(result.semantics.primary_intent, 'request_visit')
})
test('quotation marks used for emphasis do not remove an actual visit permission', async () => {
  const message = 'Quiero «visitar la oficina» mañana', raw = extraction(message)
  raw.events = ['requested_visit']
  raw.visit_intent = visit(message)
  object(raw.turn_semantics).primary_intent = 'request_visit'
  const result = await interpret(message, raw)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
})


for (const operation of ['details', 'compare']) {
  test('exclusive current evaluation overrides an unsupported price label: ' + operation, async () => {
    const message = '¿Alcanzan tres dormitorios para una familia de seis?', raw = capacityExtraction()
    raw.events = ['asked_price']
    object(raw.turn_semantics).primary_intent = 'ask_price'
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), operation, reference_kind: 'followup', query_scope: 'offered' }
    const result = await interpret(message, raw, { contexto_propiedades: { offered_ids: ['unit-302', 'unit-602'] } })
    assert.equal(result.semantics.primary_intent, 'project_information')
    assert.equal(result.semantics.confidence, 'high')
    assert.equal(object(result.semantics.interpretation).extractor_primary_intent, 'ask_price')
    assert.ok(!(result.extracted.events as string[]).includes('asked_price'))
    assert.equal(object(result.semantics.property).operation, operation)
  })
}
for (const boundary of ['actual_price', 'price_metric', 'multiple_requests', 'new_requirement', 'new_filter', 'advisor', 'no_known_options']) {
  test('evaluation scope cannot hide an independently meaningful turn: ' + boundary, async () => {
    const capacity = '¿Alcanzan tres dormitorios para una familia de seis?', price = '¿Qué precios tienen estas opciones?'
    const message = boundary === 'actual_price' ? capacity + ' ' + price : capacity, raw = capacityExtraction()
    raw.events = ['asked_price']
    object(raw.turn_semantics).primary_intent = 'ask_price'
    object(raw.turn_semantics).primary_evidence = message
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), operation: 'details', reference_kind: 'followup', query_scope: 'offered', evidence: message }
    raw.requests = [request('property', message)]
    if (boundary === 'price_metric') raw.catalog_request = { purpose: 'range', metric: 'published_commercial_price', requirements: [], semantic_preferences: [], evidence: message, confidence: 'high' }
    if (boundary === 'multiple_requests') raw.requests = [request('property', capacity), request('property', 'tres dormitorios')]
    if (boundary === 'new_requirement') (object(raw.turn_semantics).housing_quantities as Row[])[0].role = 'requirement'
    if (boundary === 'new_filter') {
      object(object(raw.turn_semantics).property).filters = { floor_number: 3 }
      object(object(raw.turn_semantics).property).filter_evidence = { floor_number: message }
    }
    if (boundary === 'advisor') raw.requests.push(request('advisor', message))
    const context = boundary === 'no_known_options' ? {} : { contexto_propiedades: { offered_ids: ['unit-302', 'unit-602'] } }
    const result = await interpret(message, raw, context)
    assert.equal(result.semantics.primary_intent, 'ask_price')
    assert.ok((result.extracted.events as string[]).includes('asked_price'))
    const decisions = object(result.semantics.interpretation).decisions as Row[]
    assert.ok(!decisions.some(d => d.code === 'current_evaluation_recovers_exclusive_informational_scope'))
  })
}


for (const message of ['No quiero iniciar ese trámite', 'No quiero un asesor ni una visita', 'No quiero dar mi nombre',
  'No quiero decir mi residencia', 'No deseo iniciar financiamiento', 'No', 'Por ahora no', 'No quiero llamadas, sólo mensajes']) {
  test('a scoped refusal cannot unsubscribe the lead: ' + message, async () => {
    const raw = extraction(message)
    raw.opt_out = true
    raw.action_evidence = { requested_advisor: null, opt_out: message, consent_granted: null }
    const result = await interpret(message, raw, { ultima_pregunta: '¿Desea iniciar la revisión financiera?',
      pregunta_pendiente: { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' } })
    assert.equal(result.extracted.opt_out, false)
  })
}
for (const message of ['No me escriban más', 'No quiero recibir mensajes', 'Dejen de contactarme', 'No deseo que me sigan escribiendo',
  'No quiero que me contacten', 'Borre mi número', 'Quiero darme de baja', 'Deme de baja', 'Ya no quiero novedades',
  'No vuelvan a escribirme', 'No me molesten más', 'No quiero recibir publicidad']) {
  test('actual global contact refusal remains an unsubscribe: ' + message, async () => {
    const raw = extraction(message)
    raw.opt_out = true
    raw.action_evidence = { requested_advisor: null, opt_out: message, consent_granted: null }
    assert.equal((await interpret(message, raw)).extracted.opt_out, true)
  })
}
test('an independent actual unsubscribe retains priority over price and tracking permission', async () => {
  const stop = 'No me escriban más', price = '¿Qué precio tiene el departamento 302?'
  const message = stop + '. ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.consent_granted = true
  raw.action_evidence = { requested_advisor: null, opt_out: stop, consent_granted: price }
  raw.requests = [request('property', price)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, true)
  assert.equal(result.extracted.tracking_consent, false)
})
test('a refusal of advisor and visit preserves the independent price question', async () => {
  const scoped = 'No quiero un asesor ni una visita', price = 'sólo saber los precios de los departamentos'
  const message = scoped + ', ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: scoped, consent_granted: null }
  raw.requests = [request('property', price)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, false)
  assert.ok(result.requests.some(r => r.domain === 'property' && r.evidence === price))
})
test('scope rebinding retains global contact refusal from the full current message', async () => {
  const stop = 'No me escriban más', price = '¿Qué precio tienen los departamentos?'
  const message = stop + '. ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: stop, consent_granted: null }
  const result = await interpret(message, raw, { mensaje_accion: price })
  assert.equal(result.extracted.opt_out, true)
})


for (const quote of [
  ['Mi amigo escribió «No me escriban más». Yo sólo quiero saber los precios', 'No me escriban más'],
  ['El mensaje dice “No quiero recibir mensajes”. Yo sólo quiero saber los precios', 'No quiero recibir mensajes'],
  ['Mi familiar escribió "Borre mi número". Yo sí quiero información', 'Borre mi número'],
  ["Mi amigo dijo 'Quiero darme de baja'. Yo deseo consultar precios", 'Quiero darme de baja'],
  ['Mi amigo escribió: quiero «darme de baja». Yo quiero precios', 'darme de baja'],
  ['¿Qué significa la frase «No me escriban más»? Quiero conocer los precios', 'No me escriban más'],
] as const) {
  test('a reported contact refusal cannot unsubscribe the current lead: ' + quote[0], async () => {
    const raw = extraction(quote[0])
    raw.opt_out = true
    raw.action_evidence = { requested_advisor: null, opt_out: quote[1], consent_granted: null }
    assert.equal((await interpret(quote[0], raw)).extracted.opt_out, false)
  })
}
for (const message of [
  'No quiero recibir mensajes sobre financiamiento, sólo información del proyecto',
  'No quiero mensajes de financiamiento',
  'No quiero recibir novedades del crédito',
  'No me escriban acerca de préstamos',
  'No deseo que me contacten para revisar crédito',
  'No me manden mensajes sobre financiamiento, sólo sobre departamentos',
  'Dejen de enviarme novedades relacionadas con crédito',
  'No me escriban por correo, sí por WhatsApp',
  'No me contacten más por teléfono',
]) {
  test('a topic or channel restriction cannot disable all contact: ' + message, async () => {
    const raw = extraction(message)
    raw.opt_out = true
    // Even a clipped citation cannot erase the topic/channel qualifier.
    raw.action_evidence = { requested_advisor: null, opt_out: message.split(/sobre|acerca|para| por | de /)[0].trim(), consent_granted: null }
    assert.equal((await interpret(message, raw)).extracted.opt_out, false)
  })
}
for (const message of [
  '«No me escriban más»',
  'Quiero «darme de baja»',
  'Por favor «No me escriban más»',
  'Confirmo: «No quiero recibir mensajes»',
  'No quiero recibir mensajes de ustedes',
]) {
  test('own emphasis and a sender qualifier preserve a global unsubscribe: ' + message, async () => {
    const raw = extraction(message)
    raw.opt_out = true
    raw.action_evidence = { requested_advisor: null, opt_out: message, consent_granted: null }
    assert.equal((await interpret(message, raw)).extracted.opt_out, true)
  })
}
test('a genuine own unsubscribe remains global beside a reported refusal and price request', async () => {
  const own = 'Yo tampoco quiero que me contacten', price = '¿Qué precios tienen los departamentos?'
  const message = 'Mi amigo escribió «No me escriban más». ' + own + '. ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.consent_granted = true
  raw.action_evidence = { requested_advisor: null, opt_out: own, consent_granted: price }
  raw.requests = [request('property', price)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, true)
  assert.equal(result.extracted.tracking_consent, false)
  assert.ok(result.requests.some(r => r.domain === 'property' && r.evidence === price))
})
test('a separate global refusal retains priority after a topic preference', async () => {
  const stop = 'No me escriban más'
  const message = 'No quiero mensajes sobre financiamiento. ' + stop, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: stop, consent_granted: null }
  assert.equal((await interpret(message, raw)).extracted.opt_out, true)
})
test('a clipped refusal from a reported quote cannot reactivate opt-out after scope rebinding', async () => {
  const price = 'Yo quiero saber los precios'
  const message = 'Mi amigo dijo «No me contacten». ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: 'No me contacten', consent_granted: null }
  const result = await interpret(message, raw, { mensaje_accion: price })
  assert.equal(result.extracted.opt_out, false)
})


const lenderChoiceContext = { pregunta_pendiente: { id: 'financing_partner', act: 'financing', question: '¿Con qué entidad prefiere continuar?' },
  financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'], current: { explicit_consent: true } } }
for (const [message, name] of [['prefiero jep', 'Cooperativa JEP'], ['con Banco Pichincha por favor', 'Banco Pichincha'],
  ['JEP', 'Cooperativa JEP'], ['Elijo Banco Pichincha', 'Banco Pichincha']] as const) {
  test('a current typed lender selection restores its pending value answer: ' + message, async () => {
    const raw = extraction(message)
    raw.financing_partner = name
    raw.financing_partner_choice = { kind: 'select', name, evidence: message, confidence: 'high' }
    raw.financing_consent = true
    object(raw.turn_semantics).primary_intent = 'ask_financing'
    raw.requests = [request('financing', message)]
    const result = await interpret(message, raw, lenderChoiceContext)
    assert.deepEqual(result.semantics.answer_to_previous, { question_id: 'financing_partner', kind: 'value', evidence: message, confidence: 'high' })
    assert.equal(object(result.extracted.financing_partner_choice).name, name)
    assert.notEqual(result.extracted.financing_consent, true, 'Naming the lender does not create another permission')
  })
}
for (const message of ['¿Qué requisitos pide JEP?', '¿Cómo funciona el crédito de JEP?', 'Quiero saber qué ofrece JEP']) {
  test('a lender mentioned in an information question cannot restore a selection answer: ' + message, async () => {
    const raw = extraction(message)
    raw.financing_partner = 'Cooperativa JEP'
    raw.financing_partner_choice = { kind: 'select', name: 'Cooperativa JEP', evidence: message, confidence: 'high' }
    raw.requests = [request('financing', message)]
    const result = await interpret(message, raw, lenderChoiceContext)
    assert.notEqual(object(result.semantics.answer_to_previous).question_id, 'financing_partner')
    assert.notEqual(result.extracted.financing_consent, true)
  })
}
for (const id of ['financing_invitation', 'property_category', 'visit_invitation', 'none']) {
  test('a lender choice is not an answer to another pending question: ' + id, async () => {
    const message = 'prefiero jep', raw = extraction(message)
    raw.financing_partner = 'Cooperativa JEP'
    raw.financing_partner_choice = { kind: 'select', name: 'Cooperativa JEP', evidence: message, confidence: 'high' }
    const result = await interpret(message, raw, { ...lenderChoiceContext, pregunta_pendiente: { id, question: '¿Desea continuar?' } })
    assert.notEqual(object(result.semantics.answer_to_previous).question_id, 'financing_partner')
  })
}
for (const kind of ['none', 'decline']) {
  test('a typed absence or lender refusal cannot restore an affirmative value: ' + kind, async () => {
    const message = kind === 'decline' ? 'No quiero JEP' : 'Quiero conocer los requisitos de JEP', raw = extraction(message)
    raw.financing_partner_choice = { kind, name: kind === 'decline' ? 'Cooperativa JEP' : null, evidence: kind === 'decline' ? message : '', confidence: kind === 'decline' ? 'high' : 'low' }
    const result = await interpret(message, raw, lenderChoiceContext)
    assert.notEqual(object(result.semantics.answer_to_previous).kind, 'value')
  })
}

for (const message of ['prefiero que me atienda un asesor', 'Quiero hablar con una persona', 'Me gustaría que me ayude un asesor']) {
  test('a literal advisor request cannot supply permission for a typed visit: ' + message, async () => {
    const raw = extraction(message)
    raw.requested_advisor = true
    raw.action_evidence = { requested_advisor: message, opt_out: null, consent_granted: null }
    raw.visit_intent = visit(message)
    raw.events = ['requested_visit']
    raw.requests = [request('advisor', message)]
    object(raw.turn_semantics).primary_intent = 'request_visit'
    const result = await interpret(message, raw)
    assert.equal(result.extracted.requested_advisor, true)
    assert.equal(result.extracted.visit_intent, null)
    assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
    assert.notEqual(result.semantics.primary_intent, 'request_visit')
    assert.ok((result.semantics.normalization_issues as string[]).includes('visit_coordination_without_current_visit_permission'))
  })
}
for (const message of ['Quiero atención presencial', 'Prefiero que me atiendan en la oficina', '¿Puedo recibir atención presencial?',
  'Me gustaría reunirme con un asesor en persona', 'Quisiera pasar por la oficina', '¿Pueden recibirme en la oficina?', '¿Me reciben en la oficina?']) {
  test('an actual physical meeting request retains typed visit permission: ' + message, async () => {
    const raw = extraction(message)
    raw.visit_intent = visit(message)
    raw.events = ['requested_visit']
    object(raw.turn_semantics).primary_intent = 'request_visit'
    const result = await interpret(message, raw)
    assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
    assert.ok((result.extracted.events as string[]).includes('requested_visit'))
    assert.equal(result.semantics.primary_intent, 'request_visit')
  })
}
for (const id of ['financing_invitation', 'property_requirements']) {
  test('an acceptance of a different pending object cannot coordinate a visit: ' + id, async () => {
    const message = 'Sí', raw = extraction(message)
    raw.visit_intent = visit(message)
    raw.events = ['requested_visit']
    object(raw.turn_semantics).answer_to_previous = { question_id: id, kind: 'affirmative', evidence: message, confidence: 'high' }
    const result = await interpret(message, raw, { pregunta_pendiente: { id, question: '¿Desea continuar?' } })
    assert.equal(result.extracted.visit_intent, null)
    assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
    assert.equal(object(result.semantics.answer_to_previous).question_id, id)
  })
}
test('a current affirmative answer to a visit invitation permits its typed coordination', async () => {
  const message = 'Sí, por favor', raw = extraction(message)
  raw.visit_intent = visit(message)
  raw.events = ['requested_visit']
  object(raw.turn_semantics).answer_to_previous = { question_id: 'visit_invitation', kind: 'affirmative', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'visit_invitation', act: 'visit', question: '¿Desea que coordinemos una visita a la oficina?' } })
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
})
test('visit availability information retains its informational intent without operational permission', async () => {
  const message = '¿Qué días tienen citas disponibles?', raw = extraction(message)
  raw.visit_intent = { ...visit(message, 'visit_information'), purpose: 'availability_information' }
  raw.events = ['requested_visit']
  raw.requests = [request('visit', message)]
  const result = await interpret(message, raw)
  assert.equal(object(result.extracted.visit_intent).kind, 'visit_information')
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
})
test('an advisor request and an independent physical visit preserve both permissions', async () => {
  const advisor = 'prefiero que me atienda un asesor', physical = 'quiero que me reciban en la oficina'
  const message = advisor + '. Además ' + physical, raw = extraction(message)
  raw.requested_advisor = true
  raw.action_evidence = { requested_advisor: advisor, opt_out: null, consent_granted: null }
  raw.visit_intent = visit(physical)
  raw.events = ['requested_visit']
  raw.requests = [request('advisor', advisor), request('visit', physical)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.requested_advisor, true)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
  assert.ok((result.extracted.events as string[]).includes('requested_visit'))
})


function householdInquiry(message: string, currentRequest: string, peopleEvidence: string, count = 6, primary = 'other'): Row {
  const raw = extraction(message), semantics = object(raw.turn_semantics)
  semantics.primary_intent = primary
  semantics.housing_quantities = [{ dimension: 'people', values: [count], role: 'context', count_basis: 'total', evidence: peopleEvidence, confidence: 'high' }]
  semantics.property = { ...object(semantics.property), group: 'residential', operation: 'none', category: null,
    reference_kind: 'none', query_scope: null, evidence: message, confidence: 'high' }
  raw.requests = [request('property', currentRequest)]
  return raw
}
const knownFamilyOptions = { contexto_propiedades: { offered_ids: ['unit-302', 'unit-602'], query: { group: 'residential' } } }
for (const primary of ['other', 'ask_reservation', 'project_information']) {
  test('a household inquiry about known offers restores detail continuity without a bedroom count: ' + primary, async () => {
    const people = 'Somos seis personas.', question = '¿Cómo se distribuirían en esas opciones?', message = people + ' ' + question
    const raw = householdInquiry(message, question, people, 6, primary)
    // Reproduce the model's invalid inherited room filter; quantity meaning removes it.
    object(object(raw.turn_semantics).property).filters = { bedrooms: 3 }
    object(object(raw.turn_semantics).property).filter_evidence = { bedrooms: people }
    const result = await interpret(message, raw, knownFamilyOptions)
    assert.equal(result.semantics.primary_intent, 'project_information')
    assert.equal(object(result.semantics.property).operation, 'details')
    assert.equal(object(result.semantics.property).reference_kind, 'followup')
    assert.equal(object(result.semantics.property).query_scope, 'offered')
    assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
    assert.equal((result.semantics.housing_quantities as Row[])[0].dimension, 'people')
    assert.deepEqual((result.semantics.housing_quantities as Row[])[0].values, [6])
    assert.ok((result.semantics.normalization_issues as string[]).includes('current_household_reference_restores_known_property_information'))
    assert.equal(object(result.semantics.interpretation).extractor_primary_intent, primary)
  })
}
for (const [people, question, count] of [
  ['Somos cuatro personas.', '¿Cómo se organizan estos departamentos?', 4],
  ['Somos cinco personas.', '¿Podríamos acomodarnos en aquellas alternativas?', 5],
  ['Somos seis personas.', '¿Cómo nos distribuiríamos entre ellas?', 6],
] as const) {
  test('current household information and an anaphoric detail question preserve the known options: ' + question, async () => {
    const message = people + ' ' + question, raw = householdInquiry(message, question, people, count)
    const result = await interpret(message, raw, knownFamilyOptions)
    assert.equal(object(result.semantics.property).operation, 'details')
    assert.equal(object(result.semantics.property).query_scope, 'offered')
    assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
  })
}
test('a known-option household price question preserves the actual price objective', async () => {
  const people = 'Somos seis personas.', question = '¿Qué precios tienen esas opciones?', message = people + ' ' + question
  const raw = householdInquiry(message, question, people, 6, 'ask_price')
  raw.events = ['asked_price']
  raw.catalog_request = { purpose: 'range', metric: 'published_commercial_price', requirements: [], semantic_preferences: [], evidence: question, confidence: 'high' }
  const result = await interpret(message, raw, knownFamilyOptions)
  assert.equal(result.semantics.primary_intent, 'ask_price')
  assert.equal(object(result.semantics.property).operation, 'details')
  assert.equal(object(result.semantics.property).query_scope, 'offered')
  assert.ok((result.extracted.events as string[]).includes('asked_price'))
})
for (const boundary of ['no_known_options', 'no_current_reference', 'new_group', 'new_category', 'new_filter', 'new_requirement', 'new_search', 'independent_financing', 'independent_price', 'current_budget']) {
  test('household continuity does not invent offers or swallow a distinct current objective: ' + boundary, async () => {
    const people = 'Somos seis personas.', question = boundary === 'no_current_reference' ? '¿Es seguro el sector?' : '¿Cómo se distribuirían en esas opciones?'
    const extra = ['new_group', 'new_category'].includes(boundary) ? ' Ahora prefiero locales comerciales para mi negocio.' : boundary === 'new_search' ? ' En cambio muéstreme nuevas opciones.' : boundary === 'current_budget' ? ' No quiero decir mi presupuesto.' : boundary === 'new_filter' ? ' Ahora quiero el tercer piso.' : boundary === 'new_requirement' ? ' Ahora necesito dos dormitorios.'
      : boundary === 'independent_financing' ? ' ¿Qué requisitos tiene el crédito?' : boundary === 'independent_price' ? ' ¿Qué precios tienen?' : ''
    const message = people + ' ' + question + extra, raw = householdInquiry(message, question, people)
    const semantics = object(raw.turn_semantics), property = object(semantics.property)
    if (boundary === 'new_group') property.group = 'commercial'
    if (boundary === 'new_category') property.category = 'local'
    if (boundary === 'new_filter') { property.filters = { floor_number: 3 }; property.filter_evidence = { floor_number: 'Ahora quiero el tercer piso' } }
    if (boundary === 'new_requirement') (semantics.housing_quantities as Row[]).push({ dimension: 'bedrooms', values: [2], role: 'requirement', count_basis: 'unspecified', evidence: 'Ahora necesito dos dormitorios', confidence: 'high' })
    if (boundary === 'new_search') raw.catalog_request = { purpose: 'search', metric: null, requirements: [], semantic_preferences: [], evidence: question, confidence: 'high' }
    if (boundary === 'independent_financing') raw.requests.push(request('financing', '¿Qué requisitos tiene el crédito?'))
    if (boundary === 'independent_price') raw.requests.push(request('property', '¿Qué precios tienen?'))
    if (boundary === 'current_budget') semantics.budget = { status: 'declines_to_disclose', amount: null, evidence: 'No quiero decir mi presupuesto', confidence: 'high' }
    const result = await interpret(message, raw, boundary === 'no_known_options' ? {} : knownFamilyOptions)
    assert.ok(!(result.semantics.normalization_issues as string[]).includes('current_household_reference_restores_known_property_information'))
  })
}


for (const [domain, quote] of [['advisor', 'quiero un asesor'], ['tracking', 'quiero recibir novedades']] as const) {
  test('a positive command attributed to another person cannot authorize the lead: ' + domain, async () => {
    const price = 'Yo sólo quiero saber los precios', message = 'Mi amigo escribió «' + quote + '». ' + price, raw = extraction(message)
    raw.requested_advisor = domain === 'advisor'
    raw.consent_granted = domain === 'tracking'
    raw.action_evidence = { requested_advisor: domain === 'advisor' ? quote : null, opt_out: null, consent_granted: domain === 'tracking' ? quote : null }
    raw.requests = [request(domain, quote), request('property', price)]
    raw.catalog_request = { purpose: 'range', metric: 'published_commercial_price', requirements: [], semantic_preferences: [], evidence: price, confidence: 'high' }
    const result = await interpret(message, raw)
    assert.equal(result.extracted.requested_advisor, false)
    assert.equal(result.extracted.tracking_consent, false)
    assert.deepEqual(result.requests.map(r => r.domain), ['property'])
    assert.equal(result.semantics.primary_intent, 'ask_price')
  })
}
for (const [message, domain] of [['«Quiero un asesor»', 'advisor'], ['Quiero «recibir novedades»', 'tracking'],
  ['Por favor «quiero recibir novedades»', 'tracking']] as const) {
  test('the lead own quotation or emphasis preserves actual permission: ' + message, async () => {
    const raw = extraction(message)
    raw.requested_advisor = domain === 'advisor'
    raw.consent_granted = domain === 'tracking'
    raw.action_evidence = { requested_advisor: domain === 'advisor' ? message : null, opt_out: null, consent_granted: domain === 'tracking' ? message : null }
    raw.requests = [request(domain, message)]
    const result = await interpret(message, raw)
    assert.equal(domain === 'advisor' ? result.extracted.requested_advisor : result.extracted.tracking_consent, true)
    assert.equal(result.requests[0].domain, domain)
  })
}
test('reported permission does not erase a separately requested own advisor and tracking consent', async () => {
  const advisor = 'Yo quiero hablar con un asesor', tracking = 'También quiero recibir novedades'
  const message = 'Mi amigo dijo «quiero un asesor». ' + advisor + '. ' + tracking, raw = extraction(message)
  raw.requested_advisor = raw.consent_granted = true
  raw.action_evidence = { requested_advisor: advisor, opt_out: null, consent_granted: tracking }
  raw.requests = [request('advisor', advisor), request('tracking', tracking)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.requested_advisor, true)
  assert.equal(result.extracted.tracking_consent, true)
  assert.deepEqual(result.requests.map(r => r.domain), ['advisor', 'tracking'])
})
test('quoted terminology remains information without becoming permission for a person', async () => {
  const message = '¿Qué significa «asesor» y qué requisitos debo revisar?', raw = extraction(message)
  raw.requests = [request('property', message)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.tracking_consent, false)
  assert.equal(result.requests[0].evidence, message)
})
test('the exact quoted unsubscribe request leak preserves only the current price query', async () => {
  const price = 'Yo sólo quiero saber los precios', quote = 'No me escriban más'
  const message = 'Mi amigo escribió “' + quote + '”. ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: quote, consent_granted: null }
  raw.requests = [request('property', price), request('tracking', quote)]
  raw.catalog_request = { purpose: 'range', metric: 'published_commercial_price', requirements: [], semantic_preferences: [], evidence: price, confidence: 'high' }
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, false)
  assert.deepEqual(result.requests.map(r => r.domain), ['property'])
  assert.equal(result.semantics.primary_intent, 'ask_price')
  assert.equal(object(result.semantics.catalog_request).metric, 'published_commercial_price')
})
test('the exact topic refusal cannot become a financing query or reservation event', async () => {
  const declined = 'No quiero recibir mensajes sobre financiamiento', wanted = 'sólo información del proyecto'
  const message = declined + ', ' + wanted, raw = extraction(message)
  raw.opt_out = true
  raw.financing_consent = false
  raw.events = ['asked_financing', 'asked_reservation']
  raw.action_evidence = { requested_advisor: null, opt_out: declined, consent_granted: null }
  raw.requests = [request('financing', declined), { ...request('property', message), request: 'información del proyecto' }]
  object(raw.turn_semantics).primary_intent = 'ask_financing'
  object(raw.turn_semantics).primary_evidence = declined
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, false)
  assert.equal(result.extracted.financing_consent, false)
  assert.deepEqual(result.requests.map(r => r.domain), ['property'])
  assert.equal(result.semantics.primary_intent, 'project_information')
  assert.ok(!(result.extracted.events as string[]).includes('asked_financing'))
  assert.ok(!(result.extracted.events as string[]).includes('asked_reservation'))
  assert.equal(object(result.semantics.interpretation).extractor_primary_intent, 'ask_financing')
})
test('a financial process refusal alone preserves the negative answer without creating an inquiry', async () => {
  const message = 'No quiero iniciar ese trámite', raw = extraction(message)
  raw.financing_consent = false
  raw.events = ['asked_financing']
  raw.requests = [request('financing', message)]
  object(raw.turn_semantics).primary_intent = 'ask_financing'
  object(raw.turn_semantics).answer_to_previous = { question_id: 'financing_invitation', kind: 'negative', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw, { pregunta_pendiente: { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' } })
  assert.equal(result.extracted.financing_consent, false)
  assert.equal(object(result.semantics.answer_to_previous).kind, 'negative')
  assert.equal(result.semantics.primary_intent, 'other')
  assert.deepEqual(result.requests, [])
})
for (const combined of [false, true]) {
  test('a process decline preserves a genuine financing terms question: ' + combined, async () => {
    const declined = 'No quiero iniciar ese trámite', query = '¿Qué requisitos pide JEP?'
    const message = declined + ', pero ' + query, raw = extraction(message)
    raw.financing_consent = false
    raw.events = ['asked_financing']
    raw.requests = combined ? [request('financing', message)] : [request('financing', declined), request('financing', query)]
    object(raw.turn_semantics).primary_intent = 'ask_financing'
    object(raw.turn_semantics).primary_evidence = query
    const result = await interpret(message, raw)
    assert.equal(result.extracted.financing_consent, false)
    assert.equal(result.semantics.primary_intent, 'ask_financing')
    assert.ok(result.requests.some(r => r.domain === 'financing' && r.evidence.includes(query)))
    assert.ok((result.extracted.events as string[]).includes('asked_financing'))
  })
}
test('a real compound price and financing inquiry remains intact beside a scoped refusal', async () => {
  const declined = 'No quiero iniciar ese trámite', price = '¿Qué precios tienen esas opciones?', finance = '¿Cuánta entrada pide JEP?'
  const message = declined + '. ' + price + ' ' + finance, raw = extraction(message)
  raw.financing_consent = false
  raw.requests = [request('financing', declined), request('property', price), request('financing', finance)]
  object(raw.turn_semantics).primary_intent = 'ask_financing'
  object(raw.turn_semantics).primary_evidence = finance
  const result = await interpret(message, raw)
  assert.deepEqual(result.requests.map(r => r.domain), ['property', 'financing'])
  assert.equal(result.semantics.primary_intent, 'ask_financing')
})
test('a genuine global refusal retains priority after scoped requests are discarded', async () => {
  const stop = 'No me escriban más', price = '¿Qué precios tienen los departamentos?'
  const message = stop + '. ' + price, raw = extraction(message)
  raw.opt_out = true
  raw.action_evidence = { requested_advisor: null, opt_out: stop, consent_granted: null }
  raw.requests = [request('tracking', stop), request('property', price)]
  const result = await interpret(message, raw)
  assert.equal(result.extracted.opt_out, true)
  assert.equal(result.extracted.tracking_consent, false)
  assert.deepEqual(result.requests.map(r => r.domain), ['tracking', 'property'])
})

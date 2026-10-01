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
const { reviewDisposition, followUpUsable, pendingFollowUpNeedsInterpretation } = require('../src/lib/integrations/automation/review-disposition.ts')
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true,
  factual_inventory_complete: true, project_values: [],
  operational_goal_preserved: true, question_has_purpose: true, question: { purpose: 'none', missing_datum: '', next_decision: '', clarifies: [] }, missing_fact_fragments: [], review_issues: [], claims: [], factual_values: [] }
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '' }

test('price ranges and equivalent launch disclosures survive the full review pipeline', async () => {
  const current = 'y que precio tiene disculpe'
  const units = [
    { id: 'local-min', unit_number: 'LC-11', category: 'local', status: 'disponible', is_published: true, published_commercial_price: 145000 },
    { id: 'penthouse-max', unit_number: '601', category: 'penthouse', status: 'disponible', is_published: true, published_commercial_price: 550000 },
  ]
  for (const disclosure of ['Son valores referenciales de lanzamiento y podrían variar.', 'Los valores de lanzamiento son orientativos y están sujetos a modificaciones.']) {
    const reply = `Los precios van desde $145.000 hasta $550.000 USD. ${disclosure}`
    const mock = sequence(candidate(current, reply), (_rules, context, schema) => {
      assert.ok(context.obligaciones_aplicables.some(rule => rule.id === 'price_conditions'
        && /cualquier redacción equivalente/.test(rule.instruction)))
      const variants = schema.properties.factual_values.items.anyOf
      assert.ok(variants.every(v => v.properties.upper_value.type === 'null'
        || JSON.stringify(v.properties.operator.enum) === '["between"]'))
      return { ...approved, claims: [{ fragment: 'S1', subject: 'Rango publicado', polarity: 'affirmation',
        claim_kind: 'project_fact', verdict: 'supported', evidence: 'Extremos exactos del conjunto cotizado.', evidence_source: 'verified_context',
        evidence_ids: [context.evidencia_afirmaciones.find(s => s.reference_id === 'group:price_quote:all:range').id] }],
      factual_values: [{ fragment: 'S1', unit_id: 'group:price_quote:all:range', field: 'published_commercial_price',
        value: 145000, upper_value: 550000, operator: 'between' }] }
    })
    const result = await completeTurnReply({ current, baseReply: reply, verified: { catalogo: units, alcance_negocio: 'property',
      modo_comercial: 'lanzamiento', politica_comercial: { precios_autorizados: true, precios_aproximados: true } },
    audit: { source: 'unit_price', verified_price_only: true, semantic_review_enabled: true } }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, reply)
    assert.equal(mock.calls.length, 2)
  }
})

test('semantic policies replace phrase vetoes without waiving a real policy violation', async () => {
  const current = 'Gracias por la información'
  const input = { current, baseReply: 'Gracias.', verified: {}, audit: { semantic_review_enabled: true } }
  for (const reply of ['No ofrecemos aprobación garantizada.', 'Todavía no hemos confirmado su cita.',
    'No soy una persona; soy un asistente virtual.', 'No tengo datos suficientes para afirmar que la renta respalde el crédito.']) {
    assert.deepEqual(turnCompletenessIssues(input, reply), [], reply)
  }
  const reply = 'Los precios de lanzamiento son definitivos y no cambiarán.'
  let reviewerCalls = 0
  const generate = async (rules, context) => {
    if (!context.respuesta_propuesta) return candidate(current, reply)
    reviewerCalls++
    assert.match(rules, /carácter referencial de lanzamiento/)
    return { ...approved, answers_supported: false, review_issues: [{ check: 'answers_supported', kind: 'content',
      fragment: 'S1', reason: 'Contradice la política de precios referenciales.' }] }
  }
  const result = await completeTurnReply({ ...input, verified: { politica_comercial: { precios_aproximados: true } } }, generate)
  assert.ok(reviewerCalls > 0)
  assert.notEqual(result.audit.status, 'checked')
  assert.notEqual(result.reply, reply)
})

test('personal acknowledgements reach the focused reviewer without a redundant profile extraction, including during a handoff', async () => {
  const current = 'Me llamo Ernesto y me mudé a Guayaquil'
  for (const reply of ['He registrado su nombre y su residencia en Guayaquil.', 'Tomo nota de sus datos, Ernesto.']) {
    const mock = sequence(candidate(current, reply), (rules, context) => {
      assert.match(rules, /El acuse de datos del perfil es conversación/)
      return { review_contract: 'focused-review-v1', claims: [], factual_values: [], project_values: [], numeric_checks: [],
        non_factual_sentence_ids: ['S1'], pending_checks: [],
        obligation_checks: context.obligaciones_aplicables.map(rule => ({ id: rule.id, verdict: 'met', sentence_ids: ['S1'], reason: 'Acuse de los datos declarados, sin afirmar una gestión comercial.' })) }
    })
    const result = await completeTurnReply({ current, baseReply: 'Gracias.', verified: {},
      audit: { semantic_review_enabled: true, reservation: { handoff_verified: false } } }, mock.generate)
    assert.equal(result.reply, reply)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(mock.calls.length, 2)
  }
})

test('semantic review blocks fabricated commercial actions even when another action has a receipt', async () => {
  for (const reply of ['Su cita ya está confirmada.', 'La unidad quedó reservada.', 'He enviado su consulta al asesor.']) {
    const current = 'Gracias por registrar mis datos'
    let reviews = 0
    const generate = async (_rules, context) => {
      if (!context.respuesta_propuesta) return candidate(current, reply)
      reviews++
      return { ...approved, answers_supported: false, review_issues: [{ kind: 'commercial_content',
        code: 'unverified_operation', fragment: 'S1', detail: 'No hay resultado confirmado de esta acción.' }],
      claims: [{ fragment: 'S1', subject: 'Gestión comercial', polarity: 'affirmation', claim_kind: 'operational_fact',
        verdict: 'unsupported', evidence: 'El registro de datos no acredita esta gestión.', evidence_source: 'none', evidence_ids: [] }] }
    }
    const result = await completeTurnReply({ current, baseReply: 'Gracias.', verified: {}, audit: {
      semantic_review_enabled: true, registration_verified: true, action: 'profile_updated',
    } }, generate)
    assert.ok(reviews > 0)
    assert.notEqual(result.reply, reply)
    assert.notEqual(result.audit.status, 'checked')
  }
})

test('a failed review of a single empty search recovers its verified answer without approving the draft', async () => {
  const current = '¿Tiene viviendas de 5 dormitorios?'
  const draft = 'No hay viviendas de 5 dormitorios. Podemos conseguir otra fuera del proyecto.'
  const proposal = { ...candidate(current, draft), requests: [{ fragment: current, intent: 'Disponibilidad de cinco dormitorios', request_type: 'specific_fact', status: 'answered', fact_key: 'bedrooms', evidence: 'Búsqueda completa sin coincidencias' }] }
  const mock = sequence(proposal, () => { throw Error('REVIEW_TIMEOUT') })
  const result = await completeTurnReply({ current, baseReply: 'Respuesta antigua', verified: {}, audit: {
    semantic_review_enabled: true, verified_catalog: true, source: 'catalog_search',
    catalog_query: { scope: 'catalog', operation: 'search', group: 'residential', filters: { bedrooms: 5, bedrooms_required: true } },
    catalog_results: { complete: true, units: [], unknown_unit_ids: [] },
    resolved_turn_intent: { requests: [{ domain: 'property' }] },
  } }, mock.generate)
  assert.equal(result.reply, 'Actualmente no contamos con viviendas disponibles de 5 dormitorios.')
  assert.equal(result.audit.status, 'recovered_catalog_result')
  assert.equal(result.audit.recovery.pending, false)
  assert.equal(result.needsAdvisor, false)
  assert.doesNotMatch(result.reply, /fuera del proyecto/)
})
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

test('penthouse price survives an empty optional or historical follow-up datum without another model call', async () => {
  const current = 'entiendo, y por ejemplo un penthouse que precio tiene?'
  const reply = 'Los penthouses de la sexta planta alta tienen un valor referencial de lanzamiento de $550.000 USD cada uno, sujeto a cambios. ¿Le gustaría obtener más detalles?'
  const units = [{ id: 'p601', unit_number: '601', category: 'penthouse', bedrooms: 2, floor_number: 6, published_commercial_price: 550000 },
    { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
    { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 }]
  for (const role of ['optional_continuation', undefined]) {
    const question = { purpose: 'choose_property', missing_datum: '', next_decision: 'Ofrecer detalles de la opción que interese.', ...(role ? { role } : {}) }
    const mock = sequence((_rules, context, schema) => {
      assert.equal(context.evidencia_turno.units.length, 2)
      assert.equal(context.contrato_redaccion.price_evidence.units.length, 2)
      assert.deepEqual(schema.properties.requests.items.properties.fragment.enum, ['R1', 'R2'])
      return { ...candidate(current, reply), requests: [{ ...candidate(current, reply).requests[0], fragment: 'R2' }], question }
    }, (_rules, context) => ({ ...approved, question: { ...question, clarifies_request_ids: [] },
      claims: [{ fragment: 'S1', subject: 'Precio y planta de los penthouses', polarity: 'affirmation', claim_kind: 'project_fact',
        verdict: 'supported', evidence_source: 'verified_context', evidence: 'Precios y plantas exactos del grupo cotizado.',
        evidence_ids: [context.evidencia_afirmaciones.find(s => s.reference_id === 'group:price_quote:all:min').id] }],
      factual_values: [{ fragment: 'S1', unit_id: 'group:price_quote:all:min', field: 'published_commercial_price', value: 550000, operator: 'eq', upper_value: null, measurement_unit: 'USD' },
        { fragment: 'S1', unit_id: 'group:price_quote:all:min', field: 'floor_number', value: 6, operator: 'eq', upper_value: null, measurement_unit: 'floor' }],
      sentence_inventory: [{ sentence_id: 'S1', catalog_fields: ['published_commercial_price', 'floor_number'], project_quantities: false, business_facts: true },
        { sentence_id: 'S2', catalog_fields: [], project_quantities: false, business_facts: false }] }))
    const result = await completeTurnReply({ current, baseReply: 'Precio publicado: $550.000 USD.', verified: { catalogo: units,
      politica_comercial: { precios_autorizados: true, precios_aproximados: true } }, audit: { source: 'unit_price',
      verified_price_only: true, semantic_review_enabled: true, resolved_turn_intent: { objective: 'ask_price', subject: { category: 'penthouse' },
        requests: [{ domain: 'property', confidence: 'high', evidence: 'un penthouse que precio tiene?' }] } } }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, reply)
    assert.equal(result.audit.final_validation.passed, true)
    assert.equal(result.audit.follow_up.usable, Boolean(role))
    assert.equal(result.audit.catalog_context_scope.included_unit_count, 2)
    assert.equal(result.audit.requests[0].fragment, 'un penthouse que precio tiene?')
    assert.equal(mock.calls.length, 2)
    assert.deepEqual(result.audit.repair_attempts, [])
  }
})

test('malformed writer and reviewer question sheets do not withhold independently approved prose', async () => {
  const current = 'Gracias', reply = 'Con mucho gusto. ¿Desea que continuemos?'
  for (const question of [{}, { purpose: 'invented', missing_datum: '', next_decision: null },
    { purpose: 'choose_property', role: 'required_collection', missing_datum: '', next_decision: '' }]) {
    const mock = sequence({ ...candidate(current, reply), question }, { ...approved, question })
    const result = await completeTurnReply({ current, baseReply: 'Gracias.', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, reply)
    assert.equal(result.audit.follow_up.usable, false)
    assert.ok(result.audit.follow_up.warnings.length)
    assert.equal(result.audit.operational_action_verified, false)
    assert.equal(mock.calls.length, 2)
    assert.deepEqual(result.audit.repair_attempts, [])
  }
})

test('optional metadata cannot waive an omitted required profile collection', async () => {
  const current = 'Estoy interesado', reply = 'Bienvenido. ¿Quiere ver opciones?'
  const question = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: '', next_decision: '' }
  const mock = sequence(candidate(current, reply), { ...approved, question, operational_goal_preserved: false,
    review_issues: [{ check: 'operational_goal_preserved', kind: 'content', fragment: 'R1', reason: 'Se omitieron nombre y residencia requeridos en la etapa.' }] },
  candidate(current, reply), { ...approved, question, operational_goal_preserved: false,
    review_issues: [{ check: 'operational_goal_preserved', kind: 'content', fragment: 'R1', reason: 'La captura obligatoria sigue ausente.' }] })
  const result = await completeTurnReply({ current, baseReply: '¿Cómo se llama y dónde reside?', verified: {},
    audit: { semantic_review_enabled: true, profile_introduction: { question_purpose: 'collect_profile', profile_state: {} } } }, mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.notEqual(result.reply, reply)
  assert.ok(result.audit.issues.includes('review_check_failed:operational_goal_preserved'))
})

test('a sentence inventory omission is repaired as verification, never downgraded to follow-up metadata', async () => {
  const current = 'Cuénteme del 202', reply = 'El departamento 202 está en la segunda planta.'
  for (const repaired of [true, false]) {
    const sheet = { ...approved, sentence_inventory: [{ sentence_id: 'S1', catalog_fields: ['floor_number'], project_quantities: false, business_facts: false }] }
    const fixed = { ...sheet, factual_values: [{ fragment: 'S1', unit_id: 'u202', field: 'floor_number', value: 2, operator: 'eq', upper_value: null, measurement_unit: 'floor' }] }
    const mock = sequence(candidate(current, reply), sheet, repaired ? fixed : sheet)
    const result = await completeTurnReply({ current, baseReply: reply, verified: { catalogo: [{ id: 'u202', unit_number: '202', category: 'departamento', floor_number: 2 }] },
      audit: { semantic_review_enabled: true } }, mock.generate)
    assert.equal(result.audit.status, repaired ? 'checked' : 'rejected_review', JSON.stringify(result.audit))
    assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
    assert.equal(result.audit.repair_attempts[0].issues[0].code, 'sentence_fact_not_reviewed')
    assert.equal(mock.calls[2][1].respuesta_propuesta, reply)
    if (repaired) assert.equal(result.reply, reply)
  }
})

test('only explicitly auxiliary defects can allow delivery; source errors and unknown checks remain blocking', () => {
  const auxiliary = { code: 'invalid_review_question_metadata', kind: 'follow_up_metadata' }
  const result = reviewDisposition([auxiliary])
  assert.equal(result.content_approved, true)
  assert.equal(result.follow_up_usable, false)
  for (const code of ['claim_source_not_verified', 'invalid_sentence_inventory', 'catalog_value_mismatch', 'unexplained_review_failure', 'future_check']) {
    const decision = reviewDisposition([auxiliary, { code, kind: 'review_metadata' }])
    assert.equal(decision.content_approved, false)
    assert.equal(decision.blocking.length, 1)
  }
  const audit = { turn_completeness: { status: 'checked', follow_up: { usable: false } } }
  assert.equal(followUpUsable(audit), false)
  assert.equal(followUpUsable({}), true)
  assert.equal(followUpUsable({ ...audit, delivery_integrity: { status: 'revalidated', review: { follow_up: { usable: true } } } }), true)
  assert.equal(pendingFollowUpNeedsInterpretation({ _follow_up_review: { usable: false, reply: '¿Continuamos?' } }, '¿Continuamos?'), true)
  assert.equal(pendingFollowUpNeedsInterpretation({ _follow_up_review: { usable: false, reply: '¿Continuamos?' } }, 'Otra respuesta'), false)
})

test('request IDs preserve the exact customer text and a real missing policy remains distinct from optional follow-up', async () => {
  const current = '¿Aceptan MASCOTAS?'
  const reply = 'Necesito confirmar la política sobre mascotas. ¿Le gustaría conocer la ubicación?'
  const question = { purpose: 'permission_to_continue', role: 'optional_continuation', missing_datum: '', next_decision: '' }
  const mock = sequence((_rules, context, schema) => {
    assert.deepEqual(schema.properties.requests.items.properties.fragment.enum, ['R1'])
    assert.equal(context.referencias_solicitud[0].text, current)
    return { ...candidate(current, reply), question, requests: [{ fragment: 'R1', intent: 'Consultar política',
      request_type: 'specific_fact', status: 'missing_fact', evidence: 'No hay política publicada.', fact_key: 'policy' }] }
  }, (_rules, context, schema) => {
    assert.equal(schema.properties.missing_fact_fragments, undefined, 'The reviewer does not reinterpret the writer request inventory')
    return { review_contract: 'focused-review-v1', claims: [], factual_values: [], project_values: [], numeric_checks: [],
      non_factual_sentence_ids: ['S1', 'S2'], pending_checks: [],
      obligation_checks: context.obligaciones_aplicables.map(rule => ({ id: rule.id, verdict: 'met', sentence_ids: [], reason: '' })) }
  })
  const result = await completeTurnReply({ current, baseReply: reply, verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [current])
  assert.deepEqual(result.audit.missing_fact_fragments, [], 'The focused reviewer no longer duplicates missing-fact detection')
  assert.deepEqual(result.audit.requests.filter(request => request.status === 'missing_fact').map(request => request.fragment), [current])
  assert.equal(mock.calls.length, 2)
})

test('the full pipeline preserves freely phrased exact quantities and blocks rounding even with reviewer approval', async () => {
  const current = 'Cuénteme sobre el departamento 202'
  const unit = { id: 'd202', unit_number: '202', category: 'departamento', area_internal_m2: 120.83 }
  for (const [reply, value, accepted] of [
    ['Su superficie interior suma ciento veinte coma ochenta y tres metros cuadrados.', 120.83, true],
    ['En el interior dispone de 120,83 metros cuadrados.', 120.83, true],
    ['Su superficie interior suma ciento veinte coma ocho metros cuadrados.', 120.8, false],
  ]) {
    const roles = []
    const generate = async (_rules, context, _schema, _a, _b, _c, role) => {
      roles.push(role)
      if (role === 'writing') return candidate(current, reply)
      return { ...approved,
        claims: [{ fragment: 'S1', subject: 'Superficie interior', polarity: 'affirmation', claim_kind: 'project_fact',
          verdict: 'supported', evidence: 'Superficie de la unidad consultada', evidence_source: 'verified_context',
          evidence_ids: context.evidencia_afirmaciones.filter(source => source.path.startsWith('evidencia_turno.units.')).map(source => source.id) }],
        factual_values: [{ fragment: 'S1', unit_id: unit.id, field: 'area_internal_m2', value,
          measurement_unit: 'm2', operator: 'eq', upper_value: null }] }
    }
    const result = await completeTurnReply({ current, baseReply: 'Información de la unidad.', verified: { catalogo: [unit] },
      audit: { semantic_review_enabled: true, verified_catalog: true, catalog_results: { units: [unit] } } }, generate)
    if (accepted) {
      assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
      assert.equal(result.reply, reply)
      assert.deepEqual(roles, ['writing', 'review'])
    } else {
      assert.notEqual(result.audit.status, 'checked')
      assert.notEqual(result.reply, reply)
      assert.match(JSON.stringify(result.audit), /catalog_value_mismatch/)
      assert.ok(roles.length <= 5, 'Repairs must remain bounded')
    }
  }
})

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
  assert.equal(mock.calls[1][2].required.includes('review_issues'), false)
  assert.equal(mock.calls[1][2].required.includes('review_contract'), true)
  assert.equal(mock.calls[1][2].required.includes('pending_checks'), true)
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

test('mixed reviewer metadata and content allegations get one independent recheck of the same draft', async () => {
  const current = '¿Podemos revisar la distribución?'
  const reply = 'Podemos evaluar cómo prefieren distribuirse.'
  const bad = { ...approved, answers_supported: false,
    review_issues: [{ check: 'answers_supported', kind: 'content', source: 'draft', fragment: reply, reason: 'Se debe verificar esta orientación.' }],
    claims: [guidance('Una frase inventada por el revisor.')] }
  const mock = sequence(candidate(current, reply), bad, { ...approved, claims: [guidance(reply)] })
  const result = await completeTurnReply({ current, baseReply: 'Respuesta antigua', verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.equal(mock.calls.length, 3)
  assert.equal(mock.calls[2][1].respuesta_propuesta, reply)
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
  const bad = { ...approved, factual_inventory_complete: false, factual_values: [{ fragment: 'S1', unit_id: 'd202', field: 'published_commercial_price', value: 210000, operator: 'eq', upper_value: null }] }
  const mock = sequence(candidate(current, reply), bad, approved)
  const result = await completeTurnReply({ current, baseReply: 'Hola.', verified: { catalogo: [unit] }, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.repair_attempts[0].target, 'review_metadata')
  assert.equal(result.audit.repair_attempts[0].issues[0].code, 'incomplete_fact_inventory')
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

test('quality omissions are advisory even when the reviewer labels them as content defects', async () => {
  const current = '¿Será cómodo para mi familia?'
  const draft = 'Tenemos opciones de vivienda.'
  const repaired = 'La comodidad depende de cómo prefieran distribuirse; podemos revisar las distribuciones.'
  const badReview = { ...approved, all_requests_considered: false, review_issues: [{ check: 'all_requests_considered', kind: 'content',
    source: 'current_request', fragment: current, reason: 'La respuesta enumera categorías sin atender la inquietud sobre comodidad.' }] }
  const mock = sequence(candidate(current, draft), badReview, candidate(current, repaired), { ...approved, claims: [guidance(repaired)] })
  const result = await completeTurnReply({ current, baseReply: draft, verified: {}, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, draft)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.repair_attempts.length, 0)
  assert.ok(result.audit.editorial_observations.some(item => item.startsWith('review_editorial:all_requests_considered:')))
  assert.equal(mock.calls.length, 2)
  const invalid = checkReviewDecision({ ...badReview, review_issues: [{ ...badReview.review_issues[0], fragment: 'consulta antigua' }] }, current, draft)
  assert.deepEqual(invalid.issues, [])
  assert.equal(invalid.editorial[0].kind, 'editorial')
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

test('operational wording reaches semantic review instead of a verb blacklist', () => {
  const draft = 'Hemos registrado su solicitud.'
  const input = { current: 'Quiero solicitar una visita', verified: {}, baseReply: draft }
  assert.ok(!turnCompletenessIssues(input, draft, noQuestion).includes('new_operational_claim'))
  assert.deepEqual(turnCompletenessIssues({ ...input, baseReply: 'Su solicitud está registrada.',
    audit: { registration_verified: true, action: 'submitted' } }, draft, noQuestion), [])
})

test('scoped exact area endpoints survive a range citation without another writer or reviewer', async () => {
  const current = 'Me equivoqué de número, pero cuénteme de los departamentos'
  const reply = 'Los departamentos de dos dormitorios tienen áreas desde 109,69 m²; los de tres llegan hasta 120,83 m².'
  const units = [{ id: 'd201', category: 'departamento', bedrooms: 2, area_internal_m2: 109.69 },
    { id: 'd301', category: 'departamento', bedrooms: 2, area_internal_m2: 115.04 },
    { id: 'd202', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 }]
  let writerState
  const mock = sequence((_rules, context) => {
    writerState = context.contrato_redaccion.estado_comercial
    assert.equal(writerState.datos_confirmados.nombre, 'Nathaly Caballero')
    assert.deepEqual(writerState.datos_a_pedir, [])
    assert.equal(writerState.brochure.accion, 'already_shared')
    return candidate(current, reply)
  }, (_rules, context, schema) => {
    assert.deepEqual(context.contrato_redaccion.estado_comercial, writerState)
    const claimKinds = schema.properties.claims.items.anyOf.flatMap(item => item.properties.claim_kind.enum)
    assert.ok(claimKinds.includes('project_fact'))
    assert.ok(!claimKinds.includes('lead_statement'))
    const groups = ['group:departamento:2:range', 'group:departamento:3:range']
    return { ...approved, claims: [{ fragment: 'S1', subject: 'Áreas de departamentos por dormitorios', polarity: 'affirmation',
      claim_kind: 'project_fact', verdict: 'supported', evidence: 'Extremos exactos por grupo.', evidence_source: 'verified_context',
      evidence_ids: groups.map(id => context.evidencia_afirmaciones.find(s => s.reference_id === id).id) }],
    factual_values: [...groups.map((unit_id, i) => ({ fragment: 'S1', unit_id, field: 'area_internal_m2',
      value: i ? 120.83 : 109.69, operator: i ? 'lte' : 'gte', upper_value: null, measurement_unit: 'm2' })),
      { fragment: 'S1', unit_id: 'group:departamento:2:min', field: 'bedrooms', value: 2, operator: 'eq', upper_value: null },
      { fragment: 'S1', unit_id: 'group:departamento:3:max', field: 'bedrooms', value: 3, operator: 'eq', upper_value: null }] }
  })
  const result = await completeTurnReply({ current, baseReply: 'Respuesta base', verified: { catalogo: units,
    perfil_lead: { full_name: 'Nathaly Caballero', residence_city: 'Cuenca', residence_status: 'confirmed',
      sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Nathaly Caballero' } } },
    estado_conversacion: { brochure_sent: true } }, audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(mock.calls.length, 2)
  assert.deepEqual(result.audit.semantic_review.factual_values.filter(f => f.field === 'area_internal_m2').map(f => f.unit_id), ['group:departamento:2:min', 'group:departamento:3:max'])
  assert.equal(result.audit.semantic_review.reference_corrections.filter(c => c.code === 'range_endpoint_reference_resolved').length, 2)
})

test('repairing an empty citation preserves the draft and does not turn a question into an unsupported fact', async () => {
  const current = 'Quisiera información del proyecto'
  const reply = 'El proyecto está en Cuenca. ¿Qué le gustaría conocer?'
  const q = { text: '¿Qué le gustaría conocer?', purpose: 'clarify_request', missing_datum: 'interés', next_decision: 'orientar consulta', clarifies: [] }
  const proposal = { ...candidate(current, reply), question: q }
  const row = { fragment: 'S1', subject: 'Ubicación del proyecto', polarity: 'affirmation', claim_kind: 'project_fact',
    verdict: 'supported', evidence: 'Ubicación publicada.', evidence_source: 'verified_context', evidence_ids: [] }
  const mock = sequence(proposal, { ...approved, question: q, claims: [row] }, (_rules, context) => {
    assert.equal(context.respuesta_propuesta, reply)
    assert.match(context.reparacion_revision.instruccion, /no demuestra que el hecho sea falso/)
    return { ...approved, question: q, claims: [{ ...row, evidence_ids: [context.evidencia_afirmaciones.find(s => s.path === 'contexto_verificado.proyecto').id] }] }
  })
  const result = await completeTurnReply({ current, baseReply: 'Hola', verified: { proyecto: { city: 'Cuenca' } },
    audit: { semantic_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls.map(call => call[6]), ['writing', 'review', 'review'])
  assert.deepEqual(result.audit.repair_attempts.map(r => r.target), ['review_metadata'])
})

/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { completeTurnReply, turnCompletenessIssues } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { requireReviewedResponse } = require('../src/lib/integrations/automation/response-review-recovery.ts')
const { reviewDisposition, followUpUsable, pendingFollowUpNeedsInterpretation } = require('../src/lib/integrations/automation/review-disposition.ts')
const pass = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
const blocked = (statement, authoritative_fact, category = 'hard_fact') => ({ review_contract: 'content-review-v1', verdict: 'block', findings: [
  { category, statement, authoritative_fact, reason: 'La afirmación material no coincide con el respaldo autorizado.' },
] })
const noQuestion = { text: '', purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const candidate = (current, reply, changes = {}) => ({ reply, question: noQuestion, requests: [{ fragment: current, intent: 'Atender la consulta',
  request_type: 'general_information', status: 'answered', evidence: 'Respuesta basada en la información disponible', fact_key: null }], ...changes })
const input = (current, baseReply, verified = {}, audit = {}) => ({ current, baseReply, verified, audit: { semantic_review_enabled: true, ...audit } })
function sequence(...answers) {
  const calls = []
  return { calls, generate: async (...args) => {
    calls.push(args)
    assert.ok(answers.length, 'Unexpected extra model request')
    const answer = answers.shift()
    return typeof answer === 'function' ? answer(...args) : answer
  } }
}
const tasks = mock => mock.calls.map(call => call[6])
const checked = (result, reply) => {
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.audit.server_semantic_validation, false)
  assert.equal(result.needsAdvisor, false)
}

test('price ranges and equivalent launch disclosures survive factual AI review intact', async () => {
  const current = '¿Qué precio tiene?'
  const units = [{ id: 'local', unit_number: 'LC-11', category: 'local', published_commercial_price: 145000 },
    { id: 'penthouse', unit_number: '601', category: 'penthouse', published_commercial_price: 550000 }]
  for (const disclosure of ['Son valores referenciales de lanzamiento y podrían variar.', 'Los valores de lanzamiento son orientativos y están sujetos a modificaciones.']) {
    const reply = `Los precios van desde USD 145.000 hasta USD 550.000. ${disclosure}`
    const mock = sequence(candidate(current, reply), (_rules, context, schema) => {
      assert.equal(context.borrador, reply)
      assert.ok(context.fuentes_autorizadas.unidades.some(unit => unit.published_commercial_price === 145000))
      assert.equal(schema.properties.factual_values, undefined)
      return pass
    })
    checked(await completeTurnReply(input(current, reply, { catalogo: units, politica_comercial: { precios_autorizados: true }, modo_comercial: 'lanzamiento' }), mock.generate), reply)
    assert.deepEqual(tasks(mock), ['writing', 'review'])
  }
})

test('a factual commercial policy violation is corrected only after an explicit AI finding', async () => {
  const current = '¿Cambian los precios?', wrong = 'Los precios de lanzamiento son definitivos y no cambiarán.'
  const reply = 'Los valores de lanzamiento son referenciales y están sujetos a cambios.'
  const finding = blocked(wrong, 'La política vigente establece precios referenciales.', 'business_guardrail')
  const mock = sequence(candidate(current, wrong), finding, candidate(current, reply), pass)
  const result = await completeTurnReply(input(current, reply, { politica_comercial: { precios_aproximados: true } }), mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'writing', 'review'])
  assert.deepEqual(mock.calls[2][1].reparacion.hallazgos_revisor, finding.findings)
})

test('personal acknowledgements require no redundant profile extraction or commercial-operation inference', async () => {
  const current = 'Me llamo Ernesto y me mudé a Guayaquil'
  for (const reply of ['He registrado su nombre y su residencia en Guayaquil.', 'Tomo nota de sus datos, Ernesto.']) {
    const mock = sequence(candidate(current, reply), pass)
    const result = await completeTurnReply(input(current, reply, {}, { reservation: { handoff_verified: false } }), mock.generate)
    checked(result, reply)
    assert.equal(result.audit.operational_action_verified, false)
    assert.deepEqual(tasks(mock), ['writing', 'review'])
  }
})

test('fabricated commercial actions remain blocked even when a different operation has a receipt', async () => {
  const current = 'Gracias por registrar mis datos'
  for (const reply of ['Su cita está confirmada.', 'La unidad quedó reservada.', 'He enviado su consulta al asesor.']) {
    const finding = blocked(reply, 'Solo existe registro de datos; no hay comprobante de esa operación.', 'business_guardrail')
    const mock = sequence(candidate(current, reply), finding, candidate(current, reply), finding)
    const result = await completeTurnReply(input(current, reply, {}, { registration_verified: true, action: 'profile_updated' }), mock.generate)
    assert.equal(result.audit.status, 'rejected_review')
    assert.throws(() => requireReviewedResponse(result.audit), /RESPONSE_REVIEW_EXHAUSTED/)
    assert.equal(result.audit.operational_action_verified, false)
    assert.deepEqual(tasks(mock), ['writing', 'review', 'writing', 'review'])
  }
})

test('review timeout on an empty search propagates for recovery without manufacturing a catalogue fallback', async () => {
  const current = '¿Tiene viviendas de cinco dormitorios?'
  const reply = 'Actualmente no contamos con viviendas de cinco dormitorios.'
  const mock = sequence(candidate(current, reply), () => { throw Error('REVIEW_TIMEOUT') })
  await assert.rejects(completeTurnReply(input(current, 'Respuesta antigua', {}, { verified_catalog: true,
    catalog_query: { operation: 'search', filters: { bedrooms: 5 } }, catalog_results: { complete: true, units: [] } }), mock.generate), /REVIEW_TIMEOUT/)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('penthouse prices retain optional empty question metadata without another writer call', async () => {
  const current = '¿Qué precio tiene un penthouse?', reply = 'Los penthouses tienen un valor referencial de lanzamiento de USD 550.000, sujeto a cambios.'
  const unit = { id: 'p601', unit_number: '601', category: 'penthouse', published_commercial_price: 550000 }
  for (const question of [noQuestion, { purpose: 'choose_property', next_decision: '', missing_datum: '' }]) {
    const mock = sequence(candidate(current, reply, { question }), pass)
    const result = await completeTurnReply(input(current, reply, { catalogo: [unit], politica_comercial: { precios_autorizados: true } }), mock.generate)
    checked(result, reply)
    assert.deepEqual(result.audit.question, {})
    assert.deepEqual(tasks(mock), ['writing', 'review'])
  }
})

test('malformed auxiliary writer question metadata cannot withhold independently approved prose', async () => {
  const current = 'Gracias', reply = 'Podemos continuar cuando desee.'
  for (const question of [{}, { purpose: 'invented', next_decision: null }, { purpose: 'choose_property', role: 'required_collection' }]) {
    const mock = sequence(candidate(current, reply, { question }), pass)
    const result = await completeTurnReply(input(current, reply), mock.generate)
    checked(result, reply)
    assert.deepEqual(result.audit.question, {})
    assert.equal(result.audit.operational_action_verified, false)
  }
})

test('profile capture remains in the writer plan without an omission veto or invented pending state', async () => {
  const current = 'Estoy interesado', reply = 'Bienvenido a La Vilet.'
  const mock = sequence((_rules, context) => {
    assert.deepEqual(context.estado_operativo.profile_introduction.missing_fields, ['full_name', 'residence'])
    return candidate(current, reply)
  }, pass)
  const result = await completeTurnReply(input(current, reply, {}, { profile_introduction: { question_purpose: 'collect_profile',
    profile_state: {}, missing_fields: ['full_name', 'residence'] } }), mock.generate)
  checked(result, reply)
  assert.deepEqual(result.audit.question, {})
})

test('a factual floor statement is reviewed without a code-generated sentence inventory', async () => {
  const current = 'Cuénteme del 202', reply = 'El departamento 202 está en la segunda planta.'
  const unit = { id: 'u202', unit_number: '202', category: 'departamento', floor_number: 2 }
  const mock = sequence(candidate(current, reply), (_rules, context, schema) => {
    assert.equal(context.borrador, reply)
    assert.equal(schema.properties.sentence_inventory, undefined)
    assert.equal(context.fuentes_autorizadas.unidades.find(item => item.id === unit.id).floor_number, 2)
    return pass
  })
  checked(await completeTurnReply(input(current, reply, { catalogo: [unit] }), mock.generate), reply)
})

test('legacy diagnostic disposition helpers keep source failures distinct from auxiliary defects', () => {
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
  assert.equal(pendingFollowUpNeedsInterpretation({ _follow_up_review: { usable: false, reply: '¿Continuamos?' } }, '¿Continuamos?'), true)
  assert.equal(pendingFollowUpNeedsInterpretation({ _follow_up_review: { usable: false, reply: '¿Continuamos?' } }, 'Otra respuesta'), false)
})

test('request references preserve exact customer text while missing-policy metadata remains non-operational', async () => {
  const current = '¿Aceptan MASCOTAS?', reply = 'Necesito confirmar la política sobre mascotas.'
  const mock = sequence((_rules, context, schema) => {
    assert.deepEqual(schema.properties.requests.items.properties.fragment.enum, ['R1'])
    assert.equal(context.referencias_solicitud[0].text, current)
    return candidate(current, reply, { requests: [{ fragment: 'R1', status: 'missing_fact', fact_key: 'policy' }] })
  }, (_rules, _context, schema) => {
    assert.equal(schema.properties.missing_fact_fragments, undefined)
    return pass
  })
  const result = await completeTurnReply(input(current, reply), mock.generate)
  checked(result, reply)
  assert.equal(result.audit.operational_action_verified, false)
  assert.deepEqual(result.unresolved, [])
})

test('exact quantities retain their spelling and only the AI reviewer rejects material rounding', async () => {
  const current = 'Cuénteme del departamento 202', unit = { id: 'd202', unit_number: '202', category: 'departamento', area_internal_m2: 120.83 }
  for (const reply of ['Su superficie interior suma ciento veinte coma ochenta y tres metros cuadrados.', 'En el interior dispone de 120,83 metros cuadrados.']) {
    const mock = sequence(candidate(current, reply), pass)
    checked(await completeTurnReply(input(current, reply, { catalogo: [unit] }), mock.generate), reply)
    assert.deepEqual(tasks(mock), ['writing', 'review'])
  }
  const wrong = 'La superficie interior exacta es de 120,8 m².', repaired = 'La superficie interior es de 120,83 m².'
  assert.deepEqual(turnCompletenessIssues(input(current, wrong), wrong), [], 'Transport code must not parse the number')
  const mock = sequence(candidate(current, wrong), blocked(wrong, 'La ficha registra 120,83 m² interiores.'), candidate(current, repaired), pass)
  checked(await completeTurnReply(input(current, wrong, { catalogo: [unit] }), mock.generate), repaired)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'writing', 'review'])
})

test('family suitability guidance survives factual review without an imposed question', async () => {
  const current = '¿Alcanzan tres dormitorios para seis personas?'
  const reply = 'Disponemos de opciones de tres dormitorios. Su comodidad dependerá de cómo prefieran distribuirse; podemos revisar los planos.'
  const units = [{ id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3 }, { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3 }]
  const mock = sequence(candidate(current, reply), (_rules, context) => {
    assert.equal(context.fuentes_autorizadas.unidades.length, 2)
    return pass
  })
  const result = await completeTurnReply(input(current, reply, { catalogo: units }), mock.generate)
  checked(result, reply)
  assert.deepEqual(result.audit.question, {})
})

test('an unexplained reviewer block repairs only the JSON envelope on the same draft', async () => {
  const current = '¿Podríamos compartir habitaciones?', reply = 'Algunas familias comparten habitaciones; conviene evaluar sus preferencias.'
  const mock = sequence(candidate(current, reply), { review_contract: 'content-review-v1', verdict: 'block', findings: [] }, pass)
  const result = await completeTurnReply(input(current, reply), mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'review'])
  assert.equal(mock.calls[2][1].borrador, reply)
  assert.equal(result.audit.semantic_review.metadata_retries, 1)
})

test('a supported guidance recheck does not rewrite the draft to repair a malformed reviewer envelope', async () => {
  const current = '¿Podemos revisar la distribución?', reply = 'Podemos evaluar cómo prefieren distribuirse.'
  const mock = sequence(candidate(current, reply), { ...pass, question: {}, sentence_inventory: [] }, pass)
  const result = await completeTurnReply(input(current, reply), mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'review'])
  assert.deepEqual(result.audit.repair_attempts, [])
})

test('editorial preferences are outside factual review and never veto a supported answer', async () => {
  const current = '¿Podemos evaluar las distribuciones?', reply = 'Podemos revisarlas según sus necesidades.'
  const mock = sequence(candidate(current, reply), (rules, _context, schema) => {
    assert.match(rules, /No evalúe estilo/)
    assert.equal(schema.properties.question_has_purpose, undefined)
    return pass
  })
  const result = await completeTurnReply(input(current, reply), mock.generate)
  checked(result, reply)
  assert.deepEqual(result.audit.editorial_observations, [])
})

test('a greeting does not acquire catalogue assertions from a populated evidence catalogue', async () => {
  const current = 'Gracias, soy Carlos', reply = 'Mucho gusto, Carlos.'
  const mock = sequence(candidate(current, reply), (_rules, context) => {
    assert.equal(context.borrador, reply)
    return pass
  })
  checked(await completeTurnReply(input(current, reply, { catalogo: [{ id: 'd202', category: 'departamento', published_commercial_price: 210000 }] }), mock.generate), reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('persistent invalid review uses bounded recovery without constructing a catalogue-list answer', async () => {
  const current = '¿Será cómodo para mi familia?', reply = 'Podemos evaluar las distribuciones según sus necesidades.'
  const bad = { review_contract: 'old-contract', verdict: 'pass', findings: [] }
  const mock = sequence(candidate(current, reply), bad, bad, candidate(current, reply), bad, bad)
  const result = await completeTurnReply(input(current, 'Departamento 202 y penthouse 602: tres dormitorios.'), mock.generate)
  assert.equal(result.audit.status, 'rejected_review')
  assert.equal(result.reply, reply)
  assert.equal(result.audit.recovery.base_used, false)
  assert.throws(() => requireReviewedResponse(result.audit), /RESPONSE_REVIEW_EXHAUSTED/)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'review', 'writing', 'review', 'review'])
})

test('quality omissions remain writer responsibilities instead of reviewer content findings', async () => {
  const current = '¿Será cómodo para mi familia?', reply = 'Tenemos opciones de vivienda.'
  const mock = sequence(candidate(current, reply), (_rules, _context, schema) => {
    const categories = schema.properties.findings.items.properties.category.enum
    assert.deepEqual(categories, ['hard_fact', 'business_guardrail', 'unsupported_policy'])
    assert.equal(schema.properties.all_requests_considered, undefined)
    return pass
  })
  checked(await completeTurnReply(input(current, reply), mock.generate), reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('conditional household-distribution advice permits digits and words without property guarantees', async () => {
  const current = 'Somos seis, ¿podría funcionar para nuestra familia?'
  for (const count of ['2', 'dos']) {
    const reply = `Podrían distribuirse de a ${count} por habitación, si les resulta cómodo; podemos evaluar sus preferencias.`
    const mock = sequence(candidate(current, reply), pass)
    checked(await completeTurnReply(input(current, reply), mock.generate), reply)
  }
})

test('operational wording reaches semantic AI review instead of a code verb blacklist', () => {
  const reply = 'Hemos registrado su solicitud.'
  assert.deepEqual(turnCompletenessIssues(input('Quiero solicitar una visita', reply), reply), [])
  assert.deepEqual(turnCompletenessIssues(input('Quiero solicitar una visita', reply, {}, { registration_verified: true, action: 'submitted' }), reply), [])
})

test('scoped exact area endpoints reach the reviewer with their unit groups and preserve confirmed profile state', async () => {
  const current = 'Cuénteme de los departamentos', reply = 'Los de dos dormitorios tienen áreas desde 109,69 m²; los de tres llegan hasta 120,83 m².'
  const units = [{ id: 'd201', category: 'departamento', bedrooms: 2, area_internal_m2: 109.69 },
    { id: 'd301', category: 'departamento', bedrooms: 2, area_internal_m2: 115.04 }, { id: 'd202', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 }]
  const mock = sequence((_rules, context) => {
    assert.equal(context.contrato_redaccion.estado_comercial.datos_confirmados.nombre, 'Nathaly Caballero')
    assert.deepEqual(context.contrato_redaccion.estado_comercial.datos_a_pedir, [])
    return candidate(current, reply)
  }, (_rules, context) => {
    assert.ok(context.fuentes_autorizadas.unidades.some(unit => unit.area_internal_m2 === 109.69))
    assert.ok(context.fuentes_autorizadas.unidades.some(unit => unit.area_internal_m2 === 120.83))
    return pass
  })
  const result = await completeTurnReply(input(current, reply, { catalogo: units,
    perfil_lead: { full_name: 'Nathaly Caballero', residence_city: 'Cuenca', residence_status: 'confirmed',
      sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Nathaly Caballero' } } }, estado_conversacion: { brochure_sent: true } }), mock.generate)
  checked(result, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review'])
})

test('review-envelope retry preserves the draft and does not treat its question as an unsupported fact', async () => {
  const current = 'Quisiera información del proyecto', reply = 'El proyecto está en Cuenca. ¿Qué le gustaría conocer?'
  const question = { text: '¿Qué le gustaría conocer?', purpose: 'clarify_request', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }
  const mock = sequence(candidate(current, reply, { question }), { ...pass, claims: [] }, pass)
  const result = await completeTurnReply(input(current, reply, { proyecto: { city: 'Cuenca' } }), mock.generate)
  checked(result, reply)
  assert.equal(result.audit.question.text, question.text)
  assert.equal(mock.calls[2][1].borrador, reply)
  assert.deepEqual(tasks(mock), ['writing', 'review', 'review'])
})

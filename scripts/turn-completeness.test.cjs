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
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '' }
const covered = (fragment, base_status = 'answered', status = 'answered') => ({ fragment, intent: 'Responder la solicitud actual', request_type: ['clarification', 'outside_scope'].includes(status) ? status : 'specific_fact', base_status, status, evidence: 'Respuesta verificada' })
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true, operational_goal_preserved: true, question_has_purpose: true, missing_fact_fragments: [], factual_values: [] }

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
  assert.equal(swapped.reply, input.baseReply)
  const unsupported = await completeTurnReply(input, model(candidate, { ...review, claims: [{ ...claim, verdict: 'unsupported' }] }).generate)
  assert.equal(unsupported.audit.status, 'rejected_review')
  const unanswered = await completeTurnReply(input, model(candidate, { ...review, all_requests_considered: false }).generate)
  assert.equal(unanswered.audit.status, 'rejected_review')
})

test('opening decision preserves base courtesy and removes actual repetitions before writing', async () => {
  const input = { current: 'Quiero información', baseReply: 'Claro que sí, con mucho gusto. Tenemos departamentos.', verified: {} }
  const candidate = { reply: 'Tenemos departamentos.', requests: [covered(input.current)], question: noQuestion }
  const result = await completeTurnReply(input, model(candidate, approved).generate)
  assert.equal(result.reply, input.baseReply)
  const repeated = await completeTurnReply({ ...input, history: [{ role: 'bot', content: 'Claro que sí, con mucho gusto. Le ayudo.' }] }, model(candidate, approved).generate)
  assert.equal(repeated.reply, 'Tenemos departamentos.')
  assert.equal(repeated.audit.opening_decision.removed_repetition, true)
})

test('semantic review records evidence and rejects neutral or unsupported claims without another model call', async () => {
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
    assert.equal(rejected.reply, input.baseReply)
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
  assert.ok(!mock.calls[0][1].respuesta_base.includes('310.000'))
  const repaired = await completeTurnReply(input, model(candidate(good.replace('550.000', '999.000')), candidate(good), approved).generate)
  assert.equal(repaired.reply, good)
  assert.equal(repaired.audit.repair_attempts.length, 1)
  const rejected = await completeTurnReply(input, model(candidate(good.replace('550.000', '999.000')), candidate(good.replace('550.000', '999.000'))).generate)
  assert.equal(rejected.audit.status, 'rejected_guard')
  assert.match(rejected.reply, /550[.,]000/)
  assert.doesNotMatch(rejected.reply, /310[.,]000|999[.,]000/)
})
test('invalid coverage records exact field and expectation without accepting the draft', async () => {
  const input = { current: 'Prefiero los departamentos', baseReply: 'Respuesta base.', verified: {} }
  const cases = [
    { requests: [covered('prefiero los departamentos')], question: noQuestion, field: 'requests[0].fragment' },
    { requests: null, question: noQuestion, field: 'requests:' },
    { requests: [covered(input.current)], question: { ...noQuestion, purpose: 'invented' }, field: 'question.purpose' },
    { requests: [covered(input.current)], question: { ...noQuestion, next_decision: null }, field: 'question.next_decision' },
    { requests: [{ ...covered(input.current), status: 'invented' }], question: noQuestion, field: 'requests[0].status' },
  ]
  for (const { field, ...metadata } of cases) {
    const candidate = { reply: 'Redacción propuesta.', ...metadata }
    const mock = model(candidate, candidate)
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.audit.status, 'invalid_coverage')
    assert.equal(result.reply, input.baseReply)
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
  const generate = async (...args) => { calls.push(args); const next = answers[calls.length - 1]; if (next instanceof Error) throw next; return next }
  return { generate, calls }
}

test('Carlos catalogue metadata is repaired without changing his final answer or question', async () => {
  const current = 'Lo que yo quisiera es un departamento de 5 dormitorios.'
  const question = { text: '¿Le gustaría revisar las alternativas disponibles?', purpose: 'permission_to_continue', missing_datum: 'Aceptación', next_decision: 'Mostrar alternativas' }
  const baseReply = 'Actualmente no contamos con departamentos de 5 dormitorios. Tenemos departamentos de 3 dormitorios, hasta 120,83 m² interiores, y penthouses de 3 dormitorios, hasta 142,09 m² interiores. ' + question.text
  const reply = baseReply.replace('Actualmente', 'En este momento')
  const input = { current, baseReply, verified: {}, audit: { source: 'catalog_search', verified_catalog: true } }
  const invalid = { reply, requests: [covered(current), covered(question.text)], question }
  const valid = { reply, requests: [covered(current)], question }
  const mock = model(invalid, valid, approved)
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

test('metadata repair keeps factual guards and cannot rewrite the draft', async () => {
  const input = { current: 'Quiero información', baseReply: 'Tenemos departamentos.', verified: {} }
  for (const reply of ['Tenemos departamentos de 999 m².', 'Tenemos departamentos. https://inventado.example/ficha']) {
    const invalid = { reply, requests: [covered('Pregunta del bot')], question: noQuestion }
    const valid = { reply, requests: [covered(input.current)], question: noQuestion }
    const mock = model(invalid, valid)
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.audit.status, 'rejected_guard')
    assert.equal(result.reply, input.baseReply)
    assert.equal(mock.calls.length, 2)
  }
  const mock = model({ reply: input.baseReply, requests: [], question: {} },
    { reply: 'Otra respuesta.', requests: [covered(input.current)], question: noQuestion })
  const result = await completeTurnReply(input, mock.generate)
  assert.deepEqual(result.audit.issues, ['metadata_repair_changed_reply'])
  assert.equal(result.reply, input.baseReply)
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
  assert.equal(result.reply, input.baseReply)
  assert.equal(result.audit.repair_attempts[0].final_status, 'unavailable')
  assert.equal(mock.calls.length, 2)
})

test('final writer receives a route-specific contract for information, price and financing', async () => {
  for (const [source, baseReply, extra] of [
    ['project_overview', 'Conozca La Vilet: https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf', {}],
    ['unit_price', 'El precio es $250.000.', { verified_price_only: true }],
    ['financing_question', 'Podemos orientarle con Banco Pichincha.', {}],
  ]) {
    const mock = model({ reply: baseReply, requests: [covered('Quiero conocer las opciones')], question: noQuestion })
    const result = await completeTurnReply({ current: 'Quiero conocer las opciones', baseReply, verified: {}, audit: { source, ...extra } }, mock.generate)
    const contract = mock.calls[0][1].contrato_redaccion
    assert.equal(contract.ruta, source)
    assert.equal(contract.decisiones_protegidas, source !== 'project_overview')
    assert.deepEqual(result.audit.writer_contract, contract)
    assert.equal(result.reply, baseReply)
    if (source === 'project_overview') assert.equal(contract.enlaces_obligatorios.length, 1)
    if (source === 'unit_price') assert.ok(contract.cifras_obligatorias.includes('250.000'))
  }
})

test('protected route allows natural wording but rejects changing the next question', async () => {
  const baseReply = 'Tenemos alternativas. ¿Qué planta prefiere?'
  const question = { text: '¿Qué planta prefiere?', purpose: 'choose_property', missing_datum: 'Planta', next_decision: 'Filtrar alternativas' }
  const input = { current: 'Quiero ver alternativas', baseReply, verified: {}, audit: { source: 'property_floor_options' }, preserveOperationalQuestion: true }
  const draft = 'Con gusto le mostramos las alternativas. ¿Qué planta prefiere?'
  const mock = model({ reply: draft, requests: [covered(input.current)], question }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, draft)
  assert.equal(result.changed, true)
  const changed = 'Tenemos alternativas. ¿Cuál es su presupuesto?'
  const bad = model({ reply: changed, requests: [covered(input.current)], question: { ...question, text: '¿Cuál es su presupuesto?' } })
  const rejected = await completeTurnReply(input, bad.generate)
  assert.equal(rejected.reply, baseReply)
  assert.ok(rejected.audit.issues.includes('protected_question_changed'))
})

test('visit rewrite missing the date keeps the complete base instead of splicing duplicate hours', async () => {
  const current = 'Me parece bien mañana a las 4 de la tarde'
  const baseReply = 'Revisaremos la disponibilidad para mañana, viernes 18 de septiembre a las 4 p. m. en nuestra oficina. Le avisaremos cuando el equipo confirme el horario.'
  const candidate = 'Hemos recibido su preferencia para mañana a las 4 p. m. en nuestra oficina. Le avisaremos cuando el equipo confirme.'
  const mock = model({reply:candidate,requests:[covered(current)],question:noQuestion},approved)
  const result = await completeTurnReply({current,baseReply,verified:{},audit:{source:'visit_intake'}},mock.generate)
  assert.equal(result.reply,baseReply)
  assert.equal(result.audit.status,'rejected_guard')
  assert.equal((result.reply.match(/4 p\. m\./g)||[]).length,1)
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
  assert.equal(result.reply, baseReply)
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
  const mock = model({ reply: input.baseReply, requests: [covered('Sí ayúdeme en el financiamiento'), covered('el local lo quiero para rentarlo, influye?', 'missing_fact', 'missing_fact')], question })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.changed, false)
  assert.equal(mock.calls.length, 1)
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

test('an obsolete denial cannot leave the client without a response when the reviewer fails', async () => {
  const result = await completeTurnReply({current:'¿Qué opciones tengo?',baseReply:'No ofrecemos crédito directo.',verified:{}},async()=>{throw Error('offline')})
  assert.match(result.reply,/qué opciones le gustaría revisar/)
  assert.equal(result.needsAdvisor,false)
})

test('unknown concrete facts preserve answered information and return only missing fragments', async () => {
  const input = { current: 'Qué precio tiene el 202? Tiene certificación acústica?', baseReply: 'El departamento 202 tiene un valor referencial de $250.000.', verified: {} }
  const reply = 'El departamento 202 tiene un valor referencial de $250.000. La certificación acústica necesita verificarse.'
  const mock = model({ reply, requests: [covered('Qué precio tiene el 202?'), covered('Tiene certificación acústica?', 'missing_fact', 'missing_fact')], question: noQuestion }, { ...approved, missing_fact_fragments: ['Tiene certificación acústica?'] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, ['Tiene certificación acústica?'])
  assert.ok(result.reply.startsWith(input.baseReply))
})

test('invented historical fragments and fictitious URLs never pass source validation', async () => {
  const input = { current: 'Qué incluye el 202?', baseReply: 'El 202 tiene balcón.', verified: {} }
  const invalid = { reply: input.baseReply, requests: [covered('Quiero una cita mañana')], question: noQuestion }
  const invented = model(invalid, invalid)
  assert.equal((await completeTurnReply(input, invented.generate)).audit.status, 'invalid_coverage')
  const badLink = model({ reply: input.baseReply + ' https://inventado.example/202', requests: [covered(input.current)], question: noQuestion })
  const result = await completeTurnReply(input, badLink.generate)
  assert.equal(result.reply, input.baseReply)
  assert.deepEqual(result.audit.issues, ['links_changed'])
  assert.equal(badLink.calls.length, 1)
})

test('prices and operational questions cannot be silently replaced', () => {
  const input = { current: 'Quisiera visitar el 202.', baseReply: 'El 202 cuesta $250.000. ¿Qué fecha le vendría bien?', verified: { price: 300000 }, preserveOperationalQuestion: true }
  const issues = turnCompletenessIssues(input, 'El 202 cuesta $300.000.', noQuestion)
  assert.ok(issues.includes('numbers_changed'))
  assert.ok(issues.includes('operational_question_omitted'))
  assert.ok(turnCompletenessIssues(input, 'Ya hemos confirmado su cita para el 202 de $250.000.', noQuestion).includes('new_operational_claim'))
})

test('a URL query is not mistaken for a client-facing question and verified catalogue prices can be formatted', () => {
  const input = { current: 'Ubicación y precio?', baseReply: 'Mapa: https://maps.google.com/?q=Cuenca', verified: { price: 250000 } }
  assert.deepEqual(turnCompletenessIssues(input, 'El precio es $250.000. Mapa: https://maps.google.com/?q=Cuenca', noQuestion), [])
})

test('a meaningless question and unverified income claim are rejected by independent review without retries', async () => {
  const input = { current: 'El local es para rentarlo, eso influye en el crédito?', baseReply: 'Podemos revisar las opciones.', verified: {} }
  const reply = 'Los ingresos futuros por renta respaldan el crédito.'
  const mock = model({ reply, requests: [covered(input.current, 'missing_fact')], question: noQuestion }, { ...approved, answers_supported: false })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, input.baseReply)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.equal(result.needsAdvisor, true)
  assert.equal(mock.calls.length, 1)
})

test('optional CTA purpose failure does not generate an urgent handoff', async () => {
  const input = { current: 'Qué productos tienen?', baseReply: 'Tenemos suites, departamentos y locales comerciales.', verified: {} }
  const mock = model({ reply: input.baseReply + ' ¿Qué opina?', requests: [covered(input.current)], question: { text: '¿Qué opina?', purpose: 'none', missing_datum: '', next_decision: '' } })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'rejected_guard')
})

test('provider errors preserve the verified base without pretending that an advisor was notified', async () => {
  const input = { current: 'Sí, con JEP', baseReply: 'Continuamos con Cooperativa JEP. ¿Cuál es su nombre completo?', verified: {} }
  const mock = model(new Error('provider unavailable'))
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, input.baseReply)
  assert.equal(result.changed, false)
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.status, 'unavailable')
})

test('preserves a numeric base sentence before reviewing a helpful addition', async () => {
  const input = { current: 'Qué opciones y precios tienen?', baseReply: 'Tenemos departamentos de 2 o 3 dormitorios.', verified: { price_range: '$250.000 a $550.000' } }
  const mock = model({ reply: 'Los valores referenciales van de $250.000 a $550.000.', requests: [covered(input.current, 'unanswered')], question: noQuestion }, approved)
  const result = await completeTurnReply(input, mock.generate)
  assert.ok(result.reply.startsWith(input.baseReply))
  assert.match(result.reply, /250\.000 a \$550\.000/)
  assert.equal(mock.calls[1][1].respuesta_propuesta, result.reply)
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
  assert.match(result.reply, /Banco Pichincha o Cooperativa JEP/)
  assert.match(result.reply, /¿Con cuál entidad desea continuar\?/)
  assert.match(result.reply, /evaluación financiera debe revisarlo la entidad/)
  assert.equal(result.needsAdvisor, true)
  assert.equal(result.changed, true)
  assert.equal(result.audit.unsupported_rental_claim_removed, true)
  assert.ok(result.unresolved.every(fragment => current.includes(fragment)))
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
  return { current, baseReply: planned.reply, verified: { catalogo }, audit: planned.audit }
}

test('a complete catalogue comparison contradicts an erroneous missing-fact claim without a handoff', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: input.baseReply, requests: [{ ...covered(input.current, 'missing_fact', 'missing_fact'), fact_key: 'catalog_comparison' }], question: noQuestion })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.equal(result.audit.handoff_assessments[0].outcome, 'answered_by_catalog')
})

test('catalogue coverage never hides an additional missing pet policy', async () => {
  const comparison = 'cual es la diferencia entre cada uno?'
  const missing = 'Aceptan mascotas?'
  const input = comparisonTurn(comparison + ' ' + missing)
  const mock = model({ reply: input.baseReply + ' La política de mascotas debe verificarse.', requests: [
    { ...covered(comparison, 'missing_fact', 'missing_fact'), fact_key: 'catalog_comparison' },
    { ...covered(missing, 'missing_fact', 'missing_fact'), fact_key: 'policy' },
  ], question: noQuestion }, { ...approved, missing_fact_fragments: [missing] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [missing])
  assert.deepEqual(result.audit.missing_fact_fragments, [missing])
})

test('a rejected rewrite cannot turn an unanswered fact into a request for an advisor', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: input.baseReply + ' Tiene 999 m² interiores.', requests: [covered(input.current, 'unanswered', 'missing_fact')], question: noQuestion })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(result.reply, input.baseReply)
  assert.equal(result.audit.status, 'rejected_guard')
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.draft_rejected, true)
})

test('independent reviewer fragments are recorded and checked against catalogue evidence', async () => {
  const input = comparisonTurn()
  const mock = model({ reply: 'Estas son las diferencias. ' + input.baseReply, requests: [covered(input.current)], question: noQuestion },
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
  const mock = model({ reply: input.baseReply, requests: [covered(comparison)], question: noQuestion },
    { ...approved, all_requests_considered: false, missing_fact_fragments: [missing] })
  const result = await completeTurnReply(input, mock.generate)
  assert.equal(mock.calls.length, 2)
  assert.equal(result.audit.independent_review, true)
  assert.equal(result.needsAdvisor, true)
  assert.deepEqual(result.unresolved, [missing])
  assert.equal(result.audit.status, 'rejected_review')
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


test('reviewer repairs nonliteral evidence once without rewriting the commercial draft', async () => {
 const current='Y no tiene algo de 5 habitaciones?';
 const reply='No tenemos viviendas de 5 dormitorios. Los departamentos ofrecen hasta 120,83 m2 interiores.';
 const input={ current, baseReply:'No tenemos viviendas de 5 dormitorios. Departamentos: 120,83 m2 interiores.', audit:{semantic_review_enabled:true}, verified:{catalogo:[{id:'d',area_internal_m2:120.83}]} };
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const fact={unit_id:'d',field:'area_internal_m2',value:120.83,fragment:'Departamentos: 120,83 m2 interiores.'};
 const review={...approved,claims:[{fragment:reply,subject:'alternativas',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],factual_values:[fact]};
 for(const success of [true,false]) {
  const responses=[candidate,review,{...review,factual_values:[{...fact,fragment:success?'Los departamentos ofrecen hasta 120,83 m2 interiores.':fact.fragment}]}];
  let calls=0;
  const result=await completeTurnReply(input,async()=>responses[calls++]);
  assert.equal(calls,3,JSON.stringify(result.audit));
  assert.equal(result.reply,success?reply:input.baseReply);
  assert.equal(result.audit.status,success?'checked':'rejected_review');
  assert.equal(result.audit.repair_attempts[0].target,'review_metadata');
  assert.equal(result.audit.repair_attempts[0].issues[0].code,'review_fragment_not_in_reply');
 }
 const responses=[candidate,review,{...review,factual_values:[]}];let calls=0;
 const omitted=await completeTurnReply(input,async()=>responses[calls++]);
 assert.equal(omitted.audit.status,'rejected_review');
 assert.equal(calls,3);
});

test('optional new opening survives but repeated opening is removed and capitalized',async()=>{
 const current='Si claro, muchas gracias';const baseReply='Tenemos departamentos.';
 const candidate={reply:'Perfecto, gracias a usted. Tenemos departamentos.',requests:[covered(current)],question:noQuestion};
 const accepted=await completeTurnReply({current,baseReply,verified:{}},model(candidate,approved).generate);
 assert.equal(accepted.reply,candidate.reply);
 const repeated=await completeTurnReply({current,baseReply,verified:{},history:[{role:'bot',content:'Perfecto, le ayudo.'}]},model(candidate,approved).generate);
 assert.equal(repeated.reply,'Gracias a usted. Tenemos departamentos.');
});

test('unit numbers used as internal IDs are explained and do not trigger unsupported repair', async () => {
 const current='que opciones tiene para familia';
 const baseReply='Tenemos penthouses de 2 dormitorios.';
 const reply='Puede revisar penthouses de 2 dormitorios.';
 const candidate={reply,requests:[covered(current)],question:noQuestion};
 const review={...approved,claims:[{fragment:reply,subject:'penthouses',polarity:'affirmation',verdict:'supported',evidence:'catalogo',evidence_source:'verified_context'}],
  factual_values:[{unit_id:'603',field:'bedrooms',value:2,fragment:'penthouses de 2 dormitorios'}]};
 let calls=0;
 const result=await completeTurnReply({current,baseReply,audit:{semantic_review_enabled:true},verified:{catalogo:[{id:'uuid603',unit_number:'603',bedrooms:2}]}},async()=>[candidate,review][calls++]);
 assert.equal(calls,2);
 assert.equal(result.reply,baseReply);
 assert.equal(result.audit.semantic_review.validation_details[0].reason,'unit_id_not_in_catalog');
 assert.equal(result.audit.semantic_review.validation_details[0].expected_unit_id,'uuid603');
 assert.equal(result.audit.semantic_review.repair_eligibility.reason,'error_not_supported_by_repair_policy');
 assert.equal(result.audit.repair_attempts.length,0);
});

test('historical reviewer references expose only implicated units from the same saved contract', () => {
 const {reviewReferenceSnapshot}=require('../src/lib/integrations/automation/semantic-review.ts');
 assert.deepEqual(reviewReferenceSnapshot({}),[]);
 const snapshot=reviewReferenceSnapshot({turn_completeness:{semantic_review:{validation_details:[{unit_id:'603'}]},
  writer_contract:{hechos_protegidos:[{id:'uuid603',unit_number:'603',category:'penthouse',private:'not exposed'}, {id:'uuid604',unit_number:'604'}]}}});
 assert.deepEqual(snapshot,[{id:'uuid603',unit_number:'603',category:'penthouse'}]);
});

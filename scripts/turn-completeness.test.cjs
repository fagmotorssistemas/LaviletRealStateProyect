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
const noQuestion = { text: '', purpose: 'none', missing_datum: '', next_decision: '' }
const covered = (fragment, base_status = 'answered', status = 'answered') => ({ fragment, intent: 'Responder la solicitud actual', request_type: ['clarification', 'outside_scope'].includes(status) ? status : 'specific_fact', base_status, status, evidence: 'Respuesta verificada' })
const approved = { all_requests_considered: true, answers_supported: true, answered_content_preserved: true, operational_goal_preserved: true, question_has_purpose: true, missing_fact_fragments: [] }
function model(...answers) {
  const calls = []
  const generate = async (...args) => { calls.push(args); const next = answers[calls.length - 1]; if (next instanceof Error) throw next; return next }
  return { generate, calls }
}

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
  const invented = model({ reply: input.baseReply, requests: [covered('Quiero una cita mañana')], question: noQuestion })
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

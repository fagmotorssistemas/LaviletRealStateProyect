const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
require('./test-typescript.cjs')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
const { financingInputs, isFinancingTurn, financingQuestionReply, hasAffordabilityConcern } = require('../src/lib/integrations/automation/financing.ts')
const context = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
const offer = 'Podemos explorar opciones con Banco Pichincha o Cooperativa JEP. ¿Le gustaría que le ayudemos a iniciar la revisión con alguna de estas entidades para su caso?'

test('the reported natural acceptance grants review consent and preserves the chosen lender', () => {
  for (const message of [
    'si, quisiera hacer la prueba conb la cooperativa jep',
    'Sí, quisiera hacer la prueba con la cooperativa JEP',
    'Quiero iniciar la revisión con JEP',
    'Me gustaría probar con la JEP',
    'Hagamos la revisión con JEP',
  ]) {
    const input = financingInputs({}, message, offer, context)
    assert.equal(input.consent, true, message)
    assert.equal(input.partner, 'Cooperativa JEP', message)
    assert.equal(isFinancingTurn({}, message, offer, input), true, message)
  }
  assert.equal(financingInputs({}, 'Deseo iniciar la evaluación con Pichincha', offer, context).partner, 'Banco Pichincha')
})

test('a contextual GEP typo resolves only to the publicly available JEP option already discussed', () => {
  const message = 'Quiero hacer la prueba con la gep'
  const input = financingInputs({}, message, offer, context)
  assert.deepEqual(input, { consent: true, partner: 'Cooperativa JEP', unsupported: '' })
  assert.equal(financingInputs({}, message, '¿Qué vivienda busca?', context).partner, null)
  assert.equal(financingInputs({}, message, offer, { partners: ['Banco Pichincha'], current: {} }).partner, null)
})

test('lender choice, uncertainty, conditions and questions alone never authorize an application', () => {
  for (const message of [
    'Con la JEP',
    'No gracias',
    'Sí, pero con crédito directo',
    'Sí, solo si me aprueban',
    '¿Puedo hacer la prueba con JEP?',
    'No sé si me alcanza',
    'No quiero iniciar la revisión con JEP',
  ]) assert.notEqual(financingInputs({}, message, offer, context).consent, true, message)
  assert.equal(financingInputs({ financing_consent: true }, 'No sé si me alcanza', offer, context).consent, null)
  assert.equal(financingInputs({ financing_consent: true }, 'Con la JEP', offer, context).consent, null)
  assert.equal(financingInputs({ financing_consent: true }, 'Sí', '¿Le gustaría revisar el modelo del departamento?', context).consent, null)
})

test('a verified natural finance step accepts yes while a later visit question does not inherit that consent', () => {
  const last = 'Podemos acompañarle con Cooperativa JEP. ¿Desea avanzar?'
  const step = { kind: 'financing_consent', reply: last }
  assert.equal(financingInputs({}, 'Sí, por supuesto', last, context, step).consent, true)
  assert.equal(financingInputs({}, 'Sí, por supuesto', '¿Le gustaría visitar nuestra oficina?', context, step).consent, null)
})

test('budget worries are recognized without being confused with price ranges or sufficient savings', () => {
  for (const message of [
    'A mí me gustaría comprar algo pero no sé si me alcanza',
    'No sé si puedo comprar un departamento',
    'No estoy segura de que pueda pagarlo',
    'No nos alcanza para comprarlo',
    'Se me sale del presupuesto',
    'No tengo dinero suficiente',
    'No puedo pagarlo',
  ]) assert.equal(hasAffordabilityConcern(message), true, message)
  for (const message of ['Tengo presupuesto de 300 mil', 'Sí me alcanza', '¿Cuánto valen las suites?', 'No sé cuántos dormitorios quiero']) {
    assert.equal(hasAffordabilityConcern(message), false, message)
  }
})

test('direct credit and eligibility in one turn both receive an answer without approval claims', () => {
  const message = 'Además tengo dos vehículos y cómo funciona el financiamiento, qué necesito para saber si soy elegible\nY tienen crédito directo?'
  const reply = financingQuestionReply(message, context.partners)
  assert.match(reply, /No ofrecemos crédito directo/)
  assert.match(reply, /Banco Pichincha.*Cooperativa JEP/)
  assert.match(reply, /ingresos y capacidad de pago/)
  assert.match(reply, /requisitos de la entidad/)
  assert.doesNotMatch(reply, /aprobado|aprobación garantizada|ya enviamos|cédula|estados de cuenta/)
})

test('questions about the process offer a next step without collecting identifiers before consent', () => {
  for (const message of ['¿Qué necesito para un crédito?', '¿Cómo funciona el financiamiento?', '¿Cómo puedo saber si soy elegible?']) {
    const reply = financingQuestionReply(message, context.partners)
    assert.match(reply, /ingresos y capacidad de pago/)
    assert.match(reply, /iniciar la revisión/)
    assert.doesNotMatch(reply, /indica.*cédula|envíe.*documentos|está aprobado/)
    assert.equal(financingInputs({}, 'Sí, quisiera hacer la prueba con JEP', reply, context).consent, true)
  }
})

test('an approval guarantee question and unrelated commercial questions keep their separate meaning', () => {
  assert.match(financingQuestionReply('¿Me garantizan la aprobación del crédito?', context.partners), /no podemos asegurar la aprobación/)
  assert.equal(financingQuestionReply('¿Pueden guardar mis dos vehículos?', context.partners), '')
  assert.equal(financingQuestionReply('¿Cuál es la ubicación?', context.partners), '')
  assert.equal(financingQuestionReply('¿Aceptan mascotas?', context.partners), '')
})

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { commercialTurnTopics, missingCommercialTopics, commercialCoverageIssues } = require('../src/lib/integrations/automation/multi-topic-turn.ts')
const { asksUnitPrice } = require('../src/lib/integrations/automation/price-reply.ts')
const { hasAffordabilityConcern } = require('../src/lib/integrations/automation/financing.ts')

const propertyHistory = [{ role: 'cliente', content: 'Quiero un departamento' }, { role: 'bot', content: 'Ofrecemos suites, departamentos y locales comerciales.' }]

test('the complete turn retains options, uncertain affordability and the singular price request', () => {
  const current = 'Entiendo y qué opciones tiene? A mí me gustaría comprar algo pero no sé si me alcanza\nCuál es el valor de los departamentos?'
  const topics = commercialTurnTopics(current, propertyHistory)
  assert.deepEqual(topics, ['price', 'options', 'affordability'])
  assert.equal(asksUnitPrice(current), true)
  assert.deepEqual(missingCommercialTopics('Podemos comparar departamentos de 2 o 3 dormitorios para ver cuál se adapta a lo que busca.', topics), ['price', 'affordability'])
  assert.deepEqual(commercialCoverageIssues('Contamos con suites y departamentos desde $220.000 USD. Si lo necesita, podemos acompañarle a revisar opciones con Banco Pichincha o Cooperativa JEP.', topics), [])
})

test('direct credit does not absorb the separate questions about the map and owned cars', () => {
  const current = 'Esa ubicación de qué es?\nAdemás tengo dos vehículos, y cómo funciona el financiamiento, qué necesito para saber si soy elegible\nY tienen crédito directo?'
  const topics = commercialTurnTopics(current, propertyHistory)
  assert.deepEqual(topics, ['parking', 'location', 'financing'])
  assert.deepEqual(missingCommercialTopics('No ofrecemos crédito directo. Podemos revisar opciones con Banco Pichincha o Cooperativa JEP.', topics), ['parking', 'location'])
  assert.deepEqual(missingCommercialTopics('La ubicación corresponde al terreno y a nuestra oficina en Puertas del Sol. Contamos con estacionamientos; verificaremos la cantidad para la unidad. No ofrecemos crédito directo, pero le acompañamos a revisar opciones con JEP.', topics), [])
})

test('pets and commercial property prices remain separate obligations', () => {
  assert.deepEqual(commercialTurnTopics('Qué valor tienen los locales? Tengo mascotas, aceptan mascotas?', propertyHistory), ['price', 'pets'])
  assert.deepEqual(missingCommercialTopics('Los locales parten desde $145.000 USD.', ['price', 'pets']), ['pets'])
})

test('explicit unrelated vehicle purchases do not become commercial questions', () => {
  assert.deepEqual(commercialTurnTopics('Qué precio tiene una moto y la financian?', propertyHistory), [])
})

test('financing and schedule options do not require inventing a housing catalog response', () => {
  assert.deepEqual(commercialTurnTopics('Qué opciones de financiamiento con JEP tienen?', propertyHistory), ['financing'])
  assert.deepEqual(commercialTurnTopics('Qué otras opciones de horario tienen para mañana?', propertyHistory), [])
  assert.deepEqual(commercialTurnTopics('Quiero ver las opciones de departamentos y cómo funciona el crédito', propertyHistory), ['options', 'financing'])
  assert.deepEqual(commercialTurnTopics('Precio del 502, no quiero financiamiento', propertyHistory), ['price'])
  assert.deepEqual(commercialTurnTopics('No necesito un crédito con Cooperativa JEP, cuál es el valor del departamento?', propertyHistory), ['price'])
  assert.deepEqual(commercialTurnTopics('No quiero crédito directo. Puedo revisar un crédito con JEP?', propertyHistory), ['financing'])
})

test('requested location and the follow-up asking what a sent map represents are both retained', () => {
  for (const current of ['Dónde queda?', 'Me comparte la dirección?', 'Esa ubicación de qué es?', 'Ese mapa de qué es?']) {
    assert.deepEqual(commercialTurnTopics(current, propertyHistory), ['location'], current)
  }
  for (const current of ['Busco un departamento con buena ubicación', 'Me interesa la ubicación cerca de parques', 'No me envíe la ubicación']) {
    assert.equal(commercialTurnTopics(current, propertyHistory).includes('location'), false, current)
  }
})

test('qualitative budget concerns use the same signal as financing and exclude unrelated shortages', () => {
  for (const current of ['Es muy caro', 'Me parece caro', 'Se sale de mi presupuesto', 'No tengo suficiente', 'No tenemos suficiente dinero para comprarlo', 'Se me sale del presupuesto']) {
    assert.equal(hasAffordabilityConcern(current), true, current)
    assert.equal(commercialTurnTopics(current, propertyHistory).includes('affordability'), true, current)
  }
  for (const current of ['No tengo suficiente espacio', 'No me parece caro', 'No es muy caro', 'No tenemos suficiente tiempo para ir', 'Me alcanza para comprarlo']) {
    assert.equal(hasAffordabilityConcern(current), false, current)
  }
})

test('separate financing, parking or fee questions no longer suppress an apartment price', () => {
  for (const current of [
    'Qué valor tiene el departamento? Y cuánto sería la cuota del crédito?',
    'Qué precio tienen los departamentos y cómo calculan la cuota?',
    'Cuánto cuesta la suite? Necesito parqueadero para dos autos',
    'Cuál es el valor de los departamentos?\nCuánto cuesta el mantenimiento?',
    'Precio del 502, no quiero financiamiento',
    'Cuál es el precio? No quiero financiamiento',
  ]) assert.equal(asksUnitPrice(current, true), true, current)
  for (const current of ['Cuál es el valor de la alícuota?', 'Cuánto cuesta el parqueadero?', 'Qué costo tiene el crédito?', 'Qué precio tiene la renta?', 'Me garantizan un valor de reventa?']) {
    assert.equal(asksUnitPrice(current, true), false, current)
  }
})

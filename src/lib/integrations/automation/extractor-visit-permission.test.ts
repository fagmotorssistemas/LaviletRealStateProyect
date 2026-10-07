import test from 'node:test'
import assert from 'node:assert/strict'
import { explicitlyRequestsVisit, visitRequestPermissionVeto } from './turn-routing'

const refused = [
  'No agendar una visita por ahora',
  'No programar una cita',
  'No agenden una visita',
  'No me agenden una visita',
  'Nunca quiero una visita',
  'Jamás deseo visitar la oficina',
  'Tampoco quisiera coordinar una cita',
  'Ni quiero una visita ni una llamada',
  'No podemos realizar una visita',
  'No me gustaría agendar una cita',
]
for (const current of refused) test(`a denied visit cannot authorize an operational request: ${current}`, () => {
  assert.equal(explicitlyRequestsVisit(current), false)
  assert.equal(visitRequestPermissionVeto(current), true)
})

const conditional = [
  'Si bajan los precios me gustaría visitar la oficina',
  'Si bajan los precios, quiero agendar una visita',
  'Quiero agendar una visita si bajan los precios',
  'Sólo si me aprueban el crédito quiero visitar el proyecto',
  'Me gustaría una visita siempre que el precio me alcance',
  'Tal vez quisiera coordinar una visita',
  'Quizás agendemos una visita más adelante',
  'Si bajan los precios y quiero visitar la oficina, les avisaré',
]
for (const current of conditional) test(`a conditional visit is not current authorization: ${current}`, () => {
  assert.equal(explicitlyRequestsVisit(current), false)
  assert.equal(visitRequestPermissionVeto(current), true)
})

const accepted = [
  'Quiero visitar la oficina',
  'Quiero visitar la oficina pero no el edificio',
  'No quiero visitar el edificio, pero quiero agendar una visita a la oficina',
  'No quiero visitar el edificio y quiero agendar una visita a la oficina',
  'Si bajan los precios compraría; quiero visitar la oficina hoy',
  'Si me aprueban el crédito me interesaría comprar, pero quiero visitar la oficina mañana',
  'Quiero visitar la oficina; si bajan los precios compraría',
  'Sí, quiero agendar una visita',
  'si quiero agendar una visita',
  '¿Puedo hacer una visita?',
  '¿Es posible visitar la oficina?',
  'Prefiero realizar una visita',
  'Agendemos una cita por favor',
  'Quiero visitar la oficina para saber si tiene ascensor',
  'No necesito información y quiero agendar una cita',
]
for (const current of accepted) test(`an independent current visit keeps its permission: ${current}`, () => {
  assert.equal(explicitlyRequestsVisit(current), true)
  assert.equal(visitRequestPermissionVeto(current), false)
})

test('a clipped evidence quote cannot remove its governing refusal or condition', () => {
  assert.equal(visitRequestPermissionVeto('No agendar una visita por ahora', 'agendar una visita'), true)
  assert.equal(visitRequestPermissionVeto('Nunca quiero una visita', 'quiero una visita'), true)
  assert.equal(visitRequestPermissionVeto('Si bajan los precios, quiero agendar una visita', 'quiero agendar una visita'), true)
  assert.equal(visitRequestPermissionVeto('Quiero agendar una visita si bajan los precios', 'Quiero agendar una visita'), true)
})
test('a separate positive proof cannot borrow a refusal from another clause', () => {
  const current = 'No quiero visitar el edificio; quiero agendar una visita a la oficina'
  assert.equal(visitRequestPermissionVeto(current, 'quiero agendar una visita a la oficina'), false)
  assert.equal(visitRequestPermissionVeto(current, 'quiero visitar el edificio'), true)
  assert.equal(visitRequestPermissionVeto(current), false)
})
test('courtesy after a declined visit does not undo the local denial', () => {
  assert.equal(visitRequestPermissionVeto('No agenden una visita; gracias'), true)
  assert.equal(explicitlyRequestsVisit('No agenden una visita; gracias'), false)
})
test('a semantic paraphrase is not vetoed simply because the lexical request helper does not recognize it', () => {
  const current = 'Me acerco a la oficina mañana'
  assert.equal(explicitlyRequestsVisit(current), false)
  assert.equal(visitRequestPermissionVeto(current), false)
  assert.equal(visitRequestPermissionVeto(current, 'una cita inventada'), false)
})
test('information requests and unrelated booking remain outside explicit visit permission', () => {
  for (const current of ['Quiero saber los horarios de atención', 'No quiero una visita, dígame los precios',
    'Quiero agendar un vuelo', 'Ya agendé una cita ayer', '¿Qué días tiene citas?'])
    assert.equal(explicitlyRequestsVisit(current), false, current)
})

for (const quoted of ['«quiero agendar una visita»', '“quiero agendar una visita”', '"quiero agendar una visita"', "'quiero agendar una visita'"])
  test(`a third-party command cannot authorize a visit: ${quoted}`, () => {
    const current = `Mi amigo escribió ${quoted}. Yo sólo quiero saber los precios`
    assert.equal(explicitlyRequestsVisit(current), false)
    assert.equal(visitRequestPermissionVeto(current, 'quiero agendar una visita'), true)
    assert.equal(visitRequestPermissionVeto(current), true)
  })

test('an actual request outside a reported command retains only its current permission', () => {
  const current = 'Mi amigo escribió «quiero agendar una visita». Yo quiero visitar la oficina mañana'
  assert.equal(explicitlyRequestsVisit(current), true)
  assert.equal(visitRequestPermissionVeto(current, 'Yo quiero visitar la oficina mañana'), false)
  assert.equal(visitRequestPermissionVeto(current), false)
})
test('quoted destination names, emphasized infinitives and standalone quotations keep an actual request', () => {
  for (const current of ['Quiero visitar la «oficina»', "Quiero 'visitar la oficina'", '«quiero agendar una visita»',
    'Si me gustaría visitar la oficina', 'Sí me gustaría visitar la oficina']) {
    assert.equal(explicitlyRequestsVisit(current), true, current)
    assert.equal(visitRequestPermissionVeto(current), false, current)
  }
})

test('accents do not merge independent affirmative and negative predicates', () => {
  for (const current of ['No quiero visitar el edificio y me gustaría agendar una visita a la oficina',
    'Quiero visitar la oficina y jamás quiero visitar el edificio']) {
    assert.equal(explicitlyRequestsVisit(current), true, current)
    assert.equal(visitRequestPermissionVeto(current), false, current)
  }
})


test('indirect capability questions preserve current visit permission', () => {
  for (const current of ['No sé si puedo hacer una visita', 'No se si podemos visitar la oficina',
    'No estoy seguro de si es posible visitar la oficina', 'No tengo claro si podríamos coordinar una visita',
    'Me pregunto si puedo visitar la oficina']) {
    assert.equal(explicitlyRequestsVisit(current), true, current)
    assert.equal(visitRequestPermissionVeto(current), false, current)
  }
})
test('knowledge or doubt does not remove a future condition from a visit', () => {
  for (const current of ['No sé si puedo visitar la oficina si bajan los precios',
    'No estoy seguro de si me aprueban el crédito, quisiera visitar si lo aprueban',
    'Quiero saber los precios y visitar si bajan', 'No tengo claro si bajan los precios y quiero agendar una visita']) {
    assert.equal(explicitlyRequestsVisit(current), false, current)
    assert.equal(visitRequestPermissionVeto(current), true, current)
  }
})

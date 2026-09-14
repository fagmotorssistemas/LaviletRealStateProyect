const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module'), path = require('node:path'), originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { mentionsVisitLocation, withVisitLocation, locationRequestKind, locationAnswer } = require('../src/lib/integrations/automation/visit-location.ts')

const address = 'Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca'
const map = 'https://www.google.com/maps/search/?api=1&query=-2.892287,-79.030259'
const info = { modo_comercial: 'lanzamiento', proyecto: { address }, ubicacion: map }

test('catalog features, pets and price determinants do not append an unrelated map', () => {
  for (const reply of [
    'Disponemos de locales comerciales, con valores referenciales según ubicación y tamaño. Las mascotas aplican a las viviendas. ¿Le interesan los locales para su negocio o para invertir?',
    'El precio depende de la ubicación, el piso y el tamaño.',
    'Podemos revisar si el local se adapta a una oficina.',
    'La seguridad de residentes y visitantes es una prioridad.',
    'La construcción todavía no ha comenzado en el terreno.',
    'La oficina ofrece información sobre financiamiento.',
    '¿Le gustaría coordinar una visita?',
    '¿Le gustaría conocer las opciones del proyecto?',
    '¿Quiere conocer más sobre La Vilet?',
    'Podemos atenderle con información del proyecto.',
  ]) {
    assert.equal(mentionsVisitLocation(reply), false, reply)
    assert.equal(withVisitLocation(reply, info), reply, reply)
  }
})

test('real invitations with a physical destination include the verified address and map', () => {
  for (const reply of [
    '¿Le gustaría coordinar una visita a nuestra oficina para revisar el proyecto?',
    'Si desea, podemos recibirle en nuestra oficina.',
    '¿Quiere conocer el terreno donde se construirá La Vilet?',
    'Puede visitar nuestra oficina.',
    'La oficina está donde se construirá La Vilet.',
    'Podemos encontrarnos en la misma dirección del proyecto.',
    'Le esperamos.',
  ]) {
    const result = withVisitLocation(reply, info)
    assert.ok(result.includes(address), reply)
    assert.ok(result.includes(map), reply)
    assert.equal(withVisitLocation(result, info), result)
  }
})

test('canceled, unnecessary or remote visits do not append a map', () => {
  for (const reply of [
    'No hace falta visitar nuestra oficina para conocer los precios.',
    'No es necesario una visita a nuestra oficina.',
    'Su visita a nuestra oficina quedó cancelada.',
    'Podemos hacer una visita virtual.',
    '¿Le gustaría coordinar una reunión por Zoom?',
    'Si prefiere una videollamada, podemos recibirle por ese medio.',
    'Podemos coordinar una visita virtual al proyecto La Vilet.',
  ]) assert.equal(withVisitLocation(reply, info), reply, reply)
})

test('direct location requests accept conversational phrasing and batched questions', () => {
  for (const message of [
    'Ubicación', 'Ya pero dónde', '¿Dónde están?', '¿Dónde queda La Vilet?',
    'Mándeme la ubicación por favor', 'Puedes enviarme la dirección', '¿Me comparte el mapa?',
    'Quiero ver el mapa', '¿Cómo llego a la oficina?', '¿En qué sector está La Vilet?',
    '¿Aceptan mascotas?\n¿Me puede enviar la ubicación?',
    'Deme la dirección y también dígame si hay estacionamientos.',
  ]) assert.equal(locationRequestKind(message), 'request', message)
})

test('location clarification remains detectable among parking and financing questions', () => {
  for (const message of [
    'Esa ubicación de qué es?',
    '¿De qué es esa ubicación?',
    '¿Ese mapa que me envió de dónde es?',
    'Esa ubicación de que es?\nAdemás tengo dos vehículos, cómo funciona el financiamiento y tienen crédito directo?',
  ]) assert.equal(locationRequestKind(message), 'clarification', message)
  const reply = locationAnswer(info, 'clarification')
  assert.match(reply, /nuestra oficina de atención y al terreno donde se construirá La Vilet/)
  assert.ok(reply.includes(address)); assert.ok(reply.includes(map))
  assert.doesNotMatch(reply, /cita confirmada|¿/)
})

test('unit position, neighborhood questions and a refused map do not request project directions', () => {
  for (const message of [
    '¿La ubicación cambia el precio?', '¿El sector es seguro?', '¿Hay parques cerca?',
    'Quiero un departamento con buena ubicación', 'La oficina me parece muy pequeña',
    'No me envíe la ubicación', 'No quiero el mapa', 'No necesito la dirección',
  ]) assert.equal(locationRequestKind(message), null, message)
})

test('location answer uses configured facts and does not invent an address or map', () => {
  assert.equal(locationAnswer({}, 'request'), '')
  const launch = locationAnswer(info)
  assert.match(launch, /oficina de atención.*se construirá La Vilet/)
  const presale = locationAnswer({ ...info, modo_comercial: 'preventa' }, 'clarification')
  assert.match(presale, /ubicación corresponde al proyecto La Vilet/)
  assert.doesNotMatch(presale, /terreno donde se construirá/)
  assert.doesNotMatch(locationAnswer({ address, map_url: 'javascript:alert(1)' }), /javascript/)
})

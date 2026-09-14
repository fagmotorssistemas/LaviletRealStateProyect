/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner uses the repository CommonJS TypeScript loader. */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { explicitlyRequestsVisit, hasUnrelatedAppointmentTarget } = require('../src/lib/integrations/automation/turn-routing.ts')

test('permission to visit remains actionable alongside a project information request', () => {
  for (const message of [
    'Deme detalles del proyecto\nY puedo hacer una visita?',
    'Deme detalles del proyecto. ¿Y puedo hacer una visita?',
    '¿Podría realizar una visita?',
    '¿Es posible visitar la oficina?',
    'No sé si puedo hacer una visita',
    'Quisiera saber si podemos visitar el lugar',
    'Quisiera pasar por la oficina',
    'Me interesa visitar el departamento 210',
    'Quiero conocerlo en persona',
    '¿Podemos coordinar una cita?',
    'Agendemos',
    'Bueno mejor quiero reagendar para hoy',
    'Voy a llegar en vuelo y quisiera visitar el departamento 210',
    'Quiero conocer los restaurantes cerca del proyecto y puedo hacer una visita?',
  ]) assert.equal(explicitlyRequestsVisit(message), true, message)
})

test('bookings from other businesses never initiate a property appointment', () => {
  for (const message of [
    'Saludos, quiero información sobre un vuelo que agendé la semana pasada',
    'Quiero agendar un vuelo',
    'Necesito agendar una cita con el médico',
    '¿Puedo hacer una visita al dentista?',
    'Quisiera reservar una cita para revisión vehicular',
    'Quiero reservar un hotel',
    'Agendemos una visita al veterinario',
    'Quiero agendar una limpieza de alfombras',
    'Quiero programar una entrega de flores',
  ]) assert.equal(explicitlyRequestsVisit(message), false, message)
  assert.equal(hasUnrelatedAppointmentTarget('Agendemos la revisión de mi moto'), true)
  assert.equal(hasUnrelatedAppointmentTarget('¿Hay restaurantes cerca del proyecto? Y puedo hacer una visita?'), false)
})

test('a refusal, a past booking or a request about an existing appointment is not a new visit', () => {
  for (const message of [
    'No quiero una visita',
    'Tampoco me gustaría visitar',
    'No puedo ir',
    'Ya agendé una cita',
    'Quiero saber qué día es la visita',
    'Necesito revisar la cita que ya tengo',
    'Quisiera confirmar si tengo una cita',
    'Estaré puntual en la visita',
    'Allí estaré, muchas gracias',
    'Qué ofrece el departamento 210?',
  ]) assert.equal(explicitlyRequestsVisit(message), false, message)
})

test('an explicit change to a property visit is not blocked by a different earlier sentence', () => {
  for (const message of [
    'Ya no necesito el vuelo. Quiero visitar el departamento 210',
    'No quiero una cita médica, pero sí quiero visitar La Vilet',
    'No puedo ir mañana. ¿Podemos coordinar una visita el viernes?',
  ]) assert.equal(explicitlyRequestsVisit(message), true, message)
})

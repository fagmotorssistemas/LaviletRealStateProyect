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
const { acceptsVisitInvitation } = require('../src/lib/integrations/automation/sales-policy.ts')
const { visitTruthReply, visitCopyIssues } = require('../src/lib/integrations/automation/visit-copy.ts')
const { protectedSentences } = require('../src/lib/integrations/automation/turn-completeness.ts')

test('coordination acceptance recognizes conversational conjugations without historical or negative bookings',()=>{
  for(const value of ['Mejor coordinamos una visita','Entonces agendamos una cita','Programamos una visita']) assert.equal(explicitlyRequestsVisit(value),true,value)
  for(const value of ['No coordinamos una visita','Ayer coordinamos una visita','Mejor coordinamos una visita al dentista']) assert.equal(explicitlyRequestsVisit(value),false,value)
  assert.equal(acceptsVisitInvitation('Sí','¿Prefiere coordinar una visita?'),true)
  assert.equal(acceptsVisitInvitation('El sábado a las 11 puede ser','Podemos coordinar su visita. Indíqueme qué día y horario prefiere.'),true)
  assert.equal(acceptsVisitInvitation('No puedo el sábado a las 11','¿Prefiere coordinar una visita?'),false)
})
test('final visit guard protects commercial paths from physical-tour and unrecorded-request claims',()=>{
  const info={modo_comercial:'lanzamiento',politica_visitas:{launchDestination:'office'}}
  const reply=visitTruthReply('Podemos coordinar una visita para que conozca personalmente los departamentos en los pisos altos y las vistas que ofrecen. ¿Qué día prefiere?',info,{},[],protectedSentences)
  assert.match(reply,/nuestra oficina/)
  assert.doesNotMatch(reply,/conozca personalmente/)
  assert.match(reply,/Qué día prefiere/)
  const pending=visitTruthReply('Su solicitud ha quedado registrada para revisión. Pronto recibirá la confirmación final para su visita.',info,{},[],protectedSentences)
  assert.doesNotMatch(pending,/ha quedado registrada|Pronto recibirá/)
  assert.match(pending,/no puedo confirmar/)
  assert.equal(visitTruthReply('Su solicitud ha quedado registrada para revisión.',info,{registration_verified:true},[],protectedSentences),'Su solicitud ha quedado registrada para revisión.')
  assert.ok(visitCopyIssues('Revisaremos disponibilidad.','El sábado es una opción dentro de nuestro horario de atención.').includes('administrative_visit_copy'))
})

test('conversational visit requests respect context, refusals and verified receipts', () => {
  assert.equal(explicitlyRequestsVisit('prefiero hacer una visita se puede?'),true)
  for(const message of ['No prefiero hacer una visita','Prefiero hacer una visita al dentista','Prefiero ver precios antes de una visita']) assert.equal(explicitlyRequestsVisit(message),false,message)
  const previous='Si tiene una fecha y hora en mente, puede indicarla para coordinar su cita.'
  for(const message of ['que tal para el sabado a las 11 am??','Puede ser para el viernes a las 10','Para el lunes a las 11']) assert.equal(acceptsVisitInvitation(message,previous),true,message)
  for(const message of ['No puedo el sabado a las 11','que tal para el sabado el precio','que tal para el sabado a las 11 en el dentista']) assert.equal(acceptsVisitInvitation(message,previous),false,message)
  assert.equal(acceptsVisitInvitation('que tal para el sabado a las 11 am??','¿Qué presupuesto tiene?'),false)
  const draft='Tomo en cuenta su preferencia para la visita este sábado a las 11 am. El equipo revisará la disponibilidad. Le confirmaremos lo antes posible si es posible agendar.'
  const guarded=visitTruthReply(draft,{}, {},[],protectedSentences)
  assert.doesNotMatch(guarded,/Tomo en cuenta|equipo revisará|Le confirmaremos/)
  assert.match(guarded,/no puedo confirmar/)
  assert.equal(visitTruthReply(draft,{}, {registration_verified:true},[],protectedSentences),draft)
})

test('permission to visit remains actionable alongside a project information request', () => {
  for (const message of [
    'Deme detalles del proyecto\nY puedo hacer una visita?',
    'HolA QUIERO AGENDAR UNA CIRA PARA VER EL DEPARTAMENTO 202',
    'Quiero coordinar una sita para ver el departamento 202',
    'Quiero agendar para ver el departamento 202',
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
    'Quiero agendar una cira con el dentista',
  ]) assert.equal(explicitlyRequestsVisit(message), false, message)
  assert.equal(hasUnrelatedAppointmentTarget('Agendemos la revisión de mi moto'), true)
  assert.equal(hasUnrelatedAppointmentTarget('¿Hay restaurantes cerca del proyecto? Y puedo hacer una visita?'), false)
})

test('a refusal, a past booking or a request about an existing appointment is not a new visit', () => {
  for (const message of [
    'No quiero una visita',
    'No quiero agendar una cira para ver el departamento 202',
    'Quiero saber cómo agendar una cira',
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

const test = require('node:test'), assert = require('node:assert/strict')
const Module = require('node:module'), path = require('node:path'), originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { asksForHouse, houseProductReply } = require('../src/lib/integrations/automation/product-fit.ts')
const { unitPriceQuote } = require('../src/lib/integrations/automation/price-reply.ts')
const { nextDiscoveryQuestion } = require('../src/lib/integrations/automation/sdr-rules.ts')
const { visitBusinessHoursReply } = require('../src/lib/integrations/automation/visit-intake.ts')
const { asksTeamAttendance, explicitlyRequestsVisit, teamAttendanceReply } = require('../src/lib/integrations/automation/turn-routing.ts')

test('literal houses are corrected before any apartment price is quoted', () => {
  const info = { alcance_negocio: 'property', politica_comercial: { precios_autorizados: true }, catalogo: [{category:'departamento',unit_number:'202',published_commercial_price:250000}] }
  for (const current of ['Cuánto vale una casa en Cuenca?', 'Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?', 'Pero y de cuántos pisos es la casa?', '¿Venden casas?']) {
    assert.equal(asksForHouse(current), true, current)
    assert.match(houseProductReply(current), /no vendemos casas independientes/)
    assert.equal(unitPriceQuote(info,current,{}),null)
  }
  for (const current of ['Busco una vivienda', 'Quiero un nuevo hogar', 'Vendo mi casa para comprar el departamento 202', 'Trabajo desde casa y quiero dos dormitorios', 'Ya no quiero una casa; quiero el departamento 202']) assert.equal(asksForHouse(current),false,current)
})

test('literal insistence gets a different correction without repeating credit direct', () => {
  const first=houseProductReply('Quiero una casa de 300 mil')
  const second=houseProductReply('Pero cuántos pisos tiene la casa?',first)
  assert.notEqual(first,second)
  assert.match(second,/no son casas independientes/)
  assert.match(second,/planta|distribución/)
  assert.doesNotMatch(second,/crédito|Pichincha|JEP/)
})

test('each discovery question records the decision it supports, not engagement', () => {
  for (const lead of [{},{preferred_category:'local'},{preferred_category:'departamento',purchase_purpose:'vivir'},{preferred_category:'local',purchase_purpose:'negocio'}]) {
    const question=nextDiscoveryQuestion(lead)
    assert.ok(question.purpose)
    assert.doesNotMatch(question.purpose,/generar interacción|mantener conversación/)
  }
  assert.match(nextDiscoveryQuestion({preferred_category:'local'}).purpose,/no evaluar aprobación bancaria/)
})

test('attendance addressed to the team cannot become a new appointment', () => {
  const current='Saludos, oiga si va a venir a la cita el día de hoy?'
  assert.equal(asksTeamAttendance(current),true)
  assert.equal(explicitlyRequestsVisit(current),false)
  assert.match(teamAttendanceReply([],[]),/no tenemos una cita confirmada/)
  assert.doesNotMatch(teamAttendanceReply([],[]),/asistente virtual|soy|voy a ir/)
  assert.match(teamAttendanceReply([{status:'aceptado',start_time:'2026-09-21T15:00:00Z'}],[]),/confirmada.*lunes 21/)
  assert.match(teamAttendanceReply([],[{status:'awaiting_advisor'}]),/pendiente de confirmación/)
  assert.equal(asksTeamAttendance('¿Puedo ir a la visita hoy?'),false)
})

test('business hours are factual working windows and do not claim open appointment slots', () => {
  const hours={1:{open:'08:30',close:'18:30'},2:{open:'08:30',close:'18:30'},3:{open:'08:30',close:'18:30'},4:{open:'08:30',close:'18:30'},5:{open:'08:30',close:'18:30'},6:{open:'09:30',close:'13:30'}}
  const reply=visitBusinessHoursReply(hours,{slot:{}},'2026-09-14T17:00:00Z')
  assert.match(reply,/lunes a viernes de 08:30 a 18:30/)
  assert.match(reply,/sábado de 09:30 a 13:30/)
  assert.match(reply,/fecha y hora.*verificaremos la disponibilidad/)
  assert.doesNotMatch(reply,/tenemos.*disponible|Mapa:|confirmada/)
  const dated=visitBusinessHoursReply(hours,{slot:{requested_date:'2026-09-15'}},'2026-09-14T17:00:00Z')
  assert.match(dated,/mañana, martes 15 de septiembre/)
  assert.doesNotMatch(dated,/qué fecha/)
  assert.equal(visitBusinessHoursReply(null,{}),'')
})

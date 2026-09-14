/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS runner with the repository TypeScript loader. */
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
const { declinesAllVisitAlternatives, visitCoordinationSummary } = require('../src/lib/integrations/automation/visit-escalation.ts')
const proposal = { id: 'request', status: 'awaiting_client', proposed_by: 'advisor', previous_request_id: 'previous',
  preferred_time_text: 'el lunes a las 10', proposed_options: [
    { start_time: '2026-09-21T15:30:00Z', end_time: '2026-09-21T16:30:00Z' },
    { start_time: '2026-09-21T16:00:00Z', end_time: '2026-09-21T17:00:00Z' },
  ] }

test('rejection of offered alternatives hands coordination to a person', () => {
  for (const message of ['No puedo en ninguno de esos horarios', 'Ninguna me sirve', 'No me sirven esas opciones',
    'Prefiero otra opción', 'No me quedan bien esos horarios', 'No puedo ninguna de esas horas']) {
    assert.equal(declinesAllVisitAlternatives(message, proposal, 'reject'), true, message)
  }
  assert.equal(declinesAllVisitAlternatives('No gracias', proposal, 'reject'), true)
})

test('a new preferred date or clock continues intake without an urgent handoff', () => {
  for (const message of ['No puedo esos horarios, mejor mañana', 'Ninguno, prefiero el martes',
    'Ninguna, mejor a las 4', 'No me sirven esas opciones, puedo el viernes',
    'Ninguno de esos horarios. Para mañana a las 11', 'Ninguna, el 25/09 me queda bien']) {
    assert.equal(declinesAllVisitAlternatives(message, proposal, 'counterproposal'), false, message)
  }
})

test('a cancellation, commercial question, or absent advisor proposal never creates urgent visit work', () => {
  for (const message of ['No quiero una visita', 'Quiero cancelar mi cita', 'No me contacten',
    '¿Qué tiene el departamento 202?', '¿Cuál es el precio?', 'Ninguno, quiero cancelar',
    'No me gusta ninguno de esos departamentos', 'Ninguna de esas opciones de financiamiento me sirve']) {
    assert.equal(declinesAllVisitAlternatives(message, proposal, 'question'), false, message)
  }
  assert.equal(declinesAllVisitAlternatives('Ninguno', null, 'reject'), false)
  assert.equal(declinesAllVisitAlternatives('Ninguno', { ...proposal, status: 'awaiting_advisor' }, 'reject'), false)
  assert.equal(declinesAllVisitAlternatives('Ninguno', { ...proposal, proposed_by: 'client' }, 'reject'), false)
  assert.equal(declinesAllVisitAlternatives('Ninguno', { ...proposal, proposed_options: [], previous_request_id: null }, 'reject'), false)
})

test('brief preserves evidence and supplies a concrete next action without claiming a call happened', () => {
  const brief = visitCoordinationSummary('Ninguna me sirve', proposal, [
    { role: 'cliente', content: 'Busco el departamento 202' }, { role: 'bot', content: 'Podemos revisar el lunes' },
  ])
  assert.match(brief, /llamar al cliente/)
  assert.match(brief, /bot está pausado/)
  assert.match(brief, /el lunes a las 10/)
  assert.match(brief, /202/)
  assert.match(brief, /Ninguna me sirve/)
  assert.doesNotMatch(brief, /ya llam|llamada realizada|cita confirmada/i)
  assert.ok(visitCoordinationSummary('a'.repeat(8000), proposal, []).length <= 3000)
})

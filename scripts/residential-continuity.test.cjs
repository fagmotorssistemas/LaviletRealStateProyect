const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { residentialContinuity, residentialContinuationIssues, commercialMemory, experienceIssues, commercialFallback } = require('../src/lib/integrations/automation/commercial-experience.ts')
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const info = { lead: { preferred_category: 'departamento' }, catalogo: [{ category: 'departamento', bedrooms: 2 }, { category: 'departamento', bedrooms: 3 }, { category: 'suite', bedrooms: 1 }],
  historial: [{ role: 'cliente', content: 'Recomiéndeme un departamento' }, { role: 'bot', content: 'La Vilet ofrece tranquilidad, seguridad y comodidad. Tenemos departamentos de 2 y 3 dormitorios. ¿Es para vivir o invertir?' }] }

test('a spontaneous request for an apartment does not mean the lead already knows about suites', () => {
  assert.equal(residentialContinuity(info, 'Para vivir').may_mention_suite, true)
  assert.match(commercialFallback(info, 'Para vivir', commercialMemory(null, info.historial)), /suites de un dormitorio/)
})
test('choosing apartments over suites does not reopen suites after the purpose answer', () => {
  const selected = { ...info, historial: [{ role: 'bot', content: '¿Prefiere suite o departamento?' }, { role: 'cliente', content: 'Departamento' }, ...info.historial.slice(1)] }
  assert.equal(residentialContinuity(selected, 'Para vivir').may_mention_suite, false)
  assert.ok(residentialContinuationIssues('Hay departamentos de 2 o 3 dormitorios y también suites.', 'Para vivir', selected).includes('category_reopened'))
  assert.doesNotMatch(commercialFallback(selected, 'Para vivir', commercialMemory(null, selected.historial)), /suite/)
})
test('suites already presented are not advertised again; an explicit suite question still works', () => {
  const known = { ...info, historial: [{ role: 'bot', content: 'Contamos con suites de un dormitorio.' }, ...info.historial] }
  assert.equal(residentialContinuity(known, 'Para vivir').may_mention_suite, false)
  assert.deepEqual(residentialContinuationIssues('Tenemos suites de un dormitorio.', 'Y cómo son las suites?', known), [])
})
test('purpose and unavailable bedrooms continue without promotional filler', () => {
  assert.ok(experienceIssues('Pensando en su comodidad diaria, ofrecemos ambientes iluminados.', 'Para vivir', info, commercialMemory(null, info.historial)).includes('repeated_question'))
  const rooms = { ...info, historial: [...info.historial, { role: 'cliente', content: 'Para vivir' }, { role: 'bot', content: '¿Cuántos dormitorios prefiere?' }] }
  assert.equal(residentialContinuity(rooms, 'Quiero de 5').requested_bedrooms, 5)
  assert.ok(residentialContinuationIssues('No hay de 5 dormitorios; tenemos de 2 o 3, pensados para una vida tranquila en Puertas del Sol.', 'Quiero de 5', rooms).includes('repeated_presentation'))
  const fallback = commercialFallback(rooms, 'Quiero de 5', commercialMemory(null, rooms.historial))
  assert.match(fallback, /No contamos.*5.*2 o 3/)
  assert.doesNotMatch(fallback, /tranquila|comodidad|Puertas del Sol/)
})
test('an explicit amenity follow-up is still answered even after presenting the amenity', () => {
  const history = [...info.historial, { role: 'bot', content: 'El proyecto contempla piscina y gimnasio.' }]
  assert.deepEqual(experienceIssues('El proyecto contempla piscina y gimnasio.', 'Y la piscina y el gimnasio?', { ...info, historial: history }, commercialMemory(null, history)), [])
})
test('the final reviewer cannot reintroduce a benefits paragraph into a short preference response', async () => {
  const baseReply = 'Tenemos departamentos de 2 o 3 dormitorios.'
  const result = await completeTurnReply({ current: 'Para vivir', history: info.historial, verified: info, baseReply }, async () => ({
    reply: baseReply + ' Están pensados para su comodidad y una vida tranquila en Puertas del Sol.',
    requests: [{ fragment: 'Para vivir', intent: 'Uso propio', request_type: 'general_information', base_status: 'answered', status: 'answered', evidence: baseReply }],
    question: { text: '', purpose: 'none', missing_datum: '', next_decision: '' },
  }))
  assert.equal(result.reply, baseReply)
  assert.equal(result.needsAdvisor, false)
  assert.ok(result.audit.issues.includes('repeated_presentation'))
})

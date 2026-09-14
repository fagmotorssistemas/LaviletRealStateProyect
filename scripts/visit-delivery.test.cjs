const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f)
const { selectedVisitOption } = require('../src/lib/integrations/automation/visit-choice.ts')
const { withVisitLocation } = require('../src/lib/integrations/automation/visit-location.ts')
const { prepareVisit, validateVisit } = require('../src/lib/integrations/automation/visit-rules.ts')
const { visitOptionsList } = require('../src/lib/inmobiliaria/visitProposalOptions.ts')
const { LAVILET_PROJECT_ID: project_id, LAVILET_TENANT_ID: tenant_id, LAVILET_MESSAGE_ROUTES } = require('../src/lib/integrations/lavilet.ts')
const scope = { project_id, tenant_id }, now = Date.parse('2026-09-14T17:00:00Z'), sentAt = new Date(now).toISOString()
const slot = start_time => ({ start_time, end_time: new Date(Date.parse(start_time) + 3600000).toISOString() })
const choices = [slot('2026-09-15T13:00:00.000Z'), slot('2026-09-15T13:30:00.000Z'), slot('2026-09-16T14:00:00.000Z')]
const address = 'Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca'
const map = 'https://www.google.com/maps/search/?api=1&query=-2.892287,-79.030259'

test('a unique ordinal selects only its corresponding option', () => {
  for (const [message, expected] of [['La primera', 1], ['El primero', 1], ['El segundo horario', 2], ['Prefiero la tercera', 3], ['El tercero', 3], ['Opción 2', 2], ['3', 3]]) {
    assert.equal(selectedVisitOption(message, choices, sentAt), expected, message)
  }
})

test('a clock with minutes never becomes a different whole-hour option', () => {
  assert.equal(selectedVisitOption('La de las 8:30', choices, sentAt), 2)
  assert.equal(selectedVisitOption('Mañana a las 8:30', choices, sentAt), 2)
  assert.equal(selectedVisitOption('La de las 8', choices, sentAt), 1)
  assert.equal(selectedVisitOption('Mañana a las 8:45', choices, sentAt), null)
})

test('an ordinal contradicted by a day or time never confirms the wrong appointment', () => {
  for (const message of ['La primera el miércoles', 'La primera mañana a las 9', 'La primera a las 8:30', 'La segunda el martes a las 8', 'La primera, 9:00']) {
    assert.equal(selectedVisitOption(message, choices, sentAt), null, message)
  }
  assert.equal(selectedVisitOption('La primera mañana a las 8', choices, sentAt), 1)
})

test('a generic yes or acceptance cannot choose arbitrarily among appointments', () => {
  for (const message of ['Sí', 'Perfecto', 'Está bien', 'Me parece bien', 'Gracias', 'La primera o la segunda', 'La cuarta']) {
    assert.equal(selectedVisitOption(message, choices, sentAt), null, message)
  }
  assert.equal(selectedVisitOption('La primera', choices.slice(0, 1), sentAt), null)
})

test('a unique clock can select a slot but the same clock on two days is ambiguous', () => {
  const repeated = [choices[0], slot('2026-09-16T13:00:00.000Z'), choices[2]]
  assert.equal(selectedVisitOption('A las 8', repeated, sentAt), null)
  assert.equal(selectedVisitOption('Mañana a las 8', repeated, sentAt), 1)
  assert.equal(selectedVisitOption('El miércoles a las 8', repeated, sentAt), 2)
  assert.equal(selectedVisitOption('A las 9', repeated, sentAt), 3)
})

test('morning and afternoon alternatives need an unambiguous period', () => {
  const repeated = [choices[0], slot('2026-09-15T01:00:00.000Z')]
  assert.equal(selectedVisitOption('A las 8', repeated, sentAt), null)
  assert.equal(selectedVisitOption('A las 8 de la mañana', repeated, sentAt), 1)
  assert.equal(selectedVisitOption('A las 8 pm', repeated, sentAt), 2)
  assert.equal(selectedVisitOption('A las 8 a. m.', repeated, sentAt), 1)
  assert.equal(selectedVisitOption('A las 8 p. m.', repeated, sentAt), 2)
  assert.equal(selectedVisitOption('A las 8 a. m.', [repeated[1], choices[2]], sentAt), null)
})

test('property, prices, financing and unrelated bookings do not become appointment choices', () => {
  for (const message of ['El departamento 2', 'Los departamentos, la opción 2', 'La suite 3', 'Los locales, la primera', 'Quiero 3 dormitorios', 'La cuota 2', 'El vuelo, la segunda', 'Las motos, la segunda']) {
    assert.equal(selectedVisitOption(message, choices, sentAt), null, message)
  }
})

test('questions, cancellation, objections and opt-out never confirm an option', () => {
  for (const message of ['¿La segunda?', 'Puedo la primera?', 'No quiero la primera', 'Cancelar la segunda', 'Cancelo la primera', 'No me contacten, la segunda', 'Prefiero otra opción', 'La primera pero no estoy segura']) {
    assert.equal(selectedVisitOption(message, choices, sentAt), null, message)
  }
})

test('an invitation alone does not attach a map before a request or confirmation', () => {
  for (const message of ['Puede visitar nuestra oficina.', 'Le esperamos.', 'La oficina está donde se construirá La Vilet.']) {
    const reply = withVisitLocation(message, { proyecto: { address }, ubicacion: map })
    assert.equal(reply, message)
  }
})

test('an existing textual address still receives the missing map and remains idempotent', () => {
  const base = `Dirección: ${address}`
  const first = withVisitLocation(base, { address, map_url: map }, true)
  const second = withVisitLocation(first, { address, map_url: map }, true)
  assert.equal(first, second)
  assert.equal(first.split(address).length - 1, 1)
  assert.equal(first.split(map).length - 1, 1)
})

test('location can be forced for a short answer without inventing absent data', () => {
  assert.equal(withVisitLocation('Sí, aquí.', { address, map_url: map }), 'Sí, aquí.')
  assert.ok(withVisitLocation('Sí, aquí.', { address, map_url: map }, true).includes(map))
  assert.equal(withVisitLocation('Le esperamos.', {}), 'Le esperamos.')
  assert.doesNotMatch(withVisitLocation('Le esperamos.', { map_url: 'javascript:alert(1)' }), /javascript/)
})

function context(count = 3) {
  const options = choices.slice(0, count), start = options[0], route = LAVILET_MESSAGE_ROUTES.find(r => r.kind === 'visit_propose')
  const preview = `Tenemos estas opciones para recibirle en nuestra oficina:\n\n${visitOptionsList(options)}\n\nPuede elegir la que mejor le venga o indicarnos otro día para verificarlo con el equipo.`
  return {
    job: { ...scope, id: 'job', kind: 'visit_propose', status: 'pending', lead_id: 'lead', appointment_id: 'appointment',
      scheduled_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600000).toISOString(),
      payload: { request_id: 'request', advisor_id: 'advisor', ...start, options, message_draft: preview, detail: preview, location: map } },
    lead: { ...scope, id: 'lead', channel_origin: 'whatsapp', kommo_id: 123 },
    config: { ...scope, enabled: true, test_only: false },
    appointment: { ...scope, id: 'appointment', lead_id: 'lead', status: 'pendiente', responsible_id: 'advisor', location_type: 'proyecto', ...start },
    request: { ...scope, id: 'request', appointment_id: 'appointment', lead_id: 'lead', assigned_advisor_id: 'advisor', status: 'awaiting_client',
      proposed_start_time: start.start_time, proposed_end_time: start.end_time, proposed_options: options, advisor_accepted_at: new Date(now - 2000).toISOString(), expires_at: new Date(now + 7200000).toISOString() },
    route: { enabled: true, approved: true, body_template: 'Campo de respuesta', bot_id: route.botId, detail_field_id: route.fieldId },
    last_client_message_at: new Date(now - 60000).toISOString(), event_current: true, recent_jobs: [],
    address, location: map, mode: 'lanzamiento', launch_destination: 'office',
  }
}

test('one, two and three advisor-approved options are valid deliveries', () => {
  for (const count of [1, 2, 3]) {
    const c = prepareVisit(context(count))
    assert.deepEqual(validateVisit(c, now), { action: 'send', reasons: [] }, `${count} options`)
    assert.ok(c.job.payload.detail.includes(visitOptionsList(choices.slice(0, count))))
  }
})

test('approved wording is never regenerated or overwritten after advisor review', () => {
  const c = context(), approvedMessage = c.job.payload.message_draft
  c.job.payload.detail = 'A stale placeholder before preparation'
  const prepared = prepareVisit(c)
  assert.equal(prepared.job.payload.detail, approvedMessage)
  assert.equal(c.job.payload.detail, 'A stale placeholder before preparation')
  assert.equal(prepareVisit(prepared).job.payload.detail, approvedMessage)
})

test('a changed proposal or omitted slot cannot be delivered', () => {
  const changed = context()
  changed.request.proposed_options = [choices[0], slot('2026-09-15T16:00:00.000Z'), choices[2]]
  assert.ok(validateVisit(prepareVisit(changed), now).reasons.includes('options_changed'))
  const missing = context()
  missing.job.payload.options = []
  assert.ok(validateVisit(missing, now).reasons.includes('missing_options'))
  const absentFromCopy = context()
  absentFromCopy.job.payload.detail = `Solo una opción. Dirección: ${address}\nMapa: ${map}`
  assert.ok(validateVisit(absentFromCopy, now).reasons.includes('options_missing_from_message'))
})

test('duplicate or excessive options cannot be delivered as distinct alternatives', () => {
  for (const options of [[choices[0], choices[0]], [...choices, slot('2026-09-17T14:00:00.000Z')]]) {
    const c = context()
    c.job.payload.options = options; c.request.proposed_options = options
    c.job.payload.message_draft = `Opciones:\n${visitOptionsList(options)}\n${address}\n${map}`
    const decision = validateVisit(prepareVisit(c), now)
    assert.equal(decision.action, 'cancel')
    assert.ok(decision.reasons.includes('options_changed'))
  }
})

test('a draft no longer matching selected options cannot be silently replaced and sent', () => {
  const c = context()
  c.job.payload.message_draft = 'La cita está confirmada. Le esperamos.'
  const prepared = prepareVisit(c)
  assert.equal(prepared.job.payload.detail, '')
  assert.equal(validateVisit(prepared, now).action, 'cancel')
  assert.ok(validateVisit(prepared, now).reasons.includes('options_missing_from_message'))
})

test('expired requests, expired jobs and past alternatives are canceled', () => {
  const expiredJob = context(); expiredJob.job.expires_at = new Date(now - 1).toISOString()
  assert.ok(validateVisit(expiredJob, now).reasons.includes('expired'))
  const expiredRequest = context(); expiredRequest.request.expires_at = new Date(now - 1).toISOString()
  assert.ok(validateVisit(expiredRequest, now).reasons.includes('proposal_not_pending'))
  const pastOption = context(); pastOption.job.payload.options[1] = slot('2026-09-14T16:00:00.000Z')
  pastOption.job.payload.message_draft = `Opciones:\n${visitOptionsList(pastOption.job.payload.options)}\n${address}\n${map}`
  assert.ok(validateVisit(prepareVisit(pastOption), now).reasons.includes('options_changed'))
})

function confirmationContext() {
  const c = context(1), route = LAVILET_MESSAGE_ROUTES.find(r => r.kind === 'visit_confirm')
  c.job.kind = 'visit_confirm'; c.job.payload.options = []; c.request.proposed_options = []
  c.request.status = 'confirmed'; c.request.client_accepted_at = new Date(now - 1000).toISOString()
  c.appointment.status = 'aceptado'
  c.route.bot_id = route.botId; c.route.detail_field_id = route.fieldId
  return prepareVisit(c)
}

test('confirmed appointments include the complete verified location and cannot omit it', () => {
  for (const [remove, reason] of [[address, 'address_changed_or_missing'], [map, 'map_changed_or_missing']]) {
    const c = confirmationContext()
    assert.equal(validateVisit(c, now).action, 'send')
    assert.ok(c.job.payload.detail.includes(address)); assert.ok(c.job.payload.detail.includes(map))
    c.job.payload.detail = c.job.payload.detail.replace(remove, '')
    const decision = validateVisit(c, now)
    assert.equal(decision.action, 'cancel'); assert.ok(decision.reasons.includes(reason))
  }
})

test('a changed location invalidates an outdated confirmation but not an unrelated proposal', () => {
  const c = confirmationContext()
  c.address = 'Nueva oficina, Cuenca'
  assert.ok(validateVisit(c, now).reasons.includes('address_changed_or_missing'))
  c.address = address; c.location = 'https://maps.google.com/?q=other'
  assert.ok(validateVisit(c, now).reasons.includes('map_changed_or_missing'))
  const proposal = context(); proposal.address = c.address; proposal.location = c.location
  assert.equal(validateVisit(prepareVisit(proposal), now).action, 'send')
})

test('single legacy proposals do not deliver unsolicited location', () => {
  const c = context(1)
  c.job.payload.options = []; c.request.proposed_options = []
  const prepared = prepareVisit(c)
  assert.ok(prepared.job.payload.detail.includes('nuestra oficina'))
  assert.ok(!prepared.job.payload.detail.includes(address)); assert.ok(!prepared.job.payload.detail.includes(map))
  assert.equal(validateVisit(prepared, now).action, 'send')
})

test('appointment reminders do not repeat the map without an approved reminder location policy', () => {
  const c = context(1)
  c.job.kind = 'visit_2h'
  const prepared = prepareVisit(c)
  assert.ok(prepared.job.payload.detail.includes('Le recordamos'))
  assert.ok(!prepared.job.payload.detail.includes(address)); assert.ok(!prepared.job.payload.detail.includes(map))
})

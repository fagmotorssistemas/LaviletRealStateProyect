import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretConversationTurn, TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { typedTurnFixture, authorityFixture } from './fixtures/typed-turn.fixture'
import { visitPreferenceFixture } from './fixtures/visit-preference.fixture'
import { commercialJourneyPlan } from './commercial-journey'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { object, type Row } from './data'
import { visitDialogueTurn, visitDialogueIntakeSnapshot } from './visit-dialogue'
import { resolveVisitCalendar } from './visit-calendar'
import { financingInputs } from './financing'
import { financingInvitationReceipt } from './financing-invitation'
import { reservationRequest } from './reservation-action'
import { normalizeTurnSemantics } from './turn-semantics'

test('the full provider schema closes every object and exposes only the current authority contract', () => {
  function check(schema: Row) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(new Set(schema.required as string[]), new Set(Object.keys(object(schema.properties))))
    }
    for (const child of Object.values(object(schema.properties))) check(object(child))
    for (const key of ['anyOf', 'oneOf']) if (Array.isArray(schema[key])) for (const child of schema[key]) check(object(child))
    if (schema.items) check(object(schema.items))
  }
  check(TURN_EXTRACTION_SCHEMA)
  for (const legacy of ['action_evidence', 'requested_advisor', 'financing_consent', 'consent_granted', 'opt_out'])
    assert.equal(Object.hasOwn(object(TURN_EXTRACTION_SCHEMA.properties), legacy), false, legacy)
})

test('a missing current contract is repaired once with the actual message identities and pending context', async () => {
  const current = 'Bueno, o sea, el miércoles a las tres de la tarde', raw = typedTurnFixture(current)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, source_message_id: 'actual-source',
    current_messages: [{ external_message_id: 'actual-source', content: current, sent_at: '2026-10-16T20:00:00Z' }],
    pregunta_pendiente: { id: 'visit_date_time', act: 'visit' } }, {
    activePrompt: async () => '', aiJson: async (_rules, input) => {
      calls++
      if (calls === 1) return {}
      assert.equal(object(input).source_message_id, 'actual-source')
      assert.equal(object(object(input).pregunta_pendiente).id, 'visit_date_time')
      assert.equal((object(input).current_messages as Row[])[0].external_message_id, 'actual-source')
      return raw
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.method, 'model')
  let invalidCalls = 0
  await assert.rejects(interpretConversationTurn({ mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => { invalidCalls++; return {} },
  }), /TURN_INTERPRETATION_INVALID/)
  assert.equal(invalidCalls, 2, 'No vocabulary fallback after an invalid model contract')
})

test('a malformed typed clock is repaired as data instead of silently discarding the stated preference', async () => {
  const current = 'El miércoles a las tres de la tarde', raw = typedTurnFixture(current, {
    action_authority: authorityFixture(current, 'visit'), visit_intent: { kind: 'request_visit', purpose: 'coordination',
      target: 'project', destination: 'office', evidence: current, confidence: 'high' },
    visit_preference: visitPreferenceFixture({ evidence: current, date: { kind: 'weekday', weekday: 3, week_offset: 1 },
      time: { kind: 'clock', hour: 15, minute: 0, meridiem: 'pm' } }),
  })
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, source_message_id: 'actual-source',
    source_at: '2026-10-16T20:00:00Z', current_messages: [{ external_message_id: 'actual-source', content: current, sent_at: '2026-10-16T20:00:00Z' }] }, {
    activePrompt: async () => '', aiJson: async (_rules, input, schema) => {
      calls++
      if (calls === 1) return raw
      assert.ok(Object.hasOwn(object(schema?.properties), 'visit_preference'))
      assert.equal(Object.hasOwn(object(schema?.properties), 'action_authority'), false, 'Preserve unrelated validated decisions')
      assert.equal(object(input).source_message_id, 'actual-source')
      return { recovery_outcome: 'repaired', visit_preferences: [], visit_preference: visitPreferenceFixture({ evidence: current,
        date: { kind: 'weekday', weekday: 3, week_offset: 1 }, time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } }) }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(object(result.extracted.visit_preference).time).hour, 3)
  assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
})

test('a typed acceptance cannot borrow an unrelated invitation to initiate a financial or reservation operation', () => {
  const current = 'Sí, eso', raw = typedTurnFixture(current, { action_authority: authorityFixture(current, 'financing', 'accept') })
  object(raw.turn_semantics).answer_to_previous = { question_id: 'unit_choice', kind: 'affirmative', evidence: current, confidence: 'high' }
  const reply = 'Podemos mostrarle esa unidad'
  assert.equal(financingInputs(raw, current, reply, { partners: ['Cooperativa JEP'], current: {} },
    { kind: 'commercial_question', reply }).consent, null)
  const permission = 'Podemos comenzar la revisión financiera si desea continuar por aquí'
  object(raw.turn_semantics).answer_to_previous = { question_id: 'financing_invitation', kind: 'affirmative', evidence: current, confidence: 'high' }
  assert.equal(financingInputs(raw, current, permission, { partners: ['Cooperativa JEP'], current: {} }, {
    kind: 'financing_consent', reply: permission, invitation: financingInvitationReceipt({ text: permission,
      continuation_id: 'financing_invitation', continuation_act: 'financing', purpose: 'permission_to_continue' }),
  }).consent, true)
  raw.action_authority = authorityFixture(current, 'reservation', 'accept')
  object(raw.turn_semantics).reservation = { kind: 'request', reference_kind: 'explicit', unit_numbers: ['605'], evidence: current, confidence: 'high' }
  const semantics = normalizeTurnSemantics(raw, current, { id: 'unit_choice', act: 'show_unit_details' })
  assert.notEqual(object(semantics.reservation).kind, 'request')
  assert.equal(reservationRequest(object(semantics.reservation), [{ externalId: 'source', text: current }], catalog, [catalog[1]], semantics.action_authority), null)
})

async function interpret(current: string, raw: Row, context: Row = {}) {
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, ...context }, {
    activePrompt: async () => 'Extractor de prueba', aiJson: async () => { calls++; return structuredClone(raw) },
  })
  assert.equal(calls, 1)
  return result
}
const catalog: Row[] = [
  { id: 'u602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 140.53, price: 341016, is_published: true, status: 'disponible' },
  { id: 'u605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09, price: 337272, is_published: true, status: 'disponible' },
]
for (const domain of ['advisor', 'visit', 'financing', 'reservation']) for (const current of ['Hecho, avancemos', 'Sí, eso es lo que deseo', 'No lo del lunes; hagámoslo el miércoles'])
  test('current typed permission remains actionable for ' + domain + ': ' + current, async () => {
    const raw = typedTurnFixture(current, { action_authority: authorityFixture(current, domain),
      visit_intent: domain === 'visit' ? { kind: 'request_visit', purpose: 'coordination', target: 'project', destination: 'office', evidence: current, confidence: 'high' } : null })
    if (domain === 'reservation') object(raw.turn_semantics).reservation = {
      kind: 'request', reference_kind: 'explicit', unit_numbers: ['605'], evidence: current, confidence: 'high',
    }
    const result = await interpret(current, raw)
    assert.equal(result.extracted.requested_advisor, domain === 'advisor')
    assert.equal(result.extracted.financing_consent === true, domain === 'financing')
    assert.equal(object(result.semantics.reservation).kind === 'request', domain === 'reservation')
    assert.equal(object(result.extracted.visit_intent).kind === 'request_visit', domain === 'visit')
  })

for (const current of ['eh\nhola amigo', 'hola panaaaa', 'bonjour, mon ami', '👋']) test('greeting uses AI meaning and preserves the open welcome: ' + current, async () => {
  const raw = typedTurnFixture(current)
  object(raw.communication).kind = 'greeting_only'
  object(raw.communication).greeting_present = true
  const result = await interpret(current, raw)
  assert.equal(result.method, 'model')
  const plan = commercialJourneyPlan({ semantica_turno: result.semantics, solicitudes_interpretadas: result.requests, property_context: {} })
  assert.equal(plan.action, 'greeting_only')
  assert.equal(plan.question_id, '')
  assert.equal(result.extracted.requested_advisor, false)
})

for (const current of ['Quisiera coordinar una visita', 'Bueno, o sea, voy el miércoles a las 3 de la tarde', 'No puedo el lunes; el miércoles sí'])
  test('visit intent and clock survive paraphrases without a language veto: ' + current, async () => {
    const raw = typedTurnFixture(current, { action_authority: authorityFixture(current, 'visit'),
      visit_intent: { kind: 'request_visit', purpose: 'coordination', target: 'project', destination: 'office', evidence: current, confidence: 'medium' },
      visit_preference: visitPreferenceFixture({ evidence: current, date: { kind: 'weekday', weekday: 3, week_offset: 1 },
        time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } }) })
    const result = await interpret(current, raw, { source_message_id: 'message', source_at: '2026-10-16T20:00:00Z' })
    assert.equal(object(result.extracted.visit_intent).kind, 'request_visit')
    const preference = object(result.extracted.visit_preference)
    assert.equal(object(preference.time).hour, 3)
    const plan = visitDialogueTurn({ current, intent: result.extracted.visit_intent, preference, sourceMessageId: 'message', readiness: {
      stage: 'not_started', verifiedOn: '2026-10-16', progress: '', enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true,
    } })
    const snapshot = visitDialogueIntakeSnapshot(plan, result.extracted.visit_intent, preference, 'message')
    assert.equal(object(snapshot._interpreted_visit).version, 'visit-preference-v2')
  })

for (const domain of ['advisor', 'visit', 'financing', 'reservation']) for (const attribution of ['reported', 'conditional', 'hypothetical'])
  test('typed ' + attribution + ' does not authorize ' + domain, async () => {
    const current = 'La otra persona dijo que quiere avanzar cuando lo decida'
    const raw = typedTurnFixture(current, { action_authority: authorityFixture(current, domain, 'request', attribution), requested_advisor: true,
      financing_consent: true, visit_intent: domain === 'visit'
        ? { kind: 'request_visit', purpose: 'coordination', target: 'project', evidence: current, confidence: 'high' } : null })
    if (domain === 'reservation') object(raw.turn_semantics).reservation = {
      kind: 'request', reference_kind: 'explicit', unit_numbers: ['605'], evidence: current, confidence: 'high',
    }
    const result = await interpret(current, raw)
    assert.equal(result.extracted.requested_advisor, false)
    assert.notEqual(result.extracted.financing_consent, true)
    assert.equal(result.extracted.visit_intent, null)
    assert.notEqual(object(result.semantics.reservation).kind, 'request')
  })

test('a scoped refusal never unsubscribes globally; a typed global refusal does', async () => {
  const current = 'No quiero recibir novedades sobre créditos'
  const scoped = await interpret(current, typedTurnFixture(current, { action_authority: authorityFixture(current, 'tracking', 'decline', 'self', 'topic_contact') }))
  assert.equal(scoped.extracted.opt_out, false)
  const global = await interpret(current, typedTurnFixture(current, { action_authority: authorityFixture(current, 'tracking', 'decline', 'self', 'all_contact') }))
  assert.equal(global.extracted.opt_out, true, 'Changing interpreted scope, rather than vocabulary, changes the action')
})

test('correcting another interpretation preserves the 605 and the accepted three-bedroom search', async () => {
  const current = 'Lo de antes fue un error; nadie me ha llamado todavía'
  const result = await interpret(current, typedTurnFixture(current))
  const previous = { selected_ids: ['u605'], offered_ids: ['u602', 'u605'],
    query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected', filters: { bedrooms: 3 } },
    exploration_state: { accepted_filters: { bedrooms: 3 } }, pending_question: {} }
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: previous }, [], result.semantics)
  assert.deepEqual(resolved.context.selected_ids, ['u605'])
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  const saved = rememberPropertyReply(catalog, resolved.context, 'Un texto redactado de cualquier manera', { source: 'scope_clarification' })
  assert.deepEqual(saved.selected_ids, ['u605'])
  assert.equal(object(object(saved.query).filters).bedrooms, 3)
})

test('accepting an offered alternative persists its query; later clarification cannot restore five bedrooms', () => {
  const current = 'Sí, revisemos esas opciones'
  const pending = { id: 'property_requirements', act: 'explore_alternatives', target_ids: [], candidate_ids: ['u602', 'u605'],
    proposed_query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 }, operation: 'search', scope: 'catalog' } }
  const raw = typedTurnFixture(current)
  object(raw.turn_semantics).answer_to_previous = { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  const result = resolvePropertyTurn(catalog, current, { _pending_question: pending, _property_context: {
    query: { group: 'residential', filters: { bedrooms: 5 } }, offered_ids: ['u602', 'u605'] } }, [], raw.turn_semantics)
  assert.equal(object(result.query.filters).bedrooms, 3)
  assert.equal(result.matches.length, 2)
  const later = resolvePropertyTurn(catalog, '¿Y entonces?', { _property_context: result.context }, [], typedTurnFixture('¿Y entonces?').turn_semantics)
  assert.equal(object(later.query.filters).bedrooms, 3)
})

test('current typed unit selection and price inquiry coexist without selecting by price or old prose', () => {
  const current = 'Entonces el 605 me gusta más, ¿qué precio tenía?'
  const semantics: Row = { ...object(typedTurnFixture(current).turn_semantics),
    property: { operation: 'details', reference_kind: 'explicit', unit_numbers: ['605'], evidence: current, confidence: 'high', filters: {} },
    unit_choice: { kind: 'selected', unit_numbers: ['605'], evidence: current, confidence: 'high' } }
  const result = resolvePropertyTurn(catalog, current, {}, [], semantics)
  assert.deepEqual(result.context.selected_ids, ['u605'])
  assert.equal(result.matches[0].unit_number, '605')
  assert.equal(resolvePropertyTurn(catalog, '605', {}, [], typedTurnFixture('605').turn_semantics).matches.length, 0,
    'A number without interpretation cannot choose or retrieve a unit')
})

test('calendar receives only typed values and preserves an hour stated before the first date', () => {
  const first = visitPreferenceFixture({ evidence: 'A las tres de la tarde', time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } })
  const hour = resolveVisitCalendar(first as never, { sourceAt: '2026-10-16T20:00:00Z', timezone: 'America/Guayaquil' })
  const date = visitPreferenceFixture({ evidence: 'Sí, el miércoles', date: { kind: 'weekday', weekday: 3, week_offset: 1 } })
  const complete = resolveVisitCalendar(date as never, { sourceAt: '2026-10-16T20:01:00Z', timezone: 'America/Guayaquil', previous: hour.state })
  assert.equal(complete.requested_date, '2026-10-21')
  assert.equal(complete.start_time, '2026-10-21T20:00:00.000Z')
})

for (const domain of ['property', 'tracking']) test('conflicting social metadata receives a bounded AI repair for ' + domain, async () => {
  const current = domain === 'property' ? 'Buenas, me quedo con el 605' : 'Buenos días, no me contacten más'
  const raw = typedTurnFixture(current)
  object(raw.communication).kind = 'greeting_only'
  if (domain === 'tracking') raw.action_authority = authorityFixture(current, 'tracking', 'decline', 'self', 'all_contact')
  else object(raw.turn_semantics).unit_choice = { kind: 'selected', unit_numbers: ['605'], evidence: current, confidence: 'high' }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => {
      calls++
      return calls === 1 ? structuredClone(raw) : { ...raw,
        communication: { ...object(raw.communication), kind: 'substantive' } }
    },
  })
  assert.equal(calls, 2, 'Repair contradictory model fields, without interpreting either phrase in code')
  assert.equal(object(result.semantics.communication).kind, 'substantive')
  if (domain === 'tracking') assert.equal(result.extracted.opt_out, true)
  else assert.deepEqual(object(result.semantics.unit_choice).unit_numbers, ['605'])
})

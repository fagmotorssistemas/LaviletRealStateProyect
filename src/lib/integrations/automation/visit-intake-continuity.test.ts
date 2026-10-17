import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizedVisitIntent, normalizedVisitPreference } from './conversation-rules'
import { visitDialogueIntakeSnapshot, visitDialogueTurn } from './visit-dialogue'
import { type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { visitPreferenceFixture as fixture } from './fixtures/visit-preference.fixture'
import { object } from './data'
import { resolveVisitCalendar } from './visit-calendar'

const readiness: ProjectReadiness = { stage: 'not_started', progress: '', verifiedOn: '2026-09-17',
  enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true }

it('keeps a current date/time answer as the preference purpose allowed by the extractor contract', () => {
  const current = 'Bueno, el miércoles a las 3, miércoles a las 3 de la tarde, que lo extraigan.'
  const intent = normalizedVisitIntent({ kind: 'request_visit', purpose: 'preference', target: 'project',
    destination: null, evidence: current, confidence: 'high' }, current)
  assert.equal(intent?.purpose, 'preference')
  const preference = normalizedVisitPreference(fixture({ evidence: current, date: { kind: 'weekday', weekday: 3, week_offset: 1 },
    time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } }), current)
  const plan = visitDialogueTurn({ current, intent, preference, readiness,
    previous: { version: 'visit-dialogue-v1', status: 'collecting', effective_destination: 'office' },
    intake: { status: 'collecting' }, sourceMessageId: 'audio-time', sourceAt: '2026-10-16T20:16:00Z' })
  assert.equal(plan.current_kind, 'preference')
  assert.equal(plan.operation_allowed, true)
  const snapshot = visitDialogueIntakeSnapshot(plan, intent, preference, 'audio-time')
  assert.equal(object(snapshot._interpreted_visit).version, 'visit-preference-v2')
  assert.equal(object(object(snapshot._interpreted_visit).time).hour, 3)
})

it('does not treat the spoken filler o sea as a choice between two visit dates', () => {
  const current = 'Ya, ok, entiendo. Bueno, entonces, o sea... Quisiera una para el miércoles.'
  const preference = normalizedVisitPreference(fixture({ evidence: 'Quisiera una para el miércoles', date: { kind: 'weekday', weekday: 3, week_offset: 1 } }), current)
  assert.equal(preference?.date.weekday, 3)
})

it('normalizes the date and clock forms returned for the actual audio and its clarification', () => {
  const current = 'Bueno, el miércoles a las 3, miércoles a las 3 de la tarde, que lo extraigan.'
  const preference = normalizedVisitPreference(fixture({ evidence: current, date: { kind: 'weekday', weekday: 3, week_offset: 1 },
    time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } }), current)
  assert.ok(preference)
  const slot = resolveVisitCalendar(preference, { sourceAt: '2026-10-16T20:00:00Z', timezone: 'America/Guayaquil' })
  assert.equal(slot.requested_date, '2026-10-21')
  assert.equal(slot.start_time, '2026-10-21T20:00:00.000Z')
  const confirmation = normalizedVisitPreference(fixture({ evidence: 'si si justamente para esa fecha', date: { kind: 'absolute', year: 2026, month: 10, day: 21, weekday: 3 },
    time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' } }), 'si si justamente para esa fecha\nya')
  assert.equal(confirmation?.date.weekday, 3)
})

it('does not turn actual alternatives, rejection or a foreign appointment into one chosen slot', () => {
  for (const current of ['El miércoles o el viernes a las 3 pm', 'No quiero el miércoles a las 3 pm']) {
    assert.equal(normalizedVisitPreference({ evidence: current, date_text: 'miércoles', time_text: 'a las 3 pm',
      location_type: null, confidence: 'high' }, current), null)
  }
  const current = 'Mi cita médica es el miércoles a las 3 pm'
  const plan = visitDialogueTurn({ current, readiness, intent: normalizedVisitIntent({ kind: 'request_visit',
    purpose: 'preference', target: 'other', evidence: current, confidence: 'high' }, current) })
  assert.equal(plan.operation_allowed, false)
})

import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizedVisitPreference, VISIT_PREFERENCE_SCHEMA } from './visit-preference-contract'
import { resolveVisitCalendar, type VisitCalendarState } from './visit-calendar'
import { visitPreferenceFixture as fixture } from './fixtures/visit-preference.fixture'

const sourceAt = '2026-10-16T20:16:00Z', timezone = 'America/Guayaquil'
const wednesday = { kind: 'weekday', weekday: 3, week_offset: 1 }
const afternoon = { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' }

it('paraphrases and oral repetitions consume exactly the same typed preference without text parsing', () => {
  for (const current of ['Bueno, o sea, miércoles a las tres, miércoles a las tres de la tarde',
    'El día 21 me viene bien a las 15h', 'Ese miércoles, tres de la tarde, perfecto', 'Mercredi à quinze heures']) {
    const preference = normalizedVisitPreference(fixture({ evidence: current, date: wednesday, time: afternoon }), current)
    assert.ok(preference)
    const resolved = resolveVisitCalendar(preference, { sourceAt, timezone })
    assert.equal(resolved.requested_date, '2026-10-21')
    assert.equal(resolved.start_time, '2026-10-21T20:00:00.000Z')
    assert.equal(resolved.end_time, '2026-10-21T21:00:00.000Z')
    assert.equal(resolved.confidence, 'exact')
  }
  assert.equal(Object.hasOwn(VISIT_PREFERENCE_SCHEMA.properties, 'date_text'), false)
  assert.equal(normalizedVisitPreference({ evidence: 'El miércoles', date_text: 'miércoles', confidence: 'high' }, 'El miércoles'), null)
})

it('the model supplies alternatives, refusals and uncertain fields instead of word blacklists', () => {
  const current = 'El miércoles o el viernes'
  const ambiguous = normalizedVisitPreference(fixture({ evidence: current, decision: 'ambiguous', uncertain_fields: ['date'], time: afternoon }), current)
  assert.ok(ambiguous)
  const result = resolveVisitCalendar(ambiguous, { sourceAt, timezone })
  assert.equal(result.start_time, null)
  assert.deepEqual(result.hours, [15])
  assert.deepEqual(result.missing_fields, ['date', 'time'])
  const declined = normalizedVisitPreference(fixture({ evidence: 'Ya no puedo', decision: 'declined', uncertain_fields: ['time'] }), 'Ya no puedo')
  assert.ok(declined)
  assert.equal(resolveVisitCalendar(declined, { sourceAt, timezone, previous: { date: { year: 2026, month: 10, day: 21 }, hours: [15], minute: 0, period: null } }).start_time, null)
})

it('relative references use the original local date and explicit calendar weeks', () => {
  const current = 'A la misma hora mañana'
  for (const confidence of ['high', 'medium']) {
    const preference = normalizedVisitPreference(fixture({ evidence: current, confidence, date: { kind: 'relative_day', offset_days: 1 }, time: { kind: 'unchanged' } }), current)
    assert.ok(preference)
    assert.equal(resolveVisitCalendar(preference, { sourceAt: '2026-10-17T02:00:00Z', timezone,
      previous: { date: { year: 2026, month: 10, day: 16 }, hours: [15], minute: 0, period: null } }).requested_date, '2026-10-17')
  }
  for (const [date, expected] of [[{ kind: 'weekday', weekday: 5, week_offset: 0 }, '2026-10-16'],
    [{ kind: 'weekday', weekday: 5, occurrence: 'strictly_next' }, '2026-10-23'],
    [{ kind: 'weekday', weekday: 5, occurrence: 'on_or_after' }, '2026-10-16']] as const) {
    const preference = normalizedVisitPreference(fixture({ evidence: current, date }), current)
    assert.ok(preference)
    assert.equal(resolveVisitCalendar(preference, { sourceAt, timezone }).requested_date, expected)
  }
})

it('validates ranges, impossible dates and explicit weekday contradictions as calendar facts', () => {
  for (const date of [{ kind: 'weekday', weekday: 8, week_offset: 0 }, { kind: 'absolute', year: 2026, month: 13, day: 1 },
    { kind: 'relative_day', offset_days: 'tomorrow' }]) assert.equal(normalizedVisitPreference(fixture({ date }), 'El miércoles a las 3 de la tarde'), null)
  for (const date of [{ kind: 'absolute', year: 2026, month: 2, day: 30 }, { kind: 'absolute', year: 2026, month: 10, day: 22, weekday: 3 }]) {
    const preference = normalizedVisitPreference(fixture({ date }), 'El miércoles a las 3 de la tarde')
    assert.ok(preference)
    assert.equal(resolveVisitCalendar(preference, { sourceAt, timezone }).valid, false)
  }
  for (const time of [{ kind: 'clock', hour: 25, minute: 0, meridiem: '24h' }, { kind: 'clock', hour: 3, minute: 61, meridiem: 'pm' },
    { kind: 'clock', hour: 3, minute: 0, meridiem: 'tarde' }]) assert.equal(normalizedVisitPreference(fixture({ time }), 'El miércoles a las 3 de la tarde'), null)
})

it('keeps time supplied before the first date and requires an explicit unchanged clock when moving a known date', () => {
  const current = 'Esta opción', input = { sourceAt, timezone }
  const initial = normalizedVisitPreference(fixture({ evidence: current, time: afternoon }), current)!
  const clock = resolveVisitCalendar(initial, input)
  const date = normalizedVisitPreference(fixture({ evidence: current, date: wednesday }), current)!
  const complete = resolveVisitCalendar(date, { ...input, previous: clock.state })
  assert.equal(complete.start_time, '2026-10-21T20:00:00.000Z')
  const moved = normalizedVisitPreference(fixture({ evidence: current, date: { kind: 'relative_day', offset_days: 8 } }), current)!
  assert.equal(resolveVisitCalendar(moved, { ...input, previous: complete.state }).has_time, false)
  const unchanged = normalizedVisitPreference(fixture({ evidence: current, date: { kind: 'relative_day', offset_days: 8 }, time: { kind: 'unchanged' } }), current)!
  assert.equal(resolveVisitCalendar(unchanged, { ...input, previous: complete.state }).start_time, '2026-10-24T20:00:00.000Z')
})

it('a period filters an unresolved clock without manufacturing an hour or treating DST ambiguity as exact', () => {
  const current = 'Me queda bien', preference = normalizedVisitPreference(fixture({ evidence: current, date: wednesday,
    time: { kind: 'clock', hour: 3, minute: 0, meridiem: null } }), current)!
  const ambiguous = resolveVisitCalendar(preference, { sourceAt, timezone })
  assert.deepEqual(ambiguous.hours, [3, 15])
  assert.equal(ambiguous.start_time, null)
  const period = normalizedVisitPreference(fixture({ evidence: current, time: { kind: 'period', period: 'afternoon' } }), current)!
  assert.equal(resolveVisitCalendar(period, { sourceAt, timezone, previous: ambiguous.state }).start_time, '2026-10-21T20:00:00.000Z')
  assert.equal(resolveVisitCalendar(period, { sourceAt, timezone }).has_time, false)
  const dst = normalizedVisitPreference(fixture({ evidence: current, date: { kind: 'absolute', year: 2026, month: 11, day: 1 },
    time: { kind: 'clock', hour: 1, minute: 30, meridiem: 'am' } }), current)!
  assert.equal(resolveVisitCalendar(dst, { sourceAt, timezone: 'America/New_York' }).start_time, null)
})

it('recovers only a demonstrated customer source with current typed acknowledgment and preserves its original timestamp', () => {
  const current = 'Sí, justamente esa fecha', original = 'Ese miércoles a las tres'
  const raw = fixture({ evidence: original, date: wednesday, time: afternoon, source: { kind: 'history', message_id: 'original' } })
  const context = { collecting: true, pendingQuestion: { id: 'visit_date_time' },
    answer: { question_id: 'visit_date_time', kind: 'affirmative', evidence: current, confidence: 'high' },
    history: [{ id: 'original', role: 'cliente', content: original, sent_at: sourceAt }] }
  const recovered = normalizedVisitPreference(raw, current, context)
  assert.ok(recovered)
  assert.equal(recovered.source_at, sourceAt)
  for (const changed of [{ ...context, collecting: false }, { ...context, pendingQuestion: { id: 'financing_invitation' } },
    { ...context, history: [{ id: 'original', role: 'bot', content: original, sent_at: sourceAt }] },
    { ...context, history: [{ id: 'foreign', role: 'cliente', content: original, sent_at: sourceAt }] }]) assert.equal(normalizedVisitPreference(raw, current, changed), null)
  assert.equal(normalizedVisitPreference(fixture({ evidence: 'Nunca dijo eso' }), current), null)
  assert.equal(normalizedVisitPreference(fixture({ confidence: 'low' }), 'El miércoles a las 3 de la tarde'), null)
  const previous: VisitCalendarState = { date: null, hours: null, minute: 0, period: null }
  assert.equal(resolveVisitCalendar(recovered, { sourceAt: recovered.source_at!, timezone, previous }).start_time, '2026-10-21T20:00:00.000Z')
})

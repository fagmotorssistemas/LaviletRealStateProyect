import { validVisitDate,validVisitTime,VISIT_PREFERENCE_VERSION,type VisitPreference } from './visit-preference-contract'

export type CalendarDate = { year: number; month: number; day: number }
export type VisitCalendarState = { date: CalendarDate | null; hours: number[] | null; minute: number; period: 'morning' | 'afternoon' | 'evening' | null }
export type VisitCalendarResult = { valid: boolean; reason: string | null; state: VisitCalendarState; requested_date: string | null;
  start_time: string | null; end_time: string | null; has_time: boolean; hours: number[] | null; minute: number;
  confidence: 'exact' | 'ambiguous' | 'date_only' | 'time_only' | 'unknown'; missing_fields: string[] }

const stamp = (value: CalendarDate) => { const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(value.year, value.month - 1, value.day); return date.getTime() }
const fromStamp = (value: number): CalendarDate => { const date = new Date(value); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() } }
const plusDays = (value: CalendarDate, count: number) => fromStamp(stamp(value) + count * 86400000)
const isoDay = (value: CalendarDate) => (new Date(stamp(value)).getUTCDay() + 6) % 7 + 1
const sameDate = (left: CalendarDate | null, right: CalendarDate | null) => !!left && !!right && left.year === right.year && left.month === right.month && left.day === right.day
const ymd = (value: CalendarDate) => [String(value.year).padStart(4, '0'), String(value.month).padStart(2, '0'), String(value.day).padStart(2, '0')].join('-')
const validDate = (value: CalendarDate) => sameDate(value, fromStamp(stamp(value)))
function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const number = (key: string) => Number(parts.find(part => part.type === key)?.value)
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute') }
}
function zonedInstant(date: CalendarDate, hour: number, minute: number, timezone: string) {
  const target = stamp(date) + (hour * 60 + minute) * 60000
  let guess = target
  for (let count = 0; count < 4; count++) {
    const actual = localParts(new Date(guess), timezone)
    const delta = target - (stamp(actual) + (actual.hour * 60 + actual.minute) * 60000)
    if (delta === 0) break
    guess += delta
  }
  const matches = (instant: number) => { const parts = localParts(new Date(instant), timezone)
    return sameDate(parts, date) && parts.hour === hour && parts.minute === minute }
  if (!matches(guess) || matches(guess - 3600000) || matches(guess + 3600000)) return null
  return new Date(guess).toISOString()
}

/** Pure calendar arithmetic and typed accumulation. This module never receives
 * customer text and cannot interpret a word or veto a writer's sentence. */
export function resolveVisitCalendar(preference: VisitPreference, input: { sourceAt: string | Date; timezone: string; previous?: VisitCalendarState }): VisitCalendarResult {
  let state: VisitCalendarState = input.previous ? { ...input.previous, hours: input.previous.hours ? [...input.previous.hours] : null }
    : { date: null, hours: null, minute: 0, period: null }
  const finish = (valid: boolean, reason: string | null = null, ambiguous = false): VisitCalendarResult => {
    let start: string | null = null
    if (valid && state.date && state.hours?.length === 1 && !ambiguous) {
      start = zonedInstant(state.date, state.hours[0], state.minute, input.timezone)
      if (!start) ambiguous = true
    }
    return { valid, reason, state, requested_date: state.date ? ymd(state.date) : null, start_time: start,
      end_time: start ? new Date(Date.parse(start) + 3600000).toISOString() : null, has_time: !!state.hours?.length,
      hours: state.hours, minute: state.minute, confidence: start ? 'exact' : ambiguous ? 'ambiguous' : state.date ? 'date_only' : state.hours?.length ? 'time_only' : 'unknown',
      missing_fields: [!state.date && 'date', (!state.hours?.length || state.hours.length !== 1 || ambiguous) && 'time'].filter(Boolean) as string[] }
  }
  try {
    if (preference.version !== VISIT_PREFERENCE_VERSION || !validVisitDate(preference.date) || !validVisitTime(preference.time)) return finish(false, 'invalid_metadata')
    const at = input.sourceAt instanceof Date ? input.sourceAt : new Date(input.sourceAt)
    if (!Number.isFinite(at.getTime())) return finish(false, 'invalid_source_time')
    const base = localParts(at, input.timezone), date = preference.date, time = preference.time
    let chosen = state.date
    if (date.kind === 'absolute') chosen = { year: date.year!, month: date.month!, day: date.day! }
    else if (date.kind === 'relative_day') chosen = plusDays(base, date.offset_days!)
    else if (date.kind === 'weekday') chosen = date.week_offset !== null
      ? plusDays(base, -isoDay(base) + date.weekday! + date.week_offset * 7)
      : plusDays(base, (date.weekday! - isoDay(base) + 7) % 7 || (date.occurrence === 'strictly_next' ? 7 : 0))
    else if (date.kind === 'month_day') chosen = { year: base.year, month: date.month!, day: date.day! }
    if (chosen && (!validDate(chosen) || date.weekday !== null && ['absolute', 'month_day'].includes(date.kind) && isoDay(chosen) !== date.weekday)) return finish(false, 'inconsistent_calendar_date')
    if (state.date && chosen && !sameDate(state.date, chosen) && time.kind !== 'unchanged') state = { ...state, hours: null, minute: 0, period: null }
    state.date = chosen
    if (time.kind === 'clock') {
      state.hours = time.meridiem === '24h' ? [time.hour!] : time.meridiem === 'am' ? [time.hour! % 12]
        : time.meridiem === 'pm' ? [time.hour! % 12 + 12] : [time.hour! % 12, time.hour! % 12 + 12]
      state.minute = time.minute!
    }
    if (time.kind === 'period') {
      state.period = time.period
      if (state.hours) state.hours = state.hours.filter(hour => time.period === 'morning' ? hour < 12 : time.period === 'afternoon' ? hour >= 12 && hour < 18 : hour >= 18)
    }
    if (preference.decision === 'ambiguous' || preference.decision === 'declined') {
      const fields = preference.uncertain_fields.length ? preference.uncertain_fields : ['date', 'time']
      if (fields.includes('date')) state.date = null
      if (fields.includes('time')) state.hours = null
      return finish(true, preference.decision, true)
    }
    return finish(true, null, !!state.hours && state.hours.length > 1)
  } catch { return finish(false, 'invalid_timezone_or_calendar') }
}

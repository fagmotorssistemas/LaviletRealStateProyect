export const AGENDA_TIMEZONE = 'America/Guayaquil'
const AGENDA_OFFSET = '-05:00'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function ecuadorYmd(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENDA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function addYmd(ymd: string, days: number): string {
  const utc = new Date(`${ymd}T12:00:00${AGENDA_OFFSET}`)
  utc.setUTCDate(utc.getUTCDate() + days)
  return ecuadorYmd(utc)
}

export function ecuadorDayStartUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00${AGENDA_OFFSET}`)
}

export function ecuadorInclusiveRange(fromYmd: string, toYmd: string): {
  fromIso: string
  toExclusiveIso: string
} {
  return {
    fromIso: ecuadorDayStartUtc(fromYmd).toISOString(),
    toExclusiveIso: ecuadorDayStartUtc(addYmd(toYmd, 1)).toISOString(),
  }
}

export function ecuadorLocalToIso(ymd: string, timeHm: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeHm)) return ''
  const time = timeHm.length === 5 ? `${timeHm}:00` : timeHm
  const parsed = new Date(`${ymd}T${time}${AGENDA_OFFSET}`)
  if (Number.isNaN(parsed.getTime()) || isoToEcuadorParts(parsed.toISOString())?.date !== ymd) return ''
  return parsed.toISOString()
}

export function isoToEcuadorParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: AGENDA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

export function isoToDatetimeLocal(iso: string | null | undefined): string {
  const parts = isoToEcuadorParts(iso)
  if (!parts) return ''
  return `${parts.date}T${parts.time}`
}

export function datetimeLocalToIso(value: string): string {
  if (!value) return ''
  const [date, time] = value.split('T')
  if (!date || !time) return ''
  return ecuadorLocalToIso(date, time.slice(0, 5))
}

export function formatAgendaDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return 'Horario por confirmar'
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Horario por confirmar'
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: AGENDA_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function appointmentIsOverdue(startTime: string | null | undefined, now = new Date()): boolean {
  if (!startTime) return false
  const date = new Date(startTime)
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime()
}

export function todayPresetRange(): { from: string; to: string } {
  const today = ecuadorYmd()
  return { from: today, to: today }
}

export function lastDaysPresetRange(days: number): { from: string; to: string } {
  const today = ecuadorYmd()
  return { from: addYmd(today, -(days - 1)), to: today }
}

export function nextDaysPresetRange(days: number): { from: string; to: string } {
  const today = ecuadorYmd()
  return { from: today, to: addYmd(today, days - 1) }
}

export function formatHmLabel(parts: { date: string; time: string } | null): string {
  if (!parts) return 'Horario por confirmar'
  return `${parts.date} ${parts.time}`
}

export { pad }

import { addYmd, ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'
import { text, type Row } from './data'

export const VISIT_REMINDER_BOT_ID = 22246
export const VISIT_REMINDER_FIELD_IDS = {
  greeting: 531808,
  detail: 531120,
  location: 531812,
} as const

export const VISIT_REMINDER_TEMPLATE = `Hola, [Saludo La Vilet]. Es un gusto saludarle. Le recordamos que tiene una cita agendada en La Vilet [Detalle de cita La Vilet].

Le compartimos nuestra ubicación para facilitar su llegada: [Ubicación La Vilet]

Si tiene alguna consulta o necesita cambiar el horario, escríbanos por aquí. ¡Le esperamos!`

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function localParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_REMINDER_DATE')
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { date, year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')) }
}

/** Uses a name only when the CRM value clearly looks like a person's name. */
export function verifiedLeadFirstName(value: unknown) {
  const raw = text(value).trim()
  if (!raw || /\d|@|https?:|\b(?:sin nombre|cliente|lead|contacto|prospecto|desconocid[oa]|whatsapp)\b/i.test(raw)) return ''
  const first = raw.split(/\s+/)[0] ?? ''
  return /^[\p{L}][\p{L}'’-]{1,39}$/u.test(first) ? first : ''
}

export function buildReminderGreeting(leadName: unknown, sentAt: string | Date = new Date()) {
  const { hour } = localParts(sentAt)
  const greeting = hour < 12 ? 'buenos días' : hour < 19 ? 'buenas tardes' : 'buenas noches'
  const first = verifiedLeadFirstName(leadName)
  return first ? `${greeting}, ${first}` : greeting
}

function reminderClock(value: string | Date) {
  const { hour, minute } = localParts(value)
  const suffix = hour >= 12 ? 'p. m.' : 'a. m.'
  const hour12 = hour % 12 || 12
  const article = hour12 === 1 ? 'a la' : 'a las'
  return `${article} ${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function reminderDay(start: string | Date, sentAt: string | Date) {
  const at = sentAt instanceof Date ? sentAt : new Date(sentAt)
  const date = start instanceof Date ? start : new Date(start)
  const day = ecuadorYmd(date), today = ecuadorYmd(at)
  if (day === today) return 'hoy'
  if (day === addYmd(today, 1)) return 'mañana'
  const { year, month, day: dayNumber } = localParts(date)
  const localNoon = new Date(`${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}T12:00:00-05:00`)
  return `el ${DAYS[localNoon.getUTCDay()]} ${dayNumber} de ${MONTHS[month - 1]}`
}

function cleanUnit(value: unknown) {
  const result = text(value).trim()
  return /^[\p{L}\d-]{1,24}$/u.test(result) ? result : ''
}

function categoryReason(category: string, unitNumber = '') {
  if (unitNumber) {
    if (category === 'suite') return `para revisar los detalles de la suite ${unitNumber}`
    if (category === 'local') return `para revisar los detalles del local ${unitNumber}`
    if (category === 'departamento') return `para revisar los detalles del departamento ${unitNumber}`
  }
  if (category === 'suite') return 'para conocer más sobre nuestras suites'
  if (category === 'departamento') return 'para conocer las opciones de departamentos del proyecto'
  if (category === 'local') return 'para conocer las opciones de locales comerciales del proyecto'
  return 'para conocer el proyecto'
}

export function reminderVisitReason(units: Row[], preferredCategory: unknown) {
  const verified = units.map(row => {
    const unit = row.unit && typeof row.unit === 'object' && !Array.isArray(row.unit) ? row.unit as Row : row
    return { category: text(unit.category), number: cleanUnit(unit.unit_number) }
  }).filter(unit => ['suite', 'departamento', 'local'].includes(unit.category) && unit.number)
  if (verified.length === 1) return categoryReason(verified[0].category, verified[0].number)
  const categories = [...new Set(verified.map(unit => unit.category))]
  if (categories.length === 1) return categoryReason(categories[0])
  return categoryReason(text(preferredCategory))
}

function advisorReference(name: unknown, title: unknown) {
  const advisorName = text(name).trim()
  if (!advisorName || advisorName.length > 120 || /[\r\n]/.test(advisorName)) throw new Error('REMINDER_ADVISOR_MISSING')
  const normalizedTitle = text(title).trim().toLocaleLowerCase('es')
  if (['asesora', 'femenino', 'femenina', 'female'].includes(normalizedTitle)) return `nuestra asesora ${advisorName}`
  return `nuestro asesor ${advisorName}`
}

export function buildReminderDetail(params: {
  startIso: string
  sentAt?: string | Date
  advisorName: unknown
  advisorTitle?: unknown
  units?: Row[]
  preferredCategory?: unknown
}) {
  const at = params.sentAt ?? new Date()
  const reason = reminderVisitReason(params.units ?? [], params.preferredCategory)
  return `${reminderDay(params.startIso, at)} ${reminderClock(params.startIso)} con ${advisorReference(params.advisorName, params.advisorTitle)} ${reason}`
}

export function verifiedGoogleMapsUrl(value: unknown) {
  const raw = text(value).trim()
  if (raw.length > 255) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && (url.hostname === 'maps.app.goo.gl' || /(^|\.)google\.[a-z.]+$/i.test(url.hostname)) ? raw : ''
  } catch { return '' }
}

export function googleMapsSearchUrl(address: unknown) {
  const value = text(address).trim()
  if (!value || value.length > 300 || /[\r\n]/.test(value)) return ''
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
  return url.length <= 255 ? url : ''
}

export function buildVisitReminderFields(context: Row, sentAt: string | Date = new Date()) {
  const appointment = context.appointment && typeof context.appointment === 'object' ? context.appointment as Row : {}
  const lead = context.lead && typeof context.lead === 'object' ? context.lead as Row : {}
  const job = context.job && typeof context.job === 'object' ? context.job as Row : {}
  const payload = job.payload && typeof job.payload === 'object' ? job.payload as Row : {}
  const startIso = text(appointment.start_time)
  const location = verifiedGoogleMapsUrl(context.location) || googleMapsSearchUrl(context.address || appointment.meeting_place)
  if (!location) throw new Error('REMINDER_LOCATION_MISSING')
  return {
    greeting: buildReminderGreeting(lead.name, sentAt),
    detail: buildReminderDetail({ startIso, sentAt, advisorName: context.advisor_name,
      advisorTitle: context.advisor_title, units: Array.isArray(context.appointment_units) ? context.appointment_units as Row[] : [],
      preferredCategory: payload.preferred_category || lead.preferred_category }),
    location,
  }
}

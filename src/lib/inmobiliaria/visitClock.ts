import { ecuadorYmd } from './agendaTime'

export const VISIT_DURATION_MINUTES = 60

export function addMinutesHm(hm: string, minutes: number): string {
  if (!hm) return ''
  const [h, m] = hm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ''
  const next = (h * 60 + m + minutes) % (24 * 60)
  const normalized = next < 0 ? next + 24 * 60 : next
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function addOneHour(hm: string): string {
  return addMinutesHm(hm, VISIT_DURATION_MINUTES)
}

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function guayaquilClock(iso: string | Date) {
  const date = iso instanceof Date ? iso : new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { hour: Number(get('hour')), minute: Number(get('minute')) }
}

export function formatVisitClock(iso: string | Date): string {
  const { hour, minute } = guayaquilClock(iso)
  const suffix = hour >= 12 ? 'p. m.' : 'a. m.'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const article = hour12 === 1 ? 'a la' : 'a las'
  const minutes = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`
  return `${article} ${hour12}${minutes} ${suffix}`
}

export function formatVisitDate(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  const ymd = ecuadorYmd(date)
  const [, month, day] = ymd.split('-').map(Number)
  const noon = new Date(`${ymd}T12:00:00-05:00`)
  const isoDow = (noon.getUTCDay() + 6) % 7
  return `el ${DAYS[isoDow]} ${day} de ${MONTHS[(month ?? 1) - 1]}`
}

export function formatVisitWhen(iso: string | Date): string {
  return `${formatVisitDate(iso)} ${formatVisitClock(iso)}`
}

export function buildVisitConfirmMessage(params: {
  leadName: string
  advisorName: string
  startIso: string
  locationUrl?: string | null
}): string {
  const first = params.leadName.trim().split(/\s+/)[0] || 'cliente'
  const advisor = params.advisorName.trim() || 'nuestro equipo'
  const url = params.locationUrl?.trim()
  const location = url ? ` Aquí puede ver nuestra ubicación:\n${url}` : ''
  return `Perfecto, ${first}. Le esperamos ${formatVisitWhen(params.startIso)} con ${advisor}, de nuestro equipo. Será un gusto recibirle y mostrarle el proyecto.${location}\nSi necesita alguna indicación, puede escribirnos por aquí. ¡Muchas gracias!`
}

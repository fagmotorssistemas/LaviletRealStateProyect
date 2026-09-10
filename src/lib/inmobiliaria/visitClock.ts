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

export function buildVisitMessage(params: {
  kind: 'visit_propose' | 'visit_confirm' | 'visit_reschedule_confirm' | 'visit_2h'
  leadName: string; advisorName?: string; startIso: string; locationUrl?: string | null
}): string {
  const first = params.leadName.trim().split(/\s+/)[0] || ''
  const advisor = params.advisorName?.trim() || ''
  const location = params.locationUrl?.trim()
  const suffix = location ? '\nUbicación:\n' + location : ''
  const when = formatVisitWhen(params.startIso)
  let result: string
  if (params.kind === 'visit_propose') {
    result = 'Con gusto podemos recibirle ' + when + ' para conocer La Vilet. ¿Le queda bien o prefiere otro horario?'
  } else if (params.kind === 'visit_2h') {
    result = 'Le esperamos hoy ' + formatVisitClock(params.startIso) + ' en La Vilet. Será un gusto recibirle. Si necesita cambiar el horario, cuéntenos por aquí.' + suffix
  } else {
    result = 'Perfecto' + (first ? ', ' + first : '') + '. Confirmamos su cita ' + when
      + (advisor ? ' con nuestro asesor ' + advisor : ' con nuestro equipo') + '. Será un gusto recibirle.' + suffix
  }
  // El campo de Salesbot admite 256 caracteres. Acortar el texto, nunca cortar el enlace o la hora.
  if (result.length > 256) {
    const day = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(params.startIso))
    result = result.replace(when, 'el ' + day + ' ' + formatVisitClock(params.startIso))
  }
  if (result.length > 256 && first) result = result.replace('Perfecto, ' + first + '.', 'Perfecto.')
  if (result.length > 256 && advisor) result = result.replace('nuestro asesor ' + advisor, 'nuestro equipo')
  if (result.length > 256) throw new Error('El enlace de ubicación es demasiado largo para el mensaje de visita')
  return result
}

export function buildVisitConfirmMessage(params: {
  leadName: string; advisorName: string; startIso: string; locationUrl?: string | null
}) {
  return buildVisitMessage({ ...params, kind: 'visit_confirm' })
}

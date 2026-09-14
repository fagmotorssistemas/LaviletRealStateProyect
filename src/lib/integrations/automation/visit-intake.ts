import { formatVisitDateRelative, formatVisitWhen, formatVisitWhenRelative } from '@/lib/inmobiliaria/visitClock'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { visitCoordinationReply } from './conversation-style'

// Normalize expressive spelling only in date/hour words. Keep the original
// message in the transcript; this value is for routing, never for booking.
export function visitDetailText(current: string) {
  return normalized(current)
    .replace(/\bma+n+a+(?:n+a+)+\b/g, 'manana')
    .replace(/\bmalana\b/g, 'manana')
    .replace(/\bo+ch+o+(?:i)?\b/g, 'ocho')
    .replace(/\blass+\b/g, 'las')
}
function differentVisitTopic(value: string) {
  return /\b(?:departamentos?|suites?|local(?:es)?|financiamiento|credito|banco|precio|brochure|modelo|plano)\b/.test(value)
    && !/\b(?:visita|visitar|cita|agendar|reagendar|reprogramar|hora|horario|horarios)\b/.test(value)
}
export function needsVisitHelp(current: string) {
  const value = visitDetailText(current)
  if (differentVisitTopic(value)) return false
  return /no (?:estoy segur[oa]|se\b)|(?:que|cual|cuando|a que) (?:dia |hora |horario )?.*(?:pued[eo]|pueden|tienen|disponible|agendar|ir\b|venir|visitar)|(?:que|cuales) (?:otras? )?(?:opciones|horarios|alternativas) (?:tiene|hay|quedan)|suger|recomiend|digame (?:ud|usted)|elija|propongan|confirme el asesor/.test(value)
    || (/\b(?:prefiero|quiero|deme|denme|mejor) (?:otra|otro|otras|otros)\b/.test(value) && !isVisitDetail(current))
}
export function isVisitDetail(current: string) {
  const value = visitDetailText(current)
  return /\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|hora|reagendar|reprogramar|cita|visita)\b/.test(value)
    || /\b(?:a\s+)?las?\s+s?\s*(?:\d|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(value)
    || /^\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|horas))?$/.test(current.trim())
}
export function visitTurnIntent(current: string): 'counterproposal' | 'question' | null {
  const value = visitDetailText(current)
  if (differentVisitTopic(value)) return null
  if (/\b(?:cancelar|cancelo|cancelacion)\b/.test(value)) return null
  if (needsVisitHelp(current) || /\b(?:reagendar|reprogramar|cambiar (?:mi |la )?(?:cita|hora|fecha)|prefiero otr[oa]|otra opcion|otro horario)\b/.test(value)) return 'counterproposal'
  // Date fragments are an answer to coordination even if the model mistakes
  // their expressive spelling or reads "mañana" as a period of the day.
  if (/^(?:si |no |para |el |la |mejor |no digo |digo |siguiente |proximo |proxima |semana )*(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value)
    || /\b(?:mejor|prefiero|quise decir)\s+(?:para |el |la |siguiente |proximo |proxima |semana )*(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value)
    || /^(?:para )?(?:a )?las? (?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(value)) return 'counterproposal'
  return null
}
export function intakeReply(result: Row, at: string | Date = new Date()) {
  const slot = object(result.slot)
  const day = text(slot.requested_date)
  const dayLabel = day ? formatVisitDateRelative(`${day}T12:00:00-05:00`, at) : ''
  const coordinationReply = () => {
    const reply = visitCoordinationReply(slot)
    return slot.start_time && slot.confidence === 'exact'
      ? reply.replace(formatVisitWhen(text(slot.start_time)), formatVisitWhenRelative(text(slot.start_time), at)) : reply
  }
  if (result.action === 'stale') return 'El horario cambió mientras revisábamos su mensaje. Permítanos comprobar la solicitud antes de continuar.'
  if (result.action === 'closed_day') return `Lo sentimos, ${dayLabel} no atendemos visitas. ¿Qué otra fecha le vendría bien?`
  if (result.action === 'past') return 'Ese horario ya pasó. ¿Qué otra fecha y hora le vendrían bien?'
  if (result.action === 'outside_hours') {
    const hours = object(result.hours)
    return `Ese horario queda fuera de nuestra atención${hours.open && hours.close ? `, de ${hours.open} a ${hours.close}` : ''}. La visita dura una hora. ¿Le vendría bien otro horario?`
  }
  if (result.action === 'submitted' && result.needs_help === true) {
    if (slot.start_time && result.review_reason) return `Tomamos en cuenta ${dayLabel} y la hora que nos indicó. El asesor revisará si podemos recibirle en ese horario y le responderá por aquí; su cita todavía no está confirmada.`
    if (slot.start_time) return coordinationReply()
    const period = result.preferred_period === 'afternoon' ? 'por la tarde' : result.preferred_period === 'morning' ? 'por la mañana' : ''
    return `Claro, le ayudamos a elegir. El equipo revisará su agenda${dayLabel ? ' para ' + dayLabel : ''}${period ? ' ' + period : ''} y le enviará una propuesta por aquí para que pueda confirmarla.`
  }
  if (result.action === 'collecting' && day && !slot.has_time) return `Perfecto, para ${dayLabel}. ¿A qué hora le gustaría venir?`
  return coordinationReply()
}

/** Business hours describe the team's working window, not free calendar slots. */
export function visitBusinessHoursReply(hours: unknown, result: Row, at: string | Date = new Date()) {
  const names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  const groups: { days: number[]; open: string; close: string }[] = []
  for (let day = 1; day <= 7; day++) {
    const slot = object(object(hours)[String(day)])
    if (!/^\d{2}:\d{2}$/.test(text(slot.open)) || !/^\d{2}:\d{2}$/.test(text(slot.close))) continue
    const previous = groups.at(-1)
    if (previous && previous.open === slot.open && previous.close === slot.close && previous.days.at(-1) === day - 1) previous.days.push(day)
    else groups.push({ days: [day], open: text(slot.open), close: text(slot.close) })
  }
  if (!groups.length) return ''
  const parts = groups.map(group => `${group.days.length > 1 ? 'de ' + names[group.days[0] - 1] + ' a ' + names[group.days.at(-1)! - 1] : 'los ' + names[group.days[0] - 1]} de ${group.open} a ${group.close}`)
  const day = text(object(result.slot).requested_date)
  const request = day
    ? `Para ${formatVisitDateRelative(day + 'T12:00:00-05:00', at)}, indíquenos qué hora le vendría bien`
    : 'Indíquenos qué fecha y hora le vendrían bien'
  return `Nuestro horario de atención es ${parts.join('; ')}. ${request}; verificaremos la disponibilidad del equipo y le confirmaremos la cita por aquí.`
}

import { formatVisitDate } from '@/lib/inmobiliaria/visitClock'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { visitCoordinationReply } from './conversation-style'

export function needsVisitHelp(current: string) {
  return /no (?:estoy segur[oa]|se\b)|(?:que|cual) (?:dia|hora|horario).*(?:pueden|tienen|disponible)|suger|recomiend|digame (?:ud|usted)|elija|propongan|confirme el asesor/.test(normalized(current))
}
export function isVisitDetail(current: string) {
  return /\b(?:manana|malana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|hora|reagend|cita|visita)\b/.test(normalized(current))
    || /^(?:a\s+)?las?\s+s?\s*\d/.test(normalized(current)) || /^\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|horas))?$/.test(current.trim())
}
export function intakeReply(result: Row) {
  const slot = object(result.slot)
  const day = text(slot.requested_date)
  const dayLabel = day ? formatVisitDate(`${day}T12:00:00-05:00`) : ''
  if (result.action === 'stale') return 'El horario cambió mientras revisábamos su mensaje. Permítanos comprobar la solicitud antes de continuar.'
  if (result.action === 'closed_day') return `Lo sentimos, ${dayLabel} no atendemos visitas. ¿Qué otra fecha le vendría bien?`
  if (result.action === 'past') return 'Ese horario ya pasó. ¿Qué otra fecha y hora le vendrían bien?'
  if (result.action === 'outside_hours') {
    const hours = object(result.hours)
    return `Ese horario queda fuera de nuestra atención${hours.open && hours.close ? `, de ${hours.open} a ${hours.close}` : ''}. La visita dura una hora. ¿Le vendría bien otro horario?`
  }
  if (result.action === 'submitted' && result.needs_help === true) {
    const period = result.preferred_period === 'afternoon' ? 'por la tarde' : result.preferred_period === 'morning' ? 'por la mañana' : ''
    return `Claro, le ayudamos a elegir. El equipo revisará su agenda${dayLabel ? ' para ' + dayLabel : ''}${period ? ' ' + period : ''} y le enviará una propuesta por aquí para que pueda confirmarla.`
  }
  if (result.action === 'collecting' && day && !slot.has_time) return `Perfecto, para ${dayLabel}. ¿A qué hora le gustaría venir?`
  return visitCoordinationReply(slot)
}

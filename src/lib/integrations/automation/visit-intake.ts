import { addMinutesHm,formatVisitClock,formatVisitDateRelative,formatVisitWhen,formatVisitWhenRelative } from '@/lib/inmobiliaria/visitClock'
import { visitCoordinationReply } from './conversation-style'
import { object,text,type Row } from './data'

/** Kept for display compatibility; this does not identify scheduling meaning. */
export function visitDetailText(current: string) { return current }
const semantic = (input: unknown) => { const row = object(input); return object(row.semantica_turno || row.turn_semantics || row) }
export function needsVisitHelp(_current: string, interpreted: unknown = {}) { return object(semantic(interpreted).routing).visit_help === true }
export function visitHoursWereOffered(_lastReply: string, receipt: unknown = {}) { return object(receipt).kind === 'visit_hours' }
export function isVisitDetail(_current: string, interpreted: unknown = {}) { return ['coordination', 'preference', 'accept_alternative'].includes(text(object(semantic(interpreted).visit_intent).purpose)) }
export function visitTurnIntent(_current: string, interpreted: unknown = {}): 'counterproposal' | 'question' | null {
  const response = object(semantic(interpreted).routing).visit_response
  return response === 'counterproposal' || response === 'question' ? response : null
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
  if (result.action === 'collecting' && result.needs_location === true) {
    const enabled=Array.isArray(result.enabled_places) ? result.enabled_places : []
    const labels:Record<string,string>={office:'nuestra oficina',site:'el terreno del proyecto',work_area:'el área autorizada de obra',model:'el departamento modelo',completed_unit:'las unidades terminadas habilitadas'}
    const places=enabled.map(value=>labels[String(value)]).filter(Boolean)
    const options=places.length===2?`${places[0]} o ${places[1]}`:places.length>2?`${places.slice(0,-1).join(', ')} o ${places.at(-1)}`:places[0]||'uno de los lugares habilitados'
    return `Ya tengo la fecha y la hora. ¿Prefiere realizar la visita en ${options}?`
  }
  if (result.action === 'submitted' && result.needs_help === true) {
    if (slot.start_time) return `${result.registration_verified === true ? 'Su solicitud quedó registrada' : 'Tenemos su preferencia'} para ${formatVisitWhenRelative(text(slot.start_time), at)} El equipo revisará ese horario y le responderá por aquí.`
    const period = result.preferred_period === 'afternoon' ? 'por la tarde' : result.preferred_period === 'morning' ? 'por la mañana' : ''
    return `Claro, le ayudamos a elegir. El equipo revisará su agenda${dayLabel ? ' para ' + dayLabel : ''}${period ? ' ' + period : ''} y le enviará una propuesta por aquí para que pueda confirmarla.`
  }
  if (result.action === 'submitted' && result.registration_verified === true) {
    return `Su solicitud quedó registrada${slot.start_time ? ' para ' + formatVisitWhenRelative(text(slot.start_time), at) : '.'} El equipo revisará ${slot.start_time ? 'ese horario' : 'su agenda'} y le responderá por aquí.`
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
  const recurringNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos']
  const parts = groups.map(group => `${group.days.length > 1 ? 'de ' + names[group.days[0] - 1] + ' a ' + names[group.days.at(-1)! - 1] : 'los ' + recurringNames[group.days[0] - 1]} de ${group.open} a ${group.close}`)
  if (result.action === 'information') return `Nuestro horario de atención es ${parts.join('; ')}.`
  const slot = object(result.slot)
  const day = text(slot.requested_date)
  const start = text(slot.start_time)
  const preferredClock = start ? formatVisitClock(start) : ''
  const timeParts = start ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start)) : ''
  const validDaysForTime = /^\d{2}:\d{2}$/.test(timeParts) ? groups.filter(group => {
    return timeParts >= group.open && addMinutesHm(timeParts, 60) <= group.close
  }) : []
  const validDayNames = validDaysForTime.flatMap(group => group.days.map(value => names[value - 1]))
  if (result.action === 'closed_day' && day) {
    const closedDay = formatVisitDateRelative(day + 'T12:00:00-05:00', at)
    const timeChoice = preferredClock && validDayNames.length
      ? `Como indicó ${preferredClock}, puede solicitar esa hora ${validDayNames.length > 1 ? 'de ' + validDayNames[0] + ' a ' + validDayNames.at(-1) : 'el ' + validDayNames[0]}. ¿Qué día le convendría?`
      : '¿Qué otro día y hora le convendrían dentro de esos horarios?'
    return `${closedDay.charAt(0).toLocaleUpperCase('es-EC') + closedDay.slice(1)} no está habilitado para visitas. Nuestro horario de atención es ${parts.join('; ')}. ${timeChoice}`
  }
  if (result.action === 'outside_hours' && day) {
    return `La hora indicada queda fuera del horario de atención. Atendemos ${parts.join('; ')}. ¿Qué hora dentro de ese horario le convendría para ${formatVisitDateRelative(day + 'T12:00:00-05:00', at)}?`
  }
  const request = day
    ? `Para ${formatVisitDateRelative(day + 'T12:00:00-05:00', at)}, indíquenos qué hora le vendría bien`
    : 'Después de revisar estos horarios, indíquenos qué fecha y hora le vendrían bien'
  return `Nuestro horario de atención es ${parts.join('; ')}. ${request} para coordinar su visita.`
}

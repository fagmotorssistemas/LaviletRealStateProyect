import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'

export function isConversationRepair(current: string) {
  if (/que significa|a que se refiere|que quiere decir|explic|no entiendo (?:el|la|los|las|eso de)\b/.test(normalized(current))) return false
  return /^[¿?\s]+$/.test(current.trim()) || /ya (?:te |le |lo |se lo |les |si )?(?:dije|respondi)|(?:por que )?repites|repite lo mismo|eso no (?:fue|es) lo que|no (?:me )?entend/.test(normalized(current))
}
export function asksVisitStatus(current: string) {
  if (/cancel|reagend|reprogram|cambiar/.test(normalized(current))) return false
  return /(?:ya quedamos|(?:esta|quedo|esta o no|quedo o no).*confirmad|tenemos.*cita|cita.*confirmad)/.test(normalized(current))
}
export function explicitlyRequestsVisit(current: string) {
  return /\b(?:agendar|agendemos|reagendar|reprogramar|reservar una cita|coordinar.*(?:cita|visita)|quiero.*(?:cita|visita|visitar)|quisiera.*(?:cita|visita|visitar)|gustaria.*(?:cita|visita|visitar)|puedo (?:ir|visitar)|cambiar.*(?:cita|hora|dia))\b/.test(normalized(current))
}
export function visitStatusReply(proposals: Row[], collecting: boolean) {
  if (proposals.length !== 1) return ''
  const p = proposals[0]
  const when = text(p.appointment_start_time || p.proposed_start_time || object(p.requested_slot).start_time)
  if (p.status === 'confirmed' && !collecting) return when
    ? `Sí, su cita está confirmada para ${formatVisitWhen(when)} Le esperamos.`
    : 'Sí, su cita está confirmada. Le esperamos.'
  if (collecting) return 'Estamos coordinando el cambio de horario; la nueva fecha todavía no está confirmada.'
  if (p.status === 'awaiting_advisor') return 'Su solicitud está registrada y el asesor está revisando el horario. Le confirmaremos por aquí cuando la acepte.'
  if (p.status === 'awaiting_client') return when
    ? `Tenemos una propuesta para ${formatVisitWhen(when)} ¿Le queda bien ese horario?`
    : 'El asesor le envió una propuesta y estamos esperando su confirmación. ¿Le queda bien ese horario?'
  return ''
}
export function declinedFollowup(current: string, lastReply: string) {
  if (!/^(?:no|no gracias|por ahora no|no por ahora|no muchas gracias)$/.test(normalized(current))) return ''
  const previous = normalized(lastReply)
  if (/cancelad.*cita|cancelad.*visita/.test(previous)) return 'Entendido, dejamos la cita cancelada. Cuando desee retomarla, puede escribirnos.'
  if (/financiamiento|revision|entidad|pichincha|jep/.test(previous)) return 'Está bien, dejamos la revisión de financiamiento para otro momento.'
  if (/visita|visitar|venir|agendar/.test(previous)) return 'Está bien, dejamos la visita para otro momento.'
  return ''
}

export const TURN_RULES = `Interprete SOLO la intención del turno actual; el historial explica referencias, no genera eventos nuevos.
Las propuestas/citas y la coordinación adjuntas son el estado real. «Estaré puntual», «allí estaré», «nos vemos» y agradecimientos NO solicitan una cita nueva. «Ya quedamos en una cita o no» consulta su estado, no solicita agendar.
«No» tras ofrecer otra fecha después de cancelar rechaza reagendar; no retoma financiamiento ni significa opt-out.
«??», «ya te dije», «por qué repites» reclaman incoherencia: reconozca y use la respuesta previa del cliente, no salude ni reinicie un formulario.
Pedir hablar con una persona tiene prioridad sobre un formulario anterior. Nunca extraiga nombre, entidad, consentimiento ni datos económicos del historial como si acabaran de decirse.`

import { actionAuthorized } from './action-authority'
import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'
import { object,text,type Row } from './data'

const semantic = (input: unknown) => { const row = object(input); return object(row.semantica_turno || row.turn_semantics || row) }
export function isConversationRepair(_current: string, interpreted: unknown = {}) { return object(semantic(interpreted).routing).repair_requested === true }
export function asksVisitStatus(_current: string, _lastReply = '', interpreted: unknown = {}) { void _lastReply;  return object(semantic(interpreted).visit_intent).kind === 'visit_status' }
export function asksTeamAttendance(_current: string, interpreted: unknown = {}) { return object(semantic(interpreted).routing).team_attendance === true }

export function teamAttendanceReply(appointments: Row[], proposals: Row[]) {
  const confirmed = appointments.filter(a => ['aceptado', 'reprogramado'].includes(text(a.status)))
  if (confirmed.length === 1) return `Tenemos confirmada su visita a La Vilet para ${formatVisitWhen(text(confirmed[0].start_time))} Si se refiere a una visita del equipo a otro lugar, esa coordinación necesita que la verifique un asesor.`
  if (confirmed.length > 1) return 'Tenemos visitas a La Vilet confirmadas. ¿A cuál de ellas se refiere para comprobarlo con el equipo?'
  if (proposals.some(p => ['awaiting_advisor', 'awaiting_client'].includes(text(p.status)))) return 'Gracias por su mensaje. Tenemos una solicitud de visita a La Vilet pendiente de confirmación; todavía no hay una cita confirmada. Puede haber una confusión con otra coordinación.'
  return 'Gracias por su mensaje. Lamento la confusión: no tenemos una cita confirmada con usted. Si se refiere a una coordinación con alguien de nuestro equipo, podemos ayudarle a verificarla.'
}

/** Legacy text permission parsing is retired. The common extractor owns permission. */
export function visitRequestPermissionVeto(_current: string, _evidence = _current, interpreted: unknown = {}): boolean { void _evidence;
  const decision = object(object(semantic(interpreted).action_authority).visit)
  return decision.decision === 'decline' || ['reported', 'conditional', 'hypothetical'].includes(text(decision.attribution))
}
export function explicitlyRequestsVisit(_current: string, interpreted: unknown = {}) { return actionAuthorized(semantic(interpreted).action_authority, 'visit') }
export function hasUnrelatedAppointmentTarget(_current: string, interpreted: unknown = {}) { return object(semantic(interpreted).visit_intent).target === 'other' }

export function visitStatusReply(proposals: Row[], collecting: boolean) {
  if (proposals.length !== 1) return ''
  const p = proposals[0]
  const when = text(p.appointment_start_time || p.proposed_start_time || object(p.requested_slot).start_time)
  if (p.status === 'confirmed' && !collecting) return when
    ? `Sí, su cita está confirmada para ${formatVisitWhen(when)} Le esperamos.`
    : 'Sí, su cita está confirmada. Le esperamos.'
  if (collecting) return 'Estamos coordinando el cambio de horario; la nueva fecha todavía no está confirmada.'
  if (p.status === 'awaiting_advisor') return 'Su solicitud está pendiente de revisión. Aún no tengo una hora de confirmación; le avisaremos por aquí cuando el equipo verifique la disponibilidad.'
  if (p.status === 'awaiting_client') return when
    ? `Tenemos una propuesta para ${formatVisitWhen(when)} ¿Le queda bien ese horario?`
    : 'El asesor le envió una propuesta y estamos esperando su confirmación. ¿Le queda bien ese horario?'
  return ''
}
export function declinedFollowup(_current: string, _lastReply: string, semantics: unknown = {}) {
  const answer = object(object(semantics).answer_to_previous)
  if (answer.kind !== 'negative' || !['high','medium'].includes(text(answer.confidence))) return ''
  return answer.question_id === 'financing_invitation' ? 'Podemos dejar la revisión financiera para otro momento.'
    : answer.question_id === 'visit_invitation' ? 'Podemos dejar la visita para otro momento.' : ''
}

export const TURN_RULES = `Interprete SOLO la intención del turno actual; el historial explica referencias, no genera eventos nuevos.
«¿Va a venir a la cita?» pregunta si alguien del equipo acudirá; no autoriza agendar ni demuestra una cita real. Compruebe las citas existentes; no se presente como asistente virtual por este motivo.
«¿Puedo hacer una visita?» o «¿Es posible visitar la oficina?» pide coordinar una visita, incluso si también solicita detalles del proyecto. Responda ambas necesidades sin pedirle repetir la solicitud. Agendar vuelos, servicios médicos u otra actividad ajena no solicita una cita inmobiliaria; no use una coordinación pendiente para interpretar ese mensaje como fecha u hora de una visita.
Las propuestas/citas y la coordinación adjuntas son el estado real. «Estaré puntual», «allí estaré», «nos vemos» y agradecimientos NO solicitan una cita nueva. «Ya quedamos en una cita o no» consulta su estado, no solicita agendar.
«No» tras ofrecer otra fecha después de cancelar rechaza reagendar; no retoma financiamiento ni significa opt-out.
«??», «ya te dije», «por qué repites» reclaman incoherencia: reconozca y use la respuesta previa del cliente, no salude ni reinicie un formulario.
Pedir hablar con una persona tiene prioridad sobre un formulario anterior. Nunca extraiga nombre, entidad, consentimiento ni datos económicos del historial como si acabaran de decirse.`

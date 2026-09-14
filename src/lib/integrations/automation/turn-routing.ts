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
export function asksTeamAttendance(current: string) {
  const value = normalized(current)
  return /\b(?:va a venir|van a venir|vendran?|vienen|viene|va a asistir|van a asistir)\b/.test(value)
    && /\b(?:cita|reunion|hoy|manana|esperando|esperamos|acordamos)\b/.test(value)
    && !/\b(?:puedo|quiero|quisiera|me gustaria|voy a) (?:ir|venir|asistir)\b/.test(value)
}

export function teamAttendanceReply(appointments: Row[], proposals: Row[]) {
  const confirmed = appointments.filter(a => ['aceptado', 'reprogramado'].includes(text(a.status)))
  if (confirmed.length === 1) return `Tenemos confirmada su visita a La Vilet para ${formatVisitWhen(text(confirmed[0].start_time))} Si se refiere a una visita del equipo a otro lugar, esa coordinación necesita que la verifique un asesor.`
  if (confirmed.length > 1) return 'Tenemos visitas a La Vilet confirmadas. ¿A cuál de ellas se refiere para comprobarlo con el equipo?'
  if (proposals.some(p => ['awaiting_advisor', 'awaiting_client'].includes(text(p.status)))) return 'Gracias por su mensaje. Tenemos una solicitud de visita a La Vilet pendiente de confirmación; todavía no hay una cita confirmada. Puede haber una confusión con otra coordinación.'
  return 'Gracias por su mensaje. Lamento la confusión: no tenemos una cita confirmada con usted. Si se refiere a una coordinación con alguien de nuestro equipo, podemos ayudarle a verificarla.'
}
export function explicitlyRequestsVisit(current: string) {
  if (asksTeamAttendance(current)) return false
  // Permission questions are requests too. Evaluate each clause so an unrelated
  // booking or a declined visit cannot borrow an intent from another question.
  return current.split(/[.!?;\n]+|\bpero\b|\badem[aá]s\b/iu).some(clause => {
    const value = normalized(clause)
    if (!value || /\b(?:no|tampoco|ni) (?:quiero|quisiera|puedo|podemos|deseo|me interesa|me gustaria|necesito)\b/.test(value)) return false
    if (hasUnrelatedAppointmentTarget(value)) return false
    if (/\b(?:puedo|podemos|podria|podriamos|se puede|es posible) (?:hacer |realizar |tener |solicitar |coordinar |agendar )?(?:una |la )?(?:visita|visitar|cita|ir|venir|pasar)\b/.test(value)) return true
    if (/\b(?:quiero|quisiera|necesito) (?:saber|consultar|confirmar|revisar)\b/.test(value) || /\b(?:ya|ayer) (?:agende|agendamos|coordine|coordinamos|reserve|reservamos)\b/.test(value)) return false
    if (/\b(?:quiero|quisiera|deseo|me interesa|me gustaria|necesito)\b.*\b(?:visita|visitar|cita|ir a (?:verlo|verla|conocerlo|conocerla)|(?:verlo|verla|conocerlo|conocerla) en persona|(?:ir|pasar|acercarme) (?:a|por) (?:la |su )?oficina)\b/.test(value)) return true
    if (/\b(?:agendar|agendemos|agenden|agendame|agendarme|reagendar|reprogramar|reservar|coordinar|coordinemos|programar|programemos|cambiar)\b.*\b(?:cita|visita|horario de visita|hora de la cita|dia de la cita)\b/.test(value)) return true
    if (/\b(?:reagendar|reprogramar) (?:para (?:hoy|manana|el |la proxima)|a las? \d)\b/.test(value)) return true
    // A short acceptance/command can use the ongoing property conversation, but
    // "agendar un vuelo/servicio" must never create a property appointment.
    return /^(?:(?:si|entonces|bueno|por favor|quiero|quisiera|podemos) )*(?:agendar|agendemos|reagendar|reprogramar|coordinemos)(?: (?:por favor|para (?:hoy|manana|el \w+)))?$/.test(value)
  })
}
export function hasUnrelatedAppointmentTarget(current: string) {
  const value = normalized(current)
  const otherService = '\\b(?:vuelo|vuelos|aerolinea|boleto|boletos|pasaje|pasajes|viaje|viajes|agencia de viajes|hotel|hoteles|restaurante|restaurantes|medico|medica|dentista|odontologo|hospital|clinica|peluqueria|barberia|manicura|masaje|veterinario|taller mecanico|revision vehicular|revision de (?:mi |un |el )?(?:carro|auto|vehiculo|moto)|prueba de manejo)\\b'
  // Nearby restaurants or arrival by plane are valid property context. Block
  // requests to book those services, not every mention of an unrelated noun.
  return new RegExp('\\b(?:agendar|agendemos|agende|agendamiento|reagendar|reprogramar|reservar|reserva|reservacion|cita|consulta|visita|visitar|coordinar)\\b(?:(?!\\b(?:departamento|suite|local|proyecto|oficina|lavilet|la vilet)\\b).){0,70}' + otherService).test(value)
    || new RegExp(otherService + '.{0,35}\\b(?:agende|agendamos|reserve|reservamos|reservado|agendado)\\b').test(value)
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
«¿Va a venir a la cita?» pregunta si alguien del equipo acudirá; no autoriza agendar ni demuestra una cita real. Compruebe las citas existentes; no se presente como asistente virtual por este motivo.
«¿Puedo hacer una visita?» o «¿Es posible visitar la oficina?» pide coordinar una visita, incluso si también solicita detalles del proyecto. Responda ambas necesidades sin pedirle repetir la solicitud. Agendar vuelos, servicios médicos u otra actividad ajena no solicita una cita inmobiliaria; no use una coordinación pendiente para interpretar ese mensaje como fecha u hora de una visita.
Las propuestas/citas y la coordinación adjuntas son el estado real. «Estaré puntual», «allí estaré», «nos vemos» y agradecimientos NO solicitan una cita nueva. «Ya quedamos en una cita o no» consulta su estado, no solicita agendar.
«No» tras ofrecer otra fecha después de cancelar rechaza reagendar; no retoma financiamiento ni significa opt-out.
«??», «ya te dije», «por qué repites» reclaman incoherencia: reconozca y use la respuesta previa del cliente, no salude ni reinicie un formulario.
Pedir hablar con una persona tiene prioridad sobre un formulario anterior. Nunca extraiga nombre, entidad, consentimiento ni datos económicos del historial como si acabaran de decirse.`

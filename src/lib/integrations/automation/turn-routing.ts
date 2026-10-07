import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'

export function isConversationRepair(current: string) {
  if (/que significa|a que se refiere|que quiere decir|explic|no entiendo (?:el|la|los|las|eso de)\b/.test(normalized(current))) return false
  return /^[¿?\s]+$/.test(current.trim()) || /ya (?:te |le |lo |se lo |les |si )?(?:dije|respondi)|(?:por que )?repites|repite lo mismo|eso no (?:fue|es) lo que|no (?:me )?entend/.test(normalized(current))
}
export function asksVisitStatus(current: string, lastReply = '') {
  if (/cancel|reagend|reprogram|cambiar/.test(normalized(current))) return false
  return /(?:ya quedamos|(?:esta|quedo|esta o no|quedo o no).*confirmad|tenemos.*cita|cita.*confirmad)/.test(normalized(current))
    || (/cuando|a que hora|cuanto (?:tiempo|tardan)/.test(normalized(current)) && /confirm|respuesta/.test(normalized(current)) && /visita|cita|horario/.test(normalized(lastReply + ' ' + current)))
}
export function asksTeamAttendance(current: string) {
  // In "miércoles que viene", viene modifies the date; it does not ask whether
  // a person from the team will attend. Remove that temporal phrase before
  // applying the deterministic attendance check.
  const value = normalized(current).replace(/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+que\s+viene\b/g, '')
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

// The action vocabulary is shared across permission clauses. Negation must
// govern a predicate, rather than vetoing an unrelated "no" in the message.
const visitPermissionPredicate = '(?:quiero|quisiera|deseo|necesito|prefiero|acepto|autorizo|puedo|podemos|podr[ií]a|podr[ií]amos|me interesa|me gustar[ií]a|voy|vamos|se puede|es posible|agend\\w*|reagend\\w*|coordin\\w*|program\\w*|reprogram\\w*|reserv\\w*|visit\\w*|hacer|realizar|tener|solicitar|ir|venir|pasar|asistir|ver|conocer)'
const negatedVisitPredicate = new RegExp('\\b(?:no|nunca|jam[aá]s|tampoco|ni)\\s+(?:(?:me|nos|le|les|lo|la|se)\\s+)?' + visitPermissionPredicate + '\\b')
const newVisitPredicate = new RegExp('\\s+y\\s+(?=(?:(?:no|nunca|jam[aá]s|tampoco|ni)\\s+)?(?:(?:me|nos|le|les)\\s+)?' + visitPermissionPredicate + '\\b)', 'i')

function visitClauseIsConditional(clause: string) {
  const value = normalized(clause), literal = clause.normalize('NFKC').toLowerCase().trim()
  if (/\b(?:solo si|solamente si|siempre que|a condicion de|con la condicion de|dependiendo de|en caso de|quizas|quiza|tal vez|supongamos|hasta que|cuando se confirme)\b/.test(value)) return true
  // Do not erase the accent distinguishing affirmative "sí" from "si".
  // An unaccented short affirmative before a request is also common in chat.
  const affirmative = /^si(?:\s*,\s*|\s+)(?:quiero|quisiera|deseo|acepto|autorizo|necesito|me interesa|me gustaria|por favor|claro|de acuerdo)\b/.test(value)
  for (const condition of literal.matchAll(/\bsi\s+(?=\S)/g)) {
    if (condition.index === 0 && affirmative) continue
    const before = literal.slice(0, condition.index)
    const queryAt = [...before.matchAll(/\b(?:saber|consultar|averiguar|comprobar|confirmar|preguntar|revisar)\b/g)].at(-1)?.index ?? -1
    const actionAt = [...before.matchAll(/\b(?:agend\w*|reagend\w*|coordin\w*|program\w*|reprogram\w*|visit\w*|reserv\w*)\b/g)].at(-1)?.index ?? -1
    // "Visitar para saber si hay ascensor" keeps an independent information
    // question; "saber los precios y visitar si bajan" binds the visit.
    if (queryAt > actionAt) continue
    // A capability question can also use conjugated knowledge or uncertainty:
    // "No sé si puedo visitar" asks permission; it does not condition a visit
    // on a future price/credit event. Match its immediate subordinate question
    // so a later "si bajan los precios" still governs the requested visit.
    const uncertaintyAt = [...before.matchAll(/\b(?:s[eé]|sabes|sabe|sabemos|saben|(?:estoy|estamos)\s+segur[oa]s?(?:\s+de)?|(?:tengo|tenemos)\s+claro|me pregunto|nos preguntamos)\s*$/g)].at(-1)?.index ?? -1
    const permissionQuestion = /^si\s+(?:puedo|podemos|podr[ií]a|podr[ií]amos|se puede|es posible)\b/.test(literal.slice(condition.index))
    if (uncertaintyAt > actionAt && permissionQuestion) continue
    return true
  }
  return false
}


/** Balanced reported command quotes cannot become the lead's own permission.
 * Keep quoted names/emphasis and a whole-message quotation; those are not an
 * attributed command. This is a bounded source check, not a general parser. */
function maskReportedVisitCommands(current: string) {
  const quoted = /«[^»]*»|“[^”]*”|"[^"]*"|(?<!\p{L})'[^']*'(?!\p{L})/gu
  const command = /\b(?:agend\w*|reagend\w*|coordin\w*|program\w*|reprogram\w*|visit\w*|reserv\w*)\b/
  let masked = false
  const withoutReportedCommands = current.replace(quoted, (quote: string, index: number) => {
    const value = normalized(quote.slice(1, -1))
    if (!command.test(value) || current.trim() === quote) return quote
    const before = normalized(current.slice(0, index)).trim()
    // Quotation around an infinitive can emphasize the actual current request:
    // "Quiero 'visitar la oficina'" still expresses the lead's own desire.
    if (/\b(?:quiero|quisiera|deseo|necesito|prefiero|me interesa|me gustaria)\s*[:]?\s*$/.test(before)
      && /^(?:agendar|reagendar|coordinar|programar|reprogramar|visitar|reservar)\b/.test(value)) return quote
    masked = true
    return quote.replace(/[^\r\n]/g, ' ')
  })
  return { current: withoutReportedCommands, masked }
}

function visitPermissionClauses(current: string) {
  return current.split(/[.!?;\n]+|\bpero\b|\badem[aá]s\b|\bsin embargo\b|\ben cambio\b/iu).flatMap(clause =>
    // Never detach a consequent from its condition merely because it starts
    // another predicate after "y". A clear sentence/contrast boundary resets it.
    visitClauseIsConditional(clause) ? [clause] : clause.split(newVisitPredicate))
}

function visitClausePermissionVeto(clause: string) {
  const value = normalized(clause)
  return negatedVisitPredicate.test(value) || visitClauseIsConditional(clause)
}

/** Veto a denied or conditional current request without requiring a recognized
 * stock phrase. Evaluate the enclosing clause, so a clipped evidence quote
 * cannot omit its governing "no" or "si". An independent positive clause keeps
 * its permission even when a different destination/request was declined. */
export function visitRequestPermissionVeto(current: string, evidence = current): boolean {
  const literal = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  const proof = literal(evidence)
  if (!proof || !literal(current).includes(proof)) return false
  const reported = maskReportedVisitCommands(current)
  if (reported.masked && !literal(reported.current).includes(proof) && !explicitlyRequestsVisit(reported.current)) return true
  const clauses = visitPermissionClauses(reported.current).filter(clause => {
    const quote = literal(clause)
    return Boolean(quote && (quote.includes(proof) || proof.includes(quote)))
      && /\b(?:cita|visita|visit\w*|agend\w*|reagend\w*|coordin\w*|program\w*|reprogram\w*|oficina|edificio|obra|proyecto|departamento|suite|local)\b/.test(normalized(clause))
  })
  return clauses.length > 0 && clauses.every(visitClausePermissionVeto)
}

export function explicitlyRequestsVisit(current: string) {
  if (asksTeamAttendance(current)) return false
  // Permission questions are requests too. Evaluate each clause so an unrelated
  // booking or a declined visit cannot borrow an intent from another question.
  return visitPermissionClauses(maskReportedVisitCommands(current).current).some(clause => {
    // Repair common appointment typos only after a booking verb. Keep the raw
    // message intact and still apply refusals / unrelated-service checks below.
    const value = normalized(clause).replace(/\b(agendar|reagendar|coordinar|programar|reservar)( una| la)? (?:cira|sita)\b/g, '$1$2 cita')
    if (!value || visitClausePermissionVeto(clause)) return false
    if (hasUnrelatedAppointmentTarget(value)) return false
    if (/\bprefiero (?:hacer |realizar |coordinar |agendar )?(?:una |la )?visita\b/.test(value)) return true
    if (/\b(?:no|tampoco)\s+(?:coordinamos|agendamos|programamos|coordinemos|agendemos)\b/.test(value)) return false
    if (/^(?:(?:mejor|entonces|si|bueno|de acuerdo|por favor)\s+)*(?:coordinamos|agendamos|programamos)\s+(?:una|la)\s+(?:visita|cita)(?:\s+por favor)?$/.test(value)) return true
    if (/\b(?:puedo|podemos|podria|podriamos|se puede|es posible) (?:hacer |realizar |tener |solicitar |coordinar |agendar )?(?:una |la )?(?:visita|visitar|cita|ir|venir|pasar)\b/.test(value)) return true
    if (/\b(?:quiero|quisiera|necesito) (?:saber|consultar|confirmar|revisar)\b/.test(value) || /\b(?:ya|ayer) (?:agende|agendamos|coordine|coordinamos|reserve|reservamos)\b/.test(value)) return false
    if (/\b(?:agendar|coordinar|programar|reservar) (?:para )?(?:ir a )?(?:ver|conocer|visitar) (?:el |la |un |una )?(?:departamento|suite|local|proyecto|oficina)\b/.test(value)) return true
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
  if (p.status === 'awaiting_advisor') return 'Su solicitud está pendiente de revisión. Aún no tengo una hora de confirmación; le avisaremos por aquí cuando el equipo verifique la disponibilidad.'
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

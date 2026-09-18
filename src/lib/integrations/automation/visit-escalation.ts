import { object, rpc, text, type Row } from './data'
import { visitDetailText } from './visit-intake'
import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'

/** A declined advisor proposal requests another round without pausing the bot. */
export function declinesAllVisitAlternatives(current: string, proposal: Row | null, intent?: string) {
  if (!proposal || proposal.status !== 'awaiting_client' || proposal.proposed_by !== 'advisor') return false
  const options = Array.isArray(proposal.proposed_options) ? proposal.proposed_options : []
  if (!options.length && !proposal.previous_request_id) return false
  const value = visitDetailText(current)
  if (/\b(?:cancel\w*|anular|desisto|dejemoslo|no me contacten|no me escriban)\b|\b(?:ya )?no (?:quiero|deseo|me interesa) (?:una |la |esa )?(?:visita|cita)\b/.test(value)) return false
  if (/\b(?:departamentos?|suites?|locales?|viviendas?|precios?|creditos?|bancos?|financiamiento|vehiculos?|casas?|motos?|vuelos?)\b/.test(value)
    && !/\b(?:visita|cita|hora|horas|horario|horarios|fecha|fechas)\b/.test(value)) return false
  // New timing takes precedence over rejecting old choices. Let the normal
  // intake collect it, including a partial date such as "mejor mañana".
  const newPreference = value.replace(/\bno (?:puedo|podria|quiero|me sirve|me queda bien)\b.*?(?=\b(?:pero|mejor|prefiero|para|puedo)\b|$)/g, '')
  if (/\b(?:manana|hoy|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|proxima semana|siguiente semana)\b/.test(newPreference)
    || /\b(?:a las?|las?|a eso de las?) (?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(newPreference)
    || /\b\d{1,2}:\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b/.test(current)) return false
  const rejection = /\bningun[oa]?\b|\bno (?:puedo|me sirven?|me quedan? bien|me convienen?|quiero)\b.*\b(?:es[oa]s?|horas?|horarios?|opciones|alternativas)\b|\b(?:prefiero|quiero|necesito) otr[oa]s? (?:opcion|hora|horario|alternativa)/.test(value)
  return rejection || intent === 'reject'
}

/** An evidence-based brief, not an AI inference about the lead's intentions. */
export function visitCoordinationSummary(current: string, proposal: Row, history: unknown) {
  const clean = (value: unknown, limit: number) => text(value).replace(/\s+/g, ' ').trim().slice(0, limit)
  const offered = (Array.isArray(proposal.proposed_options) ? proposal.proposed_options : []).map(object)
    .map(slot => text(slot.start_time)).filter(value => Number.isFinite(Date.parse(value)))
    .map(value => formatVisitWhen(value)).join('; ')
  const recent = (Array.isArray(history) ? history : []).map(object).slice(-6)
    .map(message => `${message.role === 'cliente' ? 'Cliente' : 'Equipo'}: ${clean(message.content, 240)}`).join('\n')
  return [
    'El cliente rechazó las alternativas ofrecidas y no indicó otra fecha u hora.',
    'Acción pendiente: revisar nuevas opciones; si ya rechazó dos rondas, contactar para acordar una fecha. El bot permanece activo.',
    proposal.preferred_time_text ? `Preferencia original: ${clean(proposal.preferred_time_text, 300)}` : '',
    offered ? `Horarios ofrecidos: ${offered}` : '',
    `Último mensaje del cliente: ${clean(current, 600)}`,
    recent ? `Contexto reciente:\n${recent}` : '',
  ].filter(Boolean).join('\n').slice(0, 3000)
}

export async function escalateVisitCoordination(args: { proposal: Row; current: string; history: unknown; messageId: string }) {
  const result = object(await rpc('lv_escalate_visit_coordination', {
    p_request_id: args.proposal.request_id || args.proposal.id,
    p_message_id: args.messageId,
    p_summary: visitCoordinationSummary(args.current, args.proposal, args.history),
  }))
  if (result.action !== 'escalated' || result.bot_paused !== true || !result.request_id) throw new Error('VISIT_URGENT_HANDOFF_NOT_RECORDED')
  return { ...result, message: 'Entendemos. He pasado su solicitud al equipo para que un asesor se comunique con usted y puedan coordinar la visita directamente.' }
}

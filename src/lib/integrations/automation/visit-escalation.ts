import { object, rpc, text, type Row } from './data'

import { formatVisitWhen } from '@/lib/inmobiliaria/visitClock'

/** A declined advisor proposal requests another round without pausing the bot. */
export function declinesAllVisitAlternatives(_current: string, proposal: Row | null, _intent?: string, interpreted: unknown = {}) {
  const row = object(interpreted), routing = object(object(row.semantica_turno || row.turn_semantics || row).routing)
  return proposal?.status === 'awaiting_client' && proposal.proposed_by === 'advisor' && routing.all_options_declined === true
    && [proposal.id, proposal.request_id].includes(routing.proposal_id)
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
  if (result.action !== 'escalated' || result.bot_paused === true || !result.request_id) throw new Error('VISIT_URGENT_HANDOFF_NOT_RECORDED')
  return { ...result, bot_paused: false, message: 'Entendemos. He pasado su solicitud al equipo para que un asesor se comunique con usted y puedan coordinar la visita directamente.' }
}

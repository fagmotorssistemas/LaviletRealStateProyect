import { object, text } from './data'
/** The model identifies the proposal/option. Code verifies its IDs, index and dates. */
export function selectedVisitOption(_current: string, options: unknown, _sentAt: string, interpreted: unknown = {}, proposalId = ''): number | null {
  const row = object(interpreted), routing = object(object(row.semantica_turno || row.turn_semantics || row).routing)
  const slots = Array.isArray(options) ? options : []
  return routing.visit_response === 'accept' && !!proposalId && routing.proposal_id === proposalId
    && Number.isInteger(routing.option_index) && Number(routing.option_index) >= 1 && Number(routing.option_index) <= slots.length
    && slots.every(slot => Number.isFinite(Date.parse(text(object(slot).start_time)))) ? Number(routing.option_index) : null
}

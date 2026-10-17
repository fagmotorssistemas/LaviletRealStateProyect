import { object,text } from './data'
export function showroomRequest(current: string, _history: unknown = [], interpreted: unknown = {}) { void _history;
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row), routing = object(semantics.routing)
  return ['unit', 'project', 'both'].includes(text(routing.visual_target)) ? { kind: 'visual_request', current, context: '' } : null
}
export function asksConstructionStatus(_current: string, interpreted: unknown = {}) {
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row)
  return Array.isArray(semantics.requests) && semantics.requests.map(object).some(request => Array.isArray(request.topics) && request.topics.includes('construction_status'))
}

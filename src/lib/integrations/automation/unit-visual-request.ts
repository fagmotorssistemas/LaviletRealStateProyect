import { object,text } from './data'
const routing = (input: unknown) => { const row = object(input); return object(object(row.semantica_turno || row.turn_semantics || row).routing) }
export function isUnitVisualRequest(_current: string, interpreted: unknown = {}) {
  return ['unit', 'project', 'both'].includes(text(routing(interpreted).visual_target))
}
export function isUnitPhotoRequest(_current: string, interpreted: unknown = {}) { return routing(interpreted).photo_requested === true }
export function isOnlyUnitVisualRequest(_current: string, interpreted: unknown = {}) { return routing(interpreted).visual_only === true }

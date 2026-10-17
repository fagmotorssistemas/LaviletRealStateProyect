import { UNIT_TOUR_PATH,unitTourUrl } from '@/lib/tour/unitModels'
import { object,text,type Row } from './data'
import { isUnitPhotoRequest,isUnitVisualRequest } from './unit-visual-request'

export function declinesUnitTour(_current: string, interpreted: unknown = {}): boolean {
  const row = object(interpreted), semantics = object(row.semantica_turno || row.turn_semantics || row)
  return object(semantics.routing).visual_preference === 'decline'
}

/** Only persisted outbound history or IDs saved after accepted delivery prove
 * that material was shared. A client quoting a link is not such evidence. */
export function unitTourPreviouslySent(tour: Row, history: unknown, sentUnitIds: unknown = []): boolean {
  const unitId = text(tour.unit_id), number = text(tour.unit_number)
  if (unitId && Array.isArray(sentUnitIds) && sentUnitIds.includes(unitId)) return true
  return (Array.isArray(history) ? history : []).map(object).some(row => {
    const content = text(row.content)
    if (!['bot', 'asesor'].includes(text(row.role))) return false
    if (!number) return content.includes(unitTourUrl()) && !/[?&]unidad=/.test(content)
    return content.includes(UNIT_TOUR_PATH)
      && new RegExp(`[?&]unidad=${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`).test(content)
  })
}

export function unitModelDelivery(reference: { explicit: boolean; hasUnitMention?: boolean; matches: Row[]; allowGeneralTour?: boolean }, current: string, history: unknown, sentUnitIds: unknown = [], interpreted: unknown = {}) {
  const asksModel = isUnitVisualRequest(current, interpreted)
  if (declinesUnitTour(current, interpreted) || (!reference.explicit && !asksModel)) return null
  if ((reference.matches.length > 1 && !(asksModel && reference.allowGeneralTour && !reference.hasUnitMention)) || (reference.hasUnitMention && reference.matches.length === 0)) return null
  const candidate = reference.matches.length === 1 ? reference.matches[0] : null
  const unit = candidate && ['suite', 'departamento', 'penthouse'].includes(text(candidate.category))
    && candidate.is_published !== false && (!candidate.status || candidate.status === 'disponible')
    && /^\d{3,4}$/.test(text(candidate.unit_number))
    ? candidate
    : null
  const url = unitTourUrl(unit?.unit_number)
  const alreadySent = unitTourPreviouslySent({ unit_id: unit?.id, unit_number: unit?.unit_number }, history, sentUnitIds)
  if (alreadySent && !asksModel) return null
  if (!unit) return { unit_id: null, unit_number: null, url, model_available: true,
    caption: `Aquí puede explorar el recorrido virtual 360 de La Vilet: ${url}. Es una representación de los espacios previstos para el proyecto.` }
  const label = `${unit.category === 'suite' ? 'la suite' : unit.category === 'penthouse' ? 'el penthouse' : 'el departamento'} ${text(unit.unit_number)}`
  return { unit_id: text(unit.id), unit_number: text(unit.unit_number), url, model_available: true,
    caption: `Aquí puede explorar ${label} en el recorrido virtual 360 de La Vilet: ${url}. Es una representación de los espacios previstos para el proyecto.` }
}

/** Selection is a resolved catalogue decision, not a number parsed from prose.
 * This applies even when accepted financing chooses the next response route. */
export function selectedUnitModelDelivery(reference: Row, current: string, history: unknown, sentUnitIds: unknown = [], interpreted: unknown = {}) {
  const context = object(reference.context), query = object(reference.query || context.query)
  const matches = Array.isArray(reference.matches) ? reference.matches.map(object) : []
  const selected = Array.isArray(context.selected_ids) ? context.selected_ids : []
  if (reference.needsClarification === true || query.operation !== 'select' || matches.length !== 1
    || !selected.includes(matches[0].id) || !['suite', 'departamento', 'penthouse'].includes(text(matches[0].category))) return null
  const delivery = unitModelDelivery({ explicit: true, hasUnitMention: true, matches }, current, history, sentUnitIds, interpreted)
  return delivery?.unit_id ? { ...delivery, delivery_required: true, delivery_reason: 'selected_unit' } : null
}

export function appendUnitModel(reply: string, delivery: ReturnType<typeof unitModelDelivery>) {
  return !delivery || reply.includes(delivery.url) ? reply : [reply.trim(), delivery.caption].filter(Boolean).join('\n\n')
}

/** Compatibility base supplied to the final writer, using interpreted visual intent. */
export function unitModelRequestReply(matches: Row[], current: string, willSend: boolean, interpreted: unknown = {}) {
  if (!isUnitVisualRequest(current, interpreted) || declinesUnitTour(current, interpreted)) return ''
  if (matches.length > 1) return ''
  if (!willSend) return ''
  return isUnitPhotoRequest(current, interpreted)
    ? 'El material visual disponible se incluye en la galería del espacio.'
    : 'Puede explorar la unidad a su ritmo en el recorrido virtual.'
}

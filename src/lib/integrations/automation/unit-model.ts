import { unitTourUrl, UNIT_TOUR_PATH } from '@/lib/tour/unitModels'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitPhotoRequest, isUnitVisualRequest } from './unit-visual-request'

export function declinesUnitTour(current: string): boolean {
  const m = normalized(current)
  // La negación debe referirse al material visual. Frases como «no necesito que
  // sean habitaciones independientes» no rechazan el recorrido de la unidad.
  const visual = '(?:modelo|recorrido|3d|360|tour|showroom|enlace|link|fotos?|fotografias?|imagenes?)'
  return new RegExp(`\\bno\\s+(?:me\\s+)?(?:envie|mande|comparta|muestre)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\bno\\s+(?:quiero|necesito|deseo)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\bno\\s+me\\s+(?:interesa|sirve)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\b${visual}\\b[^.!?\\n]{0,55}\\bno\\s+me\\s+(?:interesa|sirve)\\b`).test(m)
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

export function unitModelDelivery(reference: { explicit: boolean; hasUnitMention?: boolean; matches: Row[]; allowGeneralTour?: boolean }, current: string, history: unknown, sentUnitIds: unknown = []) {
  const asksModel = isUnitVisualRequest(current)
  if (declinesUnitTour(current) || (!reference.explicit && !asksModel)) return null
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
    caption: `Aquí puede explorar el recorrido virtual 360 de La Vilet: ${url}. Es una representación del proyecto, no un recorrido de obra terminada.` }
  const label = `${unit.category === 'suite' ? 'la suite' : unit.category === 'penthouse' ? 'el penthouse' : 'el departamento'} ${text(unit.unit_number)}`
  return { unit_id: text(unit.id), unit_number: text(unit.unit_number), url, model_available: true,
    caption: `Aquí puede explorar ${label} en el recorrido virtual 360 de La Vilet: ${url}. Es una representación del proyecto, no un recorrido de obra terminada.` }
}

/** Selection is a resolved catalogue decision, not a number parsed from prose.
 * This applies even when accepted financing chooses the next response route. */
export function selectedUnitModelDelivery(reference: Row, current: string, history: unknown, sentUnitIds: unknown = []) {
  const context = object(reference.context), query = object(reference.query || context.query)
  const matches = Array.isArray(reference.matches) ? reference.matches.map(object) : []
  const selected = Array.isArray(context.selected_ids) ? context.selected_ids : []
  if (reference.needsClarification === true || query.operation !== 'select' || matches.length !== 1
    || !selected.includes(matches[0].id) || !['suite', 'departamento', 'penthouse'].includes(text(matches[0].category))) return null
  const delivery = unitModelDelivery({ explicit: true, hasUnitMention: true, matches }, current, history, sentUnitIds)
  return delivery?.unit_id ? { ...delivery, delivery_required: true, delivery_reason: 'selected_unit' } : null
}

export function appendUnitModel(reply: string, delivery: ReturnType<typeof unitModelDelivery>) {
  if (!delivery) return reply
  if (reply.includes(delivery.url) && reply.length <= 1400) return reply
  const caption = delivery.caption.trim()
  if (/^(?:claro|con gusto)[,.:!\s]*$/i.test(reply.trim())) return caption
  // The attachment is a promised action, so reserve its complete caption and URL first.
  // Compact an oversized draft by removing whole trailing sentences/paragraphs only;
  // never slice through a price, date or URL. A single oversized paragraph may leave
  // only the caption. Normal drafts should be concise before reaching this last guard.
  const segmenter = new Intl.Segmenter('es', { granularity: 'sentence' })
  const sentences = (value: string) => Array.from(segmenter.segment(value), part => part.segment)
  if (reply.includes(delivery.url)) {
    // An already embedded link may share a sentence with a quoted price. Prefer the
    // existing complete prefix rather than deleting that factual sentence to dedupe.
    const existing = sentences(reply.trim())
    while (existing.length && existing.join('').trim().length > 1400) existing.pop()
    const prefix = existing.join('').trim()
    if (prefix.includes(delivery.url)) return prefix
  }
  const segments = sentences(reply.replace(delivery.caption, '').trim())
    .filter(segment => {
      if (segment.includes(delivery.url)) return false
      const m = normalized(segment)
      // Do not ask permission to send the same material that this message delivers.
      const offersSameMaterial = /^(?:si (?:gusta|desea|le interesa) )?(?:(?:le )?(?:puedo|podemos|voy a|vamos a) (?:compartir|enviar|mandar|mostrar)|le gustaria que le (?:comparta|envie|mande|muestre))/.test(m)
        && /modelo|recorrido|ficha|vista interactiva|enlace|link/.test(m)
        && !/precio|\$|usd|financ|credito|cita|visita|brochure|folleto/.test(m)
      return !offersSameMaterial
    })
  while (segments.length && segments.join('').trim().length + caption.length + 2 > 1400) segments.pop()
  const answer = segments.join('').trim()
  return answer ? `${answer}\n\n${caption}` : caption
}

export function unitModelRequestReply(matches: Row[], current: string, willSend: boolean) {
  const m = normalized(current)
  // Show the chosen home before redirecting to other sizes or types based on older
  // qualification. Simple interest statements do not need another discovery question.
  if (willSend && matches.length === 1 && /^(?:me interesa|quisiera (?:ver|conocer)|quiero (?:ver|conocer))\b/.test(m)
    && !/[?¿\n]|\b(?:precio|cuanto|financiamiento|ofrece|incluye|cita|familia|pero)\b/.test(current.toLocaleLowerCase('es'))) {
    const unit = matches[0], rooms = Number(unit.bedrooms)
    const category = text(unit.category)
    const labels: Record<string, string> = { suite: 'una suite', departamento: 'un departamento', penthouse: 'un penthouse', local: 'un local comercial' }
    const label = labels[category] || 'una unidad'
    const residential = ['suite', 'departamento', 'penthouse'].includes(category)
    const area = Number(unit.area_internal_m2)
    return `Le comparto más sobre la unidad ${text(unit.unit_number)}: es ${label}${residential && rooms > 0 ? ` de ${rooms === 1 ? 'un dormitorio' : rooms + ' dormitorios'}` : ''}${area > 0 ? `, con ${area.toLocaleString('es-EC', { maximumFractionDigits: 2 })} m² interiores` : ''}.`
  }
  if (!isUnitVisualRequest(current)
    || /\bno\b|precio|cuanto cuesta|ofrece|incluye|financ|metros|medida|dormitorio|ubicacion|visita|cita/.test(m)) return ''
  if (willSend && matches.length === 0) return 'Claro.'
  if (matches.length > 1) return `Con gusto. ¿De cuál unidad desea ver el modelo: ${matches.map(u => text(u.unit_number)).join(', ')}?`
  if (!matches.length) return 'Claro, con gusto. ¿Qué número de departamento o suite le interesa?'
  if (willSend) return isUnitPhotoRequest(current)
      ? 'En el tour puede recorrer la unidad y acercarse a sus espacios.'
      : 'Puede explorar la unidad a su ritmo en el tour.'
  return ''
}

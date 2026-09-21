import { unitTourUrl, UNIT_TOUR_PATH } from '@/lib/tour/unitModels'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitPhotoRequest, isUnitVisualRequest } from './unit-visual-request'

export function unitModelDelivery(reference: { explicit: boolean; hasUnitMention?: boolean; matches: Row[] }, current: string, history: unknown, sentUnitIds: unknown = []) {
  const m = normalized(current)
  const asksModel = isUnitVisualRequest(current)
  // La negación debe referirse al material visual. Frases como «no necesito que
  // sean habitaciones independientes» no rechazan el recorrido de la unidad.
  const visual = '(?:modelo|recorrido|3d|enlace|link|fotos?|fotografias?|imagenes?)'
  const declines = new RegExp(`\\bno\\s+(?:me\\s+)?(?:envie|mande|comparta|muestre)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\bno\\s+(?:quiero|necesito|deseo)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\bno\\s+me\\s+(?:interesa|sirve)\\b[^.!?\\n]{0,55}\\b${visual}\\b`).test(m)
    || new RegExp(`\\b${visual}\\b[^.!?\\n]{0,55}\\bno\\s+me\\s+(?:interesa|sirve)\\b`).test(m)
  if (declines || (!reference.explicit && !asksModel)) return null
  if (reference.matches.length > 1 || (reference.hasUnitMention && reference.matches.length === 0)) return null
  const candidate = reference.matches.length === 1 ? reference.matches[0] : null
  const unit = candidate && ['suite', 'departamento', 'penthouse'].includes(text(candidate.category))
    && candidate.is_published !== false && (!candidate.status || candidate.status === 'disponible')
    && /^\d{3,4}$/.test(text(candidate.unit_number))
    ? candidate
    : null
  const url = unitTourUrl(unit?.unit_number)
  // Persisted outbound messages are the authority, not the LLM's summary or a quoted client URL.
  const alreadySent = Boolean(unit && Array.isArray(sentUnitIds) && sentUnitIds.includes(unit.id)) || (Array.isArray(history) ? history : []).map(object).some(row => {
    const content = text(row.content)
    if (!['bot', 'asesor'].includes(text(row.role))) return false
    if (!unit) return content.includes(unitTourUrl()) && !/[?&]unidad=/.test(content)
    return content.includes(UNIT_TOUR_PATH)
      && new RegExp(`[?&]unidad=${text(unit.unit_number)}(?:\\b|$)`).test(content)
  })
  if (alreadySent && !asksModel) return null
  if (!unit) return { unit_id: null, unit_number: null, url, model_available: true,
    caption: `Aquí puede explorar el tour general de La Vilet: ${url}` }
  const label = `${unit.category === 'suite' ? 'la suite' : unit.category === 'penthouse' ? 'el penthouse' : 'el departamento'} ${text(unit.unit_number)}`
  return { unit_id: text(unit.id), unit_number: text(unit.unit_number), url, model_available: true,
    caption: `Aquí puede explorar ${label} en el tour de La Vilet: ${url}` }
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
    const label = unit.category === 'suite' ? 'una suite' : 'un departamento'
    const area = Number(unit.area_internal_m2)
    return `Le comparto más sobre la unidad ${text(unit.unit_number)}: es ${label}${rooms > 0 ? ` de ${rooms === 1 ? 'un dormitorio' : rooms + ' dormitorios'}` : ''}${area > 0 ? `, con ${area.toLocaleString('es-EC', { maximumFractionDigits: 2 })} m² interiores` : ''}.`
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

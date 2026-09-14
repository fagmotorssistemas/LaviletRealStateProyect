import { unitModelUrl, unitReferenceUrl, UNIT_MODEL_PATH, UNIT_REFERENCE_PATH } from '@/lib/tour/unitModels'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitPhotoRequest, isUnitVisualRequest } from './unit-visual-request'

export function unitModelDelivery(reference: { explicit: boolean; matches: Row[] }, current: string, history: unknown, sentUnitIds: unknown = []) {
  const m = normalized(current)
  const asksModel = isUnitVisualRequest(current)
  const declines = /\bno\b[^.!?\n]{0,45}\b(?:envie|mande|quiero|necesito|interesa|modelo|recorrido|3d|enlace|link|fotos?|fotografias?|imagenes?)\b/.test(m)
  if (declines || reference.matches.length !== 1 || (!reference.explicit && !asksModel)) return null
  const unit = reference.matches[0], url = unitReferenceUrl(unit)
  if (!url) return null
  // Persisted outbound messages are the authority, not the LLM's summary or a quoted client URL.
  const alreadySent = (Array.isArray(sentUnitIds) && sentUnitIds.includes(unit.id)) || (Array.isArray(history) ? history : []).map(object).some(row => {
    const content = text(row.content)
    return ['bot', 'asesor'].includes(text(row.role)) && (
      (content.includes(UNIT_MODEL_PATH) && new RegExp(`[?&]unidad=${text(unit.unit_number)}(?:\\b|$)`).test(content))
      || content.includes(`${UNIT_REFERENCE_PATH}/${text(unit.id)}`))
  })
  if (alreadySent && !asksModel) return null
  const modelAvailable = Boolean(unitModelUrl(unit))
  const label = `${unit.category === 'suite' ? 'la suite' : 'el departamento'} ${text(unit.unit_number)}`
  return { unit_id: text(unit.id), unit_number: text(unit.unit_number), url, model_available: modelAvailable,
    caption: modelAvailable ? `Aquí puede explorar ${label} en 3D: ${url}`
      : `Le comparto la ficha ${unit.category === 'suite' ? 'de la suite' : 'del departamento'} ${text(unit.unit_number)} y una referencia interactiva del proyecto. El modelo específico de esta unidad aún está pendiente: ${url}` }
}

export function appendUnitModel(reply: string, delivery: ReturnType<typeof unitModelDelivery>) {
  if (!delivery) return reply
  if (reply.includes(delivery.url) && reply.length <= 1400) return reply
  const caption = delivery.caption.trim()
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
  if (matches.length > 1) return `Con gusto. ¿De cuál unidad desea ver el modelo: ${matches.map(u => text(u.unit_number)).join(', ')}?`
  if (!matches.length) return 'Claro, con gusto. ¿Qué número de departamento o suite le interesa?'
  if (willSend) return !unitModelUrl(matches[0])
    ? `Puede revisar los detalles de la unidad ${text(matches[0].unit_number)} en el enlace que le comparto.`
    : isUnitPhotoRequest(current)
      ? 'En esta vista interactiva puede girar el modelo y acercarse a los espacios.'
      : 'Puede explorar la distribución a su ritmo en esta vista interactiva.'
  if (!unitModelUrl(matches[0])) return `De la unidad ${text(matches[0].unit_number)} todavía no tengo un recorrido 3D disponible. Puedo ayudarle con la información de su distribución.`
  return ''
}

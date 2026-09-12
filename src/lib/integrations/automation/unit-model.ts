import { unitModelUrl, UNIT_MODEL_PATH } from '@/lib/tour/unitModels'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isUnitPhotoRequest, isUnitVisualRequest } from './unit-visual-request'

export function unitModelDelivery(reference: { explicit: boolean; matches: Row[] }, current: string, history: unknown, sentUnitIds: unknown = []) {
  const m = normalized(current)
  const asksModel = isUnitVisualRequest(current)
  const declines = /\bno\b[^.!?\n]{0,45}\b(?:envie|mande|quiero|necesito|interesa|modelo|recorrido|3d|enlace|link|fotos?|fotografias?|imagenes?)\b/.test(m)
  if (declines || reference.matches.length !== 1 || (!reference.explicit && !asksModel)) return null
  const unit = reference.matches[0], url = unitModelUrl(unit)
  if (!url) return null
  // Persisted outbound messages are the authority, not the LLM's summary or a quoted client URL.
  const alreadySent = (Array.isArray(sentUnitIds) && sentUnitIds.includes(unit.id)) || (Array.isArray(history) ? history : []).map(object).some(row => {
    const content = text(row.content)
    return ['bot', 'asesor'].includes(text(row.role)) && content.includes(UNIT_MODEL_PATH)
      && new RegExp(`[?&]unidad=${text(unit.unit_number)}(?:\\b|$)`).test(content)
  })
  if (alreadySent && !asksModel) return null
  return { unit_id: text(unit.id), unit_number: text(unit.unit_number), url,
    caption: `Aquí puede explorar ${unit.category === 'suite' ? 'la suite' : 'el departamento'} ${text(unit.unit_number)} en 3D: ${url}` }
}

export function appendUnitModel(reply: string, delivery: ReturnType<typeof unitModelDelivery>) {
  if (!delivery || reply.includes(delivery.url)) return reply
  const combined = `${reply.trim()}\n\n${delivery.caption}`
  // Preserve the answer and the transport's limit; never truncate a price, date or URL.
  return combined.length <= 1400 ? combined : reply
}

export function unitModelRequestReply(matches: Row[], current: string, willSend: boolean) {
  const m = normalized(current)
  // Show the chosen home before redirecting to other sizes or types based on older
  // qualification. Simple interest statements do not need another discovery question.
  if (willSend && matches.length === 1 && /^(?:me interesa|quisiera (?:ver|conocer)|quiero (?:ver|conocer))\b/.test(m)
    && !/[?¿\n]|\b(?:precio|cuanto|financiamiento|ofrece|incluye|cita|familia|pero)\b/.test(current.toLocaleLowerCase('es'))) {
    const unit = matches[0], rooms = Number(unit.bedrooms)
    const label = unit.category === 'suite' ? 'una suite' : 'un departamento'
    return `Claro, con mucho gusto. La unidad ${text(unit.unit_number)} es ${label}${rooms > 0 ? ` de ${rooms === 1 ? 'un dormitorio' : rooms + ' dormitorios'}` : ''}.`
  }
  if (!isUnitVisualRequest(current)
    || /\bno\b|precio|cuanto cuesta|ofrece|incluye|financ|metros|medida|dormitorio|ubicacion|visita|cita/.test(m)) return ''
  if (matches.length > 1) return `Con gusto. ¿De cuál unidad desea ver el modelo: ${matches.map(u => text(u.unit_number)).join(', ')}?`
  if (!matches.length) return 'Claro, con gusto. ¿Qué número de departamento o suite le interesa?'
  if (willSend) return isUnitPhotoRequest(current)
    ? 'Con gusto. En esta vista interactiva puede girar el modelo y acercarse a los espacios.'
    : 'Claro, con mucho gusto.'
  if (!unitModelUrl(matches[0])) return `De la unidad ${text(matches[0].unit_number)} todavía no tengo un recorrido 3D disponible. Puedo ayudarle con la información de su distribución.`
  return ''
}

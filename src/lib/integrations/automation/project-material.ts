import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'

export const BROCHURE_PATH = '/materiales/brochure-la-vilet-v5.pdf'
export const BROCHURE_URL = `https://www.lavilett.com${BROCHURE_PATH}`
/** Description approved by the project owner; not a claim that the model has
 * opened the PDF or verified room dimensions from its drawings. */
export const BROCHURE_DESCRIPTION = Object.freeze({
  kind: 'brochure', contains_floor_plans: true,
  description: 'Brochure digital del proyecto con información y planos.',
  source: 'approved_project_material_description',
  room_dimensions_verified: false, model_has_examined_plans: false,
})

export const MATERIAL_REQUEST_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['request', 'accept', 'decline', 'none'] },
    evidence: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['kind', 'evidence', 'confidence'] }
export const MATERIAL_REQUEST_RULES = 'material_request interpreta la solicitud del brochure: request si lo pide, accept si acepta una oferta anterior inequívoca de enviarlo, decline si lo rechaza y none en otro caso. Mencionar el brochure que ya recibió, sus planos o instalaciones no solicita volver a enviarlo: kind=none. Use evidencia literal ACTUAL. Un sí a elegir inmuebles, financiamiento o visita no acepta material. No convierta cualquier petición de información en solicitud del brochure.'

/** One material decision shared by opening, routing and the final link contract. */
export function brochureDeliveryIntent(current: string, history: unknown = [], extracted: Row = {}, pending: Row = {}) { void history;
  const material = object(extracted.material_request), evidence = text(material.evidence).trim()
  if (material.kind === 'none' && acceptedExtractorConfidence(material.confidence))
    return { requested: false, reason: 'not_requested', evidence: '' }
  const grounded = acceptedExtractorConfidence(material.confidence) && evidence.length > 0 && evidence.length <= 500
    && normalized(current).includes(normalized(evidence))
  const offered = pending.id === 'brochure_offer' && pending.act === 'material'
  const answer = object(object(extracted.turn_semantics).answer_to_previous)
  if (grounded && material.kind === 'decline') return { requested: false, reason: 'declined', evidence }
  if (grounded && (material.kind === 'request' || material.kind === 'accept' && offered))
    return { requested: true, reason: material.kind === 'request' ? 'explicit_request' : 'accepted_offer', evidence }
  if (offered && answer.question_id === 'brochure_offer' && acceptedExtractorConfidence(answer.confidence) && answer.kind === 'affirmative'
    && normalized(current).includes(normalized(text(answer.evidence))) && text(answer.evidence).trim())
    return { requested: true, reason: 'accepted_offer', evidence: text(answer.evidence) }
  return { requested: false, reason: 'not_requested', evidence: '' }
}

/** Prose alone cannot identify a business or accept material. */
export function vehicleScopeReply(_current: string, _history: unknown = []) { void _history;  return '' }
export function wantsBrochure(current: string, history: unknown = [], interpreted: Row = {}, pending: Row = {}) {
  return brochureDeliveryIntent(current, history, interpreted, pending).requested
}

export function brochureReply(current: string, history: unknown, mode: string, physicalStateConfigured = false, requested = wantsBrochure(current, history)) {
  if (!requested) return ''
  if(physicalStateConfigured) return `Le comparto el brochure para conocer la propuesta y sus espacios. Sus representaciones del diseño no son una constancia del avance de obra:\n\n${BROCHURE_URL}`
  const launch = mode === 'lanzamiento'
  return launch
    ? `Le comparto el brochure para que pueda conocer la propuesta y sus espacios. Las imágenes muestran cómo está previsto el proyecto; todavía no hay departamentos construidos.\n\n${BROCHURE_URL}`
    : `Aquí puede revisar el brochure y conocer mejor los espacios del proyecto:\n\n${BROCHURE_URL}`
}

/** Compatibility only; final writer prose is never rewritten. */
export function launchVisitReply(reply: string, _destination: 'site' | 'office') { void _destination;  return reply }

export const LAUNCH_PROJECT_RULES = `En Lanzamiento la construcción todavía no ha comenzado y no hay departamentos terminados ni avances físicos que mostrar. Las imágenes y el brochure ilustran el proyecto previsto. Hay oficina de atención en la misma dirección del terreno.
No invite a recorrer un departamento construido ni sugiera un showroom físico disponible. Esto no impide ofrecer el showroom virtual 360 cuando su enlace esté verificado: es una representación digital del proyecto, no una visita física ni evidencia de obra terminada. Si propone una visita presencial, siga exclusivamente politica_visitas: conocer el terreno donde se construirá el proyecto o la oficina para revisar la propuesta. No invente fechas de inicio ni entrega.
No ofrezca compartir material sin adjuntarlo cuando el cliente lo solicita o acepta. El brochure es una presentación del proyecto, no prueba de avance de obra.`

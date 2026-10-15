import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

export const RECOMMENDATION_REQUEST_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { requested: { type: 'boolean' }, evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['requested', 'evidence', 'confidence'] }
export const RECOMMENDATION_REQUEST_RULES = 'recommendation_request identifica una petición actual de recomendar, sugerir o escoger un punto de partida inmobiliario para comparar. «Recomiéndeme uno y dígame su precio por metro» solicita una recomendación concreta y el cálculo, no otra invitación a explorar el tipo ya conocido. No seleccione ni reserve una unidad por recomendarla. requested=false si no existe esa petición. Use evidencia literal actual; una preferencia de vistas o amplitud por sí sola no declara una selección ni pide financiamiento.'
export function recommendationRequest(raw: unknown, current: string): Row {
  const request = object(raw), evidence = text(request.evidence).trim()
  return request.requested === true && acceptedExtractorConfidence(request.confidence) && evidence
    && current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())
    ? { requested: true, evidence, confidence: request.confidence } : { requested: false }
}

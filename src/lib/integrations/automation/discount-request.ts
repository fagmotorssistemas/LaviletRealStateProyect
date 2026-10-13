import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

export const DISCOUNT_REQUEST_SCHEMA = { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['published_offer_information', 'negotiate_personal_discount'] },
    evidence: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['kind', 'evidence', 'confidence'] }] }

export const DISCOUNT_REQUEST_EXTRACTION_RULES = `DESCUENTOS: discount_request distingue consultar un beneficio publicado de pedir una rebaja personal. «¿Tiene descuento de lanzamiento?», «¿de cuánto es?» y «¿ya está aplicado?» son published_offer_information; una continuación breve puede referirse al descuento anterior, pero su evidencia siempre procede del mensaje actual. «¿Me pueden hacer un descuento?», pedir negociar o mejorar el precio, una contraoferta o pedir una rebaja adicional son negotiate_personal_discount. No confunda una pregunta informativa con negociación ni convierta ninguna en reserva, financiamiento o consentimiento para una cita. Use null si este turno no trata descuentos o si solo los mencionó el historial. Conserve también las demás solicitudes del lote.`

/** The extractor interprets meaning; the server checks type and current proof. */
export function normalizedDiscountRequest(raw: unknown, current: string): Row | null {
  const value = object(raw), evidence = text(value.evidence).trim()
  if (!['published_offer_information', 'negotiate_personal_discount'].includes(text(value.kind))
    || !acceptedExtractorConfidence(value.confidence) || !evidence
    || !current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())) return null
  return { kind: value.kind, evidence, confidence: value.confidence }
}

export function discountNegotiationForTurn(semantics: Row, current: string, scope: Row): Row | null {
  if (scope.uncertain === true || !['property', 'neutral', 'mixed'].includes(text(scope.kind))) return null
  const request = normalizedDiscountRequest(semantics.discount_request, current)
  return request?.kind === 'negotiate_personal_discount' ? request : null
}

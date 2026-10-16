import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

const properties = {
  decision: { type: 'string', enum: ['unchanged', 'future_interest', 'resume_now', 'stop_contact'] },
  evidence: { type: 'string' },
  contact_permission: { type: 'string', enum: ['unchanged', 'accepted', 'declined'] },
  contact_evidence: { type: 'string' }, purchase_horizon: { type: 'string' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}
export const LEAD_NURTURE_SCHEMA = { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }
const literal = (value: unknown, current: string) => !!text(value).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(value).trim().normalize('NFKC').toLowerCase())

export const LEAD_NURTURE_EXTRACTION_RULES = `NUTRICIÓN COMERCIAL: nurture_request registra únicamente declaraciones actuales. future_interest requiere interés conservado y aplazamiento explícito de compra; un saludo, silencio, presupuesto pendiente, entrada sin definir o pedir solo información no bastan. purchase_horizon copia literalmente el plazo o condición declarados; no invente fechas. contact_permission=accepted solo cuando acepta expresamente mantener o retomar contacto; no use consentimiento de publicidad, rastreo, financiamiento ni un sí a otra pregunta. evidence y contact_evidence son citas del mensaje actual. resume_now requiere que solicite avanzar ahora en su compra; preguntar precios, disponibilidad, instalaciones o volver a escribir no basta. stop_contact refleja petición expresa de no recibir contacto. Sin novedades use unchanged. Estos metadatos no crean tareas, envían mensajes, eligen unidades ni autorizan trámites.`

export function nurtureWithCommercialProfile(previous: unknown, profile: unknown): Row {
  const saved = object(previous), manual = object(profile)
  if (!manual.updated_at || Date.parse(text(manual.updated_at)) < (Date.parse(text(saved.declared_at)) || 0)) return saved
  const active = manual.nutrition_active === true && manual.contact_consent === true
    && !!text(manual.nutrition_reason).trim() && !!text(manual.nutrition_evidence).trim() && !!text(manual.purchase_horizon).trim()
  return { active, future_interest: active, contact_consent: manual.contact_consent === true,
    reason: manual.nutrition_reason, evidence: manual.nutrition_evidence, contact_evidence: manual.nutrition_evidence,
    purchase_horizon: manual.purchase_horizon, resume_at: manual.resume_at, declared_at: manual.updated_at }
}

export function normalizedNurtureRequest(raw: unknown, current: string): Row {
  const value = object(raw)
  if (!acceptedExtractorConfidence(value.confidence)) return {}
  const grounded = literal(value.evidence, current), contact = literal(value.contact_evidence, current)
  return { decision: grounded && ['future_interest', 'resume_now', 'stop_contact'].includes(text(value.decision)) ? value.decision : 'unchanged',
    evidence: grounded ? text(value.evidence) : '',
    contact_permission: contact && ['accepted', 'declined'].includes(text(value.contact_permission)) ? value.contact_permission : 'unchanged',
    contact_evidence: contact ? text(value.contact_evidence) : '',
    purchase_horizon: grounded && literal(value.purchase_horizon, current) ? text(value.purchase_horizon) : '', confidence: value.confidence }
}

/** Ordinary questions preserve the pause; this never replaces commercial stage
 * or revokes a previously authorized financial process. */
export function rememberLeadNurture(previous: unknown, raw: unknown, current: string, declaredAt: string): Row {
  const before = object(previous), request = normalizedNurtureRequest(raw, current)
  if (!Object.keys(request).length) return before
  const decision = text(request.decision), permission = text(request.contact_permission)
  if (decision === 'stop_contact' || permission === 'declined') return { ...before, active: false,
    contact_consent: false, contact_evidence: request.contact_evidence || request.evidence, declared_at: declaredAt }
  if (decision === 'resume_now') return { ...before, active: false, future_interest: false, resumed_evidence: request.evidence, declared_at: declaredAt }
  const future = decision === 'future_interest'
  if (!future && permission !== 'accepted') return before
  const next: Row = { ...before,
    ...(future ? { reason: request.evidence, evidence: request.evidence, purchase_horizon: request.purchase_horizon, future_interest: true } : {}),
    ...(permission === 'accepted' ? { contact_consent: true, contact_evidence: request.contact_evidence } : {}), declared_at: declaredAt }
  return { ...next, active: next.future_interest === true && next.contact_consent === true
    && !!text(next.purchase_horizon).trim() && !!text(next.evidence).trim() && !!text(next.contact_evidence).trim() }
}

import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

export const ACTION_AUTHORITY_VERSION = 'action-authority-v1'
export const ACTION_DOMAINS = ['advisor', 'visit', 'financing', 'reservation', 'tracking'] as const
const decisions = ['request', 'accept', 'decline', 'information', 'ambiguous', 'none']
const attributions = ['self', 'reported', 'hypothetical', 'conditional', 'none']
const scopes = ['operation', 'all_contact', 'topic_contact', 'channel_contact', 'none']
const closed = (properties: Row) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values })
const decisionSchema = closed({ decision: enumeration(decisions), attribution: enumeration(attributions),
  target: enumeration(['project', 'other', 'unspecified']), scope: enumeration(scopes),
  evidence: { type: 'string' }, confidence: enumeration(['high', 'medium', 'low']) })
export const ACTION_AUTHORITY_SCHEMA = closed({ version: enumeration([ACTION_AUTHORITY_VERSION]),
  ...Object.fromEntries(ACTION_DOMAINS.map(domain => [domain, decisionSchema])) })

export const ACTION_AUTHORITY_RULES = `action_authority es la única interpretación de permisos actuales. Para cada dominio interprete el acto, su autor y alcance, con evidencia literal del mensaje actual. request/accept sólo corresponden a la decisión actual, propia, inequívoca y sin una condición pendiente; attribution=self y target=project. Una frase citada de otro hablante es reported; una posibilidad futura es hypothetical; una condición pendiente es conditional; ninguna autoriza actuar. information consulta, decline rechaza ese trámite y ambiguous mantiene una decisión sin resolver. Una duda informativa no es consentimiento. Responder a otra pregunta no presta su permiso a una visita, reserva, revisión financiera o atención humana; conserve las solicitudes independientes con sus propias fuentes. scope=operation para los trámites. En tracking distinga all_contact (baja global), topic_contact y channel_contact; rechazar crédito o una cita no rechaza el contacto. El historial puede resolver el objeto de una aceptación a una invitación realmente entregada, nunca inventar una decisión actual. No derive la decisión de una palabra aislada ni copie una etiqueta de otro bloque: todos los bloques deben describir el mismo significado. El código verificará datos, evidencia, recibos y permisos; no volverá a interpretar las palabras. Si no puede determinarlo, declare ambiguous y solicite la aclaración necesaria.`
  + '\nEl esquema JSON adjunto prevalece sobre formatos históricos del prompt publicado. No devuelva requested_advisor, financing_consent, opt_out, consent_granted ni action_evidence: son proyecciones internas del servidor y no pertenecen a la salida del modelo. No rellene una estructura histórica de visit_preference. Use request para una petición independiente actual y accept solo para aceptar una invitación o decisión concreta del contexto; aceptar detalles de una unidad no acepta trámites.'

const empty = () => ({ decision: 'none', attribution: 'none', target: 'unspecified', scope: 'none', evidence: '', confidence: 'low' })
export function normalizedActionAuthority(raw: unknown, current: string): Row {
  const input = object(raw)
  const result: Row = { version: ACTION_AUTHORITY_VERSION, status: input.version === ACTION_AUTHORITY_VERSION ? 'valid' : 'missing' }
  for (const domain of ACTION_DOMAINS) {
    const item = object(input[domain]), evidence = text(item.evidence)
    const known = decisions.includes(text(item.decision)) && attributions.includes(text(item.attribution))
      && scopes.includes(text(item.scope)) && ['project', 'other', 'unspecified'].includes(text(item.target))
    const grounded = !!evidence.trim() && current.normalize('NFKC').includes(evidence.normalize('NFKC'))
    result[domain] = input.version === ACTION_AUTHORITY_VERSION && known && acceptedExtractorConfidence(item.confidence) && grounded
      ? { decision: item.decision, attribution: item.attribution, target: item.target, scope: item.scope, evidence, confidence: item.confidence }
      : empty()
  }
  return result
}

export function actionDecision(authority: unknown, domain: typeof ACTION_DOMAINS[number]): Row {
  return object(object(authority)[domain])
}
export function actionAuthorized(authority: unknown, domain: typeof ACTION_DOMAINS[number]) {
  const row = actionDecision(authority, domain)
  return object(authority).version === ACTION_AUTHORITY_VERSION && row.attribution === 'self' && row.target === 'project'
    && row.scope === 'operation' && ['request', 'accept'].includes(text(row.decision)) && acceptedExtractorConfidence(row.confidence)
}
export function actionDeclined(authority: unknown, domain: typeof ACTION_DOMAINS[number]) {
  const row = actionDecision(authority, domain)
  return object(authority).version === ACTION_AUTHORITY_VERSION && row.attribution === 'self' && row.target === 'project'
    && row.scope === 'operation' && row.decision === 'decline' && acceptedExtractorConfidence(row.confidence)
}
export function currentContactDecision(authority: unknown) {
  const row = actionDecision(authority, 'tracking')
  const self = object(authority).version === ACTION_AUTHORITY_VERSION && row.attribution === 'self'
    && row.target === 'project' && acceptedExtractorConfidence(row.confidence)
  return { opt_out: self && row.decision === 'decline' && row.scope === 'all_contact',
    tracking_consent: self && ['request', 'accept'].includes(text(row.decision)) && row.scope === 'all_contact' }
}

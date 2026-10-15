import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { normalized } from './sdr-rules'
import { PROPERTY_CATEGORIES } from './property-category-contract'

const modes = ['unchanged', 'information_only', 'guided_search']
const scopes = ['current', 'all_categories', 'other_categories']
const properties = {
  mode: { type: 'string', enum: modes }, mode_evidence: { type: 'string' },
  catalog_scope: { type: 'string', enum: scopes }, scope_evidence: { type: 'string' },
  excluded_categories: { type: 'array', items: { type: 'string', enum: [...PROPERTY_CATEGORIES] } },
  specific_topic: { type: 'boolean' }, topic_evidence: { type: 'string' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}
export const INTERACTION_GOAL_SCHEMA = { type: 'object', additionalProperties: false,
  properties, required: Object.keys(properties) }

/** These are evidenced editorial intentions, never operational consent. */
export function normalizedInteractionGoal(raw: unknown, current: string): Row {
  const value = object(raw)
  const quote = (key: string) => {
    const evidence = text(value[key]).trim()
    return acceptedExtractorConfidence(value.confidence) && evidence
      && normalized(current).includes(normalized(evidence)) ? evidence : ''
  }
  const modeEvidence = quote('mode_evidence'), scopeEvidence = quote('scope_evidence'), topicEvidence = quote('topic_evidence')
  const mode = modeEvidence && modes.includes(text(value.mode)) ? text(value.mode) : 'unchanged'
  const scope = scopeEvidence && scopes.includes(text(value.catalog_scope)) ? text(value.catalog_scope) : 'current'
  return { mode, mode_evidence: modeEvidence, catalog_scope: scope, scope_evidence: scopeEvidence,
    excluded_categories: scope === 'other_categories' && Array.isArray(value.excluded_categories)
      ? value.excluded_categories.filter(category => PROPERTY_CATEGORIES.includes(category as typeof PROPERTY_CATEGORIES[number])) : [],
    specific_topic: value.specific_topic === true && !!topicEvidence, topic_evidence: topicEvidence,
    confidence: acceptedExtractorConfidence(value.confidence) ? value.confidence : 'low' }
}

export function interactionMode(previous: unknown, semantics: unknown): Row {
  const prior = object(previous), goal = object(object(semantics).interaction_goal)
  const change = acceptedExtractorConfidence(goal.confidence) && !!text(goal.mode_evidence)
    && ['information_only', 'guided_search'].includes(text(goal.mode))
  return { version: 'interaction-mode-v1', mode: change ? goal.mode : prior.mode === 'information_only' ? 'information_only' : 'guided_search',
    evidence: change ? goal.mode_evidence : prior.evidence || null }
}

export function informationOnly(info: Row): boolean {
  const engagement = object(info.commercial_engagement)
  const prior = info.interaction_mode || engagement.interaction_mode || object(info._sales_memory).interaction_mode
  return interactionMode(prior, info.semantica_turno || info.turn_semantics).mode === 'information_only'
}

export const INTERACTION_GOAL_RULES = `
OBJETIVO DE LA INTERACCIÓN (interaction_goal)
- Interprete con IA la intención de este turno. mode=information_only cuando pide por ahora solo conocer el proyecto, informarse o suspender la búsqueda guiada. No es un rechazo de compra ni borra presupuesto, preferencias, unidad elegida o consentimiento ya guardados. mode=guided_search solo si solicita expresamente retomar la búsqueda, recomendaciones para su compra o un trámite; una pregunta de precios, características o categorías por sí sola NO retoma la calificación. Sin cambio explícito use unchanged. Entrar en modo informativo no equivale a rechazar un financiamiento aceptado: no declare financing_consent=false por esa sola pausa. Cite sus palabras actuales en mode_evidence; no copie el historial.
- specific_topic=true y topic_evidence identifican una consulta concreta actual (precios, ubicación, qué ofrecen, instalaciones, descripción del proyecto, etc.). «Solo quiero conocer el proyecto» declara un modo y no pide por sí solo un resumen: specific_topic=false y no cree una solicitud project_overview por esa sola declaración. Si además pregunta algo concreto, conserve esa consulta y marque true. No invente preguntas a partir de un agradecimiento.
- catalog_scope=all_categories si pide el conjunto de tipos del proyecto; other_categories si pregunta qué ofrecen además del tipo ya mencionado. Cite scope_evidence y registre en excluded_categories únicamente los tipos que deja fuera de ESTA consulta. Esto amplía la información consultada sin cambiar la preferencia de compra ni seleccionar un inmueble. Una consulta de precio de departamentos usa current y property.category=departamento, sin elegir unidad. No confunda mencionar una categoría con elegirla para la compra.
`

export const INFORMATION_ONLY_WRITER_RULES = 'interaction_mode.mode=information_only conserva la decisión de conocer el proyecto entre turnos. Atienda las consultas actuales sin retomar por rutina presupuesto, dormitorios, financiamiento, visitas, reservas ni datos de presentación. Mantenga los hechos conocidos internamente. Una consulta de precios autoriza esos precios y no reabre la calificación. Si acaba de pedir solo conocer el proyecto sin un tema concreto, pregunte con naturalidad qué le gustaría conocer de La Vilet, sin anteponer un resumen. Si ya preguntó algo concreto, respóndalo; no sustituya esa respuesta por otra pregunta de tema ni exija escoger una categoría. Puede aclarar lo indispensable para responder. Una pausa de calificación no revoca consentimientos ni selecciones y no impide atender una gestión expresamente solicitada.'

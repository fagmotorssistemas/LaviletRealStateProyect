import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { normalized } from './sdr-rules'
import { PROPERTY_CATEGORIES } from './property-category-contract'

const modes = ['unchanged', 'information_only', 'guided_search']
const scopes = ['current', 'all_categories', 'other_categories']
const properties = {
  mode: { type: 'string', enum: modes }, mode_evidence: { type: 'string' },
  qualification_decision: { type: 'string', enum: ['unchanged', 'pause', 'resume'],
    description: 'pause requiere una petición explícita de suspender la búsqueda guiada o la calificación; pedir información no es una pausa.' },
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
  return { mode, mode_evidence: modeEvidence,
    qualification_decision: ['pause', 'resume'].includes(text(value.qualification_decision)) ? value.qualification_decision : 'unchanged',
    catalog_scope: scope, scope_evidence: scopeEvidence,
    excluded_categories: scope === 'other_categories' && Array.isArray(value.excluded_categories)
      ? value.excluded_categories.filter(category => PROPERTY_CATEGORIES.includes(category as typeof PROPERTY_CATEGORIES[number])) : [],
    specific_topic: value.specific_topic === true && !!topicEvidence, topic_evidence: topicEvidence,
    confidence: acceptedExtractorConfidence(value.confidence) ? value.confidence : 'low' }
}

export function interactionMode(previous: unknown, semantics: unknown): Row {
  const prior = object(previous), goal = object(object(semantics).interaction_goal)
  const change = acceptedExtractorConfidence(goal.confidence) && !!text(goal.mode_evidence)
    && (goal.mode === 'information_only' && goal.qualification_decision === 'pause'
      || goal.mode === 'guided_search' && goal.qualification_decision === 'resume')
  return { version: 'interaction-mode-v2', mode: change ? goal.mode : prior.mode === 'information_only' ? 'information_only' : 'guided_search',
    qualification_decision: change ? goal.qualification_decision : prior.qualification_decision || 'unchanged',
    evidence: change ? goal.mode_evidence : prior.evidence || null }
}

/** Check relationships between AI fields, not the customer's vocabulary. */
export function interactionGoalIssues(raw: Row, current: string): string[] {
  const goal = object(object(raw.turn_semantics).interaction_goal)
  if (!acceptedExtractorConfidence(goal.confidence)) return []
  const mode = text(goal.mode), decision = text(goal.qualification_decision) || 'unchanged'
  const quote = text(goal.mode_evidence).trim()
  const grounded = !!quote && current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
  const invalidChange = mode === 'information_only' && (decision !== 'pause' || !grounded)
    || mode === 'guided_search' && (decision !== 'resume' || !grounded)
    || mode === 'unchanged' && decision !== 'unchanged'
  const requests = (Array.isArray(raw.requests) ? raw.requests : []).map(object)
  const currentTopic = requests.some(request => acceptedExtractorConfidence(request.confidence)
    && request.domain !== 'courtesy' && Array.isArray(request.topics) && request.topics.length > 0
    && !!text(request.evidence).trim() && current.includes(text(request.evidence).trim()))
  return invalidChange || currentTopic && goal.specific_topic === false ? ['inconsistent_interaction_goal:interaction_goal'] : []
}

export function informationOnly(info: Row): boolean {
  const engagement = object(info.commercial_engagement)
  const prior = info.interaction_mode || engagement.interaction_mode || object(info._sales_memory).interaction_mode
  return interactionMode(prior, info.semantica_turno || info.turn_semantics).mode === 'information_only'
}

export const INTERACTION_GOAL_RULES = `
OBJETIVO DE LA INTERACCIÓN (interaction_goal)
- Una petición de información, conocer el proyecto o saber qué ofrecemos es una consulta project_overview, también con faltas ortográficas y saludo. Atiéndala con la presentación autorizada; no pregunte qué información quiere para eludir esa presentación. Por sí sola NO suspende la orientación, la presentación ni la captura inicial autorizada: use mode=unchanged y qualification_decision=unchanged.
- qualification_decision=pause exige que el cliente pida explícitamente suspender la calificación o la búsqueda guiada, rechace avanzar por ahora o delimite que desea información sin preguntas comerciales. Solo entonces use mode=information_only y cite esa decisión en mode_evidence. Distinga el objeto de una negativa: posponer crédito o una visita no suspende toda la orientación. Informarse y preguntar por el proyecto no son por sí mismos decisiones de pausa.
- qualification_decision=resume y mode=guided_search requieren una petición actual de retomar la búsqueda guiada o un trámite. Una consulta de precio o características no revoca una pausa explícita anterior. Sin decisión nueva use ambos unchanged. Una pausa no borra presupuesto, preferencias, unidad elegida ni permisos guardados; no declare una negativa financiera por esa sola pausa.
- specific_topic=true y topic_evidence identifican la solicitud actual, también una presentación general: «quiero información», «del proyecto» o «qué venden» solicitan project_overview. Una pausa puede coexistir con esa consulta: respóndala y respete el alcance de la pausa. Si requests contiene un tema actual, specific_topic no puede ser false. No invente solicitudes a partir de un agradecimiento.
- catalog_scope=all_categories si pide el conjunto de tipos del proyecto; other_categories si pregunta qué ofrecen además del tipo ya mencionado. Cite scope_evidence y registre en excluded_categories únicamente los tipos que deja fuera de ESTA consulta. Esto amplía la información consultada sin cambiar la preferencia de compra ni seleccionar un inmueble. Una consulta de precio de departamentos usa current y property.category=departamento, sin elegir unidad. No confunda mencionar una categoría con elegirla para la compra.
`

export const INFORMATION_ONLY_WRITER_RULES = 'interaction_mode.mode=information_only conserva una petición explícita de pausar la orientación comercial entre turnos. Atienda las consultas actuales sin reabrir por rutina presupuesto, dormitorios, financiamiento, visitas, reservas ni datos de presentación. Mantenga los hechos conocidos internamente. Una consulta de precios autoriza esos precios y no reabre la calificación. Pedir información general o conocer el proyecto merece una presentación breve y útil con los hechos autorizados, también durante una pausa; no lo sustituya por preguntar qué información quiere. Una aclaración es pertinente solo si falta un referente indispensable. Una pausa no revoca permisos ni selecciones y permite atender una gestión expresamente solicitada.'

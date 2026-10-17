import { object, text, type Row } from './data'
import { withProjectObjectionContext } from './project-objections'
import { acceptedExtractorConfidence } from './extractor-confidence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
/** Compatibility API: preserve facts whole; callers select by typed topics. */
export function relevantFacts(value: unknown, _query?: string, _broad?: RegExp) { void _query; void _broad; return rows(value) }

/** Policies constrain operations even when their names are absent from a turn. */
export function selectPolicies(verified: Row, _current?: string, _domains?: Set<string>) {
  void _current; void _domains
  return rows(verified.politicas_negocio)
}

/** The common AI interpretation owns relevance. Entire small fact blocks are
 * retained so a synonym cannot hide security/access measures or qualifications
 * attached to a fact. Presence in context never mandates mentioning the block. */
export function projectKnowledgeForTurn(verified: Row): Row {
  const semantics = object(verified.semantica_turno || verified.turn_semantics)
  const requests = [...rows(object(verified.contrato_turno).requests),
    ...rows(verified.solicitudes_interpretadas || semantics.requests), ...rows(verified.consultas_pendientes)]
    .filter(request => acceptedExtractorConfidence(request.confidence)
      && !['answered', 'resolved', 'cancelled', 'superseded'].includes(text(request.status)))
  const topics = new Set(requests.flatMap(request => Array.isArray(request.topics) ? request.topics.map(text) : []))
  const projectQuestion = requests.some(request => request.domain === 'property')
    || semantics.primary_intent === 'project_information' && acceptedExtractorConfidence(semantics.confidence)
  const location = topics.has('location') || topics.has('value_objection')
  const features = ['project_overview', 'location', 'value_objection', 'property_features', 'accessibility', 'spatial_fit', 'common_area_access']
    .some(topic => topics.has(topic)) || projectQuestion && !topics.size
    || object(semantics.recommendation_request).requested === true
    || Array.isArray(semantics.housing_quantities) && semantics.housing_quantities.map(object)
      .some(quantity => quantity.role === 'evaluation' && acceptedExtractorConfidence(quantity.confidence))
  return { instalaciones: features ? rows(verified.instalaciones) : [],
    lugares_cercanos: location ? rows(verified.lugares_cercanos) : [],
    contexto_sector: location ? rows(verified.contexto_sector) : [],
    politicas_negocio: selectPolicies(verified) }
}

/** Exact or semantic retrieval can both qualify for context selection.
 * This projection is shared by writing and review, before evidence is built.
 * The extractor, operational state, global guardrails and tone are unchanged. */
export function semanticCatalogContext(verified: Row, audit: Row, current: string): Row {
  if (!(object(audit.catalog_retrieval).applied === true || object(audit.catalog_retrieval).optimized === true)
    || !['semantic_candidates', 'optimized_catalog'].includes(text(object(verified.catalog_context_scope).kind))) return verified

  const result = withProjectObjectionContext(verified, current)
  Object.assign(result, projectKnowledgeForTurn(verified))
  result.business_policy_context = { ...object(verified.business_policy_context),
    selection: 'semantic_property_search', included_count: rows(result.politicas_negocio).length }
  result.proyecto = { ...object(verified.proyecto) }
  const blocks = ['instalaciones', 'lugares_cercanos', 'contexto_sector', 'politicas_negocio']
  result.prompt_context_selection = {
    version: 'semantic-property-context-v1', mode: object(audit.catalog_retrieval).optimized === true ? 'optimized_catalog' : 'semantic_candidates',
    included_unit_count: rows(verified.catalogo).length,
    blocks: blocks.map(key => ({ key, available: rows(verified[key]).length, included: rows(result[key]).length })),
    note: 'Contexto seleccionado para esta búsqueda. Los bloques omitidos no acreditan inexistencia de servicios ni ausencia de políticas. Responda con las fichas incluidas; no complete datos con el historial. Las obligaciones del turno y restricciones generales siguen vigentes.',
  }
  return result
}

export const SEMANTIC_OPENING_RULE = 'En esta búsqueda se incluyeron solo candidatas pertinentes. Si profile_introduction pide nombre o residencia, responda brevemente a la característica solicitada y formule esa pregunta. Las fichas respaldan la respuesta; no obligan a enumerar unidades, medidas o precios que el cliente no pidió. Conserve los datos pendientes y el propósito de la pregunta. Esta orientación de brevedad no constituye un motivo de rechazo de estilo.'

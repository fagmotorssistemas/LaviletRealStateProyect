import { object, text, type Row } from './data'
import { catalogQuery, type CatalogQuery } from './catalog-dialogue'
import { resolveCatalogRequirements } from './catalog-result'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : []

/** Resolve the same interpreted query for exact filtering and optional ranking.
 * No prose classification or budget-based relaxation occurs in retrieval. */
export function resolvedCatalogQuery(info: Row): {
  reason: string; query: CatalogQuery; request: Row; source: string; scopedIds?: string[]
} {
  const semantics = object(info.semantica_turno), property = object(semantics.property)
  const context = object(info.property_context), reference = object(info.referencia_unidad)
  const sourceQuery = [reference.query, context.query, property].map(object).find(q => Object.keys(q).length) || {}
  const query = catalogQuery(sourceQuery)
  const empty = (reason: string) => ({ reason, query, request: {}, source: 'resolved_property_query' })
  const intent = object(info.contrato_turno)
  const requests = rows(intent.requests || info.solicitudes_interpretadas).filter(r => r.domain !== 'courtesy')
  const propertyRequests = requests.filter(r => r.domain === 'property')
  if (reference.needsClarification === true || object(context.preference_transition).active === true)
    return empty('unresolved_property_reference')
  if (['mixed', 'out_of_scope', 'uncertain', 'clarify_scope'].includes(text(object(intent.scope).kind)))
    return empty('uncertain_interpretation')
  if (semantics.confidence !== 'high' || property.confidence !== 'high'
    || !propertyRequests.length || requests.some(r => r.confidence !== 'high')) return empty('uncertain_interpretation')
  // Independent catalogue scopes must be answered together by the normal path;
  // selecting only the primary one would silently omit the other request.
  if (propertyRequests.length > 1) return empty('multiple_catalog_scopes')
  if (query.operation === 'none') return empty('no_catalog_query')
  if (!['catalog', 'offered', 'selected', 'focused', 'comparison'].includes(query.scope)) return empty('unresolved_query_scope')
  if (semantics.catalog_request_status === 'invalid') return empty('invalid_structured_requirements')
  let request = object(semantics.catalog_request)
  if (request.version === 'catalog-request-v1' && request.confidence !== 'high') return empty('uncertain_interpretation')
  let source = 'catalog_request'
  if (request.version !== 'catalog-request-v1') {
    // Details and follow-ups already have an authoritative resolved property
    // query. A missing optional catalog_request does not erase that query.
    source = 'resolved_property_query'
    request = { version: 'catalog-request-v1', purpose: query.operation === 'rank' ? 'search' : query.operation,
      metric: null, requirements: [], semantic_preferences: [], confidence: 'high', evidence: property.evidence || '' }
  }
  if (!['search', 'details', 'compare', 'select', 'count', 'list', 'range', 'min', 'max'].includes(text(request.purpose)))
    return empty('unsupported_catalog_operation')
  const resolved = resolveCatalogRequirements(info, query, request)
  let scopedIds: string[] | undefined
  const referenced = rows(reference.matches).map(u => text(u.id)).filter(Boolean)
  if (reference.explicit === true || ['compare', 'select'].includes(query.operation)) {
    scopedIds = referenced.length ? referenced : query.operation === 'compare' ? ids(context.comparison_ids) : ids(context.selected_ids)
    if (!scopedIds.length) return empty('unresolved_property_reference')
  } else if (query.scope !== 'catalog') {
    scopedIds = referenced.length ? referenced : ids(context[query.scope === 'offered' ? 'offered_ids'
      : query.scope === 'comparison' ? 'comparison_ids' : query.scope === 'focused' ? 'focused_ids' : 'selected_ids'])
    if (!scopedIds.length) return empty('unresolved_property_reference')
  }
  return { reason: 'eligible', ...resolved, source, ...(scopedIds ? { scopedIds } : {}) }
}

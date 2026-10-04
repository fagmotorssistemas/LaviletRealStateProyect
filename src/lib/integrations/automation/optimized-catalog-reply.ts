import { object, text, type Row } from './data'
import { semanticCatalogScope } from './catalog-embeddings'

/** A code-owned factual base; the existing writer still produces the customer-facing wording. */
export function optimizedCatalogReply(retrieval: { units: Row[] | null; audit: Row }): { reply: string; audit: Row } | null {
  if (retrieval.audit.optimized !== true || !retrieval.units) return null
  const summary = object(retrieval.audit.catalog_summary), request = object(summary.request), query = object(summary.query)
  const count = Number(summary.matching_count), unknown = Number(summary.unknown_count), units = retrieval.units
  const names = units.map(u => `${text(u.category)} ${text(u.unit_number)}`).join(', ')
  const dimensionNames: Record<string, string> = { area_internal_m2: 'superficie interior (m²)', area_exterior_m2: 'superficie exterior (m²)',
    area_total_m2: 'superficie total (m²)', published_commercial_price: 'precio publicado (USD)', floor_number: 'planta', bedrooms: 'dormitorios', bathrooms_full: 'baños completos' }
  let reply = `La consulta tiene ${count} coincidencias confirmadas${unknown ? ` y ${unknown} unidades con datos pendientes para comprobar todos los requisitos` : ''}.`
  if (names && ['search', 'list'].includes(text(request.purpose))) reply += ` Unidades incluidas: ${names}.`
  const stat = object(object(summary.statistics)[text(request.metric)])
  if (['range', 'min', 'max'].includes(text(request.purpose))) {
    const value = request.purpose === 'range' ? `${stat.min} a ${stat.max}` : request.purpose === 'min' ? stat.min : stat.max
    if (stat.known_count && stat.min != null) reply += ` ${dimensionNames[text(request.metric)]}: ${value}${stat.complete !== true || unknown ? ', entre las fichas con datos confirmados' : ''}.`
    else reply += ' No hay datos suficientes para confirmar ese valor.'
  }
  return { reply, audit: { source: 'catalog_search', verified_catalog: true, catalog_query: query,
    catalog_retrieval: retrieval.audit, catalog_context_scope: semanticCatalogScope(retrieval.audit),
    catalog_summary: summary, catalog_aggregate_groups: retrieval.audit.catalog_aggregate_groups,
    catalog_results: { units, unit_ids: units.map(u => u.id), complete: retrieval.audit.exhaustive === true,
      unknown_unit_ids: Array.isArray(summary.unknown_units) ? summary.unknown_units.map(u => object(u).unit_id) : [],
      selection: 'optimized_catalog', total_confirmed_count: count },
    catalog_coverage: { operation: request.purpose, status: count ? 'answered' : unknown ? 'unknown' : 'no_results',
      result_unit_ids: units.map(u => u.id), complete: summary.exact_count === true },
    covered_requests: ['catalog_search'], coverage_complete: false,
    offered_unit_ids: ['search', 'list'].includes(text(request.purpose)) ? units.map(u => u.id) : [],
    selected_unit_ids: [], focused_unit_ids: [],
    pending_question: { id: 'none', act: 'other', question: '', target_ids: [], candidate_ids: [] },
  } }
}

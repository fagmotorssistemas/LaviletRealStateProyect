import { object, text, type Row } from './data'
import { CATALOG_NUMBER_FIELDS, catalogNumber, requirementMatch } from './catalog-request'
import { catalogQuery, filterCatalog, type CatalogQuery } from './catalog-dialogue'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (units: Row[]) => units.map(unit => text(unit.id))
const fields = ['id', 'unit_number', 'category', 'floor', ...CATALOG_NUMBER_FIELDS, 'spaces', 'description', 'status', 'is_published']

/** Current structured conditions replace the same prior dimension, never unrelated requirements. */
export function resolveCatalogRequirements(info: Row, query: CatalogQuery, request: Row) {
  const context = object(info.property_context), proposal = object(context.proposal_information), pending = object(context.pending_question)
  const proposalInformation = proposal.version === 'proposal-information-v1' && proposal.active === true
    && proposal.informational_only === true && proposal.pending_question_id === pending.id && pending.act === 'explore_alternatives'
  // A temporary question about a proposal is not the original search. The
  // proposal query already carries its preserved constraints; the optimized
  // original requirements must not silently restore the unavailable feature.
  const prior = proposalInformation ? {} : object(context.optimized_catalog_request)
  const current = rows(request.requirements)
  const replaced = new Set(current.map(r => r.field))
  const filters = object(object(object(info.semantica_turno).property).filters)
  if (filters.bedrooms != null || Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length) replaced.add('bedrooms')
  if (filters.floor_number != null) replaced.add('floor_number')
  if (filters.min_area_m2 != null || filters.max_area_m2 != null) replaced.add('area_internal_m2')
  const resolvedFields = new Set(rows(query.requirements).map(r => r.field))
  const inherited = [...rows(query.requirements), ...(prior.category === query.category && prior.group === query.group
    ? rows(prior.requirements).filter(r => !resolvedFields.has(r.field)) : [])].filter(r => !replaced.has(r.field))
  const requirements = [...inherited, ...current]
  const covered = new Set(requirements.map(r => r.field))
  // Legacy filters cannot turn a preference into a requirement, or override gt/gte with eq.
  const resolved = catalogQuery({ ...query, requirements: [], filters: { ...query.filters,
    ...(covered.has('bedrooms') ? { bedrooms: null, bedrooms_any: [], bedrooms_operator: null, bedrooms_upper: null, bedrooms_required: null } : {}),
    ...(covered.has('floor_number') ? { floor_number: null } : {}),
    ...(covered.has('area_internal_m2') ? { min_area_m2: null, max_area_m2: null } : {}),
  } })
  const sameScope = prior.category === query.category && prior.group === query.group
  const preferences = [...new Set([...(sameScope && Array.isArray(prior.semantic_preferences) ? prior.semantic_preferences : []),
    ...(Array.isArray(request.semantic_preferences) ? request.semantic_preferences : [])])]
  return { query: resolved, request: { ...request, requirements, semantic_preferences: preferences } }
}
export const compactCatalogUnit = (unit: Row, prices: boolean): Row => Object.fromEntries(fields
  .filter(field => field !== 'published_commercial_price' || prices).filter(field => unit[field] !== undefined).map(field => [field, unit[field]]))

export function completeCatalogResult(info: Row, query: CatalogQuery, request: Row, scopedIds?: string[]) {
  const prices = object(info.politica_comercial).precios_autorizados === true
  const catalog = rows(info.catalogo).map(u => compactCatalogUnit(u, prices))
  const categoryExclusions = object(object(info.semantica_turno).property).excluded_categories
  const base = filterCatalog(catalog, catalogQuery({ ...query, requirements: [], filters: {} }), scopedIds).filter(u => !Array.isArray(categoryExclusions) || !categoryExclusions.includes(u.category))
  const requirements = rows(request.requirements), required = requirements.filter(r => r.strength === 'required')
  const exact: Row[] = [], unknown: Row[] = [], rejected: Row[] = []
  const unknownReasons: Row[] = []
  for (const unit of base) {
    const predicates = required.map(r => ({ field: r.field, match: requirementMatch(unit, r) }))
    const f = query.filters
    const legacyMatch = filterCatalog([unit], query).length > 0
    const missingLegacy = (f.bedrooms !== null || !!f.bedrooms_any?.length) && catalogNumber(unit.bedrooms) === null
      || f.floor_number !== null && catalogNumber(unit.floor_number) === null
      || (f.min_area_m2 !== null || f.max_area_m2 !== null) && catalogNumber(unit.area_internal_m2) === null
    // A known failed predicate wins even if another requested field is absent.
    const knownQuery = catalogQuery({ ...query, filters: { ...f,
      ...(catalogNumber(unit.bedrooms) === null ? { bedrooms: null, bedrooms_any: [], bedrooms_operator: null, bedrooms_upper: null } : {}),
      ...(catalogNumber(unit.floor_number) === null ? { floor_number: null } : {}),
      ...(catalogNumber(unit.area_internal_m2) === null ? { min_area_m2: null, max_area_m2: null } : {}) } })
    if (!filterCatalog([unit], knownQuery).length || predicates.some(p => p.match === false)) rejected.push(unit)
    else if (!legacyMatch || missingLegacy || predicates.some(p => p.match === null)) {
      unknown.push(unit); unknownReasons.push({ unit_id: unit.id, unit_number: unit.unit_number,
        fields: [...new Set([...predicates.filter(p => p.match === null).map(p => p.field), ...(missingLegacy ? ['query_filters'] : [])])] })
    } else exact.push(unit)
  }
  const statistics = Object.fromEntries(CATALOG_NUMBER_FIELDS.filter(f => f !== 'published_commercial_price' || prices).map(field => {
    const values = exact.map(u => catalogNumber(u[field])).filter((n): n is number => n !== null)
    const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null
    return [field, { min, max,
      ...(field === request.metric && values.length ? {
        min_units: exact.filter(u => catalogNumber(u[field]) === min).map(u => ({ id: u.id, unit_number: u.unit_number })),
        max_units: exact.filter(u => catalogNumber(u[field]) === max).map(u => ({ id: u.id, unit_number: u.unit_number })),
      } : {}),
      known_count: values.length, unknown_count: exact.length - values.length, complete: exact.length > 0 && values.length === exact.length }]
  }))
  const readComplete = object(info.catalog_read).complete === true
  const summary: Row = { version: 'catalog-summary-v1', query, request, read_complete: readComplete,
    matching_count: exact.length, unknown_count: unknown.length, excluded_count: rejected.length, candidate_count: base.length,
    exact_count: readComplete && unknown.length === 0, matching_unit_ids: ids(exact), unknown_units: unknownReasons,
    matching_unit_numbers: exact.map(u => u.unit_number), statistics,
    note: 'Los rangos describen todas las coincidencias confirmadas antes de seleccionar fichas. Los datos desconocidos se muestran por separado; no se convierten en ausencia ni en cero.' }
  const lower: Row = {}, upper: Row = {}
  for (const [field, raw] of Object.entries(statistics)) { const stat = object(raw); if (stat.complete === true) { lower[field] = stat.min; upper[field] = stat.max } }
  const groups: Row[] = ['min', 'max', 'range'].map(aggregation => ({ id: `group:catalog_query:all:${aggregation}`, aggregation,
    category: query.category, source_scope: 'complete_query', member_ids: ids(exact), unit_count: exact.length,
    complete_for_query: summary.exact_count, covers: 'confirmed_matches', ... (aggregation === 'max' ? upper : lower),
    ...(aggregation === 'range' ? { upper_values: { ...upper, unit_count: exact.length } } : {}) }))
  return { units: exact, unknown, summary, groups, candidates: base }
}

/** All small result sets fit. Larger sets retain global aggregates plus diverse examples, within a character allowance. */
export function selectCatalogExamples(units: Row[], request: Row, scores = new Map<string, number>(), maxCharacters = 24000) {
  const preferred = rows(request.requirements).filter(r => r.strength === 'preferred')
  const relevance = (unit: Row) => preferred.filter(r => requirementMatch(unit, r) === true).length
  const ranked = [...units].sort((a, b) => relevance(b) - relevance(a) || (scores.get(text(b.id)) || 0) - (scores.get(text(a.id)) || 0)
    || text(a.unit_number).localeCompare(text(b.unit_number), 'es', { numeric: true }))
  if (JSON.stringify(ranked).length <= maxCharacters) return { units: ranked, complete: true, reason: 'all_matching_units_fit' }
  const anchors: Row[] = []
  for (const field of [...new Set([text(request.metric), ...CATALOG_NUMBER_FIELDS])].filter(Boolean)) {
    const known = ranked.filter(u => catalogNumber(u[field]) !== null).sort((a, b) => Number(a[field]) - Number(b[field]))
    if (known.length) anchors.push(known[0], known[known.length - 1])
  }
  const selected: Row[] = [], seen = new Set<string>(); let length = 2
  for (const unit of [...anchors, ...ranked]) {
    if (seen.has(text(unit.id))) continue
    seen.add(text(unit.id)); const size = JSON.stringify(unit).length + 1
    if (length + size > maxCharacters) continue
    selected.push(unit); length += size
  }
  return { units: selected, complete: selected.length === units.length, reason: 'context_allowance_with_extremes' }
}

import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { catalogNumber, requirementMatch } from './catalog-request'

const categories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Meaning and subjects come from the extractor, never a price-keyword scan. */
export function interpretedPriceComparison(verified: Row, current: string): Row | null {
  const semantics = object(verified.semantica_turno)
  const request = object(semantics.catalog_request || verified.catalog_request)
  const comparison = object(request.price_comparison), evidence = text(comparison.evidence).trim()
  const subjects = Array.isArray(comparison.categories) ? [...new Set(comparison.categories)] : []
  if (!acceptedExtractorConfidence(comparison.confidence) || !evidence || evidence.length > 1000
    || !current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())
    || subjects.length < 2 || subjects.length > 4 || subjects.some(category => !categories.has(String(category)))) return null
  return { categories: subjects, evidence, confidence: comparison.confidence }
}

/** Category comparison does not alter search filters, recommendations or
 * selection. Aggregate fresh inventory for the known bedroom requirement. */
export function categoryPriceComparison(verified: Row, current: string): Row | null {
  const interpretation = interpretedPriceComparison(verified, current)
  if (!interpretation || Object.keys(object(verified.limite_alcance)).length) return null
  const policy = object(verified.politica_comercial)
  if (policy.precios_autorizados !== true) return { ...interpretation, status: 'prices_not_authorized', groups: [], units: [] }
  if (object(verified.catalog_read).complete !== true) return { ...interpretation, status: 'needs_complete_inventory', groups: [], units: [] }
  const semantics = object(verified.semantica_turno), request = object(semantics.catalog_request || verified.catalog_request)
  const query = object(object(verified.property_context).query)
  const bedroomRequirements = acceptedExtractorConfidence(request.confidence)
    ? rows(request.requirements).filter(row => row.field === 'bedrooms' && row.strength === 'required') : []
  const inherited = rows(query.requirements).filter(row => row.field === 'bedrooms' && row.strength === 'required')
  const property = object(semantics.property)
  const currentFilters = acceptedExtractorConfidence(property.confidence) ? object(property.filters) : {}, queryFilters = object(query.filters)
  const confirmed = object(object(object(verified.hechos_confirmados).property).filters)
  const exact = catalogNumber(currentFilters.bedrooms) ?? catalogNumber(queryFilters.bedrooms) ?? catalogNumber(confirmed.bedrooms)
  const exactSource = catalogNumber(currentFilters.bedrooms) !== null ? currentFilters
    : catalogNumber(queryFilters.bedrooms) !== null ? queryFilters : confirmed
  const conditions = bedroomRequirements.length ? bedroomRequirements : inherited.length ? inherited
    : exact !== null && exact > 0 ? [{ field: 'bedrooms', operator: text(exactSource.bedrooms_operator) || 'eq',
      value: exact, upper_value: exactSource.bedrooms_upper ?? null, strength: 'required' }] : []
  const any = [currentFilters.bedrooms_any, queryFilters.bedrooms_any, confirmed.bedrooms_any].find(value => Array.isArray(value) && value.length)
  const alternatives = Array.isArray(any) ? any.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0) : []
  const pool = rows(Array.isArray(verified.catalogo_verificacion) ? verified.catalogo_verificacion : verified.catalogo)
    .filter(unit => unit.is_published === true && unit.status === 'disponible'
      && (!alternatives.length || alternatives.includes(Number(unit.bedrooms)))
      && conditions.every(condition => requirementMatch(unit, condition) === true))
  const units: Row[] = [], groups: Row[] = [], missing: string[] = []
  for (const category of interpretation.categories as string[]) {
    const members = pool.filter(unit => unit.category === category)
    if (!members.length || members.some(unit => catalogNumber(unit.published_commercial_price) === null
      || Number(unit.published_commercial_price) <= 0)) { missing.push(category); continue }
    const prices = members.map(unit => Number(unit.published_commercial_price))
    const bedrooms = members.map(unit => catalogNumber(unit.bedrooms))
    const bedroomsKnown = bedrooms.every(value => value !== null)
    const bedroomRange = bedroomsKnown ? { minimum: Math.min(...bedrooms as number[]), maximum: Math.max(...bedrooms as number[]) } : null
    const scopeKey = conditions.length ? conditions.map(condition => `${condition.operator}-${condition.value}-${condition.upper_value ?? ''}`).join('_')
      : alternatives.length ? alternatives.join('-') : 'all-bedrooms'
    groups.push({ id: `group:category_price_comparison:${category}:${scopeKey}:range`, category,
      aggregation: 'range', source_scope: 'category_price_comparison', query_role: 'comparison_only',
      complete_for_query: true, member_ids: members.map(unit => unit.id), member_count: members.length,
      unit_count: members.length, bedroom_requirements: conditions, bedrooms_any: alternatives,
      bedrooms_filter: bedroomRange?.minimum === bedroomRange?.maximum ? bedroomRange?.minimum ?? null : null,
      ...(bedroomRange ? { bedrooms: bedroomRange.minimum } : {}),
      published_commercial_price: Math.min(...prices), upper_values: { published_commercial_price: Math.max(...prices),
        ...(bedroomRange ? { bedrooms: bedroomRange.maximum } : {}) } })
    units.push(...members.map(unit => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category,
      bedrooms: unit.bedrooms, published_commercial_price: unit.published_commercial_price,
      is_published: true, status: 'disponible' })))
  }
  return { version: 'category-price-comparison-v1', ...interpretation,
    status: missing.length ? 'incomplete_comparison' : 'verified',
    scope: { kind: 'category_prices', bedroom_requirements: conditions, bedrooms_any: alternatives,
      excludes_budget_filter: true, main_selection_unchanged: true },
    units, groups, missing_categories: missing,
    instruction: 'Use los rangos calculados de estas categorías y dormitorios para responder la comparación concreta. No enumere el catálogo completo ni convierta el rango en el precio de cada unidad. Esta evidencia no cambia la preferencia, exclusiones o unidad elegida ni acredita que el presupuesto o la entrada cubran el precio. Conserve la siguiente decisión comercial. Los datos desconocidos no prueban qué categoría cuesta menos.' }
}

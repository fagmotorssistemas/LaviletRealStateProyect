import { areaAssertions, satisfiesNumeric } from './numeric-relations'
import { object, text, type Row } from './data'
import { sanitizeTourSpaces } from '@/lib/tour/tourRooms'
import { factualValueIssues, reviewedCatalogDenials, reviewedContextualGuidance } from './semantic-review'
import { turnEvidence } from './turn-evidence'
import { bedroomOptions } from './bedroom-options'
import { bedroomComparison, bedroomCondition, matchesBedrooms, type BedroomComparison } from './bedroom-comparison'
import { verifiedAbsenceReply } from './catalog-absence'
import { requirementMatch, catalogNumber } from './catalog-request'
import { unitModelDelivery } from './unit-model'
import { leadBudget } from './budget-state'

type Operation = 'search' | 'rank' | 'compare' | 'select' | 'details' | 'none'
export type CatalogQuery = {
  group: 'residential' | 'commercial' | null
  category: string | null
  operation: Operation
  selector: string | null
  scope: string
  requirements?: Row[]
  filters: BedroomComparison & { bedrooms: number | null; bedrooms_any?: number[]; bedrooms_required: boolean | null; floor_number: number | null; min_area_m2: number | null; max_area_m2: number | null }
}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
const unitIds = (units: Row[]) => units.map(unit => text(unit.id))
const residential = new Set(['suite', 'departamento', 'penthouse'])
const categories = new Set([...residential, 'local'])
const operations = new Set(['search', 'rank', 'compare', 'select', 'details', 'none'])
const finite = (value: unknown, minimum = 0): number | null => typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null
const measurement = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : finite(Number(value), 0.01)
const number = (value: number) => value.toLocaleString('es-EC', { maximumFractionDigits: 2 })
const join = (values: string[], conjunction = 'y') => values.length < 2 ? values[0] || '' : `${values.slice(0, -1).join(', ')} ${conjunction} ${values.at(-1)}`
const label = (unit: Row) => `${unit.category === 'local' ? 'local comercial' : text(unit.category)} ${text(unit.unit_number)}`
const plural: Record<string, string> = { suite: 'suites', departamento: 'departamentos', penthouse: 'penthouses', local: 'locales comerciales' }
const comparisonFields = ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number'] as const
const fieldValue = (unit: Row, field: typeof comparisonFields[number]) => field === 'floor_number'
  ? finite(unit[field]) : measurement(unit[field])
const floorLabel = (unit: Row) => text(unit.floor) || (finite(unit.floor_number) !== null ? `planta ${unit.floor_number}` : '')
const groupLabel = (units: Row[]) => units.length === 1 ? label(units[0])
  : `${plural[text(units[0].category)] || 'unidades'} ${join(units.map(unit => text(unit.unit_number)))}`

/** The interpreter owns intent. This layer only validates and executes its query. */
export function catalogQuery(value: unknown): CatalogQuery {
  const input = object(value), filters = object(input.filters)
  const requirements = rows(input.requirements)
  const covered = new Set(requirements.map(r => r.field))
  return {
    group: ['residential', 'commercial'].includes(text(input.group)) ? input.group as CatalogQuery['group'] : null,
    category: categories.has(text(input.category)) ? text(input.category) : null,
    operation: operations.has(text(input.operation)) ? input.operation as Operation : 'none',
    selector: text(input.selector) || null,
    scope: text(input.scope || input.query_scope) || 'catalog',
    ...(requirements.length ? { requirements } : {}),
    filters: { ...(bedroomOptions(filters.bedrooms_any).length > 1 ? { bedrooms_any: bedroomOptions(filters.bedrooms_any) } : {}), bedrooms: bedroomOptions(filters.bedrooms_any).length > 1 ? null : finite(filters.bedrooms, 1), bedrooms_required: typeof filters.bedrooms_required === 'boolean' ? filters.bedrooms_required : null,
      floor_number: finite(filters.floor_number), min_area_m2: finite(filters.min_area_m2, 0.01), max_area_m2: finite(filters.max_area_m2, 0.01), ...bedroomComparison(filters),
      ...(covered.has('floor_number') ? { floor_number: null } : {}),
      ...(covered.has('area_internal_m2') ? { min_area_m2: null, max_area_m2: null } : {}) },
  }
}

/** A missing measurement is unknown, not evidence that a feature is absent. */
export function partitionCatalog(catalog: Row[], query: CatalogQuery, scopedIds?: string[]) {
  const requirements = query.requirements || []
  const required = requirements.filter(r => r.strength === 'required')
  const base = catalog.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
    .filter(unit => !scopedIds || scopedIds.includes(text(unit.id)))
    .filter(unit => !query.group || (query.group === 'residential' ? residential.has(text(unit.category)) : unit.category === 'local'))
    .filter(unit => !query.category || unit.category === query.category)
    .sort((a, b) => text(a.unit_number).localeCompare(text(b.unit_number), 'es', { numeric: true }))
  const units: Row[] = [], unknown: Row[] = []
  for (const unit of base) {
    const checks: (boolean | null)[] = required.map(r => requirementMatch(unit, r))
    const f = query.filters
    if (!requirements.some(r => r.field === 'bedrooms') && (f.bedrooms != null || f.bedrooms_any?.length))
      checks.push(catalogNumber(unit.bedrooms) === null ? null : matchesBedrooms(catalogNumber(unit.bedrooms), f))
    if (!requirements.some(r => r.field === 'floor_number') && f.floor_number != null)
      checks.push(catalogNumber(unit.floor_number) === null ? null : catalogNumber(unit.floor_number) === f.floor_number)
    if (!requirements.some(r => r.field === 'area_internal_m2')) {
      if (f.min_area_m2 != null) checks.push(catalogNumber(unit.area_internal_m2) === null ? null : Number(unit.area_internal_m2) >= f.min_area_m2)
      if (f.max_area_m2 != null) checks.push(catalogNumber(unit.area_internal_m2) === null ? null : Number(unit.area_internal_m2) <= f.max_area_m2)
    }
    if (checks.includes(false)) continue
    if (checks.includes(null)) unknown.push(unit)
    else units.push(unit)
  }
  return { units, unknown }
}

export function filterCatalog(catalog: Row[], query: CatalogQuery, scopedIds?: string[]) {
  return partitionCatalog(catalog, query, scopedIds).units
}

/** A recommendation changes one verified physical requirement, never the
 * customer's price limit or an indispensable number of bedrooms. */
export function catalogRequirementAlternative(catalog: Row[], query: CatalogQuery, excluded: Set<string>, scopedIds?: string[],
  budget?: { maximum: number }) {
  const fields = new Set(rows(query.requirements).filter(r => r.strength === 'required'
    && !['published_commercial_price', 'unmodeled', 'spaces'].includes(text(r.field))).map(r => text(r.field)))
  if (query.filters.bedrooms !== null || query.filters.bedrooms_any?.length) fields.add('bedrooms')
  if (query.filters.floor_number !== null) fields.add('floor_number')
  if (query.filters.min_area_m2 !== null || query.filters.max_area_m2 !== null) fields.add('area_internal_m2')
  const withoutFloor = catalogQuery({ ...query, filters: { ...query.filters, floor_number: null },
    requirements: rows(query.requirements).filter(r => !['floor_number', 'published_commercial_price'].includes(text(r.field))) })
  const canPreserveBedroomsByChangingFloor = fields.has('floor_number') && fields.has('bedrooms')
    && filterCatalog(catalog, withoutFloor, scopedIds).some(unit => !excluded.has(text(unit.category)))
  const proposals: { field: string; query: CatalogQuery; units: Row[] }[] = []
  for (const field of fields) {
    if (field === 'bedrooms' && (query.filters.bedrooms_required === true || canPreserveBedroomsByChangingFloor)) continue
    const filters = { ...query.filters }
    if (field === 'bedrooms') Object.assign(filters, { bedrooms: null, bedrooms_any: [], bedrooms_operator: null, bedrooms_upper: null, bedrooms_required: false })
    if (field === 'floor_number') filters.floor_number = null
    if (field === 'area_internal_m2') Object.assign(filters, { min_area_m2: null, max_area_m2: null })
    // An unavailable apartment count can be explored across compatible housing
    // types. This is an explicit proposal, never a silent category selection;
    // exclusions and every other physical/price constraint still apply.
    let proposed = catalogQuery({ ...query, operation: 'search', selector: null,
      category: field === 'bedrooms' && query.group === 'residential' && query.category === 'departamento' ? null : query.category, filters,
      requirements: rows(query.requirements).filter(r => r.field !== field) })
    let units = filterCatalog(catalog, proposed, scopedIds).filter(unit => !excluded.has(text(unit.category))
      && unit[field] != null && unit[field] !== '' && Number.isFinite(Number(unit[field])))
    // Budget orientation limits what is offered, never adds a permanent price
    // requirement. A later correction of the budget can expand this same search.
    if (budget && Number.isFinite(budget.maximum) && budget.maximum > 0) units = units.filter(unit =>
      typeof unit.published_commercial_price === 'number' && Number.isFinite(unit.published_commercial_price)
      && unit.published_commercial_price > 0 && unit.published_commercial_price <= budget.maximum)
    if (!units.length) continue
    if (field === 'bedrooms' && units.every(unit => typeof unit.bedrooms === 'number' && Number.isFinite(unit.bedrooms) && unit.bedrooms > 0)) {
      const requested = query.filters.bedrooms ?? query.filters.bedrooms_any?.[0]
        ?? rows(query.requirements).find(r => r.field === field && typeof r.value === 'number')?.value
      const count = typeof requested === 'number' ? units.reduce((best, unit) =>
        Math.abs(Number(unit.bedrooms) - requested) < Math.abs(best - requested) ? Number(unit.bedrooms) : best, Number(units[0].bedrooms)) : null
      if (count !== null) {
        proposed = catalogQuery({ ...proposed, filters: { ...proposed.filters, bedrooms: count } })
        units = filterCatalog(units, proposed)
      }
    }
    if (field === 'floor_number') {
      const conditions = rows(query.requirements).filter(r => r.field === field && r.strength === 'required')
      if (query.filters.floor_number !== null) conditions.push({ operator: 'eq', value: query.filters.floor_number })
      const distance = (floor: number) => conditions.reduce((total, condition) => {
        const value = Number(condition.value), upper = Number(condition.upper_value)
        if (!Number.isFinite(value)) return total
        if (condition.operator === 'eq') return total + Math.abs(floor - value)
        if (['lt', 'lte'].includes(text(condition.operator))) return total + Math.max(0, floor - value)
        if (['gt', 'gte'].includes(text(condition.operator))) return total + Math.max(0, value - floor)
        if (condition.operator === 'between' && Number.isFinite(upper)) return total + Math.max(0, value - floor, floor - upper)
        return total
      }, 0)
      const floors = [...new Set(units.map(unit => Number(unit.floor_number)))]
      const nearest = Math.min(...floors.map(distance))
      const proposedFloors = floors.filter(floor => distance(floor) === nearest)
      // A concrete, consentable proposal is not a silent floor selection. Ties
      // remain open instead of arbitrarily choosing an upper or lower floor.
      if (conditions.length && proposedFloors.length === 1) {
        proposed = catalogQuery({ ...proposed, filters: { ...proposed.filters, floor_number: proposedFloors[0] } })
        units = filterCatalog(units, proposed)
      }
    }
    proposals.push({ field, query: proposed, units })
  }
  // Keeping the requested bedrooms precedes offering fewer rooms merely to
  // stay on the unavailable floor. Each change still needs explicit consent.
  return proposals.find(proposal => proposal.field === 'floor_number') || (proposals.length === 1 ? proposals[0] : null)
}

/** Use the catalogue's official floor label. Number alone never invents a
 * ground-floor or accessibility claim. */
export function alternativeFloorQuestion(query: CatalogQuery, units: Row[], includeBedrooms = false): string {
  if (query.filters.floor_number === null || !units.length) return ''
  const names = [...new Set(units.map(floorLabel).filter(Boolean))]
  const floor = names.length === 1 ? names[0] : `planta ${query.filters.floor_number}`
  const categoryNames = [...new Set(units.map(unit => text(unit.category)))]
  const subject = categoryNames.length === 1 ? plural[categoryNames[0]] || 'opciones' : 'opciones'
  const bedrooms = includeBedrooms && query.filters.bedrooms !== null ? ` de ${query.filters.bedrooms} dormitorios` : ''
  return `¿Le gustaría que revisemos ${subject === 'suites' || subject === 'opciones' ? 'las' : 'los'} ${subject}${bedrooms} en ${floor}?`
}

/** A no to one concrete floor permits another explicitly consented proposal,
 * never a silent bedroom reduction or a sequence of repeated offers. */
export function canOfferLowerFloorBedrooms(info: Row, query: CatalogQuery, declined: Row): boolean {
  const semantics = object(info.semantica_turno), answer = object(semantics.answer_to_previous)
  const current = text(answer.evidence).trim(), evidence = text(declined.evidence).trim()
  const refusal = evidence.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const engagement = object(info.commercial_engagement)
  return query.filters.bedrooms_required !== true && answer.confidence === 'high'
    && answer.kind === 'negative' && answer.question_id === 'property_requirements'
    && !!current && current === evidence && engagement.passive !== true
    && object(info._sales_memory).passive_sales !== true && semantics.opt_out !== true && info.opt_out !== true
    && object(info.catalog_verification_read || info.catalog_read).complete === true
    && !/\b(?:ningun[oa]?|no (?:quiero|deseo|necesito) (?:seguir|continuar|revisar|explorar|evaluar)|no (?:me interesa|estoy interesad[oa])|no (?:quiero|deseo).*(?:alternativas|opciones)|no insista|dej(?:e|a) de)\b/.test(refusal)
}

export function catalogLowerFloorBedroomAlternative(catalog: Row[], query: CatalogQuery, declined: Row,
  excluded: Set<string>, scopedIds?: string[], budget?: { maximum: number }) {
  const rejected = catalogQuery(declined.proposed_query)
  const original = catalogQuery(declined.original_query)
  const nonFloor = (value: CatalogQuery) => JSON.stringify({ group: value.group, category: value.category,
    filters: { ...value.filters, floor_number: null }, requirements: rows(value.requirements).filter(r => r.field !== 'floor_number') })
  // A rejected bedroom change is already the second offer. It does not permit
  // another reduction, nor can a rejected category/area change masquerade as a floor decision.
  if (nonFloor(original) !== nonFloor(query) || nonFloor(rejected) !== nonFloor(original)
    || original.filters.bedrooms_required === true || rejected.filters.floor_number === null
    || JSON.stringify([original.filters.floor_number, rows(original.requirements).filter(r => r.field === 'floor_number')])
      === JSON.stringify([rejected.filters.floor_number, rows(rejected.requirements).filter(r => r.field === 'floor_number')])) return null
  const bedroomRequirements = rows(query.requirements).filter(r => r.field === 'bedrooms' && r.strength === 'required')
  const threshold = query.filters.bedrooms ?? (bedroomRequirements.length === 1
    && ['eq', 'gte'].includes(text(bedroomRequirements[0].operator)) ? catalogNumber(bedroomRequirements[0].value) : null)
  if (threshold === null || threshold <= 1 || query.filters.bedrooms_any?.length
    || ['lte', 'between'].includes(text(query.filters.bedrooms_operator))) return null
  const requirements = rows(query.requirements).filter(r => !['floor_number', 'bedrooms'].includes(text(r.field)))
  const available = catalogQuery({ ...query, operation: 'search', selector: null, requirements,
    filters: { ...query.filters, floor_number: null, bedrooms: null, bedrooms_any: [], bedrooms_operator: null, bedrooms_upper: null, bedrooms_required: false } })
  let units = filterCatalog(catalog, available, scopedIds).filter(unit => !excluded.has(text(unit.category))
    && catalogNumber(unit.floor_number) !== null && Number(unit.floor_number) < rejected.filters.floor_number!
    && Number(unit.floor_number) >= 0 && catalogNumber(unit.bedrooms) !== null
    && Number(unit.bedrooms) > 0 && Number(unit.bedrooms) < threshold)
  if (budget && Number.isFinite(budget.maximum) && budget.maximum > 0) units = units.filter(unit =>
    typeof unit.published_commercial_price === 'number' && Number.isFinite(unit.published_commercial_price)
    && unit.published_commercial_price > 0 && unit.published_commercial_price <= budget.maximum)
  if (!units.length) return null
  // Minimize the bedroom reduction among verified options below the rejected
  // floor; then keep its lowest floor. Category changes remain excluded.
  const bedrooms = Math.max(...units.map(unit => Number(unit.bedrooms)))
  units = units.filter(unit => Number(unit.bedrooms) === bedrooms)
  const floor = Math.min(...units.map(unit => Number(unit.floor_number)))
  units = units.filter(unit => Number(unit.floor_number) === floor)
  const proposed = catalogQuery({ ...available, filters: { ...available.filters, bedrooms, floor_number: floor } })
  return { field: 'bedrooms_and_floor', query: proposed, units }
}

export function rankCatalog(units: Row[], selector: string | null, pricesAllowed = false) {
  const field = ['largest', 'smallest'].includes(selector || '') ? 'area_internal_m2'
    : pricesAllowed && ['cheapest', 'most_expensive'].includes(selector || '') ? 'published_commercial_price' : null
  const unknown = field ? units.filter(unit => measurement(unit[field]) === null || field === 'published_commercial_price' && Number(unit[field]) <= 0) : units
  if (!field || !units.length || unknown.length) return { units: [] as Row[], complete: false, unknown_unit_ids: unitIds(unknown) }
  const values = units.map(unit => measurement(unit[field])!)
  const extreme = ['smallest', 'cheapest'].includes(selector || '') ? Math.min(...values) : Math.max(...values)
  return { units: units.filter(unit => measurement(unit[field]) === extreme), complete: true, unknown_unit_ids: [] as string[] }
}

/** Aggregates are computed only over the already filtered result, never the whole catalogue. */
export function compareCatalog(units: Row[]) {
  const measure = (field: string) => {
    const values = units.map(unit => measurement(unit[field]))
    const complete = units.length > 0 && values.every(value => value !== null)
    return { complete, same: complete && new Set(values).size === 1, min: complete ? Math.min(...values as number[]) : null, max: complete ? Math.max(...values as number[]) : null }
  }
  const grouped = new Map<string, Row[]>()
  for (const unit of units) {
    const key = JSON.stringify([unit.category, ...comparisonFields.filter(field => field !== 'floor_number').map(field => fieldValue(unit, field))])
    grouped.set(key, [...(grouped.get(key) || []), unit])
  }
  const groups = [...grouped.values()].map(group => ({
    unit_ids: unitIds(group), unit_numbers: group.map(unit => text(unit.unit_number)), category: text(group[0].category),
    bedrooms: measurement(group[0].bedrooms), bathrooms_full: measurement(group[0].bathrooms_full),
    area_internal_m2: measurement(group[0].area_internal_m2), area_exterior_m2: measurement(group[0].area_exterior_m2),
    floors: group.map(unit => ({ unit_id: text(unit.id), unit_number: text(unit.unit_number), floor_number: finite(unit.floor_number), floor: floorLabel(unit) })),
  }))
  const known_fields = comparisonFields.filter(field => units.length > 0 && units.every(unit => fieldValue(unit, field) !== null))
  const differences = known_fields.map(field => ({ field, values: [...new Set(units.map(unit => fieldValue(unit, field)))] }))
    .filter(item => item.values.length > 1)
  return { unit_ids: unitIds(units), count: units.length, interior: measure('area_internal_m2'), exterior: measure('area_exterior_m2'), bedrooms: measure('bedrooms'),
    groups, differences, known_fields }
}

/** Overview restrictions apply to a search presentation, never a comparison or details. */
export function isCategoryOverview(audit: Row): boolean {
  const operation = text(object(audit.catalog_query).operation)
  return object(audit.alternative_presentation).kind === 'category_overview' && (!operation || operation === 'search')
}

/** Check factual relationships in rewritten copy against the exact query result.
 * A number occurring elsewhere in the project does not authorize attaching it
 * to this category, bedroom count or unit. Non-catalogue questions remain free
 * to be completed by the normal coverage stage. */
export function validateCatalogReply(reply: string, audit: Row): { valid: boolean; reason?: string; details?: Row[] } {
  // A reviewed inventory has already been compared with the immutable sources.
  // Never reinterpret an approved draft with the historical prose parser.
  if (['structured_facts_v1', 'business-risk-v1', 'business-risk-v2'].includes(text(object(audit.semantic_review).validation_owner))
    && object(audit.semantic_review).status === 'checked') return { valid: true }
  if (object(audit.reference_resolution).status === 'clarification'
    && /\bno (?:contamos|tenemos|hay|disponemos)\b/i.test(reply)) return { valid: false, reason: 'unresolved_reference_is_not_unavailability' }
  if (audit.verified_catalog !== true) return { valid: true }
  const verified = [...new Map([...rows(object(audit.catalog_results).units), ...rows(object(audit.alternative_results).units)].map(unit => [unit.id, unit])).values()]
  if (!verified.length) return { valid: true }
  const review = object(audit.semantic_review)
  const groups = turnEvidence({}, audit).groups
  const reviewFacts = review.status === 'checked' && !factualValueIssues(review.factual_values, reply, [...verified, ...groups]).length
    ? rows(review.factual_values) : []
  const comparable = (value: string) => value.replace(/m²/g, 'm2').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const words: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
  const factualReply = [...reviewedCatalogDenials(reply, audit), ...reviewedContextualGuidance(reply, audit)]
    .reduce((body, fragment) => body.replace(fragment, ''), reply)
  const raw = factualReply.replace(/https?:\/\/\S+/g, '').replace(/¿[^?]*\?/g, '').replace(/m²/g, 'm2').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const clauses = raw.replace(/,\s*(?:frente a|mientras que|en cambio)\s+/g, '; ').split(/(?<!\d)\.\s+|(?<=\d)\.(?!\d)\s+|[;\n]+|\s+y\s+(?=(?:el |la |los |las )?(?:departamentos?|suites?|penthouses?|locales?|unidades?)\s+\d)/)
  for (const clause of clauses) {
    if (!clause.trim() || /[¿?]/.test(clause) || /\bno (?:contamos|tenemos|aparecen|ofrecemos|disponemos|dispone|hay)|pendiente.*verificar|falta.*verific/.test(clause)) continue
    let relevant = verified
    // Bind every member of a collective reference before checking its attributes.
    // Merely finding these numbers elsewhere in the result permits swapped groups.
    const named = [...clause.matchAll(/\b(departamentos?|apartamentos?|suites?|penthouses?|local(?:es)?(?: comerciales?)?|unidad(?:es)?)\s+(?:numeros?\s*)?((?:lc-?)?\d{1,4}(?:\s*(?:,|y|e)\s*(?:lc-?)?\d{1,4})*)\b/g)]
    const implicit = named.length ? [] : [...clause.matchAll(/\b(?:los|las|el|la)\s+(\d{3,4}(?:\s*(?:,|y|e)\s*\d{3,4})*)\b/g)]
    const references = [...named.map(match => ({ category: match[1], numbers: match[2] })),
      ...implicit.map(match => ({ category: 'unidad', numbers: match[1] }))]
    if (references.length) {
      const referenced: Row[] = []
      for (const reference of references) {
        const category = reference.category.startsWith('apartamento') ? 'departamento' : reference.category.startsWith('local') ? 'local'
          : reference.category.startsWith('unidad') ? 'unidad' : reference.category.replace(/s$/, '')
        for (const code of reference.numbers.match(/\d+/g) || []) {
          const candidates = verified.filter(unit => Number(text(unit.unit_number).replace(/\D/g, '')) === Number(code))
          if (!candidates.length) return { valid: false, reason: 'catalog_unit_mismatch' }
          const matching = category === 'unidad' ? candidates : candidates.filter(unit => unit.category === category)
          if (!matching.length) return { valid: false, reason: 'catalog_category_mismatch' }
          referenced.push(...matching)
        }
      }
      relevant = referenced
    } else {
      const mentioned = [...categories].filter(category => new RegExp(`\\b${category === 'local' ? 'local(?:es)?' : category + 's?'}\\b`).test(clause))
      if (mentioned.length === 1) relevant = relevant.filter(unit => unit.category === mentioned[0])
    }
    const roomMatches = [...clause.matchAll(/\b(\d+(?:\s*(?:,|y|o|a)\s*\d+)*|un|uno|una|dos|tres|cuatro|cinco|seis)\s+(?:dormitorios?|habitaciones?|cuartos?)\b/g)]
    if (roomMatches.length) {
      const requested = roomMatches.flatMap(match => words[match[1]] ? [words[match[1]]] : (match[1].match(/\d+/g) || []).map(Number))
      if (requested.some(rooms => !relevant.some(unit => Number(unit.bedrooms) === rooms))) return { valid: false, reason: 'catalog_bedroom_mismatch' }
      if (references.length && relevant.some(unit => !requested.includes(Number(unit.bedrooms)))) return { valid: false, reason: 'catalog_bedroom_mismatch' }
      relevant = relevant.filter(unit => requested.includes(Number(unit.bedrooms)))
    }
    const bathrooms = [...clause.matchAll(/\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)\s+banos? completos?\b/g)]
      .map(match => words[match[1]] ?? Number(match[1]))
    if (bathrooms.length && (bathrooms.some(value => !relevant.some(unit => measurement(unit.bathrooms_full) === value))
      || references.length && relevant.some(unit => !bathrooms.includes(measurement(unit.bathrooms_full)!)))) return { valid: false, reason: 'catalog_bathroom_mismatch' }
    if (references.length) {
      const ordinals: Record<string, number> = { primera: 1, primer: 1, segunda: 2, segundo: 2, tercera: 3, tercer: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6 }
      const floors = [...clause.matchAll(/\b(?:(\d{1,2})(?:\.[ªº]|[ªºa])?|(primera?|primer|segunda?|segundo|tercera?|tercer|cuarta?|cuarto|quinta?|quinto|sexta?|sexto))\s+(?:planta|piso)\b|\b(?:planta|piso)\s+(\d{1,2})\b/g)]
        .map(match => match[2] ? ordinals[match[2]] : Number(match[1] || match[3]))
      if (/\bplanta baja\b/.test(clause)) floors.push(0)
      if (floors.length && relevant.some(unit => !floors.includes(finite(unit.floor_number)!))) return { valid: false, reason: 'catalog_floor_mismatch' }
    }
    for (const area of areaAssertions(clause)) {
      // The reviewer resolves natural language to a typed field. Use that
      // binding only after checking its literal fragment and catalogue value;
      // never override an explicit conflicting label in the actual reply.
      const bindings = reviewFacts.filter(fact => ['area_internal_m2', 'area_exterior_m2'].includes(text(fact.field))
        && comparable(text(fact.fragment)).includes(area.fragment) && area.values.includes(Number(fact.value))
        && (relevant.some(unit => unit.id === fact.unit_id) || groups.some(group => group.id === fact.unit_id)))
      const boundFields = [...new Set(bindings.map(fact => text(fact.field)))]
      if (!area.fieldExplicit && boundFields.length === 1) area.field = boundFields[0]
      const boundGroups = groups.filter(group => bindings.some(fact => fact.unit_id === group.id && fact.field === area.field))
      const groupIds = new Set(boundGroups.flatMap(group => ids(group.member_ids)))
      const areaUnits = !references.length && groupIds.size ? relevant.filter(unit => groupIds.has(text(unit.id))) : relevant
      const allowed = areaUnits.map(unit => measurement(unit[area.field])).filter((value): value is number => value !== null)
      const matches = (actual: number) => area.operator === 'between'
        ? satisfiesNumeric(actual, area.values[0], 'between', area.values[1])
        : area.values.some(value => satisfiesNumeric(actual, value, area.operator))
      if (area.derived) return { valid: false, reason: 'catalog_derived_fact_unverified' }
      if (area.exactRange && area.values.some(value => !allowed.some(actual => satisfiesNumeric(actual, value))))
        return { valid: false, reason: 'catalog_area_mismatch' }
      const wrongEndpoint = area.endpoint && allowed.length && !satisfiesNumeric(Math[area.endpoint](...allowed), area.values[0])
      if (!allowed.length || wrongEndpoint || !allowed.some(matches) || (references.length || area.operator !== 'eq') && (allowed.length !== areaUnits.length || !allowed.every(matches)))
        return { valid: false, reason: 'catalog_area_mismatch', details: [{ fragment: clause, field: area.field,
          received: area.values, operator: area.operator, expected: allowed, unit_ids: relevant.map(unit => unit.id) }] }
    }
  }
  return { valid: true }
}

const facts = (unit: Row, pricesAllowed: boolean) => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category, bedrooms: unit.bedrooms,
  ...(pricesAllowed ? { published_commercial_price: unit.published_commercial_price } : {}),
  floor_number: unit.floor_number, floor: unit.floor, area_internal_m2: unit.area_internal_m2, area_exterior_m2: unit.area_exterior_m2,
  bathrooms_full: unit.bathrooms_full, description: unit.description, spaces: unit.spaces })
function details(unit: Row) {
  return [measurement(unit.bedrooms) !== null ? `${unit.bedrooms} ${Number(unit.bedrooms) === 1 ? 'dormitorio' : 'dormitorios'}` : '',
    measurement(unit.bathrooms_full) !== null ? `${unit.bathrooms_full} ${Number(unit.bathrooms_full) === 1 ? 'baño completo' : 'baños completos'}` : '',
    measurement(unit.area_internal_m2) !== null ? `${number(Number(unit.area_internal_m2))} m² interiores` : '',
    measurement(unit.area_exterior_m2) !== null ? `${number(Number(unit.area_exterior_m2))} m² exteriores` : '',
    text(unit.floor) || (finite(unit.floor_number) !== null ? `planta ${unit.floor_number}` : '')].filter(Boolean).join(', ')
}
function categorySummary(units: Row[]) {
  return [...categories].filter(category => units.some(unit => unit.category === category)).map(category => {
    const categoryUnits = units.filter(unit => unit.category === category)
    const counts = [...new Set(categoryUnits.map(unit => measurement(unit.bedrooms)).filter(value => value !== null))].sort((a, b) => a - b)
    const known = category !== 'local' && categoryUnits.every(unit => measurement(unit.bedrooms) !== null)
    return `${plural[category]}${known ? ` de ${join(counts.map(number), 'o')} ${counts.length === 1 && counts[0] === 1 ? 'dormitorio' : 'dormitorios'}` : ''}`
  })
}

/** At the floor-selection stage do not turn each floor into a list of codes. */
export function catalogFloorOverview(units: Row[]) {
  return [...categories].filter(category => units.some(unit => unit.category === category)).map(category => {
    const members = units.filter(unit => unit.category === category)
    const floors = [...new Set([...members].sort((a, b) => Number(a.floor_number) - Number(b.floor_number)).map(floorLabel).filter(Boolean))]
    return `${categorySummary(members)[0]}${floors.length ? ` en ${join(floors)}` : ''}`
  }).join('; ')
}

/** Category-level alternatives precede individual specifications and floor selection. */
function alternativeOverview(units: Row[], includeFloorDetails = true) {
  const groups = [...categories].filter(category => units.some(unit => unit.category === category)).map(category => {
    const members = units.filter(unit => unit.category === category)
    const areas = members.map(unit => measurement(unit.area_internal_m2))
    const min = areas.every(area => area !== null) ? Math.min(...areas as number[]) : null
    const max = areas.every(area => area !== null) ? Math.max(...areas as number[]) : null
    const exterior = members.map(unit => measurement(unit.area_exterior_m2))
    const exteriorMin = exterior.every(area => area !== null) ? Math.min(...exterior as number[]) : null
    const exteriorMax = exterior.every(area => area !== null) ? Math.max(...exterior as number[]) : null
    const floors = [...new Set([...members].sort((a, b) => Number(a.floor_number) - Number(b.floor_number)).map(floorLabel).filter(Boolean))]
    const description = categorySummary(members)[0]
    return { category, min_area_internal_m2: min, max_area_internal_m2: max,
      min_area_exterior_m2: exteriorMin, max_area_exterior_m2: exteriorMax, floors,
      description: `${description}${min !== null && max !== null ? min === max ? `, con ${number(min)} m² interiores` : `, desde ${number(min)} hasta ${number(max)} m² interiores` : ''}${includeFloorDetails && exteriorMin !== null && exteriorMax !== null ? exteriorMin === exteriorMax ? ` y ${number(exteriorMin)} m² exteriores` : ` y desde ${number(exteriorMin)} hasta ${number(exteriorMax)} m² exteriores` : ''}${includeFloorDetails && floors.length ? ` en ${join(floors)}` : ''}` }
  })
  const reply = groups.map(group => `${group.description.charAt(0).toUpperCase()}${group.description.slice(1)}.`).join(' ')
  return { reply, groups }
}

function groupedCharacteristics(units: Row[], comparison = compareCatalog(units)) {
  return comparison.groups.map(group => {
    const members = units.filter(unit => group.unit_ids.includes(text(unit.id)))
    const attributes = details({ ...members[0], floor: '', floor_number: null })
    const missing = [group.area_internal_m2 === null ? 'superficie interior pendiente de verificación' : '',
      group.area_exterior_m2 === null ? 'superficie exterior pendiente de verificación' : ''].filter(Boolean)
    const name = groupLabel(members)
    return `${name.charAt(0).toUpperCase() + name.slice(1)}: ${[attributes, ...missing].filter(Boolean).join(', ')}.`
  }).join('\n')
}

function floorComparison(units: Row[]) {
  const known = units.filter(unit => floorLabel(unit)), unknown = units.filter(unit => !floorLabel(unit))
  const groups = new Map<string, Row[]>()
  for (const unit of known) groups.set(floorLabel(unit), [...(groups.get(floorLabel(unit)) || []), unit])
  const byFloor = [...groups].map(([floor, members]) => `${groupLabel(members)} en ${floor}`)
  const location = groups.size > 1 ? `La planta cambia: ${byFloor.join('; ')}.`
    : groups.size === 1 ? `${groupLabel(known).charAt(0).toUpperCase() + groupLabel(known).slice(1)} ${known.length === 1 ? 'está' : 'están'} en ${floorLabel(known[0])}.` : ''
  return [location, unknown.length ? `Falta verificar la planta de ${groupLabel(unknown)}.` : ''].filter(Boolean).join(' ')
}

function comparisonReply(units: Row[], comparison: ReturnType<typeof compareCatalog>) {
  let body: string
  if (comparison.groups.length === 1 && comparison.interior.complete && units.length > 1) {
    const unit = units[0], attributes = [measurement(unit.bedrooms) !== null ? `${unit.bedrooms} dormitorios` : '',
      measurement(unit.bathrooms_full) !== null ? `${unit.bathrooms_full} baños completos` : ''].filter(Boolean)
    body = `${unit.category === 'suite' ? 'Las' : 'Los'} ${groupLabel(units)}${attributes.length ? ` tienen ${join(attributes)} y` : ' tienen'} la misma superficie interior: ${number(comparison.interior.min!)} m².`
    if (comparison.exterior.complete) body += ` Cada uno cuenta con ${number(comparison.exterior.min!)} m² exteriores.`
    else body += ' La superficie exterior está pendiente de verificación.'
  } else {
    const dimensions: Record<string, string> = { bedrooms: 'los dormitorios', bathrooms_full: 'los baños completos', area_internal_m2: 'la superficie interior', area_exterior_m2: 'la superficie exterior' }
    const differences = comparison.differences.filter(item => item.field !== 'floor_number').map(item => dimensions[item.field])
    body = `${differences.length ? `Se diferencian en ${join(differences)}:\n` : ''}${groupedCharacteristics(units, comparison)}`
  }
  return [body, floorComparison(units)].filter(Boolean).join('\n')
}

/** Pure catalogue answer shared by every commercial route and writing style. */
export function catalogDialogueReply(info: Row, _current = ''): { reply: string; audit: Row } | null {
  if (info.catalogue_price_requested === true) return null // Keep the existing authorized-price quote and affordability policy.
  if (['ask_price', 'request_visit', 'ask_financing', 'request_reservation', 'ask_reservation'].includes(text(object(info.semantica_turno).primary_intent))) return null
  const reference = object(info.referencia_unidad), context = object(info.property_context || reference.context)
  const semantic = object(object(info.semantica_turno).property)
  const raw = object(reference.query || context.query || (semantic.confidence === 'high' ? semantic : {}))
  const query = catalogQuery(raw)
  if (query.filters.bedrooms_operator === 'between' && query.filters.bedrooms_upper == null) return null
  // A relative price choice needs a complete price ranking before selecting a unit.
  if (query.operation === 'select' && ['cheapest', 'most_expensive'].includes(query.selector || '')) query.operation = 'rank'
  if (query.operation === 'none') {
    if (!canOfferLowerFloorBedrooms(info, query, object(context.requirements_declined))) return null
    // A scoped refusal has no new catalogue operation. Execute only the
    // second, consentable proposal; never change the durable original query.
    query.operation = 'search'
  }
  const catalog = rows(info.catalogo)
  if (!catalog.length) return null
  const pending = object(context.pending_question || info.pregunta_pendiente)
  const focus = ids(pending.target_ids).length ? ids(pending.target_ids) : ids(context.focused_ids)
  const referenceIds = unitIds(rows(reference.matches))
  let scopedIds: string[] | undefined
  if (query.scope === 'offered') scopedIds = ids(context.offered_ids)
  if (query.scope === 'comparison') scopedIds = ids(context.comparison_ids)
  if (query.scope === 'selected') scopedIds = ids(context.selected_ids).length ? ids(context.selected_ids) : focus
  if (['details', 'select'].includes(query.operation)) scopedIds = (reference.explicit === true || object(context.reference_resolution).status === 'resolved') && referenceIds.length ? referenceIds
    : focus.length ? focus : referenceIds.length ? referenceIds : scopedIds
  if (query.operation === 'compare') {
    if (referenceIds.length) scopedIds = referenceIds
    else if (!scopedIds?.length && query.scope !== 'catalog') scopedIds = ids(pending.candidate_ids).length
      ? ids(pending.candidate_ids) : ids(context.offered_ids)
  }
  if (query.operation === 'select' && query.category && !query.selector && !scopedIds?.length
    && reference.explicit !== true && reference.needsClarification !== true) query.operation = 'search'
  const partition = partitionCatalog(catalog, query, scopedIds)
  const candidates = partition.units
  const excluded = [...new Set([...ids(semantic.excluded_categories), ...ids(context.excluded_categories)])]
  const units = candidates.filter(unit => !excluded.includes(text(unit.category)))
  const unknown = partition.unknown.filter(unit => !excluded.includes(text(unit.category)))
  const availableIds = new Set(unitIds(filterCatalog(catalog, catalogQuery({}))))
  const missingIds = (scopedIds || []).filter(id => !availableIds.has(id))
  const semanticCandidates = query.operation === 'search' && object(info.catalog_retrieval).applied === true
  const baseAudit: Row = { query_transition: object(context.query_transition), filter_resolution: object(context.filter_resolution),
    reference_resolution: object(context.reference_resolution), source: `catalog_${query.operation}`, verified_catalog: true, catalog_query: query,
    catalog_results: { unit_ids: unitIds(units), units: units.map(unit => facts(unit, object(info.politica_comercial).precios_autorizados === true)), complete: !unknown.length && !semanticCandidates, unknown_unit_ids: unitIds(unknown),
      ...(semanticCandidates ? { selection: 'semantic_candidates' } : {}) },
    ...(semanticCandidates ? { catalog_retrieval: info.catalog_retrieval, catalog_context_scope: info.catalog_context_scope } : {}),
    covered_requests: [`catalog_${query.operation}`], coverage_complete: false, catalog_excluded_categories: excluded,
    offered_unit_ids: [], focused_unit_ids: [], selected_unit_ids: [],
    catalog_coverage: { operation: query.operation, status: units.length ? 'answered' : unknown.length ? 'unknown' : 'no_results', result_unit_ids: unitIds(units),
      known_fields: compareCatalog(units).known_fields },
    pending_question: { id: 'none', act: 'other', question: '', target_ids: [], candidate_ids: [] } }
  const respond = (reply: string, audit: Row = {}) => ({ reply, audit: { ...baseAudit, ...audit } })
  const question = (id: string, act: string, value: string, targets: Row[] = [], candidatesForQuestion = units) => ({ id, act, question: value, target_ids: unitIds(targets), candidate_ids: unitIds(candidatesForQuestion) })
  if ((query.operation === 'compare' && (units.length < 2 || missingIds.length > 0 || reference.needsClarification === true))
    || ['details', 'select'].includes(query.operation) && (!units.length || missingIds.length > 0)) {
    const next = text(reference.clarification) || (query.operation === 'compare'
      ? '¿Qué unidades le gustaría que comparemos?' : '¿Qué unidad le gustaría conocer?')
    return respond(next, {
      reference_resolution: { ...object(context.reference_resolution), status: 'clarification', requested_ids: scopedIds || [], resolved_ids: unitIds(units), missing_ids: missingIds },
      catalog_results: { ...object(baseAudit.catalog_results), complete: false, unknown_unit_ids: missingIds },
      catalog_coverage: { operation: query.operation, status: 'clarification', result_unit_ids: unitIds(units), known_fields: [] },
      covered_requests: [], pending_question: question('unit_choice', 'choose_unit', next),
      progressive_selection: { stage: 'choose_unit', question: next, candidate_ids: unitIds(units), reason: 'reference_requires_clarification' },
    })
  }
  if (!units.length) {
    const subject = query.category ? plural[query.category] : query.group === 'commercial' ? 'locales comerciales' : 'viviendas'
    const conditions = [bedroomCondition(query.filters), query.filters.floor_number !== null ? `en la planta ${query.filters.floor_number}` : ''].filter(Boolean).join(' ')
    const opening = unknown.length ? 'Falta información en las fichas para confirmar qué opciones cumplen todas esas características.'
      : verifiedAbsenceReply(baseAudit) || `Actualmente no contamos con ${subject} disponibles${conditions ? ` ${conditions}` : ''}.`
    if (unknown.length) return respond(opening)
    const budget = leadBudget(info)
    const cap = budget.status === 'maximum_total' && budget.confidence === 'high'
      && typeof budget.amount === 'number' && object(info.politica_comercial).precios_autorizados === true
      ? { maximum: budget.amount } : undefined
    const declined = object(context.requirements_declined)
    const rejectionForThisQuery = Object.keys(declined).length > 0
      && JSON.stringify(catalogQuery({ ...object(declined.original_query), operation: 'search' }))
        === JSON.stringify(catalogQuery({ ...query, operation: 'search' }))
    const lowerAlternative = rejectionForThisQuery && canOfferLowerFloorBedrooms(info, query, declined)
      ? catalogLowerFloorBedroomAlternative(catalog, query, declined, new Set(excluded), scopedIds, cap) : null
    if (rejectionForThisQuery && !lowerAlternative) return respond(opening, { original_query: query })
    const alternative = lowerAlternative || catalogRequirementAlternative(catalog, query, new Set(excluded), scopedIds, cap)
    if (!alternative) return respond(opening, { original_query: query })
    const proposed = alternative.query, wider = alternative.units
    const overview = alternativeOverview(wider, false)
    const next = ['floor_number', 'bedrooms_and_floor'].includes(alternative.field)
      && alternativeFloorQuestion(proposed, wider, alternative.field === 'bedrooms_and_floor')
      || (alternative.field === 'bedrooms' && proposed.filters.bedrooms !== null
      ? `¿Le gustaría revisar las opciones de ${proposed.filters.bedrooms} dormitorios que tenemos disponibles?`
      : '¿Le gustaría revisar estas alternativas con ese cambio de requisito?')
    const floor = alternative.field === 'floor_number' && proposed.filters.floor_number !== null
      ? ` La planta compatible más cercana al requisito solicitado es ${floorLabel(wider[0])}.` : ''
    return respond(`${opening}${floor} Podemos revisar estas alternativas y valorar si se adaptan a lo que necesita: ${overview.reply} ${next}`,
      { original_query: query, alternative_results: { query: proposed, unit_ids: unitIds(wider), units: wider.map(unit => facts(unit, object(info.politica_comercial).precios_autorizados === true)) },
        alternative_presentation: { kind: 'category_overview', groups: overview.groups },
        pending_question: { ...question('property_requirements', 'explore_alternatives', next, [], wider), proposed_query: proposed,
          requirement_change: { field: alternative.field } } })
  }
  if (query.operation === 'rank') {
    const ranked = rankCatalog(units, query.selector, object(info.politica_comercial).precios_autorizados === true)
    if (!ranked.complete) return respond(['cheapest', 'most_expensive'].includes(query.selector || '')
      ? 'No tengo precios publicados y autorizados suficientes para comparar todas esas opciones y confirmar cuál tiene el mayor o menor precio.'
      : 'Falta una medida verificada para comparar todas esas opciones. Puedo mostrarle los datos disponibles sin afirmar cuál es la mayor.',
      { catalog_results: { ...object(baseAudit.catalog_results), complete: false, unknown_unit_ids: ranked.unknown_unit_ids }, coverage_complete: false })
    const ranking = ranked.units
    const dimension = ['cheapest', 'most_expensive'].includes(query.selector || '') ? 'precio publicado' : 'superficie interior'
    const value = dimension === 'precio publicado' ? `USD ${number(Number(ranking[0].published_commercial_price))}` : `${number(Number(ranking[0].area_internal_m2))} m²`
    const characteristic = ['smallest', 'cheapest'].includes(query.selector || '') ? 'menor' : 'mayor'
    let response = ranking.length === 1
      ? `La opción de ${characteristic} ${dimension} es ${label(ranking[0])}, con ${value}.`
      : `${join(ranking.map(label))} comparten la ${characteristic} ${dimension}: ${value}.`
    if (object(context.query_transition).reason === 'largest_available_after_unavailable_preference' && query.selector === 'largest') {
      const rooms = measurement(ranking[0].bedrooms)
      if (ranking.length === 1 && rooms !== null) response = `La mayor superficie interior disponible corresponde a ${label(ranking[0])}, de ${rooms} dormitorios, con ${value}.`
      const apartments = units.filter(unit => unit.category === 'departamento')
      const apartmentRank = rankCatalog(apartments, 'largest', false)
      if (ranking.every(unit => unit.category !== 'departamento') && apartments.length && apartmentRank.complete) response += ` Los departamentos más amplios alcanzan ${number(Number(apartmentRank.units[0].area_internal_m2))} m² interiores.`
    }
    const next = ranking.length === 1 ? `¿Le gustaría ver los detalles de ${label(ranking[0])}?` : '¿Cuál de estas opciones le gustaría conocer?'
    return respond(`${response} ${next}`, { offered_unit_ids: unitIds(ranking), focused_unit_ids: ranking.length === 1 ? unitIds(ranking) : [],
      catalog_ranking: { selector: query.selector, unit_ids: unitIds(ranking), value },
      pending_question: question('unit_choice', ranking.length === 1 ? 'show_unit_details' : 'choose_unit', next, ranking.length === 1 ? ranking : [], ranking) })
  }
  if (query.operation === 'compare') {
    const comparison = compareCatalog(units)
    const next = '¿Cuál de estas opciones le gustaría conocer más a detalle?'
    return respond(`${comparisonReply(units, comparison)} ${next}`, { comparison_unit_ids: unitIds(units), offered_unit_ids: unitIds(units), catalog_comparison: comparison,
      pending_question: question('unit_choice', 'choose_unit', next),
      progressive_selection: { stage: 'choose_unit', question: next, candidate_ids: unitIds(units), reason: 'comparison_answered_before_selection' },
      catalog_coverage: { ...object(baseAudit.catalog_coverage), required_dimensions: ['bedrooms', 'area_internal_m2', 'area_exterior_m2', 'floor_number'] } })
  }
  const concreteDetails = query.operation === 'details' && (reference.explicit === true
    || Array.isArray(semantic.unit_numbers) && semantic.unit_numbers.length > 0)
  if (['search', 'details'].includes(query.operation) && !concreteDetails && !query.category
    && (query.filters.bedrooms !== null || query.filters.bedrooms_any?.length || Object.keys(object(context.original_query)).length)
    && new Set(units.map(unit => unit.category)).size > 1) {
    const overview = alternativeOverview(units, false)
    const names = [...new Set(units.map(unit => plural[text(unit.category)]))]
    const next = `¿Prefiere que revisemos primero ${join(names, 'o')}?`
    return respond(`${overview.reply} ${next}`, {
      offered_unit_ids: unitIds(units), alternative_presentation: { kind: 'category_overview', groups: overview.groups },
      pending_question: question('property_category', 'choose_category', next),
      progressive_selection: { stage: 'choose_category', question: next, candidate_ids: unitIds(units), criteria: query.filters,
        reason: 'compatible_types_before_floor_or_unit' },
    })
  }
  if (concreteDetails || query.operation === 'select' || units.length === 1) {
    if (units.length !== 1 || reference.needsClarification === true) {
      const next = '¿Cuál de estas opciones le gustaría conocer?'
      return respond(`${groupedCharacteristics(units)}\n${floorComparison(units)} ${next}`, { offered_unit_ids: unitIds(units), pending_question: question('unit_choice', 'choose_unit', next),
        progressive_selection: { stage: 'choose_unit', question: next, candidate_ids: unitIds(units), criteria: query.filters, reason: 'details_require_unit_choice' } })
    }
    const unit = units[0]
    const delivery = unitModelDelivery({ explicit: true, hasUnitMention: true, matches: [unit] }, _current, info.historial, info.unit_models_sent)
    const tour = delivery?.unit_id ? { ...delivery, delivery_required: true, delivery_reason: query.operation === 'select' ? 'selected_unit' : 'single_compatible_option' } : null
    const spaces = sanitizeTourSpaces(Array.isArray(unit.spaces) ? unit.spaces : []).slice(0, 8).map(value => text(value).toLocaleLowerCase('es'))
    const description = text(unit.description).trim().replace(/\s+/g, ' ').slice(0, 350)
    const price = object(info.politica_comercial).precios_autorizados === true && Number(unit.published_commercial_price) > 0
      ? ` Su precio${object(info.politica_comercial).precios_aproximados === true ? ' referencial' : ''} es USD ${number(Number(unit.published_commercial_price))}.` : ''
    const next = query.operation === 'select' ? '' : `¿Desea continuar con ${label(unit)}?`
    const reply = `${label(unit).charAt(0).toUpperCase() + label(unit).slice(1)}${details(unit) ? ` tiene ${details(unit)}` : ' está disponible'}.${description ? ` ${description.replace(/[.!]$/, '')}.` : ''}${spaces.length ? ` Incluye ${join(spaces)}.` : ''}${price}${tour ? ` ${tour.caption}` : ''}${next ? ` ${next}` : ''}`
    return respond(reply, { focused_unit_ids: unitIds(units), selected_unit_ids: query.operation === 'select' ? unitIds(units) : [], offered_unit_ids: unitIds(units),
      unit_reference: { ids: unitIds(units), numbers: units.map(value => value.unit_number) }, ...(tour ? { unit_model: tour } : {}),
      ...(next ? { pending_question: question('unit_choice', 'confirm_unit', next, units),
        progressive_selection: { stage: 'choose_unit', question: next, candidate_ids: unitIds(units), reason: 'single_option_is_not_client_selection' } } : {}) })
  }
  const broad = !query.category && query.filters.bedrooms === null && !query.filters.bedrooms_any?.length && query.filters.floor_number === null && query.filters.min_area_m2 === null && query.filters.max_area_m2 === null
  if (broad) {
    const questionText = query.group === 'commercial' ? '¿Qué tipo de local busca?'
      : query.group === 'residential' ? '¿Qué tipo de vivienda le gustaría conocer?' : '¿Qué tipo de propiedad le gustaría conocer?'
    return respond(`Disponemos de ${join(categorySummary(units))}. ${questionText}`,
      { pending_question: question('property_category', 'choose_category', questionText) })
  }
  const floors = [...new Map([...units].filter(unit => finite(unit.floor_number) !== null)
    .sort((a, b) => Number(a.floor_number) - Number(b.floor_number))
    .map(unit => [Number(unit.floor_number), text(unit.floor) || `planta ${unit.floor_number}`])).values()]
  const choosingChangedCategory = object(context.preference_transition).active === true && query.category && query.filters.floor_number === null
  if (floors.length > 1) {
    const next = '¿En qué planta le gustaría revisar las opciones?'
    const body = `${semanticCandidates ? 'Entre las opciones encontradas hay' : 'Podemos revisar estas opciones:'} ${alternativeOverview(units).reply}`
    return respond(`${body} ${next}`,
      { offered_unit_ids: unitIds(units), pending_question: question('property_floor', 'choose_floor', next),
        progressive_selection: { stage: 'choose_floor', question: next, candidate_ids: unitIds(units), criteria: query.filters, reason: 'choose_floor_before_unit', client_requested_change: !!choosingChangedCategory,
          instruction: 'Mencione plantas y categorías compatibles, sin números de unidad. Pregunte explícitamente en qué planta quiere revisar opciones; no limite la pregunta a departamentos si también hay penthouses compatibles.' } })
  }
  const shown = units.slice(0, 8)
  const next = shown.length === 1 ? `¿Le gustaría ver los detalles de ${label(shown[0])}?` : '¿Cuál de estas opciones le gustaría conocer?'
  const choices = shown.length > 1 ? `${groupedCharacteristics(shown)}\n${floorComparison(shown)}`
    : `${label(shown[0])}${details(shown[0]) ? ` (${details(shown[0])})` : ''}.`
  return respond(`${choices}${units.length > shown.length ? ` Hay ${units.length} opciones que cumplen esos criterios; estas son las primeras ${shown.length}.` : ''} ${next}`,
    { offered_unit_ids: unitIds(shown), focused_unit_ids: shown.length === 1 ? unitIds(shown) : [],
      progressive_selection: { stage: 'choose_unit', question: next, candidate_ids: unitIds(shown), criteria: query.filters, reason: 'floor_selected_choose_unit', client_requested_change: object(context.preference_transition).active === true },
      pending_question: question('unit_choice', shown.length === 1 ? 'show_unit_details' : 'choose_unit', next, shown.length === 1 ? shown : [], shown) })
}

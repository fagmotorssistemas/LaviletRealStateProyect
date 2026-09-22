import { object, text, type Row } from './data'
import { unitTourUrl } from '@/lib/tour/unitModels'
import { sanitizeTourSpaces } from '@/lib/tour/tourRooms'

type Operation = 'search' | 'rank' | 'compare' | 'select' | 'details' | 'none'
export type CatalogQuery = {
  group: 'residential' | 'commercial' | null
  category: string | null
  operation: Operation
  selector: string | null
  scope: string
  filters: { bedrooms: number | null; bedrooms_required: boolean | null; floor_number: number | null; min_area_m2: number | null; max_area_m2: number | null }
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
  return {
    group: ['residential', 'commercial'].includes(text(input.group)) ? input.group as CatalogQuery['group'] : null,
    category: categories.has(text(input.category)) ? text(input.category) : null,
    operation: operations.has(text(input.operation)) ? input.operation as Operation : 'none',
    selector: text(input.selector) || null,
    scope: text(input.scope || input.query_scope) || 'catalog',
    filters: { bedrooms: finite(filters.bedrooms, 1), bedrooms_required: typeof filters.bedrooms_required === 'boolean' ? filters.bedrooms_required : null,
      floor_number: finite(filters.floor_number), min_area_m2: finite(filters.min_area_m2, 0.01), max_area_m2: finite(filters.max_area_m2, 0.01) },
  }
}

export function filterCatalog(catalog: Row[], query: CatalogQuery, scopedIds?: string[]) {
  return catalog.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
    .filter(unit => !scopedIds || scopedIds.includes(text(unit.id)))
    .filter(unit => !query.group || (query.group === 'residential' ? residential.has(text(unit.category)) : unit.category === 'local'))
    .filter(unit => !query.category || unit.category === query.category)
    .filter(unit => query.filters.bedrooms === null || measurement(unit.bedrooms) === query.filters.bedrooms)
    .filter(unit => query.filters.floor_number === null || unit.floor_number !== null && unit.floor_number !== undefined && Number(unit.floor_number) === query.filters.floor_number)
    .filter(unit => query.filters.min_area_m2 === null || (measurement(unit.area_internal_m2) ?? -Infinity) >= query.filters.min_area_m2)
    .filter(unit => query.filters.max_area_m2 === null || (measurement(unit.area_internal_m2) ?? Infinity) <= query.filters.max_area_m2)
    .sort((a, b) => text(a.unit_number).localeCompare(text(b.unit_number), 'es', { numeric: true }))
}

export function rankCatalog(units: Row[], selector: string | null, pricesAllowed = false) {
  const field = ['largest', 'smallest'].includes(selector || '') ? 'area_internal_m2'
    : pricesAllowed && ['cheapest', 'most_expensive'].includes(selector || '') ? 'published_commercial_price' : null
  const unknown = field ? units.filter(unit => measurement(unit[field]) === null) : units
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

/** Check factual relationships in rewritten copy against the exact query result.
 * A number occurring elsewhere in the project does not authorize attaching it
 * to this category, bedroom count or unit. Non-catalogue questions remain free
 * to be completed by the normal coverage stage. */
export function validateCatalogReply(reply: string, audit: Row): { valid: boolean; reason?: string } {
  if (audit.verified_catalog !== true) return { valid: true }
  const requiredTour = text(object(audit.unit_model).url)
  if (requiredTour && !reply.includes(requiredTour)) return { valid: false, reason: 'unit_tour_omitted' }
  if (object(audit.alternative_presentation).kind === 'category_overview'
    && /\b(?:departamentos?|penthouses?|suites?|unidades?)\s+\d{2,4}\b/i.test(reply)) return { valid: false, reason: 'alternative_unit_list_premature' }
  const pending = object(audit.pending_question)
  if (ids(pending.target_ids).length && text(pending.question) && !reply.includes(text(pending.question))) return { valid: false, reason: 'catalog_pending_question_changed' }
  const verified = rows(object(audit.catalog_results).units).length
    ? rows(object(audit.catalog_results).units) : rows(object(audit.alternative_results).units)
  if (!verified.length) return { valid: true }
  const decimal = (value: string) => {
    const clean = value.replace(/[.,]$/, '')
    const last = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','))
    return last >= 0 && clean.length - last <= 3
      ? Number(clean.slice(0, last).replace(/[.,]/g, '') + '.' + clean.slice(last + 1)) : Number(clean.replace(/[.,]/g, ''))
  }
  const requiredAreas = rows(object(audit.alternative_presentation).groups)
    .map(group => measurement(group.max_area_internal_m2)).filter(value => value !== null)
  const writtenAreas = [...reply.matchAll(/(\d[\d.,]*)\s*m[²2]/g)].map(match => decimal(match[1]))
  if (requiredAreas.some(area => !writtenAreas.some(value => Math.abs(value - area) < 0.005))) return { valid: false, reason: 'alternative_area_omitted' }
  const words: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
  const raw = reply.replace(/https?:\/\/\S+/g, '').replace(/¿[^?]*\?/g, '').replace(/m²/g, 'm2').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const clauses = raw.split(/(?<!\d)\.\s+|(?<=\d)\.(?!\d)\s+|[;\n]+|\s+y\s+(?=(?:el |la |los |las )?(?:departamentos?|suites?|penthouses?|locales?|unidades?)\s+\d)/)
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
    const areas = [...clause.matchAll(/(\d[\d.,]*(?:\s*(?:a|y|o|–|-)\s*\d[\d.,]*)?)\s*(?:m2|metros? cuadrados?)\s*(interior(?:es)?|exterior(?:es)?)?/g)]
    for (const match of areas) {
      const field = match[2]?.startsWith('exterior') ? 'area_exterior_m2' : 'area_internal_m2'
      const allowed = relevant.map(unit => measurement(unit[field])).filter(value => value !== null)
      const requested = (match[1].match(/\d[\d.,]*/g) || []).map(decimal)
      const after = clause.slice((match.index || 0) + match[0].length)
      if (/^\s*(?:mas|menos|adicionales|de diferencia)\b/.test(after)) return { valid: false, reason: 'catalog_derived_fact_unverified' }
      if (requested.some(area => !allowed.some(value => Math.abs(value - area) < 0.005))) return { valid: false, reason: 'catalog_area_mismatch' }
      if (references.length && relevant.some(unit => {
        const actual = measurement(unit[field])
        if (actual === null) return true
        return /\d\s*(?:a|–|-)\s*\d/.test(match[1]) && requested.length === 2
          ? actual < Math.min(...requested) || actual > Math.max(...requested)
          : !requested.some(area => Math.abs(actual - area) < 0.005)
      })) return { valid: false, reason: 'catalog_area_mismatch' }
    }
  }
  return { valid: true }
}

const facts = (unit: Row) => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category, bedrooms: unit.bedrooms,
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

/** Category-level alternatives precede individual specifications and floor selection. */
function alternativeOverview(units: Row[]) {
  const groups = [...categories].filter(category => units.some(unit => unit.category === category)).map(category => {
    const members = units.filter(unit => unit.category === category)
    const areas = members.map(unit => measurement(unit.area_internal_m2))
    const max = areas.every(area => area !== null) ? Math.max(...areas as number[]) : null
    const description = categorySummary(members)[0]
    return { category, max_area_internal_m2: max,
      description: `${description}${max !== null ? `, con hasta ${number(max)} m² interiores` : ''}` }
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
  void _current // Text is interpreted once, before this deterministic catalogue query.
  if (info.catalogue_price_requested === true) return null // Keep the existing authorized-price quote and affordability policy.
  if (['ask_price', 'request_visit', 'ask_financing'].includes(text(object(info.semantica_turno).primary_intent))) return null
  const reference = object(info.referencia_unidad), context = object(info.property_context || reference.context)
  const semantic = object(object(info.semantica_turno).property)
  const raw = object(reference.query || context.query || (semantic.confidence === 'high' ? semantic : {}))
  const query = catalogQuery(raw)
  if (query.operation === 'none') return null
  const catalog = rows(info.catalogo)
  if (!catalog.length) return null
  const pending = object(context.pending_question || info.pregunta_pendiente)
  const focus = ids(pending.target_ids).length ? ids(pending.target_ids) : ids(context.focused_ids)
  const referenceIds = unitIds(rows(reference.matches))
  let scopedIds: string[] | undefined
  if (query.scope === 'offered') scopedIds = ids(context.offered_ids)
  if (query.scope === 'comparison') scopedIds = ids(context.comparison_ids)
  if (query.scope === 'selected') scopedIds = ids(context.selected_ids).length ? ids(context.selected_ids) : focus
  if (['details', 'select'].includes(query.operation)) scopedIds = reference.explicit === true && referenceIds.length ? referenceIds
    : focus.length ? focus : referenceIds.length ? referenceIds : scopedIds
  if (query.operation === 'compare' && referenceIds.length > 1) scopedIds = referenceIds
  const candidates = filterCatalog(catalog, query, scopedIds)
  const excluded = ids(semantic.excluded_categories)
  const units = candidates.filter(unit => !excluded.includes(text(unit.category)))
  const baseAudit: Row = { source: `catalog_${query.operation}`, verified_catalog: true, catalog_query: query,
    catalog_results: { unit_ids: unitIds(units), units: units.map(facts), complete: true, unknown_unit_ids: [] },
    covered_requests: [`catalog_${query.operation}`], coverage_complete: false,
    offered_unit_ids: [], focused_unit_ids: [], selected_unit_ids: [],
    catalog_coverage: { operation: query.operation, status: units.length ? 'answered' : 'no_results', result_unit_ids: unitIds(units),
      known_fields: compareCatalog(units).known_fields },
    pending_question: { id: 'none', act: 'other', question: '', target_ids: [], candidate_ids: [] } }
  const respond = (reply: string, audit: Row = {}) => ({ reply, audit: { ...baseAudit, ...audit } })
  const question = (id: string, act: string, value: string, targets: Row[] = [], candidatesForQuestion = units) => ({ id, act, question: value, target_ids: unitIds(targets), candidate_ids: unitIds(candidatesForQuestion) })
  if (!units.length) {
    const subject = query.category ? plural[query.category] : query.group === 'commercial' ? 'locales comerciales' : 'viviendas'
    const conditions = [query.filters.bedrooms !== null ? `de ${query.filters.bedrooms} dormitorios` : '', query.filters.floor_number !== null ? `en la planta ${query.filters.floor_number}` : ''].filter(Boolean).join(' ')
    const opening = `Actualmente no contamos con ${subject} disponibles${conditions ? ` ${conditions}` : ''}.`
    if (query.filters.bedrooms_required === true) return respond(opening)
    let proposed = catalogQuery({ ...query, operation: 'search', scope: 'catalog', selector: null,
      filters: { ...query.filters, bedrooms: null, floor_number: null, min_area_m2: null, max_area_m2: null } })
    let wider = filterCatalog(catalog, proposed).filter(unit => !excluded.includes(text(unit.category)))
    const offerOtherHomes = query.category === 'departamento' && query.filters.bedrooms !== null
      && query.filters.floor_number === null && query.filters.min_area_m2 === null && query.filters.max_area_m2 === null
    if (query.group === 'residential' && (!wider.length || offerOtherHomes)) {
      proposed = { ...proposed, category: null }
      wider = filterCatalog(catalog, proposed).filter(unit => !excluded.includes(text(unit.category)))
    }
    if (query.filters.bedrooms !== null && wider.length) {
      const maxBedrooms = Math.max(...wider.map(unit => measurement(unit.bedrooms) || 0))
      if (maxBedrooms > 0) {
        proposed = { ...proposed, filters: { ...proposed.filters, bedrooms: maxBedrooms, bedrooms_required: false } }
        wider = wider.filter(unit => measurement(unit.bedrooms) === maxBedrooms)
      }
    }
    if (!wider.length) return respond(opening, { original_query: query })
    const overview = alternativeOverview(wider)
    const next = '¿Le gustaría revisar las alternativas disponibles?'
    return respond(`${opening} Podemos ofrecerle estas alternativas: ${overview.reply} ${next}`,
      { original_query: query, alternative_results: { query: proposed, unit_ids: unitIds(wider), units: wider.map(facts) },
        alternative_presentation: { kind: 'category_overview', groups: overview.groups },
        pending_question: { ...question('property_category', 'explore_alternatives', next, [], wider), proposed_query: proposed } })
  }
  if (query.operation === 'rank') {
    const ranked = rankCatalog(units, query.selector, object(info.politica_comercial).precios_autorizados === true)
    if (!ranked.complete) return respond('Falta una medida verificada para comparar todas esas opciones. Puedo mostrarle los datos disponibles sin afirmar cuál es la mayor.',
      { catalog_results: { ...object(baseAudit.catalog_results), complete: false, unknown_unit_ids: ranked.unknown_unit_ids }, coverage_complete: false })
    const ranking = ranked.units
    const dimension = ['cheapest', 'most_expensive'].includes(query.selector || '') ? 'precio publicado' : 'superficie interior'
    const value = dimension === 'precio publicado' ? `USD ${number(Number(ranking[0].published_commercial_price))}` : `${number(Number(ranking[0].area_internal_m2))} m²`
    const characteristic = ['smallest', 'cheapest'].includes(query.selector || '') ? 'menor' : 'mayor'
    const response = ranking.length === 1
      ? `La opción de ${characteristic} ${dimension} es ${label(ranking[0])}, con ${value}.`
      : `${join(ranking.map(label))} comparten la ${characteristic} ${dimension}: ${value}.`
    const next = ranking.length === 1 ? `¿Le gustaría ver los detalles de ${label(ranking[0])}?` : '¿Cuál de estas opciones le gustaría conocer?'
    return respond(`${response} ${next}`, { offered_unit_ids: unitIds(ranking), focused_unit_ids: ranking.length === 1 ? unitIds(ranking) : [],
      catalog_ranking: { selector: query.selector, unit_ids: unitIds(ranking), value },
      pending_question: question('unit_choice', ranking.length === 1 ? 'show_unit_details' : 'choose_unit', next, ranking.length === 1 ? ranking : [], ranking) })
  }
  if (query.operation === 'compare') {
    const comparison = compareCatalog(units)
    return respond(comparisonReply(units, comparison), { comparison_unit_ids: unitIds(units), offered_unit_ids: unitIds(units), catalog_comparison: comparison,
      catalog_coverage: { ...object(baseAudit.catalog_coverage), required_dimensions: ['bedrooms', 'area_internal_m2', 'area_exterior_m2', 'floor_number'] } })
  }
  if (query.operation === 'search' && !query.category && Object.keys(object(context.original_query)).length
    && new Set(units.map(unit => unit.category)).size > 1) {
    const overview = alternativeOverview(units)
    const names = [...new Set(units.map(unit => plural[text(unit.category)]))]
    const next = `¿Prefiere que revisemos primero ${join(names, 'o')}?`
    return respond(`${overview.reply} ${next}`, {
      offered_unit_ids: unitIds(units), alternative_presentation: { kind: 'category_overview', groups: overview.groups },
      pending_question: question('property_category', 'choose_category', next),
    })
  }
  if (query.operation === 'details' || query.operation === 'select') {
    if (units.length !== 1 || reference.needsClarification === true) {
      const next = '¿Cuál de estas opciones le gustaría conocer?'
      return respond(`${groupedCharacteristics(units)}\n${floorComparison(units)} ${next}`, { offered_unit_ids: unitIds(units), pending_question: question('unit_choice', 'choose_unit', next) })
    }
    const unit = units[0], url = unitTourUrl(text(unit.unit_number))
    const spaces = sanitizeTourSpaces(Array.isArray(unit.spaces) ? unit.spaces : []).slice(0, 8).map(value => text(value).toLocaleLowerCase('es'))
    const description = text(unit.description).trim().replace(/\s+/g, ' ').slice(0, 350)
    const reply = `${label(unit).charAt(0).toUpperCase() + label(unit).slice(1)}${details(unit) ? ` tiene ${details(unit)}` : ' está disponible'}.${description ? ` ${description.replace(/[.!]$/, '')}.` : ''}${spaces.length ? ` Incluye ${join(spaces)}.` : ''} Puede explorar sus espacios en el recorrido: ${url}`
    return respond(reply, { focused_unit_ids: unitIds(units), selected_unit_ids: query.operation === 'select' ? unitIds(units) : [], offered_unit_ids: unitIds(units),
      unit_reference: { ids: unitIds(units), numbers: units.map(value => value.unit_number) }, unit_model: { unit_id: unit.id, unit_number: unit.unit_number, url } })
  }
  const broad = !query.category && query.filters.bedrooms === null && query.filters.floor_number === null && query.filters.min_area_m2 === null && query.filters.max_area_m2 === null
  if (broad) {
    const questionText = query.group === 'commercial' ? '¿Qué tipo de local busca?'
      : query.group === 'residential' ? '¿Qué tipo de vivienda le gustaría conocer?' : '¿Qué tipo de propiedad le gustaría conocer?'
    return respond(`Disponemos de ${join(categorySummary(units))}. ${questionText}`,
      { pending_question: question('property_category', 'choose_category', questionText) })
  }
  const categoryOnly = query.category && Object.entries(query.filters).every(([key, value]) => key === 'bedrooms_required' || value === null)
  const floors = [...new Map([...units].filter(unit => finite(unit.floor_number) !== null)
    .sort((a, b) => Number(a.floor_number) - Number(b.floor_number))
    .map(unit => [Number(unit.floor_number), text(unit.floor) || `planta ${unit.floor_number}`])).values()]
  if (categoryOnly && floors.length > 1) {
    const next = '¿Qué planta prefiere?'
    return respond(`${groupedCharacteristics(units)}\n${floorComparison(units)} ${next}`,
      { offered_unit_ids: unitIds(units), pending_question: question('property_floor', 'choose_floor', next) })
  }
  const shown = units.slice(0, 8)
  const next = shown.length === 1 ? `¿Le gustaría ver los detalles de ${label(shown[0])}?` : '¿Cuál de estas opciones le gustaría conocer?'
  const choices = shown.length > 1 ? `${groupedCharacteristics(shown)}\n${floorComparison(shown)}`
    : `${label(shown[0])}${details(shown[0]) ? ` (${details(shown[0])})` : ''}.`
  return respond(`${choices}${units.length > shown.length ? ` Hay ${units.length} opciones que cumplen esos criterios; estas son las primeras ${shown.length}.` : ''} ${next}`,
    { offered_unit_ids: unitIds(shown), focused_unit_ids: shown.length === 1 ? unitIds(shown) : [],
      pending_question: question('unit_choice', shown.length === 1 ? 'show_unit_details' : 'choose_unit', next, shown.length === 1 ? shown : [], shown) })
}

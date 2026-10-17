import { catalogQuery, partitionCatalog } from './catalog-dialogue'
import { normalizedFloorQuery } from './catalog-request'
import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { leadBudget } from './budget-state'
import { evaluateBudgetOptions } from './budget-evaluation'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const ids = (units: Row[]) => units.map(unit => text(unit.id))

/** The model interprets height and its referent. Code executes numeric catalogue
 * comparisons without inspecting customer or writer vocabulary. */
export function resolveFloorExploration(catalog: Row[], current: string, previous: Row, semantics: Row) {
  const floor = normalizedFloorQuery(object(semantics.catalog_request).floor_query, current)
  if (!floor) return null
  const property = object(semantics.property), old = object(previous.query), request = object(semantics.catalog_request)
  const valid = acceptedExtractorConfidence(property.confidence)
  const changedGroup = valid && property.group && old.group && property.group !== old.group
  const category = valid && property.category || (!changedGroup ? old.category : null) || null
  const currentFilters = Object.fromEntries(Object.entries(valid ? object(property.filters) : {}).filter(([, value]) => value != null
    && (!Array.isArray(value) || value.length > 0)))
  const requirements = rows(request.requirements)
  const replaced = new Set(requirements.map(requirement => requirement.field))
  const query = catalogQuery({ ...old, category,
    group: category === 'local' ? 'commercial' : category ? 'residential' : valid && property.group || old.group,
    scope: 'catalog', operation: 'search', selector: null,
    filters: { ...(!changedGroup ? object(old.filters) : {}), ...currentFilters, floor_number: null },
    requirements: [...(!changedGroup ? rows(old.requirements).filter(r => r.field !== 'floor_number' && !replaced.has(r.field)) : []), ...requirements] })
  const exclusions = [...(Array.isArray(previous.excluded_categories) ? previous.excluded_categories : []),
    ...(valid && Array.isArray(property.excluded_categories) ? property.excluded_categories : [])]
  const eligible = catalog.filter(unit => !exclusions.includes(unit.category))
  const basePartition = partitionCatalog(eligible, query), base = basePartition.units
  const known = base.filter(unit => typeof unit.floor_number === 'number' && Number.isInteger(unit.floor_number)
    && unit.floor_number >= 0 && unit.floor_number <= 100)
  const complete = known.length === base.length && !basePartition.unknown.length
  const highest = known.length ? Math.max(...known.map(unit => Number(unit.floor_number))) : null
  const target = floor.kind === 'highest_available' ? highest : floor.reference_floor
  if (target === null) return { query, matches: [], explicit: false, hasUnitMention: false,
    needsClarification: floor.kind !== 'highest_available', clarification: '', reason: 'typed_floor_reference_unresolved',
    context: { ...previous, ...(floor.kind === 'highest_available' ? { query } : {}), pending_question: {}, current_floor_query: { version: 'floor-exploration-v1', ...floor, query,
      reference_unresolved: floor.kind !== 'highest_available', matching_unit_ids: [], highest_floor_unit_ids: [],
      highest_available_floor: highest, floor_membership_complete: complete } } as Row }
  const requirement = { field: 'floor_number', operator: floor.kind === 'highest_available' ? 'eq'
    : floor.kind === 'above_reference' ? 'gt' : 'lt', value: target, strength: 'required', evidence: floor.evidence }
  const resolved = catalogQuery({ ...query, requirements: [...(query.requirements || []), requirement] })
  const partition = partitionCatalog(eligible, resolved)
  const alternativeFloor = !known.length ? null : floor.kind === 'below_reference'
    ? Math.min(...known.map(unit => Number(unit.floor_number))) : highest
  const alternatives = alternativeFloor === null ? [] : known.filter(unit => unit.floor_number === alternativeFloor)
  return { query: resolved, matches: partition.units, explicit: false, hasUnitMention: false,
    needsClarification: false, clarification: '', reason: 'typed_floor_query',
    context: { ...previous, query: resolved, focused_ids: ids(partition.units), pending_question: {},
      current_floor_query: { version: 'floor-exploration-v1', ...floor, query: resolved,
        matching_unit_ids: ids(partition.units), highest_available_floor: highest,
        highest_floor_unit_ids: ids(known.filter(unit => unit.floor_number === highest)),
        alternative_floor: alternativeFloor, alternative_unit_ids: ids(alternatives),
        floor_membership_complete: complete && !partition.unknown.length } } as Row }
}

/** Answer and continuation share the newly requested set. Older affordable
 * options remain memory, never the question for a different floor. */
export function floorExplorationPlan(info: Row): Row | null {
  const floor = object(object(info.property_context).current_floor_query)
  if (floor.version !== 'floor-exploration-v1') return null
  if (floor.reference_unresolved === true) return { version: 'commercial-journey-v1', action: 'clarify_floor_reference',
    question: '¿A partir de qué planta le gustaría que revisemos las opciones?', question_id: 'property_floor', question_act: 'choose_floor',
    financing_offer_allowed: false, visit_offer_allowed: false, floor_exploration: floor,
    instruction: 'Aclare únicamente la planta de referencia que falta para responder la consulta de altura. Conserve categoría, presupuesto, selección y decisiones previas. Una referencia sin resolver no demuestra que falten opciones.' }
  const catalog = rows(info.catalogo_verificacion || info.catalogo)
  const matchingIds = Array.isArray(floor.matching_unit_ids) ? floor.matching_unit_ids : []
  const alternativeIds = Array.isArray(floor.alternative_unit_ids) ? floor.alternative_unit_ids
    : Array.isArray(floor.highest_floor_unit_ids) ? floor.highest_floor_unit_ids : []
  const matches = catalog.filter(unit => matchingIds.includes(unit.id))
  const alternatives = catalog.filter(unit => alternativeIds.includes(unit.id))
  const presented = matches.length ? matches : alternatives
  const complete = object(info.catalog_read).complete === true && floor.floor_membership_complete === true
  const prices = object(info.politica_comercial).precios_autorizados === true
  const comparison = evaluateBudgetOptions({ budget: leadBudget(info), units: presented,
    pricesAuthorized: prices, membershipComplete: complete })
  const outside = comparison.coverage === 'none'
  const question = !matches.length ? alternatives.length ? '¿Le gustaría revisar las opciones de la planta disponible más cercana?' : ''
    : outside ? '¿Le gustaría que revisemos estas opciones de mayor precio?' : '¿Cuál de estas opciones le gustaría conocer mejor?'
  return { version: 'commercial-journey-v1', action: 'explore_floor_options',
    question, question_id: question ? !matches.length || outside ? 'property_floor' : 'unit_choice' : '',
    question_act: !matches.length || outside ? 'explore_quoted_options' : 'choose_unit',
    continuation_optional: false, financing_offer_allowed: false, visit_offer_allowed: false,
    requested_query: floor.query, selection_scope: { categories: [...new Set(presented.map(unit => unit.category))],
      floors: [...new Set(presented.map(unit => unit.floor_number))], unit_ids: ids(presented) },
    floor_exploration: { ...floor, catalog_read_complete: complete,
      alternative_options: alternatives.map(unit => ({ id: unit.id, unit_number: unit.unit_number, category: unit.category,
        floor_number: unit.floor_number, ...(prices ? { published_commercial_price: unit.published_commercial_price } : {}) })) },
    budget_guidance: { comparison, comparison_required: outside, mention_required: outside,
      scope: matches.length ? 'requested_floor_options' : 'highest_floor_alternatives' },
    instruction: 'Responda primero sobre la altura solicitada usando floor_exploration y las fichas verificadas. '
      + 'La comparación y la pregunta pertenecen a las opciones de esta consulta, no a las unidades de una planta anterior. '
      + 'Con catálogo completo, explique la planta más alta disponible del tipo conocido cuando responda la consulta. '
      + 'Si la lectura o las plantas están incompletas, describa únicamente las opciones comprobadas sin certificar una planta máxima del proyecto. '
      + 'Si las alternativas mostradas superan el presupuesto declarado, indique brevemente esa diferencia con sus precios autorizados y pregunte si desea explorarlas. '
      + 'Consultar otras plantas conserva el presupuesto y no acepta un aumento, otra categoría, financiamiento ni una unidad. '
      + 'Si no hay coincidencias de altura, proponga únicamente la alternativa verificada indicada; la ausencia física no se resuelve con crédito. '
      + 'Presente diferencias útiles entre las opciones, sin inventarlas. No vuelva a pedir elegir entre unidades de un alcance anterior ni cierre con una pregunta genérica cuando existe esta continuación concreta.' }
}

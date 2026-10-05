import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { compactCatalogUnit } from './catalog-result'
import { relevantFacts, selectPolicies } from './semantic-catalog-context'
import { selectedFinancingUnit } from './financing-stage'
import { turnEvidence } from './turn-evidence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Opt-in context selection is independent of whether vector ranking ran.
 * Operational state and database snapshots are never changed by this projection. */
export function taskVerifiedContext(verified: Row, audit: Row, current: string): Row {
  if (object(verified.catalog_search).embeddingsEnabled !== true) return verified
  const intent = object(audit.resolved_turn_intent || verified.contrato_turno)
  const requests = rows(verified.solicitudes_interpretadas || intent.requests).filter(r => r.domain !== 'courtesy')
  const domains = new Set(requests.map(r => text(r.domain)))
  const source = text(audit.source)
  const semantics = object(verified.semantica_turno), property = object(semantics.property)
  const context = object(verified.property_context), query = object(context.query)
  const finance = domains.size === 1 && domains.has('financing') || /^financing/.test(source)
  const collectionOnly = !!audit.financing_collection && !domains.has('visit') && !domains.has('property')
  const budget = object(object(verified.semantica_turno).budget)
  const newBudget = budget.confidence === 'high' && ['amount', 'maximum_total'].includes(text(budget.status))
  const financeOnly = collectionOnly || finance && !domains.has('property') && !domains.has('visit')
    && source !== 'financing_selection_required' && !newBudget
  const generalPrice = source === 'unit_price' && !rows(verified.referencia_unidad && object(verified.referencia_unidad).matches).length
    && !rows(object(verified.property_context).selected_ids).length
  const overview = source === 'project_overview' && ['project_information', 'other'].includes(text(intent.objective))
  const catalogRequest = object(semantics.catalog_request || verified.catalog_request)
  const broadInformation = !finance && !newBudget && domains.size <= 1 && !query.category && !query.group
    && !rows(context.selected_ids).length && !rows(property.unit_numbers).length
    && (!catalogRequest.purpose || catalogRequest.purpose === 'none') && !rows(catalogRequest.requirements).length
    && property.reference_kind === 'none' && property.operation === 'none' && semantics.primary_intent === 'project_information'
  const hasValues = (value: unknown) => Object.values(object(value)).some(v => v != null && v !== false && v !== '' && (!Array.isArray(v) || v.length > 0))
  // A broad residential/commercial/category introduction needs complete groups,
  // not every floor plan. Specific requirements, comparisons and preferences
  // retain their detailed evidence, even while the next step asks for bedrooms.
  const categoryOverview = source === 'catalog_search' && !finance && !newBudget
    && domains.size === 1 && domains.has('property') && requests.length === 1
    && requests[0].confidence === 'high' && semantics.confidence === 'high'
    && semantics.primary_intent === 'project_information' && !rows(intent.required_facts).length
    && query.operation === 'search' && !!(query.group || query.category) && !query.selector
    && !hasValues(query.filters) && !rows(query.requirements).length
    && !rows(context.selected_ids).length && !rows(property.unit_numbers).length
    && !['specific', 'followup', 'comparison'].includes(text(property.reference_kind))
    && catalogRequest.purpose === 'search' && !catalogRequest.metric && !rows(catalogRequest.requirements).length
    && !rows(catalogRequest.semantic_preferences).length && !text(catalogRequest.semantic_preferences).trim()
    && !Object.keys(object(semantics.household)).length
  const task = source === 'clarify_previous_choice' ? 'clarify_choice'
    : financeOnly ? 'financing' : source === 'financing_selection_required' ? 'property_selection'
      : generalPrice ? 'price_summary' : overview ? 'project_overview' : categoryOverview ? 'category_overview' : broadInformation ? 'catalog_overview'
        : domains.size > 1 ? 'multiple_requests' : 'property'
  const result = { ...verified }
  const queryText = [current, ...requests.map(r => text(r.request))].join('\n')
  // Include facts requested by ANY current request, never only the primary intent.
  result.instalaciones = relevantFacts(verified.instalaciones, queryText, /amenidad|instalacion|comodidad|area[s]? comun|servicios del proyecto/)
  result.lugares_cercanos = relevantFacts(verified.lugares_cercanos, queryText, /cerca|alrededor|entorno|sector|ubicacion|zona|barrio/)
  result.contexto_sector = relevantFacts(verified.contexto_sector, queryText, /entorno|sector|ubicacion|zona|barrio|plusval/)
  result.politicas_negocio = selectPolicies(verified, queryText, domains)
  if (financeOnly && audit.verified_catalog !== true) {
    const unit = selectedFinancingUnit(verified)
    result.catalogo = unit ? [unit] : []
    result.catalog_context_scope = { kind: 'task_context', task, catalog_status: unit ? 'selected_unit' : 'not_applicable',
      note: 'Catálogo omitido salvo la unidad elegida. No es una búsqueda vacía ni acredita falta de disponibilidad.' }
    delete result.catalogo_verificacion
  } else if (overview && audit.verified_catalog !== true) {
    result.catalogo = []
    result.catalog_context_scope = { kind: 'project_overview', catalog_status: 'not_applicable' }
    delete result.catalogo_verificacion
  }
  const project = object(verified.proyecto)
  if (financeOnly) result.proyecto = { name: project.name, address: project.address }
  if (collectionOnly) {
    result.instalaciones = []; result.lugares_cercanos = []; result.contexto_sector = []
    result.financing_collection = audit.financing_collection
  }
  delete result.posicionamiento_proyecto
  result.prompt_context_selection = { version: 'task-context-v1', mode: 'task_context', task,
    embedding_applied: object(audit.catalog_retrieval).applied === true,
    blocks: ['catalogo', 'instalaciones', 'lugares_cercanos', 'contexto_sector', 'politicas_negocio'].map(key => ({
      key, available: rows(verified[key]).length, included: rows(result[key]).length })),
    note: 'Hechos seleccionados para las solicitudes actuales. Los datos omitidos no acreditan inexistencia. Las restricciones comerciales y el estado del lead se conservan.' }
  return result
}

/** Full canonical evidence stays in validation. Both models see this same
 * projection, with complete aggregates, not aggregate values of a top-k sample. */
export function addTaskQueryEvidence<T extends { units: Row[]; groups: Row[] }>(evidence: T, verified: Row): T {
  if (object(verified.prompt_context_selection).version !== 'task-context-v1'
    || object(verified.prompt_context_selection).task === 'multiple_requests') return evidence
  const filtered = filterCatalog(evidence.units, catalogQuery(object(verified.property_context).query))
  if (!filtered.length || filtered.length === evidence.units.length) return evidence
  const scoped = turnEvidence({ catalogo: filtered }).groups.map(group => ({ ...group,
    id: text(group.id).replace('group:', 'group:task_query:'), source_scope: 'task_query',
    covers: 'known_matches_to_current_property_query' }))
  return { ...evidence, groups: [...evidence.groups, ...scoped] }
}

export function taskModelEvidence<T extends { units: Row[]; groups: Row[] }>(evidence: T, verified: Row): T {
  const selection = object(verified.prompt_context_selection)
  if (selection.version !== 'task-context-v1') return evidence
  let units = evidence.units
  const priceSummary = ['price_summary', 'catalog_overview'].includes(text(selection.task))
  if (selection.task === 'clarify_choice') return { ...evidence, units: [],
    groups: evidence.groups.filter(group => group.aggregation === 'range'
      && (group.bedrooms_filter === null || group.source_scope === 'context')),
    model_scope: { task: 'clarify_choice', note: 'Solo se aclara la alternativa, sin volver a describirla. Se conservan los rangos por categoría como referencia de verificación; no es necesario comunicarlos.' } }
  const query = object(object(verified.property_context).query)
  const filtered = filterCatalog(units, catalogQuery(query))
  const property = object(verified.property_context)
  const relatedIds = new Set([
    ...rows(object(verified.presupuesto_del_turno).alternatives).map(unit => text(unit.id)),
    ...[property.selected_ids, query.operation === 'compare' ? property.comparison_ids : [], object(evidence).alternative_ids]
      .flatMap(value => Array.isArray(value) ? value.map(text) : []),
  ])
  // Keep all matches, not a fixed six. If no match exists keep the authorized
  // alternatives so the writer can explain the mismatch without inventing one.
  if (filtered.length && selection.task !== 'multiple_requests') {
    const matchingIds = new Set(filtered.map(unit => text(unit.id)))
    units = units.filter(unit => matchingIds.has(text(unit.id)) || relatedIds.has(text(unit.id)))
  }
  const included = new Set(units.map(u => text(u.id)))
  const matchingIds = new Set(filtered.map(u => text(u.id)))
  const roleOf = (unit: Row) => matchingIds.has(text(unit.id)) ? 'current_query' : relatedIds.has(text(unit.id)) ? 'related_option' : 'available_alternative'
  if (priceSummary) units = []
  const seen = new Set<string>()
  const groups = evidence.groups.filter(group => {
    if (group.source_scope !== 'complete_query' && !priceSummary && filtered.length && selection.task !== 'multiple_requests'
      && Array.isArray(group.member_ids) && group.member_ids.some(id => !included.has(text(id)))) return false
    const key = JSON.stringify([group.aggregation, group.member_ids, group.source_scope === 'budget_matching'])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  if (selection.task === 'category_overview') {
    return { ...evidence, units: [], groups: groups.filter(group => group.aggregation === 'range').map(group => {
      const { member_ids, ...aggregate } = group
      return { ...aggregate, member_count: Array.isArray(member_ids) ? member_ids.length : 0,
        unit_count: group.unit_count ?? (Array.isArray(member_ids) ? member_ids.length : 0) }
    }), catalog_summary: catalogOverviewSummary(object(evidence).catalog_summary), query_result_ids: [],
    model_scope: { task: 'category_overview', listed_unit_count: 0, evidence_unit_count: evidence.units.length,
      query, note: 'Presentación general de los tipos de espacio consultados. Los grupos se calcularon sobre todas las coincidencias; se omitieron fichas y listas de identificadores. Use las categorías y dormitorios para orientar y formular el siguiente paso. No atribuya distribuciones internas a partir de este resumen.' } } as T
  }
  return { ...evidence, units: units.map(unit => ({ ...compactCatalogUnit(unit, object(verified.politica_comercial).precios_autorizados === true), query_role: roleOf(unit) })),
    groups, model_scope: { task: selection.task, listed_unit_count: units.length, evidence_unit_count: evidence.units.length,
      query, matching_unit_ids: [...matchingIds], related_unit_ids: [...relatedIds].filter(id => !matchingIds.has(id)),
      note: priceSummary ? 'Solo agregaciones completas para precios. Las fichas se omitieron, no hay un resultado vacío.'
        : 'Las fichas son las pertinentes; los grupos conservan el alcance y los miembros del conjunto completo.' } }
}

export function catalogOverviewSummary(raw: unknown): Row {
  const summary = object(raw)
  return Object.fromEntries(Object.entries(summary).filter(([key]) =>
    !['matching_unit_ids', 'matching_unit_numbers', 'unknown_units', 'excluded_units', 'selected_unit_ids', 'selected_unit_numbers'].includes(key)))
}

export const TASK_CONTEXT_RULES = 'prompt_context_selection identifica la información seleccionada para TODAS las solicitudes del turno, se haya usado embeddings o no. evidencia_turno.model_scope explica las fichas omitidas; use los grupos completos para rangos y cantidades, nunca cuente las fichas para inferir totales. Omitir un catálogo en una explicación financiera no significa que no haya inmuebles. Atienda solo el siguiente paso pendiente: no repita el presupuesto, el brochure ni invitaciones a un asesor por costumbre.'

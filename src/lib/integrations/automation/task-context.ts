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
  const finance = domains.size === 1 && domains.has('financing') || /^financing/.test(source)
  const budget = object(object(verified.semantica_turno).budget)
  const newBudget = budget.confidence === 'high' && ['amount', 'maximum_total'].includes(text(budget.status))
  const financeOnly = finance && !domains.has('property') && !domains.has('visit')
    && source !== 'financing_selection_required' && !newBudget
  const generalPrice = source === 'unit_price' && !rows(verified.referencia_unidad && object(verified.referencia_unidad).matches).length
    && !rows(object(verified.property_context).selected_ids).length
  const overview = source === 'project_overview' && ['project_information', 'other'].includes(text(intent.objective))
  const task = financeOnly ? 'financing' : source === 'financing_selection_required' ? 'property_selection'
    : generalPrice ? 'price_summary' : overview ? 'project_overview' : domains.size > 1 ? 'multiple_requests' : 'property'
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
  const priceSummary = selection.task === 'price_summary'
  const query = object(object(verified.property_context).query)
  const filtered = filterCatalog(units, catalogQuery(query))
  const property = object(verified.property_context)
  const relatedIds = new Set([
    ...rows(object(verified.presupuesto_del_turno).alternatives).map(unit => text(unit.id)),
    ...[property.selected_ids, property.comparison_ids, object(evidence).alternative_ids]
      .flatMap(value => Array.isArray(value) ? value.map(text) : []),
  ])
  // Keep all matches, not a fixed six. If no match exists keep the authorized
  // alternatives so the writer can explain the mismatch without inventing one.
  if (filtered.length && selection.task !== 'multiple_requests') {
    const matchingIds = new Set(filtered.map(unit => text(unit.id)))
    units = units.filter(unit => matchingIds.has(text(unit.id)) || relatedIds.has(text(unit.id)))
  }
  const included = new Set(units.map(u => text(u.id)))
  if (priceSummary) units = []
  const seen = new Set<string>()
  const groups = evidence.groups.filter(group => {
    if (group.source_scope !== 'complete_query' && !priceSummary && filtered.length && selection.task !== 'multiple_requests'
      && Array.isArray(group.member_ids) && group.member_ids.some(id => !included.has(text(id)))) return false
    const key = JSON.stringify([group.aggregation, group.member_ids, group.source_scope === 'budget_matching'])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return { ...evidence, units: units.map(unit => compactCatalogUnit(unit, object(verified.politica_comercial).precios_autorizados === true)),
    groups, model_scope: { task: selection.task, listed_unit_count: units.length, evidence_unit_count: evidence.units.length,
      note: priceSummary ? 'Solo agregaciones completas para precios. Las fichas se omitieron, no hay un resultado vacío.'
        : 'Las fichas son las pertinentes; los grupos conservan el alcance y los miembros del conjunto completo.' } }
}

export const TASK_CONTEXT_RULES = 'prompt_context_selection identifica la información seleccionada para TODAS las solicitudes del turno, se haya usado embeddings o no. evidencia_turno.model_scope explica las fichas omitidas; use los grupos completos para rangos y cantidades, nunca cuente las fichas para inferir totales. Omitir un catálogo en una explicación financiera no significa que no haya inmuebles. Atienda solo el siguiente paso pendiente: no repita el presupuesto, el brochure ni invitaciones a un asesor por costumbre.'

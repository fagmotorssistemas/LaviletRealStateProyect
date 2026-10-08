import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { compactCatalogUnit } from './catalog-result'
import { relevantFacts, selectPolicies } from './semantic-catalog-context'
import { selectedFinancingUnit } from './financing-stage'
import { leadBudget } from './budget-state'
import { turnEvidence } from './turn-evidence'
import { proposalInformationContext } from './commercial-journey'
import { withProjectIntroductionForTurn } from './project-introduction-context'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const hasValues = (value: unknown): boolean => value != null && value !== false && value !== ''
  && (Array.isArray(value) ? value.some(hasValues)
    : typeof value === 'object' ? Object.values(object(value)).some(hasValues) : true)

/** Context selection is independent of whether vector ranking is enabled.
 * Operational state and database snapshots are never changed by this projection. */
export function taskVerifiedContext(verified: Row, audit: Row, current: string): Row {
  const intent = object(audit.resolved_turn_intent || verified.contrato_turno)
  const interpretedRequests = rows(verified.solicitudes_interpretadas), sharedRequests = rows(intent.requests)
  // Use canonical domains without discarding any additional independent request
  // in older contexts whose shared contract is incomplete.
  const requestIdentity = (request: Row) => JSON.stringify([request.request, request.evidence, request.source, request.source_message_id])
  const sharedIdentities = new Set(sharedRequests.map(requestIdentity))
  const requests = [...sharedRequests, ...interpretedRequests.filter(request => !sharedIdentities.has(requestIdentity(request)))]
    .filter(r => r.domain !== 'courtesy')
  const domains = new Set(requests.map(r => text(r.domain)))
  const source = text(audit.source)
  const semantics = object(verified.semantica_turno), property = object(semantics.property)
  const context = object(verified.property_context), query = object(context.query)
  const finance = domains.size === 1 && domains.has('financing') || /^financing/.test(source)
  const collectionOnly = !!audit.financing_collection && !domains.has('visit') && !domains.has('property')
  const budget = object(object(verified.semantica_turno).budget)
  const effectiveBudget = leadBudget(verified)
  const newBudget = budget.confidence === 'high' && ['amount', 'maximum_total'].includes(text(budget.status))
  const financeOnly = collectionOnly || finance && !domains.has('property') && !domains.has('visit')
    && source !== 'financing_selection_required' && !newBudget
  const generalPrice = source === 'unit_price' && !rows(verified.referencia_unidad && object(verified.referencia_unidad).matches).length
    && !rows(object(verified.property_context).selected_ids).length
  const catalogRequest = object(semantics.catalog_request || verified.catalog_request)
  // Classification has already been reconciled in the shared turn contract.
  // Catalogue needs and compound requests take precedence over the route.
  const overview = source === 'project_overview' && intent.objective === 'project_information'
    && semantics.primary_intent === 'project_information' && semantics.confidence === 'high'
    && requests.length === 1 && requests[0].confidence === 'high' && requests[0].domain === 'property'
    && !finance && (!budget.status || budget.status === 'not_discussed') && effectiveBudget.status === 'not_discussed'
    && !hasValues(intent.required_facts) && !hasValues(intent.subject)
    && !['mixed', 'out_of_scope', 'uncertain', 'clarify_scope'].includes(text(object(intent.scope).kind))
    && !Object.keys(object(verified.limite_alcance)).length
    && (!catalogRequest.purpose || catalogRequest.purpose === 'none')
    && !hasValues(catalogRequest.metric) && !hasValues(catalogRequest.requirements) && !hasValues(catalogRequest.semantic_preferences)
    && property.operation === 'none' && property.reference_kind === 'none'
    && !['category', 'group', 'unit_numbers', 'filters', 'filter_evidence', 'selector', 'excluded_categories'].some(key => hasValues(property[key]))
    && !hasValues(semantics.housing_quantities) && !hasValues(semantics.household)
    && !hasValues(query.category) && !hasValues(query.group) && !hasValues(query.filters)
    && !hasValues(query.selector) && !hasValues(query.requirements)
    && (!query.operation || query.operation === 'none')
    && !['selected_ids', 'comparison_ids', 'offered_ids', 'focused_ids'].some(key => hasValues(context[key]))
    && !text(object(verified.lead).unit_id)
    && !hasValues(object(verified.referencia_unidad).matches) && object(verified.referencia_unidad).needsClarification !== true
  const broadInformation = !finance && !newBudget && domains.size <= 1 && requests.length === 1 && requests[0].domain === 'property'
    && (!requests[0].confidence || requests[0].confidence === 'high') && (!semantics.confidence || semantics.confidence === 'high')
    && (!budget.status || budget.status === 'not_discussed') && effectiveBudget.status === 'not_discussed' && !hasValues(intent.required_facts)
    && !text(object(verified.lead).unit_id)
    && !query.category && !query.group && (!query.operation || ['none', 'search'].includes(text(query.operation)))
    && !rows(context.selected_ids).length && !rows(property.unit_numbers).length
    && (!catalogRequest.purpose || catalogRequest.purpose === 'none') && !rows(catalogRequest.requirements).length
    && !hasValues(catalogRequest.metric) && !hasValues(catalogRequest.semantic_preferences)
    && !hasValues(query.filters) && !hasValues(query.requirements) && !hasValues(query.selector)
    && !hasValues(property.filters) && !hasValues(property.selector) && !hasValues(property.excluded_categories)
    && !hasValues(semantics.housing_quantities) && !hasValues(semantics.household)
    && !['mixed', 'out_of_scope', 'uncertain', 'clarify_scope'].includes(text(object(intent.scope).kind))
    && !Object.keys(object(verified.limite_alcance)).length
    && property.reference_kind === 'none' && property.operation === 'none' && semantics.primary_intent === 'project_information'
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
        : domains.size > 1 || requests.length > 1 ? 'multiple_requests' : 'property'
  const result = withProjectIntroductionForTurn(verified)
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
  const proposal = proposalInformationContext(verified)
  const filtered = filterCatalog(evidence.units, catalogQuery(Object.keys(proposal).length ? proposal.query : object(verified.property_context).query),
    Object.keys(proposal).length ? (Array.isArray(proposal.resolved_ids) ? proposal.resolved_ids.map(text) : []) : undefined)
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
  const proposalInformation = proposalInformationContext(verified)
  const proposalInformationalTurn = Object.keys(proposalInformation).length > 0
  const proposalReferenceIds = new Set(Array.isArray(proposalInformation.resolved_ids) ? proposalInformation.resolved_ids.map(text) : [])
  const proposalUnknownIds = Array.isArray(proposalInformation.unknown_ids) ? proposalInformation.unknown_ids.map(text) : []
  const proposalMissingIds = Array.isArray(proposalInformation.missing_ids) ? proposalInformation.missing_ids.map(text) : []
  const query = object(proposalInformationalTurn ? proposalInformation.query : object(verified.property_context).query)
  const filtered = filterCatalog(units, catalogQuery(query), proposalInformationalTurn
    ? (Array.isArray(proposalInformation.resolved_ids) ? proposalInformation.resolved_ids.map(text) : []) : undefined)
  const property = object(verified.property_context)
  const relatedIds = new Set([
    ...rows(object(verified.presupuesto_del_turno).alternatives).map(unit => text(unit.id)),
    ...[property.selected_ids, query.operation === 'compare' ? property.comparison_ids : [], object(evidence).alternative_ids]
      .flatMap(value => Array.isArray(value) ? value.map(text) : []),
  ])
  // Keep all matches, not a fixed six. If no match exists keep the authorized
  // alternatives so the writer can explain the mismatch without inventing one.
  if (proposalInformationalTurn && selection.task !== 'multiple_requests') units = units.filter(unit => proposalReferenceIds.has(text(unit.id)))
  else if (filtered.length && selection.task !== 'multiple_requests') {
    const matchingIds = new Set(filtered.map(unit => text(unit.id)))
    units = units.filter(unit => matchingIds.has(text(unit.id)) || relatedIds.has(text(unit.id)))
  }
  const clarifyRequirements = object(verified.siguiente_paso_comercial).action === 'clarify_requirements'
    && selection.task !== 'multiple_requests'
  // An incompatible search needs complete ranges/categories to explain the
  // mismatch, not all 65 floor plans. Preserve explicitly related units.
  if (clarifyRequirements && !proposalInformationalTurn) units = units.filter(unit => relatedIds.has(text(unit.id)))
  const included = new Set(units.map(u => text(u.id)))
  const matchingIds = new Set(filtered.map(u => text(u.id)))
  const roleOf = (unit: Row) => matchingIds.has(text(unit.id)) ? 'current_query'
    : proposalInformationalTurn && proposalReferenceIds.has(text(unit.id)) ? 'current_query_unknown'
      : proposalInformationalTurn && selection.task === 'multiple_requests' ? 'other_request_context'
        : relatedIds.has(text(unit.id)) ? 'related_option' : 'available_alternative'
  if (priceSummary) units = []
  const needsInventory = !proposalInformationalTurn && !filtered.length
    && evidence.groups.some(group => group.source_scope === 'complete_query' && group.unit_count === 0)
  const seen = new Set<string>()
  let groups = evidence.groups.filter(group => {
    if (group.source_scope === 'catalog_inventory' && !needsInventory) return false
    if (proposalInformationalTurn && selection.task !== 'multiple_requests' && (!Array.isArray(group.member_ids) || !group.member_ids.length
      || group.member_ids.some(id => !included.has(text(id))))) return false
    if (group.source_scope !== 'complete_query' && !priceSummary && filtered.length && selection.task !== 'multiple_requests'
      && Array.isArray(group.member_ids) && group.member_ids.some(id => !included.has(text(id)))) return false
    const key = JSON.stringify([group.aggregation, group.member_ids, group.category, group.bedrooms_filter, group.source_scope,
      group.source_scope === 'catalog_inventory' ? group.query_scope : null])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  // Complete aggregate references are useful; repeated source sets are not.
  // Keep one range for an identical set and attribute scope, preferring the
  // exact-query source. Its endpoints support min/max as well as ranges.
  if (selection.task !== 'multiple_requests') {
    const scopes = new Set<string>()
    const sourcePriority = (group: Row) => Number(group.source_scope === 'complete_query')
      + (clarifyRequirements && !proposalInformationalTurn ? 2 * Number(group.source_scope === 'requirement_alternatives') : 0)
    groups = [...groups].sort((a, b) => sourcePriority(b) - sourcePriority(a))
      .filter(group => {
        if (group.aggregation !== 'range') return false
        const key = JSON.stringify([Array.isArray(group.member_ids) ? [...group.member_ids].sort() : [],
          group.category ?? null, group.bedrooms_filter ?? null, group.budget_amount ?? null,
          group.source_scope === 'catalog_inventory' ? group.query_scope : null])
        if (scopes.has(key)) return false
        scopes.add(key); return true
      })
  }
  if (clarifyRequirements && !proposalInformationalTurn && !relatedIds.size) {
    // A recommendation needs a compact verified reason to consider the exact
    // proposed change, not only its bedroom count or unrelated catalogue data.
    // All canonical groups remain available to independent numeric validation.
    const filters = object(query.filters)
    const needed = new Set<string>(['bedrooms'])
    for (const key of Object.keys(filters).filter(key => filters[key] != null)) {
      if (/area/.test(key)) ['area_internal_m2','area_exterior_m2','area_total_m2'].forEach(field => needed.add(field))
      else if (/floor/.test(key)) needed.add('floor_number')
      else if (/bathroom/.test(key)) needed.add('bathrooms_full')
      else if (/price|budget/.test(key)) needed.add('published_commercial_price')
    }
    for (const requirement of rows(query.requirements)) if (requirement.field) needed.add(text(requirement.field))
    const recommendationIds = new Set(Array.isArray(object(verified.siguiente_paso_comercial).alternative_unit_ids)
      ? (object(verified.siguiente_paso_comercial).alternative_unit_ids as unknown[]).map(text) : [])
    if (recommendationIds.size) groups = groups.filter(group => group.source_scope === 'requirement_alternatives' && group.category != null
      || group.source_scope === 'complete_query' && group.unit_count === 0)
    groups = groups.map(group => {
      const recommendation = group.source_scope === 'requirement_alternatives' && group.category != null
      const attributes = new Set([...needed, ...(recommendation ? ['area_internal_m2','area_exterior_m2','bathrooms_full'] : [])])
      const keep = new Set(['id','category','aggregation','bedrooms_filter','source_scope','member_ids','unit_count','covers','complete_for_query','query_scope',
        ...(recommendation ? ['shared_spaces'] : []), ...attributes])
      return { ...Object.fromEntries(Object.entries(group).filter(([key]) => keep.has(key))),
        ...(group.upper_values ? { upper_values:Object.fromEntries(Object.entries(object(group.upper_values)).filter(([key]) => attributes.has(key))) } : {}) }
    })
  }
  // Global counts/ranges remain code-owned, but their full membership does not
  // need to be sent again after reducing the catalogue to relevant examples.
  groups = groups.map(group => {
    if (group.source_scope !== 'catalog_inventory') return group
    const { member_ids, ...aggregate } = group
    return { ...aggregate, member_count: Array.isArray(member_ids) ? member_ids.length : group.unit_count }
  })
  if (['category_overview', 'catalog_overview'].includes(text(selection.task))) {
    return { ...evidence, units: [], groups: groups.filter(group => group.aggregation === 'range').map(group => {
      const { member_ids, ...aggregate } = group
      return { ...aggregate, member_count: Array.isArray(member_ids) ? member_ids.length : group.member_count ?? group.unit_count ?? 0,
        unit_count: group.unit_count ?? (Array.isArray(member_ids) ? member_ids.length : 0) }
    }), catalog_summary: catalogOverviewSummary(object(evidence).catalog_summary), query_result_ids: [],
    model_scope: { task: selection.task, listed_unit_count: 0, evidence_unit_count: evidence.units.length,
      query, note: 'Presentación general de los tipos de espacio consultados. Los grupos se calcularon sobre todas las coincidencias; se omitieron fichas y listas de identificadores. Use las categorías y dormitorios para orientar y formular el siguiente paso. No atribuya distribuciones internas a partir de este resumen.' } } as T
  }
  return { ...evidence, units: units.map(unit => ({ ...compactCatalogUnit(unit, object(verified.politica_comercial).precios_autorizados === true), query_role: roleOf(unit) })),
    groups, model_scope: { task: selection.task, listed_unit_count: units.length, evidence_unit_count: evidence.units.length,
      query, matching_unit_ids: [...matchingIds], related_unit_ids: [...relatedIds].filter(id => !matchingIds.has(id)),
      ...(proposalInformationalTurn ? { original_requirement_query: proposalInformation.original_query, alternative_acceptance: 'pending',
        unknown_unit_ids: proposalUnknownIds, missing_unit_ids: proposalMissingIds,
        reference_complete: proposalInformation.complete === true, reference_resolved_unit_ids: [...proposalReferenceIds] } : {}),
      note: clarifyRequirements ? proposalInformationalTurn
        ? `Las fichas y rangos responden solo al referente resuelto de la consulta informativa sobre la propuesta pendiente, no a la necesidad original ni a una alternativa ya aceptada. ${proposalUnknownIds.length ? 'Las fichas current_query_unknown tienen datos insuficientes para comprobar una condición: no las presente como coincidencias confirmadas ni infiera ausencia. ' : ''}${proposalMissingIds.length ? 'Faltan alternativas del referente anterior: explique el límite sin reemplazarlas por otras unidades. ' : ''}${!proposalReferenceIds.size && !proposalUnknownIds.length && !proposalMissingIds.length ? 'No hay coincidencias confirmadas para esta consulta temporal; no repueble las fichas con toda la propuesta ni atribuya sus rangos al resultado vacío. ' : ''}Responda con los datos verificados y conecte con la pregunta de aceptación pendiente; no pida presupuesto, planta, unidad ni financiamiento todavía.`
        : 'La búsqueda original no tiene coincidencias confirmadas. Los grupos requirement_alternatives describen la propuesta verificada, NO opciones que satisfacen todos los requisitos originales. Recomiéndela brevemente con sus áreas y características comunes comprobadas por categoría; no enumere unidades ni precios no solicitados. Explique el requisito que cambia y pregunte si aceptaría explorarlo antes de avanzar. No declare que el presupuesto alcanza ni prometa que resolverá la necesidad.'
        : priceSummary ? 'Solo agregaciones completas para precios. Las fichas se omitieron, no hay un resultado vacío.'
        : 'Las fichas son las pertinentes; los grupos conservan el alcance y los miembros del conjunto completo.' } }
}

export function catalogOverviewSummary(raw: unknown): Row {
  const summary = object(raw)
  return Object.fromEntries(Object.entries(summary).filter(([key]) =>
    !['matching_unit_ids', 'matching_unit_numbers', 'unknown_units', 'excluded_units', 'selected_unit_ids', 'selected_unit_numbers'].includes(key)))
}

export const TASK_CONTEXT_RULES = 'prompt_context_selection identifica la información seleccionada para TODAS las solicitudes del turno, se haya usado embeddings o no. evidencia_turno.model_scope explica las fichas omitidas; use los grupos completos para rangos y cantidades, nunca cuente las fichas para inferir totales. Omitir un catálogo en una explicación financiera no significa que no haya inmuebles. Atienda solo el siguiente paso pendiente: no repita el presupuesto, el brochure ni invitaciones a un asesor por costumbre.'

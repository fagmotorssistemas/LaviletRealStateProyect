import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { interactionMode } from './interaction-mode'
import { answersPendingQuestion,emptyPropertyFilters,normalizedPendingQuestion,normalizedPropertyFilters,normalizedPropertyQuery,pendingQuestionFromReply,propertyFiltersWithQuantityMeaning,propertyPreferenceChange } from './turn-semantics'
import { normalizedSelectionPreferences, selectionPreferences, unrestrictedBedrooms, prioritizesInteriorSpace, withoutBedroomConstraint } from './selection-preferences'
import { normalized } from './sdr-rules'
import { informationSubject } from './information-context'
import { replaceBedroomComparison } from './bedroom-comparison'
import { resolveCatalogReference } from './catalog-reference'
import { catalogQuery, filterCatalog, partitionCatalog } from './catalog-dialogue'
import { normalizeCatalogRequest } from './catalog-request'
import { showroomRequest } from './virtual-showroom'
import { groundedCurrentCategoryExclusions } from './purchase-evidence'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { resolveFloorExploration } from './catalog-floor-query'
import { currentQuote } from './current-quote'

const available = (units: Row[]) => units.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
const memory = (units: Row[]) => ({ ids: unitIds(units), numbers: units.map(unit => unit.unit_number) })
const code = (value: unknown) => `${/^LC/i.test(text(value)) ? 'LC-' : ''}${Number(text(value).replace(/\D/g, ''))}`
const unitIds = (units: Row[]) => units.map(unit => text(unit.id))

/** Retired prose reader. Only delivered structured receipts carry references. */
export function unitsInPropertyReply(_catalog: Row[], _reply: string): Row[] { void _catalog; void _reply;  return [] }

/** Durable references come from delivered metadata; prose never rewrites choices. */
export function propertyContext(_catalog: Row[], previous: unknown, _history: unknown): Row { void _history;
  const saved = object(previous)
  return { ...saved, version: 3, offered_ids: ids(saved.offered_ids), comparison_ids: ids(saved.comparison_ids),
    selected_ids: ids(saved.selected_ids), focused_ids: ids(saved.focused_ids), query: object(saved.query),
    pending_question: normalizedPendingQuestion(saved.pending_question), excluded_categories: ids(saved.excluded_categories) }
}

export function resolvePropertyTurn(catalogRaw: Row[], current: string, summaryRaw: unknown, history: unknown, semantics: unknown) {
  const summary = object(summaryRaw), goal = object(object(semantics).interaction_goal)
  const previous = propertyContext(available(catalogRaw), summary._property_context, history)
  delete previous.information_query
  delete previous.current_floor_query
  const interpretedReference = object(object(semantics).property)
  if (interpretedReference.reference_kind === 'ambiguous' && acceptedExtractorConfidence(interpretedReference.confidence)
    && currentQuote(interpretedReference.evidence, current)) {
    const known = available(catalogRaw), numbers = ids(interpretedReference.unit_numbers).map(code)
    const candidates = known.filter(unit => ids(previous.offered_ids).includes(text(unit.id)) || numbers.includes(code(unit.unit_number)))
    const pending = { id: 'unit_choice', act: 'choose_unit', question: '¿A cuál de las opciones se refiere?',
      target_ids: [], candidate_ids: unitIds(candidates) }
    return { matches: candidates, explicit: false, reason: 'unresolved_choice', needsClarification: true,
      clarification: pending.question, choice_clarification: { kind: 'ambiguous_unit_reference', evidence: interpretedReference.evidence },
      query: object(previous.query), memory: memory(candidates),
      context: { ...previous, pending_question: pending,
        reference_resolution: { source: 'extractor_ambiguous_reference', status: 'ambiguous', resolved_ids: unitIds(candidates) } } as Row }
  }
  const floor = resolveFloorExploration(available(catalogRaw), current, previous, object(semantics))
  if (floor) {
    const informational = interactionMode(summary._interaction_mode || object(summary._sales_memory).interaction_mode, semantics).mode === 'information_only'
    return { ...floor, memory: object(summary._unit_reference), ...(informational ? { context: { ...previous,
      information_query: { query: floor.query }, current_floor_query: floor.context.current_floor_query } } : {}) }
  }
  const broad = acceptedExtractorConfidence(goal.confidence)
    && ['all_categories', 'other_categories'].includes(text(goal.catalog_scope)) && !!text(goal.scope_evidence)
  if (broad) {
    const excluded = goal.catalog_scope === 'other_categories' ? ids(goal.excluded_categories) : []
    const matches = available(catalogRaw).filter(unit => !excluded.includes(text(unit.category)))
    const query = { group: null, category: null, filters: emptyPropertyFilters(), operation: 'search', scope: 'catalog' }
    return { matches, explicit: false, hasUnitMention: false, needsClarification: false, clarification: '',
      reason: 'informational_catalog_scope', query, memory: object(summary._unit_reference),
      context: { ...previous, information_query: { query, excluded_categories: excluded, scope: goal.catalog_scope } } as Row }
  }
  const resolved = resolvePropertyTurnDetails(catalogRaw, current, { ...summary, _property_context: previous }, history, semantics)
  const mode = interactionMode(summary._interaction_mode || object(summary._sales_memory).interaction_mode, semantics)
  if (mode.mode !== 'information_only') return resolved
  // An information query can have its own category and filters. It never
  // replaces the saved buying needs, selected home or reference memory.
  return { ...resolved, memory: object(summary._unit_reference), context: { ...previous,
    information_query: { query: resolved.query, excluded_categories: ids(object(resolved.context).excluded_categories) } } as Row }
}

function resolvePropertyTurnDetails(catalogRaw: Row[], current: string, summaryRaw: unknown, history: unknown, semantics: unknown) {
  const catalog = available(catalogRaw), summary = object(summaryRaw)
  const categoryDecision=object(object(semantics).category_choice),categoryDecisionEvidence=normalized(text(categoryDecision.evidence))
  const explicitCategoryChoice=categoryDecision.kind==='selected'&&acceptedExtractorConfidence(categoryDecision.confidence)
    && ['suite','departamento','penthouse','local'].includes(text(categoryDecision.category))
    && !!categoryDecisionEvidence&&normalized(current).includes(categoryDecisionEvidence)
  const semantic=explicitCategoryChoice?{...object(object(semantics).property),category:categoryDecision.category,
    group:categoryDecision.category==='local'?'commercial':'residential',operation:'search',unit_numbers:[],reference_kind:'explicit',
    evidence:categoryDecision.evidence,confidence:categoryDecision.confidence}:object(object(semantics).property)
  const context = propertyContext(catalog, summary._property_context, history)
  context.reference_resolution = {}
  // A proposal's informational query belongs to one turn. It never replaces
  // the client's search or supplies consent on a later message.
  delete context.proposal_information
  const base = resolveCatalogReference(catalog, current, summary._unit_reference, history, semantics)
  const m = normalized(current)
  const pending = normalizedPendingQuestion(Object.keys(object(summary._pending_question)).length ? summary._pending_question : context.pending_question)
  if (pending.id === 'property_requirements' && pending.act === 'other' && answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative')
    && !Object.keys(object(pending.proposed_query)).length) {
    const clarification = 'Para buscar alternativas necesito saber qué requisito podemos cambiar: ¿cuál desea mantener y cuál podría flexibilizar?'
    return { ...base, matches: [], explicit: false, needsClarification: true, reason: 'requirement_adjustment_not_identified',
      clarification, query: context.query, context: { ...context, pending_question: { ...pending, question: clarification } } as Row }
  }
  const positive = answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative')
  const confirmsSet = positive && ['choose_category', 'explore_alternatives'].includes(text(pending.act))
  const semanticValid = acceptedExtractorConfidence(semantic.confidence) && !!text(semantic.evidence).trim() && m.includes(normalized(text(semantic.evidence)))
  const declaredUnitChoice = object(object(semantics).unit_choice)
  const explicitUnitChoiceEvidence = normalized(text(declaredUnitChoice.evidence))
  const explicitChoice = declaredUnitChoice.kind === 'selected' && acceptedExtractorConfidence(declaredUnitChoice.confidence)
    && !!explicitUnitChoiceEvidence && normalized(current).includes(explicitUnitChoiceEvidence)
  const semanticOperation = explicitChoice ? 'select' : semanticValid && ['search', 'rank', 'compare', 'select', 'details'].includes(text(semantic.operation)) ? text(semantic.operation) : ''
  const category = semanticValid && (!confirmsSet || explicitCategoryChoice) ? text(semantic.category) : ''
  const excluded = semanticValid && !confirmsSet ? groundedCurrentCategoryExclusions(semantic, current, pending) : []
  const eligible = (units: Row[]) => units.filter(unit => (!category || unit.category === category) && !excluded.includes(text(unit.category)))
  const fromIds = (value: unknown) => ids(value).flatMap(id => catalog.filter(unit => text(unit.id) === id))
  const previousQuery = object(context.query)
  const previousSelectedIds = ids(context.selected_ids)
  const activePreferenceTransition = object(context.preference_transition).active === true
  // Older alternative offers recorded the journey but omitted their proposal.
  // Recover only a documented alternative journey, never an arbitrary old filter.
  const previousFilters = normalizedPropertyFilters(previousQuery.filters)
  if (context.journey === 'residential_alternatives' && ['compare_categories', 'choose_category'].includes(text(context.phase))
    && pending.act === 'choose_category' && (positive || !!category || answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative'))
    && previousFilters.bedrooms !== null && previousFilters.bedrooms_required !== true
    && !catalog.some(unit => ['departamento', 'penthouse'].includes(text(unit.category)) && Number(unit.bedrooms) === previousFilters.bedrooms)) {
    const options = catalog.filter(unit => ['departamento', 'penthouse'].includes(text(unit.category))
      && (previousFilters.floor_number === null || Number(unit.floor_number) === previousFilters.floor_number)
      && (previousFilters.min_area_m2 === null || Number(unit.area_internal_m2) >= previousFilters.min_area_m2)
      && (previousFilters.max_area_m2 === null || Number(unit.area_internal_m2) <= previousFilters.max_area_m2))
    const candidates = options.filter(unit => Number(unit.bedrooms) > 0 && Number(unit.bedrooms) === Math.max(...options
      .filter(other => other.category === unit.category).map(other => Number(other.bedrooms) || 0)))
    if (candidates.length) {
      const counts = [...new Set(candidates.map(unit => Number(unit.bedrooms)))]
      pending.act = 'explore_alternatives'; pending.candidate_ids = unitIds(candidates)
      pending.proposed_query = normalizedPropertyQuery({ group: 'residential', operation: 'search', scope: 'offered',
        filters: { ...previousFilters, bedrooms: counts.length === 1 ? counts[0] : null, bedrooms_required: false } })
    }
  }
  // Current constraints come exclusively from the interpreted fields.
  const currentFilters = propertyFiltersWithQuantityMeaning(normalizedPropertyFilters(semanticValid ? semantic.filters : {}), semantics)
  const targetsSelected = semantic.query_scope === 'selected' && semantic.operation !== 'compare'
  const referenceSource = targetsSelected && ids(context.selected_ids).length ? 'selected'
    : targetsSelected && ids(pending.target_ids).length ? 'pending_target' : ids(pending.candidate_ids).length ? 'pending_question'
    : ids(context.comparison_ids).length ? 'comparison' : ids(context.offered_ids).length ? 'offered' : 'selected'
  const referenceTargets = ids(referenceSource === 'pending_question' ? pending.candidate_ids : referenceSource === 'pending_target' ? pending.target_ids
    : referenceSource === 'comparison' ? context.comparison_ids : referenceSource === 'offered' ? context.offered_ids : context.selected_ids)
  const referencedUnits = fromIds(referenceTargets)
  const contextualOperation = ['compare', 'details', 'rank'].includes(text(semantic.operation))
    && (['comparison', 'followup', 'relative'].includes(text(semantic.reference_kind))
      || ['comparison', 'offered', 'selected'].includes(text(semantic.query_scope)))
  const inheritedFilters: Row = {}
  if (contextualOperation) for (const [key, value] of Object.entries(currentFilters)) {
    if (value === null || text(object(semantic.filter_evidence)[key])) continue
    const sameAsQuery = JSON.stringify(object(previousQuery.filters)[key]) === JSON.stringify(value)
    const describesTargets = referencedUnits.length > 0 && referencedUnits.length === referenceTargets.length
      && key !== 'bedrooms_required' && filterCatalog(referencedUnits, catalogQuery({ filters: { [key]: value } })).length === referencedUnits.length
    if (sameAsQuery || describesTargets || key === 'bedrooms_required' && value === false) {
      inheritedFilters[key] = value
      if (key === 'bedrooms_any') delete currentFilters.bedrooms_any
      else Object.assign(currentFilters, { [key]: null })
    }
  }
  const suppliedFilters = { ...currentFilters }
  const hasCurrentFilters = Object.entries(suppliedFilters).some(([key, value]) => key !== 'bedrooms_required' && value !== null && (!Array.isArray(value) || value.length > 0))
  context.filter_resolution = { current: suppliedFilters, inherited: inheritedFilters, evidence: object(semantic.filter_evidence),
    authority: 'current_typed_fields' }
  const group = confirmsSet ? text(previousQuery.group) : text(semantic.group) || (category === 'local' ? 'commercial' : category ? 'residential' : '')
  const broadResidential = semanticValid && group === 'residential' && !category && semanticOperation === 'search'
  const previousCategory = text(previousQuery.category || context.preference_category)
  const previousGroup = text(previousQuery.group) || (previousCategory === 'local' ? 'commercial' : previousCategory ? 'residential' : '')
  const groupChanged = !!group && !!previousGroup && group !== previousGroup
  // Choosing apartments within residential options refines the same search.
  // Only a change of use (housing/local) invalidates its previous constraints.
  const priorFilters = normalizedPropertyFilters(previousQuery.filters)
  const known = confirmedInterpretationMemory(summary), knownProperty = object(known.property)
  const preferenceUpdates = normalizedSelectionPreferences(object(semantics).selection_preferences, current)
  const preferences = selectionPreferences(object(known.selection_preferences || context.selection_preferences), preferenceUpdates)
  // A new evidenced quantity supersedes a prior waiver, without erasing the
  // independent priority. Facts in presented units never enter suppliedFilters.
  if (suppliedFilters.bedrooms != null || suppliedFilters.bedrooms_any?.length)
    preferences.bedrooms = { kind: 'constrained', evidence: semantic.evidence, confidence: semantic.confidence }
  context.selection_preferences = preferences
  const roomsUnrestricted = unrestrictedBedrooms(preferences)
  const preferencesChanged = Object.keys(preferenceUpdates).length > 0
  const rememberedFilters = acceptedExtractorConfidence(knownProperty.confidence) && text(knownProperty.evidence).trim()
    ? object(knownProperty.filters) : {}
  const acceptedFilters = object(object(context.exploration_state).accepted_filters)
  const restoreKnownNeeds = !groupChanged && !previousSelectedIds.length && semanticValid
    && (semanticOperation === 'search' || category && object(semantics).primary_intent === 'select_property')
    && group !== 'commercial' && previousGroup !== 'commercial' && knownProperty.group !== 'commercial'
  const inheritedNeeds = restoreKnownNeeds ? { ...rememberedFilters, ...acceptedFilters,
    ...Object.fromEntries(Object.entries(priorFilters).filter(([, value]) => value != null)) } : priorFilters
  const filters = replaceBedroomComparison({ ...(groupChanged ? emptyPropertyFilters() : normalizedPropertyFilters(inheritedNeeds)),
    ...Object.fromEntries(Object.entries(suppliedFilters).filter(([, value]) => value !== null)) }, suppliedFilters)
  if (suppliedFilters.bedrooms_any?.length && (currentFilters.bedrooms === null || suppliedFilters.bedrooms_any.includes(currentFilters.bedrooms))) { filters.bedrooms = null; filters.bedrooms_any = suppliedFilters.bedrooms_any }
  else if (suppliedFilters.bedrooms != null) delete filters.bedrooms_any
  if (roomsUnrestricted) Object.assign(filters, object(withoutBedroomConstraint({ filters }).filters))
  if (roomsUnrestricted) for (const key of ['bedrooms_any', 'bedrooms_operator', 'bedrooms_upper']) delete (filters as Row)[key]
  const asksRanking = semanticOperation === 'rank'
  const selector = semanticValid ? text(semantic.selector) : ''
  const inheritedBedrooms = normalizedPropertyFilters(previousQuery.filters)
  const expandsUnavailableSearch = broadResidential && selector === 'largest'
    && currentFilters.bedrooms === null && currentFilters.bedrooms === null
    && inheritedBedrooms.bedrooms !== null && inheritedBedrooms.bedrooms_required !== true
    && !catalog.some(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category)) && Number(unit.bedrooms) === inheritedBedrooms.bedrooms)
  if (expandsUnavailableSearch) {
    context.original_query = previousQuery
    filters.bedrooms = null; filters.bedrooms_required = null
    context.query_transition = { reason: 'largest_available_after_unavailable_preference', before: inheritedBedrooms, after: { ...filters }, preference_retained: inheritedBedrooms.bedrooms }
  } else context.query_transition = {}
  let operation = semanticOperation || (asksRanking ? 'rank' : broadResidential || hasCurrentFilters ? 'search' : 'none')
  const continuesInformation = !semanticOperation && informationSubject(current, { property_context: context, historial: history, semantica_turno: semantics }) === 'property'
  if (continuesInformation && !hasCurrentFilters && !category) operation = 'details'
  if (!semanticOperation && selector && (['search', 'rank'].includes(operation) || ['cheapest', 'most_expensive'].includes(selector) && operation === 'select')) operation = 'rank'
  context.operation_resolution = { source: semanticOperation ? 'extractor' : 'typed_context', extracted: semanticOperation || null,
    ignored_keyword_operations: semanticOperation && asksRanking && semanticOperation !== 'rank' ? ['rank'] : [] }
  const query: Row = { group: group || text(previousQuery.group) || null,
    category: broadResidential || groupChanged && !category ? null : category || text(previousQuery.category || context.preference_category) || null,
    filters, operation, selector: selector || null,
    scope: continuesInformation ? ids(context.selected_ids).length ? 'selected' : ids(context.comparison_ids).length ? 'comparison' : 'offered'
      : text(semantic.query_scope) || (operation === 'search' || operation === 'rank' ? 'catalog' : null) }
  // Requirements describe the requested information, not necessarily a change
  // to the customer's original needs. Validate their own current evidence.
  const structured = normalizeCatalogRequest(object(semantics).catalog_request, current) || {}
  const currentRequirements = Array.isArray(structured.requirements) ? structured.requirements.map(object) : []
  const replacedFields = new Set(currentRequirements.map(r => r.field))
  // One representation of explicit comparisons on both retrieval routes.
  const inheritedRequirements = !groupChanged && Array.isArray(previousQuery.requirements)
    ? previousQuery.requirements.map(object).filter(r => !replacedFields.has(r.field)
      && !(r.field === 'bedrooms' && suppliedFilters.bedrooms != null)
      && !(r.field === 'floor_number' && suppliedFilters.floor_number != null)) : []
  if (currentRequirements.length || inheritedRequirements.length) query.requirements = [...inheritedRequirements, ...currentRequirements]
  if (roomsUnrestricted) query.requirements = (Array.isArray(query.requirements) ? query.requirements : []).filter(r => object(r).field !== 'bedrooms')
  if (preferencesChanged && !ids(semantic.unit_numbers).length && semantic.operation !== 'select') {
    query.operation = operation = 'search'; query.scope = 'catalog'
    query.group = query.group || 'residential'
    context.pending_question = {}; pending.id = ''; pending.act = ''
    delete context.optimized_catalog_request
  }
  if (currentRequirements.some(r => r.field === 'floor_number')) filters.floor_number = null
  const currentBedroomRequirements = currentRequirements.filter(requirement => requirement.field === 'bedrooms')
  const currentBedroom = currentBedroomRequirements.length === 1 && currentBedroomRequirements[0].operator === 'eq'
    && typeof currentBedroomRequirements[0].value === 'number' ? Number(currentBedroomRequirements[0].value) : null
  const categoryPreference = explicitCategoryChoice || semanticValid && !!category
    && pending.act === 'choose_category' && ['search', 'select'].includes(semanticOperation)
    && !ids(semantic.unit_numbers).length && fromIds(pending.candidate_ids).some(unit => unit.category === category)
  if (categoryPreference) {
    context.category_preference = { category, evidence: current, confirmed: true }
    if (!ids(semantic.unit_numbers).length && !['rank', 'compare', 'details'].includes(operation)) query.operation = operation = 'search'
    if (category !== previousCategory && query.scope === 'selected') query.scope = 'catalog'
  }
  const asksToExplore = semanticOperation === 'search' || ['search', 'list'].includes(text(structured.purpose))
  const asksOnlyPrices = object(semantics).primary_intent === 'ask_price' || structured.metric === 'published_commercial_price'
  let originalQuery = Object.keys(object(context.original_query)).length ? object(context.original_query) : previousQuery
  const bedroomRequirement = (value: Row): number | null => {
    const conditions = (Array.isArray(value.requirements) ? value.requirements.map(object) : [])
      .filter(requirement => requirement.field === 'bedrooms' && requirement.operator === 'eq')
    return normalizedPropertyFilters(value.filters).bedrooms
      ?? (conditions.length === 1 && typeof conditions[0].value === 'number' ? Number(conditions[0].value) : null)
  }
  // Legacy turns sometimes lost the initial bedroom need before recording the
  // alternative query. Recover it only from an independently typed requirement
  // in this message, never from a family-size quantity or a historical summary.
  const housingQuantities = object(semantics).housing_quantities
  const statedNeeds = (Array.isArray(housingQuantities) ? housingQuantities.map(object) : [])
    .flatMap(quantity => {
      const values = quantity.values, evidence = text(quantity.evidence)
      return quantity.dimension === 'bedrooms' && quantity.role === 'requirement' && acceptedExtractorConfidence(quantity.confidence)
        && Array.isArray(values) && values.length === 1 && typeof values[0] === 'number'
        && values[0] > 0 && evidence && m.includes(normalized(evidence)) ? [{ bedrooms: values[0], evidence }] : []
    })
  const retainedBedrooms = bedroomRequirement(originalQuery)
  if (asksToExplore && !asksOnlyPrices && currentBedroom !== null && !Object.keys(object(context.exploration_state)).length
    && (retainedBedrooms === null || retainedBedrooms === currentBedroom) && statedNeeds.length === 1
    && statedNeeds[0].bedrooms !== currentBedroom) {
    const need = statedNeeds[0]
    originalQuery = normalizedPropertyQuery({ ...originalQuery, group: 'residential',
      category: object(context.category_preference).confirmed === true ? originalQuery.category : null,
      filters: { ...object(originalQuery.filters), bedrooms: need.bedrooms,
        bedrooms_required: currentFilters.bedrooms_required === true || object(originalQuery.filters).bedrooms_required === true },
      requirements: [...(Array.isArray(originalQuery.requirements) ? originalQuery.requirements.map(object) : [])
        .filter(requirement => requirement.field !== 'bedrooms'),
      { field: 'bedrooms', operator: 'eq', value: need.bedrooms, strength: 'required', evidence: need.evidence }] })
    context.original_query = originalQuery
  }
  const previousBedrooms = bedroomRequirement(originalQuery)
  const requestsAlternativeExploration = semanticValid && acceptedExtractorConfidence(object(semantics).confidence)
    && asksToExplore && !asksOnlyPrices && ['search', 'details', 'list'].includes(text(structured.purpose)) && currentBedroom !== null
    && previousBedrooms !== null && currentBedroom !== previousBedrooms && !groupChanged
    && !previousSelectedIds.length && !ids(semantic.unit_numbers).length && semanticOperation !== 'select'
    && !filterCatalog(catalog, catalogQuery(originalQuery)).length
    && filterCatalog(catalog, catalogQuery(query)).length > 0
  if (requestsAlternativeExploration) {
    if (!Object.keys(object(context.original_query)).length) context.original_query = normalizedPropertyQuery(originalQuery)
    // Asking about three while still needing five authorizes this exploration;
    // it is neither a declaration of suitability nor a category/unit selection.
    filters.bedrooms = null; filters.bedrooms_required = null; delete filters.bedrooms_any
    const chosenCategory = object(context.category_preference)
    query.category = chosenCategory.confirmed === true ? text(chosenCategory.category) || null : null
    context.preference_category = query.category
    query.group = 'residential'; query.operation = 'search'; operation = 'search'; query.scope = 'catalog'
    context.exploration_state = { version: 'property-exploration-v1', authorized: true, evidence: text(structured.evidence) }
    if (Object.hasOwn(context, 'optimized_catalog_request')) context.optimized_catalog_request = {
      group: query.group, category: query.category, requirements: query.requirements || [],
    }
    context.selected_ids = []; context.focused_ids = []; context.comparison_ids = []; context.pending_question = {}
    pending.id = ''; pending.act = ''; pending.candidate_ids = []; delete pending.proposed_query
  }
  if (groupChanged) {
    context.preference_category = category || null
    context.selected_ids = []; context.comparison_ids = []; context.offered_ids = []; context.focused_ids = []
    context.excluded_categories = []
    context.pending_question = {}
    delete context.exploration_state; delete context.category_preference
  }
  // Once a verified alternative set is offered, choosing its category or floor
  // refines that set rather than restoring the entire category from the catalogue.
  if (activePreferenceTransition && previousQuery.scope === 'offered' && !groupChanged
    && (category || currentFilters.floor_number !== null) && ids(context.offered_ids).length) query.scope = 'offered'
  context.query = query
  if (groupChanged) context.original_query = {}
  if (broadResidential) { context.preference_category = null; context.selected_ids = []; context.comparison_ids = [] }
  const result = (matches: Row[], reason: string, explicit = false, needsClarification = false) => {
    context.operation_resolution = { ...object(context.operation_resolution), applied: query.operation,
      ...(semanticOperation && query.operation !== semanticOperation ? { adjustment: reason } : {}) }
    if (matches.length && explicit && !needsClarification && ['select', 'details', 'compare'].includes(text(query.operation))) {
      // Looking up the identified subject must not reapply constraints from an
      // older search (e.g. apartment/floor 2 before the offered penthouse 602).
      query.category = matches.every(unit => unit.category === matches[0].category) ? matches[0].category : null
      query.group = matches.every(unit => unit.category === 'local') ? 'commercial'
        : matches.every(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))) ? 'residential' : null
      query.filters = emptyPropertyFilters(); query.scope = query.operation === 'compare' ? 'comparison' : 'selected'
      delete query.requirements
      context.reference_resolution = { source: 'explicit_reference', requested_ids: unitIds(matches), resolved_ids: unitIds(matches), status: 'resolved' }
    }
    return {
    ...base, matches, explicit, reason, needsClarification, query,
    memory: memory(matches), context,
    clarification: needsClarification ? (matches.length > 1
      ? `Entre las opciones que revisamos hay varias que encajan: ${matches.map(unit => `${text(unit.category)} ${text(unit.unit_number)}`).join(', ')}. ¿Cuál de estas opciones le gustaría conocer?`
      : 'Para orientarle con la opción correcta, ¿puede indicarme el número de la unidad que le interesa?') : '',
    }
  }
  if (pending.id === 'showroom_information' && positive) {
    const expected = ids(pending.target_ids), observed = fromIds(expected)
    query.operation = 'details'; query.scope = 'offered'; query.filters = emptyPropertyFilters(); query.selector = null
    delete query.requirements
    query.category = observed.length === 1 ? observed[0].category : null
    query.group = observed.length === 1 ? observed[0].category === 'local' ? 'commercial' : 'residential' : null
    context.selected_ids = previousSelectedIds; context.focused_ids = unitIds(observed); context.pending_question = {}
    context.reference_resolution = { source: 'showroom_information_invitation', requested_ids: expected, resolved_ids: unitIds(observed), status: observed.length === expected.length ? 'resolved' : 'clarification' }
    return result(observed, 'accepted_showroom_information', false, !observed.length || observed.length !== expected.length)
  }
  if (pending.id === 'property_comparison' && pending.act === 'compare_properties'
    && answersPendingQuestion(semantics, 'property_comparison', 'affirmative')) {
    const expected = ids(pending.candidate_ids), compared = fromIds(expected)
    if (expected.length > 1 && compared.length === expected.length) {
      query.operation = 'compare'; query.scope = 'comparison'; query.category = null; query.filters = emptyPropertyFilters()
      context.comparison_ids = expected; context.offered_ids = expected; context.pending_question = {}
      return result(compared, 'accepted_category_comparison', true)
    }
    return { ...result([], 'comparison_scope_unavailable', false, true), clarification: '¿Qué opciones le gustaría que comparemos?' }
  }
  const proposal = normalizedPropertyQuery(pending.proposed_query)
  const proposalPending = pending.id === 'property_requirements' && pending.act === 'explore_alternatives'
    && Object.keys(proposal).length > 0 && ids(pending.candidate_ids).length > 0
  const acceptsProposal = proposalPending && (positive || answersPendingQuestion(semantics,
    pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative'))
  const declinesProposal = proposalPending && answersPendingQuestion(semantics,
    pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative')
  const informationPurpose = ['details', 'compare', 'count', 'list', 'range', 'min', 'max'].includes(text(structured.purpose))
  const informationOperation = ['details', 'compare', 'rank'].includes(semanticOperation)
  const visualRequest = !!showroomRequest(current, history, semantics)
  const informationalRequest = semanticValid && acceptedExtractorConfidence(object(semantics).confidence)
    && object(semantics).catalog_request_status !== 'invalid'
    && object(semantics).primary_intent !== 'select_property' && semanticOperation !== 'select'
    && (asksOnlyPrices || informationPurpose
      || informationOperation && object(semantics).primary_intent !== 'select_property' || visualRequest)
  // A literal subject can be inspected without accepting the whole proposal.
  // Resolve only codes actually present in this message and unambiguous in
  // the fresh catalogue; their identities must belong to that proposal.
  const literalProposalNumbers = ids(semantic.unit_numbers).map(code)
  const literalProposalCodes = [...new Set([...ids(semantic.unit_numbers), ...ids(object(base).requestedCodes)]
    .map(code).filter(number => literalProposalNumbers.includes(number)))]
  const literalProposalUnits = literalProposalCodes.flatMap(number => {
    const matches = catalogRaw.filter(unit => code(unit.unit_number) === number)
    return matches.length === 1 ? matches : []
  })
  const literalProposalSubject = proposalPending && literalProposalCodes.length > 0
    && literalProposalUnits.length === literalProposalCodes.length
    && literalProposalUnits.every(unit => ids(pending.candidate_ids).includes(text(unit.id)))
  const proposalCategories = new Set(fromIds(pending.candidate_ids).map(unit => text(unit.category)))
  const currentBedroomMatchesProposal = currentBedroom !== null && currentBedroom === normalizedPropertyFilters(proposal.filters).bedrooms
  const proposalSubject = proposalPending && !groupChanged && (!category || proposalCategories.has(category))
    // An explicit new catalogue constraint is not silently rebound to an old
    // proposal. Follow-ups can refine that proposal with new conditions.
    && !(semantic.reference_kind === 'none' && semantic.query_scope === 'catalog' && !currentBedroomMatchesProposal
      && (hasCurrentFilters || currentRequirements.length > 0))
  if (proposalPending && !proposalSubject && semanticOperation === 'search'
    && (groupChanged || !!category || hasCurrentFilters || currentRequirements.length > 0)) {
    context.pending_question = {}
    // The rest of this resolver must not interpret naming a new category or
    // requirement as acceptance of the proposal that was just superseded.
    pending.id = ''; pending.act = ''; pending.candidate_ids = []
    delete pending.proposed_query
  }
  // Resolve the subject before executing a range/details/comparison operation.
  // In particular, ask_price cannot search for the unavailable original need
  // merely because the extractor emitted search/catalog instead of followup.
  // Literal subjects outside this proposal keep their own precise route below.
  const hasExplicitSubject = ids(semantic.unit_numbers).length > 0 || base.hasUnitMention
  if (proposalSubject && informationalRequest && !acceptsProposal && !declinesProposal && (!hasExplicitSubject || literalProposalSubject)) {
    const candidateIds = ids(pending.candidate_ids)
    const subjectIds = literalProposalSubject ? unitIds(literalProposalUnits) : candidateIds
    const candidates = fromIds(subjectIds)
    const supplied = Object.fromEntries(Object.entries(suppliedFilters).filter(([, value]) => value !== null))
    const baseRequirements = Array.isArray(proposal.requirements) ? proposal.requirements.map(object) : []
    const newFields = new Set(currentRequirements.map(requirement => requirement.field))
    if (suppliedFilters.bedrooms != null || Array.isArray(suppliedFilters.bedrooms_any) && suppliedFilters.bedrooms_any.length) newFields.add('bedrooms')
    if (suppliedFilters.floor_number != null) newFields.add('floor_number')
    if (suppliedFilters.min_area_m2 != null || suppliedFilters.max_area_m2 != null) newFields.add('area_internal_m2')
    const requirements = [...baseRequirements.filter(requirement => !newFields.has(requirement.field)), ...currentRequirements]
    const operation = structured.purpose === 'compare' || semanticOperation === 'compare' ? 'compare'
      : semanticOperation === 'rank' ? 'rank' : 'details'
    const subjectCategory = literalProposalSubject
      ? literalProposalUnits.every(unit => unit.category === literalProposalUnits[0].category) ? literalProposalUnits[0].category : null
      : category || proposal.category
    Object.assign(query, { ...proposal, category: subjectCategory, operation,
      scope: operation === 'compare' ? 'comparison' : 'offered', selector: operation === 'rank' ? selector || null : null,
      filters: normalizedPropertyFilters({ ...object(proposal.filters), ...supplied }) })
    if (requirements.length) query.requirements = requirements
    else delete query.requirements
    const partition = partitionCatalog(candidates, catalogQuery(query))
    const subject = [...partition.units, ...partition.unknown].filter(unit => !excluded.includes(text(unit.category)))
    const missingIds = subjectIds.filter(id => !candidates.some(unit => text(unit.id) === id))
    const requestedOperation = informationPurpose ? text(structured.purpose) : operation
    context.query = { ...previousQuery }
    context.pending_question = pending
    // Offered and compared identify the subject of information, not acceptance
    // of changed needs or selection. Existing price/tour readers use these IDs.
    context.offered_ids = unitIds(candidates)
    if (operation === 'compare') context.comparison_ids = unitIds(subject)
    context.proposal_information = { version: 'proposal-information-v1', active: true, informational_only: true,
      pending_question_id: pending.id, candidate_ids: candidateIds, subject_ids: subjectIds, resolved_ids: unitIds(subject), query: { ...query },
      original_query: { ...previousQuery }, requested_operation: requestedOperation,
      complete: !missingIds.length && !partition.unknown.length, missing_ids: missingIds, unknown_ids: unitIds(partition.unknown) }
    context.reference_resolution = { source: 'pending_proposal', requested_ids: subjectIds, resolved_ids: unitIds(subject),
      missing_ids: missingIds, status: missingIds.length ? 'clarification' : partition.unknown.length ? 'unknown_attributes' : 'resolved' }
    return { ...result(subject, 'pending_proposal_information', false, missingIds.length > 0),
      ...(missingIds.length ? { clarification: 'Una de las alternativas sobre las que conversábamos ya no aparece disponible. ¿Le gustaría revisar las opciones actuales?' } : {}) }
  }
  // Asking to explore after an unavailable bedroom count authorizes a separate
  // alternative query; it does not erase the client's original requirement.
  const oldFilters = normalizedPropertyFilters(previousQuery.filters)
  const asksAlternatives = semanticValid && semanticOperation === 'search'
  const originalBedrooms = oldFilters.bedrooms
  const residentialQuery = previousQuery.group === 'residential' || query.group === 'residential'
  const alternatives = catalog.filter(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))
    && (!query.category || unit.category === query.category)
    && !ids(context.excluded_categories).includes(text(unit.category)) && !excluded.includes(text(unit.category))
    && (oldFilters.floor_number === null || Number(unit.floor_number) === oldFilters.floor_number)
    && (oldFilters.min_area_m2 === null || Number(unit.area_internal_m2) >= oldFilters.min_area_m2)
    && (oldFilters.max_area_m2 === null || Number(unit.area_internal_m2) <= oldFilters.max_area_m2))
  const answersAlternativeProposal = Object.keys(proposal).length > 0
    && ['explore_alternatives', 'confirm_bedrooms'].includes(text(pending.act))
    && (positive || answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative')
      || pending.act === 'explore_alternatives' && !!category
      || pending.act === 'confirm_bedrooms' && currentFilters.bedrooms !== null)
  // A delivered proposal has its own acceptance transition below. The generic
  // alternative search must not preempt it and leave the original requirements
  // alongside a relaxed filter (for example eq 5 together with bedrooms 3).
  if (!answersAlternativeProposal
    && (!semanticOperation || semanticOperation === 'search') && asksAlternatives && residentialQuery && originalBedrooms !== null && currentFilters.bedrooms === null
    && alternatives.length && !alternatives.some(unit => Number(unit.bedrooms) === originalBedrooms)
    && alternatives.every(unit => Number(unit.bedrooms) > 0)) {
    if (!Object.keys(object(context.original_query)).length) context.original_query = normalizedPropertyQuery(previousQuery)
    query.filters = { ...oldFilters, bedrooms: Math.max(...alternatives.map(unit => Number(unit.bedrooms))), bedrooms_required: false }
    query.operation = 'search'; query.selector = null; query.scope = 'catalog'
    context.selected_ids = []; context.focused_ids = []; context.comparison_ids = []; context.pending_question = {}
    return result(alternatives.filter(unit => Number(unit.bedrooms) === object(query.filters).bedrooms), 'requested_alternatives_after_no_match')
  }
  if (category) {
    context.preference_category = category
    // Choosing a type can reopen that type. It does not revoke independently
    // confirmed rejections of other types merely because they were not repeated.
    context.excluded_categories = ids(context.excluded_categories).filter(value => value !== category)
    const sources = { ...object(context.category_exclusion_sources) }; delete sources[category]
    context.category_exclusion_sources = sources
  }
  if (excluded.length) {
    context.excluded_categories = [...new Set([...ids(context.excluded_categories), ...excluded])]
    context.category_exclusion_sources = { ...object(context.category_exclusion_sources), ...Object.fromEntries(excluded.map(category =>
      [category, { evidence: text(semantic.evidence), reference_kind: semantic.reference_kind,
        ...(text(object(pending.proposed_query).category) ? { pending_question: pending } : {}) }])) }
  }
  // Current interpreted codes identify the subject; only the current selection act can choose it.
  const semanticNumbers = explicitChoice && ids(declaredUnitChoice.unit_numbers).length ? ids(declaredUnitChoice.unit_numbers) : semanticValid ? ids(semantic.unit_numbers) : []
  const semanticExplicit = explicitChoice || semanticValid && ['explicit', 'comparison'].includes(text(semantic.reference_kind))
  // The extractor resolves natural references against the actually offered
  // choice. Validate identity and availability, not a literal unit code that
  // the client never needed to repeat. A price question can accompany a choice.
  if (semanticValid && semanticOperation === 'select' && semantic.reference_kind === 'relative'
    && semanticNumbers.length === 1 && text(semantic.evidence).trim() && m.includes(normalized(text(semantic.evidence)))) {
    const offeredIds = ids(pending.candidate_ids).length ? ids(pending.candidate_ids) : ids(context.offered_ids)
    const offered = fromIds(offeredIds)
    const chosen = offered.filter(unit => semanticNumbers.some(number => code(number) === code(unit.unit_number)))
    if (chosen.length === 1 && offered.length === offeredIds.length && !excluded.includes(text(chosen[0].category))) {
      context.selected_ids = unitIds(chosen); context.focused_ids = unitIds(chosen); context.comparison_ids = []
      context.pending_question = {}; context.preference_transition = {}
      query.category = chosen[0].category; query.group = chosen[0].category === 'local' ? 'commercial' : 'residential'
      query.operation = 'select'; query.scope = 'selected'; query.selector = null
      context.category_preference = { category: chosen[0].category, confirmed: true, evidence: semantic.evidence }
      return result(chosen, 'semantic_relative_choice', true)
    }
    return { ...result([], 'relative_choice_requires_clarification', false, true),
      clarification: 'Para revisar la opción correcta, ¿cuál de las unidades presentadas prefiere?' }
  }
  const literalNumbers = semanticNumbers.map(code)
  const literalUnits = catalog.filter(unit => semanticNumbers.some(number => code(number) === code(unit.unit_number))
    && literalNumbers.includes(code(unit.unit_number)))
  const currentUnitMention = literalUnits.length > 0 || ids(object(base).requestedCodes).some(number => literalNumbers.includes(code(number)))
    || semanticExplicit && semanticNumbers.some(number => literalNumbers.includes(code(number)))
  const currentIntent = text(object(semantics).primary_intent)
  const operationalContinuation = ['request_reservation', 'ask_reservation', 'ask_financing', 'request_visit', 'discuss_budget'].includes(currentIntent)
    || currentIntent === 'answer_previous' && ['reservation', 'financing', 'budget', 'visit'].includes(text(pending.act))
  const selectedInformation = ['ask_price', 'project_information', 'answer_previous', 'other'].includes(currentIntent)
    && (semantic.query_scope === 'selected' || semantic.reference_kind === 'followup')
  const selectedSubject = fromIds(previousSelectedIds)
  const selectedCodes = catalogRaw.filter(unit => previousSelectedIds.includes(text(unit.id))).map(unit => code(unit.unit_number))
  // A repeated category is descriptive context in an operational or unit
  // information turn, not a new choice. Resolve the already chosen subject
  // without changing the current action or interpreting it as fresh consent.
  const preservesSelectedSubject = previousSelectedIds.length > 0 && semanticValid
    && acceptedExtractorConfidence(object(semantics).confidence) && (operationalContinuation || selectedInformation)
    && !semanticOperation && !groupChanged && !selector && !hasCurrentFilters && !currentRequirements.length
    && !categoryPreference && !excluded.length && (!category || category === previousCategory)
    && selectedSubject.every(unit => !category || unit.category === category)
    && (semanticNumbers.every(number => selectedCodes.includes(code(number)))
      || selectedSubject.length !== previousSelectedIds.length && semantic.query_scope === 'selected' && !explicitChoice)
  if (preservesSelectedSubject) {
    const complete = selectedSubject.length === previousSelectedIds.length
    const ambiguousSelection = previousSelectedIds.length > 1
    query.operation = 'none'; query.scope = 'selected'; query.selector = null
    context.selected_ids = previousSelectedIds
    context.reference_resolution = { source: 'confirmed_selection', requested_ids: previousSelectedIds,
      resolved_ids: unitIds(selectedSubject), status: !complete ? 'unavailable' : ambiguousSelection ? 'ambiguous' : 'resolved' }
    return { ...result(selectedSubject, !complete ? 'selected_context_unavailable' : ambiguousSelection ? 'ambiguous' : 'remembered',
      false, !complete || ambiguousSelection),
      ...(!complete ? { clarification: 'La unidad elegida ya no aparece disponible. ¿Le gustaría revisar las opciones actuales?' } : {}) }
  }
  if ((base.hasUnitMention || semanticExplicit && semanticNumbers.length > 0) && currentUnitMention) {
    // Clients say "departamento 602" for a penthouse or "departamento 210" for a suite.
    // A known explicit residential number is more precise than that category label.
    let matches = base.matches.filter(unit => !excluded.includes(text(unit.category)))
    if (literalUnits.length && semanticExplicit) matches = [...new Map([...literalUnits, ...base.matches.filter(unit =>
      ids(object(base).requestedCodes).some(number => code(number) === code(unit.unit_number)) && literalNumbers.includes(code(unit.unit_number)))]
      .filter(unit => !excluded.includes(text(unit.category))).map(unit => [unit.id, unit])).values()]
    const rejectedNumbers = declaredUnitChoice.kind === 'rejected' && acceptedExtractorConfidence(declaredUnitChoice.confidence)
      && explicitUnitChoiceEvidence && m.includes(explicitUnitChoiceEvidence) ? ids(declaredUnitChoice.unit_numbers).map(code) : []
    const rejected = matches.filter(unit => rejectedNumbers.includes(code(unit.unit_number)))
    matches = matches.filter(unit => !rejected.includes(unit))
    if (rejected.length && !matches.length) {
      context.selected_ids = []; context.comparison_ids = []; context.offered_ids = []
      return result([], 'unit_rejected')
    }
    // Invalid explicit codes must never fall back to an older, valid selection.
    const requestedCodes = ids(object(base).requestedCodes)
    const incomplete = !matches.length || (semanticNumbers.length > 0 && literalUnits.length !== semanticNumbers.length)
      || (!semanticExplicit && requestedCodes.some(number => !catalog.some(unit => Number(text(unit.unit_number).replace(/\D/g, '')) === Number(number))))
    query.operation = semanticOperation || 'details'
    if (['search', 'rank'].includes(text(query.operation))) query.scope = 'offered'
    query.selector = query.operation === 'rank' ? selector || null : null
    if (['search', 'rank'].includes(text(query.operation))) query.filters = normalizedPropertyFilters(suppliedFilters)
    context.pending_question = {}
    context.focused_ids = matches.length === 1 && !incomplete ? unitIds(matches) : []
    context.comparison_ids = matches.length > 1 ? unitIds(matches) : []
    context.selected_ids = incomplete ? [] : matches.length === 1 && query.operation === 'select' ? unitIds(matches)
      : ['details', 'compare'].includes(text(query.operation)) ? previousSelectedIds.filter(id => !rejected.some(unit => text(unit.id) === id)) : []
    if (matches.length === 1 && !incomplete) context.preference_transition = {}
    context.offered_ids = matches.length && !incomplete ? unitIds(matches) : []
    return result(matches, incomplete ? 'ambiguous' : pending.act === 'choose_unit' && matches.length === 1 && semanticOperation === 'select' ? 'explicit_pending_choice' : literalUnits.length ? 'semantic_explicit' : 'explicit', !incomplete, incomplete)
  }
  const selectedForVisualization = fromIds(previousSelectedIds)
  const visualSelectedSubject = visualRequest && previousSelectedIds.length === 1 && selectedForVisualization.length === 1
    && semanticValid && ['followup', 'relative'].includes(text(semantic.reference_kind))
    && semantic.query_scope === 'selected' && semanticOperation !== 'select'
    && !groupChanged && !categoryPreference && !excluded.length && !hasCurrentFilters && !currentRequirements.length
    && (!category || selectedForVisualization[0].category === category
      || category === 'departamento' && ['suite', 'departamento', 'penthouse'].includes(text(selectedForVisualization[0].category)))
  if (visualSelectedSubject) {
    // How to see an already chosen unit is an informational interruption even
    // if the extractor calls it search/none. It must not restart type selection.
    Object.assign(query, normalizedPropertyQuery(previousQuery), { operation: 'details', scope: 'selected', selector: null })
    context.selected_ids = previousSelectedIds
    context.pending_question = pending
    context.preference_category = context.category_preference && object(context.category_preference).confirmed === true
      ? object(context.category_preference).category : previousQuery.category || null
    return result(selectedForVisualization, 'selected_visual_followup')
  }
  const baselineUnits = fromIds(previousSelectedIds.length ? previousSelectedIds : context.offered_ids)
  const baselineCounts = [...new Set(baselineUnits.map(unit => Number(unit.bedrooms)).filter(count => count > 0))]
  const baselineFilters = normalizedPropertyFilters(previousQuery.filters)
  const baselineBedrooms = baselineFilters.bedrooms ?? (baselineFilters.bedrooms_any?.length ? Math.min(...baselineFilters.bedrooms_any)
    : baselineCounts.length === 1 ? baselineCounts[0] : null)
  const preference = propertyPreferenceChange(current, { ...previousQuery, filters: { ...baselineFilters, bedrooms: baselineBedrooms } }, semantics)
  // Answering the bedroom clarification refines the requested cheaper search;
  // changing its count does not cancel the still-active price requirement.
  if (pending.id === 'property_bedrooms' && activePreferenceTransition && object(context.preference_transition).kind === 'cheaper'
    && (pending.act !== 'confirm_bedrooms' || currentFilters.bedrooms !== normalizedPropertyFilters(object(pending.proposed_query).filters).bedrooms)
    && currentFilters.bedrooms !== null && !answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative')) {
    Object.assign(preference, { kind: 'cheaper', bedrooms: currentFilters.bedrooms,
      requires_bedroom_confirmation: false, evidence: current.trim().slice(0, 240) })
  }
  if ((!semanticOperation || semanticOperation === 'search') && preference.kind && (previousQuery.group === 'residential' || query.group === 'residential'
    || baselineUnits.some(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))))) {
    const sourceIds = unitIds(baselineUnits)
    context.selected_ids = previousSelectedIds
    context.preference_transition = { kind: preference.kind, active: true, source_selected_ids: previousSelectedIds,
      source_offered_ids: sourceIds, source_bedrooms: baselineBedrooms, fewer_bedrooms: preference.fewer_bedrooms === true }
    const needsBedroomCount = preference.fewer_bedrooms === true && baselineBedrooms === null && preference.bedrooms === null
    if (preference.requires_bedroom_confirmation || needsBedroomCount) {
      Object.assign(query, normalizedPropertyQuery(previousQuery))
      context.query_transition = { reason: preference.kind === 'cheaper' ? 'requested_cheaper_options' : 'requested_fewer_bedrooms',
        before: previousQuery, after: { ...query }, evidence: preference.evidence, requires_bedroom_confirmation: true }
      return { ...result(baselineUnits, preference.kind === 'cheaper'
        ? needsBedroomCount ? 'cheaper_requires_bedroom_count' : 'cheaper_requires_bedrooms_confirmation' : 'fewer_requires_bedroom_count', false, true),
        clarification: baselineBedrooms === null ? '¿Cuántos dormitorios le gustaría que tuviera la opción que busca?'
          : `¿Desea que mantengamos los ${baselineBedrooms} dormitorios al buscar opciones más económicas?` }
    }
    const explicitCategory = category || null
    const proposedFilters = normalizedPropertyFilters({ ...baselineFilters, ...Object.fromEntries(Object.entries(currentFilters).filter(([, value]) => value !== null)),
      bedrooms: preference.bedrooms, bedrooms_any: [], bedrooms_required: currentFilters.bedrooms_required })
    // "Fewer" is bounded by the established requirement, never by a hardcoded
    // bedroom count. Explicit counts remain exact, including one bedroom.
    const candidates = catalog.filter(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))
      && (!explicitCategory || unit.category === explicitCategory)
      && (preference.bedrooms !== null ? Number(unit.bedrooms) === preference.bedrooms
        : Number(unit.bedrooms) > 0 && Number(unit.bedrooms) < Number(baselineBedrooms))
      && (proposedFilters.floor_number === null || Number(unit.floor_number) === proposedFilters.floor_number)
      && (proposedFilters.min_area_m2 === null || Number(unit.area_internal_m2) >= proposedFilters.min_area_m2)
      && (proposedFilters.max_area_m2 === null || Number(unit.area_internal_m2) <= proposedFilters.max_area_m2))
    if (preference.bedrooms === null) {
      const counts = [...new Set(candidates.map(unit => Number(unit.bedrooms)))]
      proposedFilters.bedrooms = counts.length === 1 ? counts[0] : null
      if (counts.length > 1) proposedFilters.bedrooms_any = counts
      else delete proposedFilters.bedrooms_any
    }
    Object.assign(query, { group: 'residential', category: explicitCategory, filters: proposedFilters,
      operation: 'search', selector: null, scope: 'catalog' })
    context.query_transition = { reason: preference.kind === 'fewer_bedrooms' ? 'requested_fewer_bedrooms' : 'requested_cheaper_options',
      before: previousQuery, after: { ...query }, evidence: preference.evidence, previous_bedrooms: baselineBedrooms }
    context.pending_question = {}; context.comparison_ids = []; context.focused_ids = []
    context.preference_category = explicitCategory; context.excluded_categories = []
    return result(candidates, preference.kind === 'fewer_bedrooms' ? 'requested_fewer_bedrooms' : 'requested_cheaper_options')
  }
  // A comparison request resolves the active offered set before an incidental
  // yes or an earlier chosen unit can redirect it to a single option.
  const asksComparison = semanticOperation === 'compare'
  const continuesSet = asksComparison || contextualOperation && ['details', 'rank'].includes(operation)
  if (continuesSet && !acceptsProposal && !declinesProposal && referenceTargets.length && (['comparison', 'offered', 'selected'].includes(text(query.scope))
    || !hasCurrentFilters && (!category || referencedUnits.every(unit => unit.category === category)))) {
    // Resolve the subject first. Only this turn's new constraints refine that
    // set; prior search filters must not erase an already offered alternative.
    query.operation = asksComparison ? 'compare' : operation
    query.scope = asksComparison ? 'comparison' : 'offered'
    const compatiblePrior = Object.fromEntries(Object.entries(normalizedPropertyFilters(previousQuery.filters)).filter(([key, value]) => value !== null
      && key !== 'bedrooms_required' && referencedUnits.length > 0
      && filterCatalog(referencedUnits, catalogQuery({ filters: { [key]: value } })).length === referencedUnits.length))
    const scopedFilters: Row = { ...compatiblePrior,
      ...Object.fromEntries(Object.entries(suppliedFilters).filter(([, value]) => value !== null)) }
    if (suppliedFilters.bedrooms !== null) delete scopedFilters.bedrooms_any
    query.filters = normalizedPropertyFilters(scopedFilters)
    if (!category) query.category = referencedUnits.length && referencedUnits.every(unit => unit.category === referencedUnits[0].category) ? referencedUnits[0].category : null
    if (asksComparison) query.selector = null
    const matches = filterCatalog(referencedUnits, catalogQuery(query)).filter(unit => !excluded.includes(text(unit.category)))
    const incomplete = referencedUnits.length !== referenceTargets.length
    const needsClarification = incomplete || !matches.length || asksComparison && matches.length < 2
    context.reference_resolution = { source: referenceSource, requested_ids: referenceTargets, resolved_ids: unitIds(matches),
      missing_ids: referenceTargets.filter(id => !referencedUnits.some(unit => text(unit.id) === id)),
      status: needsClarification ? 'clarification' : 'resolved' }
    if (asksComparison) context.comparison_ids = unitIds(matches)
    else context.offered_ids = unitIds(matches)
    return { ...result(matches, needsClarification ? 'context_reference_requires_clarification'
      : asksComparison ? 'comparison_followup' : 'contextual_property_followup', false, needsClarification),
      ...(needsClarification ? { clarification: asksComparison
        ? 'Para comparar las opciones correctas, ¿qué unidades le gustaría que revisemos?'
        : 'Para revisar la opción correcta, ¿qué unidad le gustaría conocer?' } : {}) }
  }
  if (asksComparison && ['comparison', 'offered', 'selected'].includes(text(query.scope))) {
    query.operation = 'compare'; query.scope = 'comparison'; context.comparison_ids = []
    context.reference_resolution = { source: referenceSource, requested_ids: referenceTargets, resolved_ids: [], status: 'clarification' }
    return { ...result([], 'context_reference_requires_clarification', false, true),
      clarification: '¿Qué unidades le gustaría que comparemos?' }
  }
  // A reply to a durable, focused question names its subject without requiring
  // the customer to repeat a code. Accepting details never books a visit or purchase.
  const acceptsPending = positive || answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative')
  if (pending.id === 'property_priority' && pending.act === 'confirm_priority' && acceptsPending
    && prioritizesInteriorSpace(preferences)) {
    Object.assign(query, roomsUnrestricted ? withoutBedroomConstraint(normalizedPropertyQuery(previousQuery)) : normalizedPropertyQuery(previousQuery),
      { operation: 'search', scope: 'catalog', selector: null })
    context.pending_question = {}; context.selected_ids = previousSelectedIds
    return result(filterCatalog(catalog, catalogQuery(query)), 'accepted_selection_priority')
  }
  if (!roomsUnrestricted && pending.act === 'confirm_bedrooms' && currentFilters.bedrooms === null
    && answersPendingQuestion(semantics, 'property_bedrooms', 'negative')) {
    Object.assign(query, normalizedPropertyQuery(previousQuery))
    context.selected_ids = previousSelectedIds
    return { ...result([], 'bedroom_confirmation_declined', false, true),
      clarification: '¿Cuántos dormitorios le gustaría que tuviera la opción que busca?' }
  }
  if (pending.act === 'explore_quoted_options' && acceptsPending) {
    const options = fromIds(pending.candidate_ids)
    if (options.length && options.length === ids(pending.candidate_ids).length) {
      query.operation = 'details'; query.scope = 'offered'; query.selector = null
      context.offered_ids = unitIds(options); context.pending_question = {}
      return result(options, 'accepted_quoted_options')
    }
  }
  const declinesPending = answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative')
  const offeredCategory = pending.id === 'property_category' && pending.act === 'choose_category'
    ? text(object(pending.proposed_query).category) : ''
  const categoryOptions = offeredCategory ? fromIds(pending.candidate_ids) : []
  if (offeredCategory && acceptsPending && !declinesPending && !category
    && proposal.category === offeredCategory && categoryOptions.length > 0
    && categoryOptions.length === ids(pending.candidate_ids).length
    && categoryOptions.every(unit => unit.category === offeredCategory)) {
    // Accept only the type in the delivered invitation. Preserve physical
    // requirements and leave every unit unselected until its own decision.
    Object.assign(query, { ...normalizedPropertyQuery(previousQuery), category: offeredCategory,
      group: offeredCategory === 'local' ? 'commercial' : 'residential', operation: 'search', selector: null })
    context.category_preference = { category: offeredCategory, confirmed: true, evidence: current }
    context.pending_question = {}; context.selected_ids = []; context.focused_ids = []; context.comparison_ids = []
    context.phase = 'category_accepted'
    return result(filterCatalog(catalog, catalogQuery(query)), 'accepted_category_offer')
  }
  if (pending.id === 'unit_choice' && pending.act === 'confirm_unit' && declinesPending) {
    const rejectedTargets = ids(pending.target_ids)
    if (rejectedTargets.length === 1 && previousSelectedIds.includes(rejectedTargets[0])) {
      context.selected_ids = previousSelectedIds.filter(id => !rejectedTargets.includes(id))
      context.pending_question = {}; context.focused_ids = []; context.comparison_ids = []
      query.operation = 'none'; query.scope = null; query.selector = null
      return result([], 'confirmed_unit_declined')
    }
  }
  if (pending.id === 'property_requirements' && declinesPending) {
    context.requirements_declined = { original_query: normalizedPropertyQuery(query),
      ...(Object.keys(proposal).length ? { proposed_query: proposal } : {}), evidence: current }
    context.pending_question = {}
    context.selected_ids = previousSelectedIds
    return result([], 'alternative_query_declined')
  }
  const proposedOptions = pending.id === 'property_requirements' && pending.act === 'explore_alternatives'
    ? filterCatalog(fromIds(pending.candidate_ids), catalogQuery(proposal)).filter(unit => !excluded.includes(text(unit.category))) : null
  if (acceptsPending && proposedOptions && !proposedOptions.length) {
    Object.assign(query, normalizedPropertyQuery(previousQuery))
    context.selected_ids = previousSelectedIds
    return { ...result([], 'alternative_query_unavailable', false, true),
      clarification: 'Las alternativas sobre las que conversábamos ya no se pueden confirmar. ¿Le gustaría revisar las opciones actuales?' }
  }
  const previousBedroomFilters = normalizedPropertyFilters(previousQuery.filters)
  const proposedBedroomFilters = normalizedPropertyFilters(proposal.filters)
  const bedroomRequirements = (value: Row) => (Array.isArray(value.requirements) ? value.requirements.map(object) : [])
    .filter(requirement => requirement.field === 'bedrooms')
    .map(({ operator, value, strength }) => ({ operator, value, strength }))
  const preservesRequiredBedrooms = previousBedroomFilters.bedrooms === proposedBedroomFilters.bedrooms
    && JSON.stringify(previousBedroomFilters.bedrooms_any || []) === JSON.stringify(proposedBedroomFilters.bedrooms_any || [])
    && proposedBedroomFilters.bedrooms_required === true
    && JSON.stringify(bedroomRequirements(previousQuery)) === JSON.stringify(bedroomRequirements(proposal))
  const acceptedAlternative = ['explore_alternatives', 'confirm_bedrooms'].includes(text(pending.act))
    && !declinesPending
    && (acceptsPending || pending.act === 'explore_alternatives' && !!category
      || pending.act === 'confirm_bedrooms' && currentFilters.bedrooms !== null && !answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative'))
    && (pending.act === 'confirm_bedrooms' || previousBedroomFilters.bedrooms_required !== true || preservesRequiredBedrooms)
    && Object.keys(proposal).length > 0
  if (acceptedAlternative) {
    // Exploring a relaxed query is not a new declaration of the original need,
    // and accepting a set never selects one of its units.
    if (!Object.keys(object(context.original_query)).length) context.original_query = normalizedPropertyQuery(previousQuery)
    const proposedFilters = normalizedPropertyFilters(proposal.filters)
    Object.assign(query, { ...proposal, category: category || proposal.category,
      filters: { ...proposedFilters, ...Object.fromEntries(Object.entries(currentFilters).filter(([key, value]) => value !== null
        && !(structured.version === 'catalog-request-v1' && key.startsWith('bedrooms') && currentBedroomRequirements.length))) },
      operation: 'search', selector: null })
    // Object.assign cannot remove an old requirement omitted by the accepted
    // proposal. Otherwise a relaxed bedroom filter still carries the old eq 5.
    const proposalRequirements = Array.isArray(proposal.requirements) ? proposal.requirements.map(object) : []
    const currentFields = new Set(currentRequirements.map(r => r.field))
    const requirements = [...proposalRequirements.filter(r => !currentFields.has(r.field)), ...currentRequirements]
    if (requirements.length) query.requirements = requirements
    else delete query.requirements
    // Retrieval may retain an additional structured query beside the durable
    // property query. Accepting a proposal must update both representations,
    // or the next turn can inherit the original, now superseded requirement.
    if (Object.hasOwn(context, 'optimized_catalog_request')) context.optimized_catalog_request = {
      category: query.category, group: query.group, requirements,
    }
    operation = 'search'
    delete filters.bedrooms_any
    Object.assign(filters, query.filters)
    context.offered_ids = ids(pending.candidate_ids)
    context.selected_ids = pending.act === 'confirm_bedrooms' || activePreferenceTransition ? previousSelectedIds : []; context.comparison_ids = []; context.focused_ids = []
    context.pending_question = {}
    delete context.requirements_declined
    context.phase = 'exploring_alternatives'
    context.exploration_state = { version: 'property-exploration-v1', authorized: true, evidence: current,
      accepted_filters: { ...object(query.filters) } }
    context.query_transition = { reason: pending.act === 'confirm_bedrooms' ? 'accepted_bedroom_confirmation' : 'accepted_alternatives',
      before: previousQuery, after: { ...query }, original_requirement_retained: true }
  } else if (pending.act === 'choose_category' && acceptsPending && !category) {
    query.operation = operation = 'search'
    // A bare yes cannot restore an older preference after several categories
    // were explicitly offered as alternatives to an unavailable property.
    query.category = text(previousQuery.category) || null
    context.selected_ids = []; context.focused_ids = []
  }
  const confirmsOption = answersPendingQuestion(semantics, 'unit_choice', 'affirmative') || positive && pending.id === 'unit_choice'
  if (confirmsOption && ['choose_unit', 'confirm_unit', 'show_unit_details'].includes(text(pending.act))) {
    const targetIds = ids(pending.target_ids).length ? ids(pending.target_ids) : ids(context.focused_ids).length ? ids(context.focused_ids) : ids(pending.candidate_ids).length ? ids(pending.candidate_ids) : ids(context.offered_ids)
    const options = fromIds(targetIds)
    if (targetIds.length === 1 && options.length === 1) {
      const reason = ids(pending.target_ids).length || ids(context.focused_ids).length ? 'confirmed_question_target' : 'confirmed_single_option'
      context.selected_ids = unitIds(options); context.focused_ids = unitIds(options); context.comparison_ids = []
      query.operation = 'select'; query.scope = 'selected'
      return result(options, reason, true)
    }
    if (targetIds.length) return { ...result(options, options.length !== targetIds.length ? 'question_target_unavailable' : 'question_requires_choice', false, true),
      clarification: options.length !== targetIds.length ? 'La opción sobre la que conversábamos ya no aparece disponible. ¿Le gustaría revisar las alternativas actuales?'
        : result(options, 'question_requires_choice', false, true).clarification }
  }
  // A client may choose the unit just shown while the bot's next question asks
  // about its intended use. That choice is a separate current speech act; a
  // bare yes to purpose/financing must never supply the same authorization.
  const choiceEvidence = normalized(text(semantic.evidence))
  const previousAnswer = object(object(semantics).answer_to_previous)
  const rejectedChoice = previousAnswer.kind === 'negative'
    && normalized(text(previousAnswer.evidence)).includes(choiceEvidence)
  const currentChoice = semanticOperation === 'select' && semantic.reference_kind === 'followup'
    && (explicitChoice || acceptedExtractorConfidence(object(semantics).primary_intent === 'select_property' && object(semantics).confidence))
    && [semantic.evidence, object(semantics).primary_evidence].every(value => {
      const evidence = normalized(text(value))
      return !!evidence && m.includes(evidence)
    })
    && !positive && !rejectedChoice
  if (currentChoice) {
    const offered = ids(context.offered_ids), focused = ids(context.focused_ids)
    const requested = focused.length ? focused : offered
    const availableOptions = fromIds(requested)
    const options = filterCatalog(eligible(availableOptions), catalogQuery(query))
    const focusIsCurrent = !focused.length || focused.every(id => offered.includes(id))
    context.selected_ids = []
    if (focusIsCurrent && requested.length === 1 && availableOptions.length === 1 && options.length === 1) {
      context.selected_ids = unitIds(options); context.focused_ids = unitIds(options); context.comparison_ids = []
      context.pending_question = {}; context.preference_transition = {}
      query.operation = 'select'; query.scope = 'selected'; query.selector = null
      return result(options, 'explicit_contextual_choice', true)
    }
    const unavailable = availableOptions.length !== requested.length
    return { ...result(options, unavailable ? 'contextual_choice_unavailable'
      : !focusIsCurrent || options.length !== requested.length ? 'contextual_choice_incompatible' : 'contextual_choice_requires_choice', false, true),
      ...(unavailable ? { clarification: 'La opción sobre la que conversábamos ya no aparece disponible. ¿Le gustaría revisar las alternativas actuales?' } : {}) }
  }
  // Search/ranking returns facts, not a selected unit. Ties are valid answers.
  // Resolve filters before unit-code guards, so "5ta planta" never becomes unit 5.
  if (['details', 'compare'].includes(operation) && query.scope === 'catalog' && (hasCurrentFilters || currentRequirements.length)) {
    const matches = filterCatalog(eligible(catalog), catalogQuery(query))
    context.focused_ids = unitIds(matches)
    context.selected_ids = previousSelectedIds
    if (['unit_choice', 'property_floor'].includes(text(pending.id))) context.pending_question = {}
    return result(matches, 'current_catalog_details')
  }
  if (['search', 'rank'].includes(operation) && (hasCurrentFilters || currentRequirements.length || broadResidential || operation === 'rank' || acceptedAlternative || requestsAlternativeExploration
    || categoryPreference || preferencesChanged || prioritizesInteriorSpace(preferences))) {
    const progressionIds = object(context.exploration_state).authorized === true && ['choose_category', 'choose_floor'].includes(text(pending.act))
      ? ids(pending.candidate_ids) : []
    const scopeIds = query.scope === 'offered' ? ids(context.offered_ids).length ? ids(context.offered_ids) : progressionIds : query.scope === 'comparison' ? ids(context.comparison_ids)
      : query.scope === 'selected' ? ids(context.selected_ids) : []
    const floorConditions = (value: Row) => (Array.isArray(value.requirements) ? value.requirements.map(object) : [])
      .filter(requirement => requirement.field === 'floor_number')
      .map(({ operator, value, strength }) => ({ operator, value, strength }))
    const acceptingOfferedFloor = acceptedAlternative && proposedOptions
      && (normalizedPropertyFilters(previousQuery.filters).floor_number !== normalizedPropertyFilters(proposal.filters).floor_number
        || JSON.stringify(floorConditions(previousQuery)) !== JSON.stringify(floorConditions(proposal)))
    // The current acceptance refers to the options actually offered. Keep its
    // receipt bounded without turning budget orientation into a durable cap;
    // a later budget correction may widen the physical query again.
    // Fresh needs may search the catalog. A lost relative set cannot silently
    // turn a ranking of "these" options into a ranking of every project unit.
    if (!scopeIds.length && !acceptingOfferedFloor && query.scope !== 'catalog') {
      if (operation === 'search' && (preferencesChanged || hasCurrentFilters || currentRequirements.length || categoryPreference || broadResidential))
        query.scope = 'catalog'
      else return result([], 'unresolved_search_scope', false, true)
    }
    const source = acceptingOfferedFloor ? proposedOptions : scopeIds.length ? fromIds(scopeIds) : catalog
    const matchingIds = new Set(filterCatalog(source, catalogQuery(query)).map(unit => text(unit.id)))
    const candidates = source.filter(unit => matchingIds.has(text(unit.id)) && !excluded.includes(text(unit.category)))
    context.selected_ids = acceptedAlternative && pending.act === 'confirm_bedrooms' || activePreferenceTransition ? previousSelectedIds : []; context.comparison_ids = []
    if (operation === 'rank' && ['largest', 'smallest'].includes(selector)) {
      if (!candidates.length) return result([], 'catalog_no_match')
      if (candidates.some(unit => !(Number(unit.area_internal_m2) > 0))) return result(candidates, 'ranking_missing_area')
      const target = (selector === 'largest' ? Math.max : Math.min)(...candidates.map(unit => Number(unit.area_internal_m2)))
      const ranked = candidates.filter(unit => Number(unit.area_internal_m2) === target)
      return result(ranked, ranked.length > 1 ? 'ranking_tie' : 'catalog_rank')
    }
    return result(candidates, acceptedAlternative && pending.act === 'confirm_bedrooms' ? 'accepted_bedroom_confirmation'
      : candidates.length ? acceptedAlternative ? 'accepted_alternative_query' : 'catalog_search' : 'catalog_no_match')
  }
  const declinedSelector = answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'negative')
  if (selector && declinedSelector) return result([], 'ambiguous', false, true)
  if (selector && semanticOperation === 'select') {
    // The newest displayed set outranks the old CRM preference or old chosen unit.
    const requested = ids(ids(context.offered_ids).length ? context.offered_ids
      : ids(context.comparison_ids).length ? context.comparison_ids : context.selected_ids)
    const availableCandidates = fromIds(requested)
    if (availableCandidates.length !== requested.length) return { ...result(availableCandidates, 'ambiguous', false, true),
      clarification: 'Una de las opciones que le mostramos ya no aparece disponible. ¿Le gustaría que revisemos las opciones actuales?' }
    const candidates = eligible(availableCandidates)
    let ranked: Row[] = []
    if (selector === 'first' || selector === 'last') ranked = candidates.length ? [selector === 'first' ? candidates[0] : candidates[candidates.length - 1]] : []
    else if (['largest', 'smallest'].includes(selector) && candidates.length && candidates.every(unit => Number(unit.area_internal_m2) > 0)) {
      const areas = candidates.map(unit => Number(unit.area_internal_m2))
      const target = selector === 'largest' ? Math.max(...areas) : Math.min(...areas)
      ranked = candidates.filter(unit => Number(unit.area_internal_m2) === target)
    }
    // Prices are intentionally absent from this extraction catalog; never invent a ranking.
    const matches = ranked.length ? ranked : candidates
    if (ranked.length !== 1) return result(matches, 'ambiguous', false, true)
    context.selected_ids = unitIds(ranked); context.comparison_ids = []; context.offered_ids = unitIds(ranked)
    return result(ranked, 'relative_selection', true)
  }
  if (category || excluded.length) {
    if (activePreferenceTransition && query.scope === 'offered' && category) {
      const candidates = fromIds(context.offered_ids).filter(unit => unit.category === category && !excluded.includes(text(unit.category)))
      query.operation = 'search'
      return result(candidates, candidates.length ? 'catalog_search' : 'catalog_no_match')
    }
    context.selected_ids = []; context.comparison_ids = []; context.offered_ids = []; context.phase = null
    // A category change is a fresh catalogue query, never an empty offered set
    // masquerading as verified absence of inventory.
    query.scope = 'catalog'; query.operation = 'search'
    return result([], 'category_change')
  }
  const neutralAnswer = acceptedExtractorConfidence(object(semantics).primary_intent === 'answer_previous' && object(semantics).confidence)
    && !semanticOperation && !category && !excluded.length && !hasCurrentFilters && !currentRequirements.length
    && !groupChanged && !selector && !ids(semantic.unit_numbers).length
  if (neutralAnswer && previousSelectedIds.length) {
    // An acknowledgement can refer to an existing choice without choosing a
    // new unit or authorizing the pending financial/visit operation. Keep the
    // verified subject so later projection cannot reopen the whole category.
    const selected = fromIds(previousSelectedIds)
    query.operation = 'none'; query.scope = 'selected'; query.selector = null
    context.selected_ids = previousSelectedIds
    return { ...result(selected, 'remembered', false, selected.length !== previousSelectedIds.length),
      ...(selected.length !== previousSelectedIds.length ? { clarification:
        'La unidad elegida ya no aparece disponible. ¿Le gustaría revisar las opciones actuales?' } : {}) }
  }
  const followup = continuesInformation || semanticValid && ['comparison', 'followup'].includes(text(semantic.reference_kind))
  if (followup) {
    const focused=ids(context.focused_ids),offered=ids(context.offered_ids)
    const currentFocus=focused.length===1&&offered.includes(focused[0])?focused:[]
    const requested = ids(context.comparison_ids).length ? ids(context.comparison_ids) : ids(context.selected_ids).length?ids(context.selected_ids):currentFocus
    const matches = fromIds(requested)
    if (matches.length !== requested.length) return { ...result(matches, 'ambiguous', false, true),
      clarification: 'Una de las unidades que estábamos revisando ya no aparece en el catálogo disponible. ¿Le gustaría revisar las opciones que siguen disponibles?' }
    if (matches.length) {
      if(!ids(context.comparison_ids).length&&!ids(context.selected_ids).length&&currentFocus.length){
        query.operation='details';query.scope='offered';context.reference_resolution={source:'focused_information',status:'resolved',resolved_ids:unitIds(matches)}
      }
      return result(matches, matches.length > 1 ? 'comparison_followup' : 'remembered')
    }
    // Multiple offered options are not a comparison or an accepted selection.
    if (ids(context.offered_ids).length) return result(fromIds(context.offered_ids), 'ambiguous', false, true)
  }
  context.operation_resolution = { ...object(context.operation_resolution), applied: query.operation }
  return { ...base, reason: 'remembered', needsClarification: false, clarification: '', context, query }
}

/** Persist only after the reply was delivered. Offered, compared and chosen are different facts. */
export function rememberPropertyReply(catalog: Row[], contextRaw: unknown, reply: string, audit: Row): Row {
  const context: Row = { ...object(contextRaw), version: 2 }
  const informationQuery = object(context.information_query)
  const informational = Object.keys(informationQuery).length > 0
  const proposalInformation = object(context.proposal_information)
  const previousPending = object(context.pending_question)
  const informsProposal = proposalInformation.version === 'proposal-information-v1' && proposalInformation.active === true
    && proposalInformation.informational_only === true && proposalInformation.pending_question_id === previousPending.id
    && previousPending.act === 'explore_alternatives'
  if (['business_out_of_scope', 'vehicle_out_of_scope', 'scope_clarification'].includes(text(audit.source))) {
    // Clarifying a message or answering another subject suspends this turn's
    // catalogue references, not the client's decisions. The inbound resolver
    // already applies explicit changes/rejections; keep that resolved state so
    // a later operational follow-up cannot revive an older, superseded need.
    delete context.information_query
    delete context.proposal_information
    return { ...context, offered_ids: [], comparison_ids: [], focused_ids: [], pending_question: {},
      query: { ...object(context.query), operation: 'none', selector: null }, reference_resolution: {},
      operation_resolution: { source: text(audit.source), applied: 'none' }, last_reply: reply }
  }
  const explicitOffers = ids(audit.offered_unit_ids)
  const selected = ids(audit.selected_unit_ids)
  const compared = ids(audit.comparison_unit_ids)
  const focused = ids(audit.focused_unit_ids)
  const structured = Object.hasOwn(audit, 'pending_question') || [audit.offered_unit_ids, audit.selected_unit_ids, audit.comparison_unit_ids, audit.focused_unit_ids].some(Array.isArray)
  const allowed = new Set(unitIds(available(catalog)))
  const actual = structured ? [...new Set([...explicitOffers, ...selected, ...compared, ...focused])].filter(id => allowed.has(id)) : []
  if (actual.length) {
    // New suggestions supersede offered/comparison references. A bot proposal
    // cannot revoke a confirmed client choice; the inbound resolver owns that
    // transition and revalidates availability before an operational step.
    if (ids(context.comparison_ids).some(id => !actual.includes(id))) context.comparison_ids = []
    context.offered_ids = actual
  }
  if (explicitOffers.length) context.offered_ids = explicitOffers.filter(id => actual.includes(id))
  if (selected.length) { context.selected_ids = selected.filter(id => actual.includes(id)); context.comparison_ids = []; context.preference_transition = {} }
  if (compared.length) context.comparison_ids = compared.filter(id => actual.includes(id))
  if (Object.hasOwn(audit, 'pending_question')) context.pending_question = normalizedPendingQuestion(audit.pending_question, catalog)
  else if (!structured) {
    const pending = pendingQuestionFromReply(reply)
    context.pending_question = normalizedPendingQuestion({ ...pending, target_ids: unitIds(unitsInPropertyReply(catalog, text(pending.question))), candidate_ids: actual }, catalog)
  } else context.pending_question = {}
  context.focused_ids = focused.length ? focused.filter(id => allowed.has(id)) : ids(object(context.pending_question).target_ids)
  if (audit.catalog_query && !informsProposal && !informational) context.query = object(audit.catalog_query)
  if (audit.catalog_query && !informsProposal && !informational && (object(audit.catalog_retrieval).optimized === true || Object.hasOwn(context, 'optimized_catalog_request'))) context.optimized_catalog_request = object(audit.catalog_retrieval).optimized === true
    ? { category: object(audit.catalog_query).category, group: object(audit.catalog_query).group,
      requirements: object(object(audit.catalog_summary).request).requirements } : {}
  if (audit.original_query) context.original_query = normalizedPropertyQuery(audit.original_query)
  // Reply audit can contain the temporary price/details query. Delivery does
  // not turn that query into acceptance or select a proposed unit.
  if (informsProposal && object(context.pending_question).id === previousPending.id
    && object(context.pending_question).act === 'explore_alternatives') {
    context.query = object(proposalInformation.original_query)
    context.selected_ids = ids(object(contextRaw).selected_ids)
  } else if (informsProposal) delete context.proposal_information
  context.context_source = structured ? 'structured_reply' : 'legacy_reply'
  if (audit.alternative_phase) context.phase = audit.alternative_phase
  else if (audit.source === 'property_floor_options') context.phase = 'choose_unit'
  else if (selected.length) context.phase = 'review_unit'
  if (['unit_alternative', 'unit_alternative_journey'].includes(text(audit.source))) context.journey = 'residential_alternatives'
  if (['compare_categories', 'choose_category', 'choose_floor'].includes(text(context.phase)) && audit.alternative_phase) {
    if (object(context.preference_transition).active !== true) context.offered_ids = []
    context.comparison_ids = []
  }
  if (informational) {
    context.query = object(object(contextRaw).query)
    context.selected_ids = ids(object(contextRaw).selected_ids)
    delete context.information_query
  }
  return { ...context, last_reply: reply }
}

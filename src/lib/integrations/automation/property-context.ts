import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { informationSubject } from './information-context'
import { bedroomOptionsFromText } from './bedroom-options'
import { resolveCatalogReference } from './catalog-reference'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { answersPendingQuestion, emptyPropertyFilters, normalizedPendingQuestion, normalizedPropertyFilters, normalizedPropertyQuery, pendingQuestionFromReply, propertyFiltersFromText, propertyPreferenceChange } from './turn-semantics'

const available = (units: Row[]) => units.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
const unitIds = (units: Row[]) => units.map(unit => text(unit.id))
const memory = (units: Row[]) => ({ ids: unitIds(units), numbers: units.map(unit => unit.unit_number) })
const code = (value: unknown) => `${/^LC/i.test(text(value)) ? 'LC-' : ''}${Number(text(value).replace(/\D/g, ''))}`

/** Read actual delivered copy, not the model's summary, preserving the displayed order. */
export function unitsInPropertyReply(catalog: Row[], reply: string) {
  const value = normalized(reply).replace(/https?:\/\/\S+/g, '')
  const hits: { index: number; units: Row[] }[] = []
  const matches = [...value.matchAll(/\b(?:penthouse|departamento|apartamento|suite|unidad|local(?: comercial)?|lc-?)\s*(?:numero\s*)?(\d{1,4})\b/g)]
  if (/departamentos?|suites?|penthouses?|unidades?|locales?/.test(value)) {
    matches.push(...value.matchAll(/\b(?:el|del|la|y|con|entre)\s+(?:(?:el|la)\s+)?(\d{3,4})\b|\((\d{3,4})\)/g))
  }
  for (const match of matches) {
    const number = match[1] || match[2]
    const isLocal = /^(?:lc|local)/.test(match[0])
    const units = available(catalog).filter(unit => Number(text(unit.unit_number).replace(/\D/g, '')) === Number(number)
      && (isLocal ? unit.category === 'local' : !/^LC/i.test(text(unit.unit_number))))
    if (units.length === 1) hits.push({ index: match.index || 0, units })
  }
  return [...new Map(hits.sort((a, b) => a.index - b.index).flatMap(hit => hit.units).map(unit => [text(unit.id), unit])).values()]
}

function lastBot(history: unknown) {
  return text((Array.isArray(history) ? history : []).map(object).filter(row => ['bot', 'asesor'].includes(text(row.role))).at(-1)?.content)
}

export function propertyContext(catalog: Row[], previous: unknown, history: unknown): Row {
  const saved = object(previous)
  const reply = lastBot(history)
  const current: Row = { ...saved, version: 2, offered_ids: ids(saved.offered_ids), comparison_ids: ids(saved.comparison_ids), selected_ids: ids(saved.selected_ids), focused_ids: ids(saved.focused_ids),
    pending_question: normalizedPendingQuestion(saved.pending_question), query: object(saved.query) }
  // Legacy transcripts and an externally sent advisor message may differ from saved state.
  if (reply && reply !== saved.last_reply) {
    const mentioned = unitsInPropertyReply(catalog, reply)
    const m = normalized(reply)
    if (mentioned.length) {
      current.offered_ids = unitIds(mentioned)
      current.comparison_ids = mentioned.length > 1 && /diferencia|compar|ambos|ambas|mismo precio/.test(m) ? unitIds(mentioned) : []
      current.selected_ids = [] // Showing one unit is not evidence of client selection.
    } else if (/no (?:gestionamos|vendemos)|que tipo de espacio|departamentos.*penthouses|penthouses.*departamentos/.test(m)) {
      current.offered_ids = []; current.comparison_ids = []; current.selected_ids = []; current.phase = null
    }
    const pending = pendingQuestionFromReply(reply)
    const targets = unitsInPropertyReply(catalog, text(pending.question))
    current.pending_question = normalizedPendingQuestion({ ...pending, target_ids: unitIds(targets), candidate_ids: unitIds(mentioned) }, catalog)
    current.focused_ids = targets.length === 1 ? unitIds(targets) : []
    current.context_source = 'legacy_reply'
    current.last_reply = reply
  }
  return current
}

function relativeSelector(current: string) {
  const value = normalized(current)
  if (/\b(?:mas grande|mas amplio|mayor (?:area|superficie|tamano))\b/.test(value)) return 'largest'
  if (/\b(?:mas pequen[oa]|menor (?:area|superficie|tamano))\b/.test(value)) return 'smallest'
  if (/\b(?:mas barat[oa]|mas economic[oa]|menor precio)\b/.test(value)) return 'cheapest'
  if (/\b(?:mas car[oa]|mayor precio)\b/.test(value)) return 'most_expensive'
  if (/\b(?:el primero|la primera)\b/.test(value)) return 'first'
  if (/\b(?:el ultimo|la ultima)\b/.test(value)) return 'last'
  return ''
}

export function resolvePropertyTurn(catalogRaw: Row[], current: string, summaryRaw: unknown, history: unknown, semantics: unknown) {
  const catalog = available(catalogRaw), summary = object(summaryRaw), semantic = object(object(semantics).property)
  const context = propertyContext(catalog, summary._property_context, history)
  context.reference_resolution = {}
  const base = resolveCatalogReference(catalog, current, summary._unit_reference, history)
  const m = normalized(current)
  const pending = normalizedPendingQuestion(Object.keys(object(summary._pending_question)).length ? summary._pending_question : context.pending_question)
  const acceptsDetails = pending.act === 'show_unit_details'
    && /^(?:si\s+)?(?:por favor\s+)?(?:envieme|mandeme|compartame|muestreme)\s+(?:los\s+)?detalles(?:\s+por favor)?$/.test(m)
  const positive = acceptsDetails || /^(?:si(?: claro| por favor| esta bien| me parece bien)?|claro|de acuerdo|esta bien|me parece bien|perfecto|revisemos|veamos|si (?:prefiero|quiero|me interesa) (?:esa|esta) opcion|(?:prefiero|quiero|me interesa) (?:esa|esta) opcion)(?: gracias)?$/.test(m.replace(/[.!¡,]/g, '').trim())
  const confirmsSet = positive && ['choose_category', 'explore_alternatives'].includes(text(pending.act))
  const semanticValid = semantic.confidence === 'high'
  const semanticOperation = semanticValid && ['search', 'rank', 'compare', 'select', 'details'].includes(text(semantic.operation)) ? text(semantic.operation) : ''
  const category = semanticValid && !confirmsSet ? text(semantic.category) : ''
  const excluded = semanticValid && !confirmsSet ? ids(semantic.excluded_categories) : []
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
  // Compatibility for the former no-match offer, which recorded its verified
  // alternatives but mislabeled its yes/no question as a category choice.
  if (positive && pending.act === 'choose_category' && normalized(text(pending.question)) === 'le gustaria revisar las alternativas disponibles') {
    const oldFilters = normalizedPropertyFilters(previousQuery.filters)
    const candidateIds = ids(pending.candidate_ids), alternatives = fromIds(candidateIds)
    const roomCounts = [...new Set(alternatives.map(unit => Number(unit.bedrooms)))]
    const originalHasMatch = catalog.some(unit => (!previousQuery.category || unit.category === previousQuery.category)
      && (previousQuery.group !== 'residential' || ['suite', 'departamento', 'penthouse'].includes(text(unit.category)))
      && (oldFilters.bedrooms === null || Number(unit.bedrooms) === oldFilters.bedrooms)
      && (oldFilters.floor_number === null || Number(unit.floor_number) === oldFilters.floor_number)
      && (oldFilters.min_area_m2 === null || Number(unit.area_internal_m2) >= oldFilters.min_area_m2)
      && (oldFilters.max_area_m2 === null || Number(unit.area_internal_m2) > 0 && Number(unit.area_internal_m2) <= oldFilters.max_area_m2))
    if (oldFilters.bedrooms !== null && oldFilters.bedrooms_required !== true && !originalHasMatch
      && alternatives.length === candidateIds.length && alternatives.length > 0
      && alternatives.every(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category)))
      && roomCounts.length === 1 && roomCounts[0] > 0 && roomCounts[0] !== oldFilters.bedrooms) {
      pending.act = 'explore_alternatives'
      pending.proposed_query = normalizedPropertyQuery({ group: 'residential',
        category: alternatives.every(unit => unit.category === alternatives[0].category) ? alternatives[0].category : null,
        operation: 'search', scope: 'catalog', filters: { bedrooms: roomCounts[0] } })
      context.pending_question = pending
    }
  }
  const lexicalFilters = propertyFiltersFromText(current, text(pending.id))
  const bedroomChoices = bedroomOptionsFromText(current)
  if (bedroomChoices.length > 1) { lexicalFilters.bedrooms = null; lexicalFilters.bedrooms_any = bedroomChoices }
  const currentFilters = normalizedPropertyFilters(semantic.filters)
  if (currentFilters.bedrooms_required === true && lexicalFilters.bedrooms_required !== true && !text(object(semantic.filter_evidence).bedrooms_required)) currentFilters.bedrooms_required = null
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
    if (value === null || object(lexicalFilters)[key] != null || text(object(semantic.filter_evidence)[key])) continue
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
  const ignoredLexicalFilters: Row = {}
  for (const [key, value] of Object.entries(lexicalFilters)) {
    if (value === null) continue
    if (semanticValid && text(object(semantic.filter_evidence)[key]) && object(currentFilters)[key] != null) {
      if (JSON.stringify(object(currentFilters)[key]) !== JSON.stringify(value)) ignoredLexicalFilters[key] = value
    } else Object.assign(suppliedFilters, { [key]: value })
  }
  const hasCurrentFilters = Object.entries(suppliedFilters).some(([key, value]) => key !== 'bedrooms_required' && value !== null && (!Array.isArray(value) || value.length > 0))
  context.filter_resolution = { current: suppliedFilters, inherited: inheritedFilters, evidence: object(semantic.filter_evidence),
    ignored_lexical_filters: ignoredLexicalFilters }
  const group = confirmsSet ? text(previousQuery.group) : text(semantic.group) || (category === 'local' ? 'commercial' : category ? 'residential' : '')
  const broadResidential = group === 'residential' && !category && /\bviviendas?|residencial|(?:algo|opciones?|espacio) para vivir\b/.test(m)
  const previousCategory = text(previousQuery.category || context.preference_category)
  const previousGroup = text(previousQuery.group) || (previousCategory === 'local' ? 'commercial' : previousCategory ? 'residential' : '')
  const groupChanged = !!group && !!previousGroup && group !== previousGroup
  // Choosing apartments within residential options refines the same search.
  // Only a change of use (housing/local) invalidates its previous constraints.
  const filters = { ...(groupChanged ? emptyPropertyFilters() : normalizedPropertyFilters(previousQuery.filters)),
    ...Object.fromEntries(Object.entries(suppliedFilters).filter(([, value]) => value !== null)) }
  if (suppliedFilters.bedrooms_any?.length && (lexicalFilters.bedrooms === null || suppliedFilters.bedrooms_any.includes(lexicalFilters.bedrooms))) { filters.bedrooms = null; filters.bedrooms_any = suppliedFilters.bedrooms_any }
  else if (suppliedFilters.bedrooms != null) delete filters.bedrooms_any
  const asksRanking = /\b(?:cual|cuales|que|cuanto)\b.*\b(?:mas grande|mas amplio|mayor|mas pequen|mas barat|mas economic|menor)/.test(m)
  const selector = semanticValid ? semantic.reference_kind === 'relative' || semantic.operation === 'rank' ? text(semantic.selector) || relativeSelector(current) : '' : relativeSelector(current)
  const inheritedBedrooms = normalizedPropertyFilters(previousQuery.filters)
  const expandsUnavailableSearch = broadResidential && selector === 'largest'
    && lexicalFilters.bedrooms === null && currentFilters.bedrooms === null
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
  context.operation_resolution = { source: semanticOperation ? 'extractor' : 'lexical_fallback', extracted: semanticOperation || null,
    ignored_keyword_operations: semanticOperation && asksRanking && semanticOperation !== 'rank' ? ['rank'] : [] }
  const query: Row = { group: group || text(previousQuery.group) || null,
    category: broadResidential ? null : category || text(previousQuery.category || context.preference_category) || null,
    filters, operation, selector: selector || null,
    scope: continuesInformation ? ids(context.selected_ids).length ? 'selected' : ids(context.comparison_ids).length ? 'comparison' : 'offered'
      : text(semantic.query_scope) || (operation === 'search' || operation === 'rank' ? 'catalog' : null) }
  // Once a verified alternative set is offered, choosing its category or floor
  // refines that set rather than restoring the entire category from the catalogue.
  if (activePreferenceTransition && previousQuery.scope === 'offered' && !groupChanged
    && (category || lexicalFilters.floor_number !== null) && ids(context.offered_ids).length) query.scope = 'offered'
  context.query = query
  if (groupChanged) context.original_query = {}
  if (broadResidential) { context.preference_category = null; context.excluded_categories = []; context.selected_ids = []; context.comparison_ids = [] }
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
  // Asking to explore after an unavailable bedroom count authorizes a separate
  // alternative query; it does not erase the client's original requirement.
  const oldFilters = normalizedPropertyFilters(previousQuery.filters)
  const asksAlternatives = /^(?:bueno |entonces |y |ok )*(?:que (?:otras )?(?:opciones|alternativas) (?:tiene|tienen|hay)|(?:muestreme|veamos|revisemos) (?:las |otras )?(?:opciones|alternativas))$/.test(m)
  const originalBedrooms = oldFilters.bedrooms
  const residentialQuery = previousQuery.group === 'residential' || query.group === 'residential'
  const alternatives = catalog.filter(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))
    && (!query.category || unit.category === query.category)
    && !ids(context.excluded_categories).includes(text(unit.category)) && !excluded.includes(text(unit.category))
    && (oldFilters.floor_number === null || Number(unit.floor_number) === oldFilters.floor_number)
    && (oldFilters.min_area_m2 === null || Number(unit.area_internal_m2) >= oldFilters.min_area_m2)
    && (oldFilters.max_area_m2 === null || Number(unit.area_internal_m2) <= oldFilters.max_area_m2))
  if ((!semanticOperation || semanticOperation === 'search') && asksAlternatives && residentialQuery && originalBedrooms !== null && lexicalFilters.bedrooms === null
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
    context.excluded_categories = excluded
  }
  // Semantic explicit codes must actually occur in this message; history cannot fabricate them.
  const semanticNumbers = semanticValid ? ids(semantic.unit_numbers) : []
  const semanticExplicit = semanticValid && ['explicit', 'comparison'].includes(text(semantic.reference_kind))
  const literalNumbers = [...current.matchAll(/(?:^|[^\d])((?:LC-?)?\d{1,4})(?=[^\d]|$)/gi)].map(match => code(match[1]))
  const literalUnits = catalog.filter(unit => semanticNumbers.some(number => code(number) === code(unit.unit_number))
    && literalNumbers.includes(code(unit.unit_number)))
  const currentUnitMention = literalUnits.length > 0 || ids(object(base).requestedCodes).some(number => literalNumbers.includes(code(number)))
    || semanticExplicit && semanticNumbers.some(number => literalNumbers.includes(code(number)))
  if ((base.hasUnitMention || semanticExplicit && semanticNumbers.length > 0) && currentUnitMention) {
    // Clients say "departamento 602" for a penthouse or "departamento 210" for a suite.
    // A known explicit residential number is more precise than that category label.
    let matches = base.matches.filter(unit => !excluded.includes(text(unit.category)))
    if (literalUnits.length && semanticExplicit) matches = [...new Map([...literalUnits, ...base.matches.filter(unit =>
      ids(object(base).requestedCodes).some(number => code(number) === code(unit.unit_number)) && literalNumbers.includes(code(unit.unit_number)))]
      .filter(unit => !excluded.includes(text(unit.category))).map(unit => [unit.id, unit])).values()]
    const rejected = matches.filter(unit => {
      const number = Number(text(unit.unit_number).replace(/\D/g, ''))
      const before = new RegExp(`\\b(?:no(?: (?:quiero|prefiero|elijo|escojo|me interesa))?|descarto|rechazo)\\s+(?:(?:el|la|departamento|suite|penthouse|local|unidad)\\s+)*0*${number}\\b`)
      const after = new RegExp(`\\b0*${number}\\s+(?:ya\\s+)?(?:no me (?:interesa|sirve|conviene)|lo descarto|la descarto)\\b`)
      return before.test(m) || after.test(m)
    })
    matches = matches.filter(unit => !rejected.includes(unit))
    if (rejected.length && !matches.length) {
      context.selected_ids = []; context.comparison_ids = []; context.offered_ids = []
      return result([], 'unit_rejected')
    }
    // Invalid explicit codes must never fall back to an older, valid selection.
    const requestedCodes = ids(object(base).requestedCodes)
    const incomplete = !matches.length || (semanticNumbers.length > 0 && literalUnits.length !== semanticNumbers.length)
      || (!semanticExplicit && requestedCodes.some(number => !catalog.some(unit => Number(text(unit.unit_number).replace(/\D/g, '')) === Number(number))))
    query.operation = semanticOperation || (matches.length > 1 ? 'compare' : 'select')
    if (['search', 'rank'].includes(text(query.operation))) query.scope = 'offered'
    query.selector = query.operation === 'rank' ? selector || null : null
    if (['search', 'rank'].includes(text(query.operation))) query.filters = normalizedPropertyFilters(suppliedFilters)
    context.pending_question = {}
    context.focused_ids = matches.length === 1 && !incomplete ? unitIds(matches) : []
    context.comparison_ids = matches.length > 1 ? unitIds(matches) : []
    context.selected_ids = matches.length === 1 && !incomplete && query.operation === 'select' ? unitIds(matches) : []
    if (matches.length === 1 && !incomplete) context.preference_transition = {}
    context.offered_ids = matches.length && !incomplete ? unitIds(matches) : []
    return result(matches, incomplete ? 'ambiguous' : pending.act === 'choose_unit' && matches.length === 1 && !/precio|cuesta|cuanto|compar|\bno\b/.test(m) ? 'explicit_pending_choice' : literalUnits.length ? 'semantic_explicit' : 'explicit', !incomplete, incomplete)
  }
  const baselineUnits = fromIds(previousSelectedIds.length ? previousSelectedIds : context.offered_ids)
  const baselineCounts = [...new Set(baselineUnits.map(unit => Number(unit.bedrooms)).filter(count => count > 0))]
  const baselineFilters = normalizedPropertyFilters(previousQuery.filters)
  const baselineBedrooms = baselineFilters.bedrooms ?? (baselineFilters.bedrooms_any?.length ? Math.min(...baselineFilters.bedrooms_any)
    : baselineCounts.length === 1 ? baselineCounts[0] : null)
  const preference = propertyPreferenceChange(current, { ...previousQuery, filters: { ...baselineFilters, bedrooms: baselineBedrooms } })
  // Answering the bedroom clarification refines the requested cheaper search;
  // changing its count does not cancel the still-active price requirement.
  if (pending.id === 'property_bedrooms' && activePreferenceTransition && object(context.preference_transition).kind === 'cheaper'
    && (pending.act !== 'confirm_bedrooms' || lexicalFilters.bedrooms !== normalizedPropertyFilters(object(pending.proposed_query).filters).bedrooms)
    && lexicalFilters.bedrooms !== null && !/\bno\s+(?:quiero|necesito|me interesan?)\b/.test(m)) {
    Object.assign(preference, { kind: 'cheaper', bedrooms: lexicalFilters.bedrooms,
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
    const explicitCategory = category && new RegExp(`\\b${category === 'departamento' ? '(?:departamentos?|apartamentos?)' : `${category}s?`}\\b`).test(m) ? category : null
    const proposedFilters = normalizedPropertyFilters({ ...baselineFilters, ...Object.fromEntries(Object.entries(lexicalFilters).filter(([, value]) => value !== null)),
      bedrooms: preference.bedrooms, bedrooms_any: [], bedrooms_required: lexicalFilters.bedrooms_required })
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
  const asksComparison = semanticOperation ? semanticOperation === 'compare'
    : /\b(?:diferencias?|comparar|compare|comparacion)\b/.test(m)
      && !/\b(?:no (?:quiero|deseo|necesito)|sin)\b[^.!?]{0,30}\bcompar|\bno me importan?\b[^.!?]{0,20}\bdiferencias?/.test(m)
  const continuesSet = asksComparison || contextualOperation && ['details', 'rank'].includes(operation)
  if (continuesSet && referenceTargets.length && (['comparison', 'offered', 'selected'].includes(text(query.scope))
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
  // A literal answer to the offered choice outranks an inconsistent AI search.
  // Do not promote mentions in comparisons, prices, refusals or mixed requests.
  const choice = m.match(/^(?:(?:perfecto|entonces|bien)\s+)*(?:revisemos|veamos|quiero ver|quiero conocer|elijo|escojo|prefiero)\s+(?:(?:el|la|opcion|departamento|suite|penthouse|unidad)\s+)*(\d{3,4})(?:\s+(?:entonces|entocnes|por favor))?$/)
    || (pending.act === 'choose_unit' ? m.match(/^(?:(?:el|la|opcion|departamento|suite|penthouse|unidad)\s+)*(\d{3,4})(?:\s+por favor)?$/) : null)
  const chosen = choice && pending.act === 'choose_unit'
    ? fromIds(pending.candidate_ids).filter(unit => code(unit.unit_number) === code(choice[1]) && !excluded.includes(text(unit.category))) : []
  if (chosen.length === 1 && (!semanticOperation || semanticOperation === 'select' || semanticOperation === 'details')) {
    context.selected_ids = unitIds(chosen); context.focused_ids = unitIds(chosen); context.comparison_ids = []
    context.preference_transition = {}
    query.operation = semanticOperation || 'select'; query.selector = null
    return result(chosen, 'explicit_pending_choice', true)
  }
  // A reply to a durable, focused question names its subject without requiring
  // the customer to repeat a code. Accepting details never books a visit or purchase.
  const acceptsPending = positive || answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative')
  if (pending.act === 'confirm_bedrooms' && lexicalFilters.bedrooms === null
    && (/^(?:no|no gracias|no necesariamente|no importa)$/.test(m) || answersPendingQuestion(semantics, 'property_bedrooms', 'negative'))) {
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
  const proposal = normalizedPropertyQuery(pending.proposed_query)
  const acceptedAlternative = ['explore_alternatives', 'confirm_bedrooms'].includes(text(pending.act))
    && (acceptsPending || pending.act === 'explore_alternatives' && !!category
      || pending.act === 'confirm_bedrooms' && lexicalFilters.bedrooms !== null && !/\bno\s+(?:quiero|necesito|me interesan?)\b/.test(m))
    && (pending.act === 'confirm_bedrooms' || normalizedPropertyFilters(previousQuery.filters).bedrooms_required !== true)
    && Object.keys(proposal).length > 0
  if (acceptedAlternative) {
    // Exploring a relaxed query is not a new declaration of the original need,
    // and accepting a set never selects one of its units.
    if (!Object.keys(object(context.original_query)).length) context.original_query = normalizedPropertyQuery(previousQuery)
    const proposedFilters = normalizedPropertyFilters(proposal.filters)
    Object.assign(query, { ...proposal, category: category || proposal.category,
      filters: { ...proposedFilters, ...Object.fromEntries(Object.entries(lexicalFilters).filter(([, value]) => value !== null)) },
      operation: 'search', selector: null })
    operation = 'search'
    delete filters.bedrooms_any
    Object.assign(filters, query.filters)
    context.offered_ids = ids(pending.candidate_ids)
    context.selected_ids = activePreferenceTransition ? previousSelectedIds : []; context.comparison_ids = []; context.focused_ids = []
    context.pending_question = {}
    context.phase = 'exploring_alternatives'
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
  // Search/ranking returns facts, not a selected unit. Ties are valid answers.
  // Resolve filters before unit-code guards, so "5ta planta" never becomes unit 5.
  if (['search', 'rank'].includes(operation) && (hasCurrentFilters || broadResidential || operation === 'rank' || acceptedAlternative)) {
    const scopeIds = query.scope === 'offered' ? ids(context.offered_ids) : query.scope === 'comparison' ? ids(context.comparison_ids)
      : query.scope === 'selected' ? ids(context.selected_ids) : []
    const source = scopeIds.length ? fromIds(scopeIds) : catalog
    const candidates = source.filter(unit => (!query.category || unit.category === query.category)
      && (query.group !== 'residential' || ['suite', 'departamento', 'penthouse'].includes(text(unit.category)))
      && (query.group !== 'commercial' || unit.category === 'local') && !excluded.includes(text(unit.category))
      && (filters.floor_number === null || Number(unit.floor_number) === filters.floor_number)
      && (Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length ? filters.bedrooms_any.includes(Number(unit.bedrooms)) : filters.bedrooms === null || Number(unit.bedrooms) === filters.bedrooms)
      && (filters.min_area_m2 === null || Number(unit.area_internal_m2) >= filters.min_area_m2)
      && (filters.max_area_m2 === null || Number(unit.area_internal_m2) > 0 && Number(unit.area_internal_m2) <= filters.max_area_m2))
    context.selected_ids = activePreferenceTransition ? previousSelectedIds : []; context.comparison_ids = []
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
  const declinedSelector = /\b(?:no (?:quiero|prefiero|elijo|escojo|me interesa)|descarto)\b[^.!?]{0,35}\b(?:mas (?:grande|amplio|pequeno|barato|caro)|primero|ultimo)\b/.test(m)
  if (selector && declinedSelector) return result([], 'ambiguous', false, true)
  if (selector) {
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
    return result([], 'category_change')
  }
  const followup = continuesInformation || (semanticValid && ['comparison', 'followup'].includes(text(semantic.reference_kind)))
    || !semanticOperation && /^(?:y\s+)?(?:en\s+)?(?:el\s+)?(?:precio|valor)\b|\b(?:y (?:el|en) precio|que (?:precio|valor)|cuanto (?:cuesta|vale|cuestan|valen)|diferencia|ambos|ambas|entre ellos)\b/.test(m)
  if (followup && (semanticOperation || !/\b(?:edificio|proyecto|sector|alimentos|papas|vehiculos?|motos?)\b/.test(m))) {
    const requested = ids(context.comparison_ids).length ? ids(context.comparison_ids) : ids(context.selected_ids)
    const matches = fromIds(requested)
    if (matches.length !== requested.length) return { ...result(matches, 'ambiguous', false, true),
      clarification: 'Una de las unidades que estábamos revisando ya no aparece en el catálogo disponible. ¿Le gustaría revisar las opciones que siguen disponibles?' }
    if (matches.length) return result(matches, matches.length > 1 ? 'comparison_followup' : 'remembered')
    // Multiple offered options are not a comparison or an accepted selection.
    if (ids(context.offered_ids).length) return result(fromIds(context.offered_ids), 'ambiguous', false, true)
  }
  context.operation_resolution = { ...object(context.operation_resolution), applied: query.operation }
  return { ...base, reason: 'remembered', needsClarification: false, clarification: '', context, query }
}

/** Persist only after the reply was delivered. Offered, compared and chosen are different facts. */
export function rememberPropertyReply(catalog: Row[], contextRaw: unknown, reply: string, audit: Row): Row {
  const context: Row = { ...object(contextRaw), version: 2 }
  if (['business_out_of_scope', 'vehicle_out_of_scope', 'scope_clarification'].includes(text(audit.source))) {
    return { version: 2, preference_category: context.preference_category || null, offered_ids: [], comparison_ids: [], selected_ids: [], focused_ids: [], pending_question: {}, query: {}, phase: null, last_reply: reply }
  }
  const explicitOffers = ids(audit.offered_unit_ids)
  const selected = ids(audit.selected_unit_ids)
  const compared = ids(audit.comparison_unit_ids)
  const focused = ids(audit.focused_unit_ids)
  const structured = Object.hasOwn(audit, 'pending_question') || [audit.offered_unit_ids, audit.selected_unit_ids, audit.comparison_unit_ids, audit.focused_unit_ids].some(Array.isArray)
  const allowed = new Set(unitIds(available(catalog)))
  const actual = structured ? [...new Set([...explicitOffers, ...selected, ...compared, ...focused])].filter(id => allowed.has(id)) : unitIds(unitsInPropertyReply(catalog, reply))
  if (actual.length) {
    // New suggestions supersede old references; a quote about the same chosen
    // unit/pair keeps it, while a different delivered set cannot retain stale IDs.
    if (ids(context.comparison_ids).some(id => !actual.includes(id))) context.comparison_ids = []
    if (object(context.preference_transition).active !== true && ids(context.selected_ids).some(id => !actual.includes(id))) context.selected_ids = []
    context.offered_ids = actual
  }
  if (explicitOffers.length) context.offered_ids = explicitOffers.filter(id => actual.includes(id))
  if (selected.length) { context.selected_ids = selected.filter(id => actual.includes(id)); context.comparison_ids = []; context.preference_transition = {} }
  if (compared.length) context.comparison_ids = compared.filter(id => actual.includes(id))
  if (!structured && actual.length > 1 && /compar|diferencia|ambos|ambas/.test(normalized(reply))) context.comparison_ids = actual
  if (Object.hasOwn(audit, 'pending_question')) context.pending_question = normalizedPendingQuestion(audit.pending_question, catalog)
  else if (!structured) {
    const pending = pendingQuestionFromReply(reply)
    context.pending_question = normalizedPendingQuestion({ ...pending, target_ids: unitIds(unitsInPropertyReply(catalog, text(pending.question))), candidate_ids: actual }, catalog)
  } else context.pending_question = {}
  context.focused_ids = focused.length ? focused.filter(id => allowed.has(id)) : ids(object(context.pending_question).target_ids)
  if (audit.catalog_query) context.query = object(audit.catalog_query)
  if (audit.original_query) context.original_query = normalizedPropertyQuery(audit.original_query)
  context.context_source = structured ? 'structured_reply' : 'legacy_reply'
  if (audit.alternative_phase) context.phase = audit.alternative_phase
  else if (audit.source === 'property_floor_options') context.phase = 'choose_unit'
  else if (selected.length) context.phase = 'review_unit'
  if (['unit_alternative', 'unit_alternative_journey'].includes(text(audit.source))) context.journey = 'residential_alternatives'
  if (['compare_categories', 'choose_category', 'choose_floor'].includes(text(context.phase)) && audit.alternative_phase) {
    if (object(context.preference_transition).active !== true) { context.offered_ids = []; context.selected_ids = [] }
    context.comparison_ids = []
  }
  return { ...context, last_reply: reply }
}

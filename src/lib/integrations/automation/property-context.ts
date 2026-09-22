import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { resolveCatalogReference } from './catalog-reference'
import { answersPendingQuestion, emptyPropertyFilters, normalizedPendingQuestion, normalizedPropertyFilters, normalizedPropertyQuery, pendingQuestionFromReply, propertyFiltersFromText } from './turn-semantics'

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
  const base = resolveCatalogReference(catalog, current, summary._unit_reference, history)
  const m = normalized(current)
  const pending = normalizedPendingQuestion(Object.keys(object(summary._pending_question)).length ? summary._pending_question : context.pending_question)
  const positive = /^(?:si(?: por favor| esta bien| me parece bien)?|claro|de acuerdo|esta bien|me parece bien|perfecto|revisemos|veamos|si (?:prefiero|quiero|me interesa) (?:esa|esta) opcion|(?:prefiero|quiero|me interesa) (?:esa|esta) opcion)(?: gracias)?$/.test(m.replace(/[.!¡,]/g, '').trim())
  const confirmsSet = positive && ['choose_category', 'explore_alternatives'].includes(text(pending.act))
  const semanticValid = semantic.confidence === 'high'
  const category = semanticValid && !confirmsSet ? text(semantic.category) : ''
  const excluded = semanticValid && !confirmsSet ? ids(semantic.excluded_categories) : []
  const eligible = (units: Row[]) => units.filter(unit => (!category || unit.category === category) && !excluded.includes(text(unit.category)))
  const fromIds = (value: unknown) => ids(value).flatMap(id => catalog.filter(unit => text(unit.id) === id))
  const previousQuery = object(context.query)
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
  const currentFilters = normalizedPropertyFilters(semantic.filters)
  const suppliedFilters = Object.fromEntries(Object.entries(lexicalFilters).map(([key, value]) => [key, value ?? currentFilters[key as keyof typeof currentFilters]]))
  const hasCurrentFilters = Object.values(suppliedFilters).some(value => value !== null)
  const group = confirmsSet ? text(previousQuery.group) : text(semantic.group) || (category === 'local' ? 'commercial' : category ? 'residential' : '')
  const broadResidential = group === 'residential' && !category && /\bviviendas?|residencial|(?:algo|opciones?|espacio) para vivir\b/.test(m)
  const previousCategory = text(previousQuery.category || context.preference_category)
  const previousGroup = text(previousQuery.group) || (previousCategory === 'local' ? 'commercial' : previousCategory ? 'residential' : '')
  const groupChanged = !!group && !!previousGroup && group !== previousGroup
  // Choosing apartments within residential options refines the same search.
  // Only a change of use (housing/local) invalidates its previous constraints.
  const filters = { ...(groupChanged ? emptyPropertyFilters() : normalizedPropertyFilters(previousQuery.filters)),
    ...Object.fromEntries(Object.entries(suppliedFilters).filter(([, value]) => value !== null)) }
  const asksRanking = /\b(?:cual|cuales|que|cuanto)\b.*\b(?:mas grande|mas amplio|mayor|mas pequen|mas barat|mas economic|menor)/.test(m)
  const selector = semanticValid ? semantic.reference_kind === 'relative' || semantic.operation === 'rank' ? text(semantic.selector) || relativeSelector(current) : '' : relativeSelector(current)
  let operation = asksRanking ? 'rank' : broadResidential || hasCurrentFilters && !['compare', 'details'].includes(text(semantic.operation)) ? 'search' : text(semantic.operation) || 'none'
  const query: Row = { group: group || text(previousQuery.group) || null,
    category: broadResidential ? null : category || text(previousQuery.category || context.preference_category) || null,
    filters, operation, selector: selector || null,
    scope: text(semantic.query_scope) || (operation === 'search' || operation === 'rank' ? 'catalog' : null) }
  context.query = query
  if (groupChanged) context.original_query = {}
  if (broadResidential) { context.preference_category = null; context.excluded_categories = []; context.selected_ids = []; context.comparison_ids = [] }
  const result = (matches: Row[], reason: string, explicit = false, needsClarification = false) => {
    if (matches.length && explicit && !needsClarification && ['select', 'details', 'compare'].includes(text(query.operation))) {
      // Looking up the identified subject must not reapply constraints from an
      // older search (e.g. apartment/floor 2 before the offered penthouse 602).
      query.category = matches.every(unit => unit.category === matches[0].category) ? matches[0].category : null
      query.group = matches.every(unit => unit.category === 'local') ? 'commercial'
        : matches.every(unit => ['suite', 'departamento', 'penthouse'].includes(text(unit.category))) ? 'residential' : null
      query.filters = emptyPropertyFilters(); query.scope = query.operation === 'compare' ? 'comparison' : 'selected'
    }
    return {
    ...base, matches, explicit, reason, needsClarification, query,
    memory: memory(matches), context,
    clarification: needsClarification ? (matches.length > 1
      ? `Entre las opciones que revisamos hay varias que encajan: ${matches.map(unit => `${text(unit.category)} ${text(unit.unit_number)}`).join(', ')}. ¿Cuál de estas opciones le gustaría conocer?`
      : 'Para orientarle con la opción correcta, ¿puede indicarme el número de la unidad que le interesa?') : '',
    }
  }
  if (category) {
    context.preference_category = category
    context.excluded_categories = excluded
  }
  // A reply to a durable, focused question names its subject without requiring
  // the customer to repeat a code. Accepting details never books a visit or purchase.
  const acceptsPending = positive || answersPendingQuestion(semantics, pending.id as Parameters<typeof answersPendingQuestion>[1], 'affirmative')
  const proposal = normalizedPropertyQuery(pending.proposed_query)
  const acceptedAlternative = pending.act === 'explore_alternatives' && acceptsPending && Object.keys(proposal).length > 0
  if (acceptedAlternative) {
    // Exploring a relaxed query is not a new declaration of the original need,
    // and accepting a set never selects one of its units.
    if (!Object.keys(object(context.original_query)).length) context.original_query = normalizedPropertyQuery(previousQuery)
    const proposedFilters = normalizedPropertyFilters(proposal.filters)
    Object.assign(query, { ...proposal, category: category || proposal.category,
      filters: { ...proposedFilters, ...Object.fromEntries(Object.entries(lexicalFilters).filter(([, value]) => value !== null)) },
      operation: 'search', selector: null })
    operation = 'search'
    Object.assign(filters, query.filters)
    context.offered_ids = ids(pending.candidate_ids)
    context.selected_ids = []; context.comparison_ids = []; context.focused_ids = []
    context.pending_question = {}
  } else if (pending.act === 'choose_category' && acceptsPending && !category) {
    query.operation = operation = 'search'
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
      && (filters.bedrooms === null || Number(unit.bedrooms) === filters.bedrooms)
      && (filters.min_area_m2 === null || Number(unit.area_internal_m2) >= filters.min_area_m2)
      && (filters.max_area_m2 === null || Number(unit.area_internal_m2) > 0 && Number(unit.area_internal_m2) <= filters.max_area_m2))
    context.selected_ids = []; context.comparison_ids = []
    if (operation === 'rank' && ['largest', 'smallest'].includes(selector)) {
      if (!candidates.length) return result([], 'catalog_no_match')
      if (candidates.some(unit => !(Number(unit.area_internal_m2) > 0))) return result(candidates, 'ranking_missing_area')
      const target = (selector === 'largest' ? Math.max : Math.min)(...candidates.map(unit => Number(unit.area_internal_m2)))
      const ranked = candidates.filter(unit => Number(unit.area_internal_m2) === target)
      return result(ranked, ranked.length > 1 ? 'ranking_tie' : 'catalog_rank')
    }
    return result(candidates, candidates.length ? acceptedAlternative ? 'accepted_alternative_query' : 'catalog_search' : 'catalog_no_match')
  }
  // Semantic explicit codes must actually occur in this message; history cannot fabricate them.
  const semanticNumbers = semanticValid ? ids(semantic.unit_numbers) : []
  const semanticExplicit = semanticValid && ['explicit', 'comparison'].includes(text(semantic.reference_kind))
  const literalNumbers = [...current.matchAll(/(?:^|[^\d])((?:LC-?)?\d{1,4})(?=[^\d]|$)/gi)].map(match => code(match[1]))
  const literalUnits = catalog.filter(unit => semanticNumbers.some(number => code(number) === code(unit.unit_number))
    && literalNumbers.includes(code(unit.unit_number)))
  if (base.hasUnitMention || semanticExplicit && semanticNumbers.length > 0) {
    // Clients say "departamento 602" for a penthouse or "departamento 210" for a suite.
    // A known explicit residential number is more precise than that category label.
    let matches = base.matches.filter(unit => !excluded.includes(text(unit.category)))
    if (literalUnits.length && semanticExplicit) matches = literalUnits.filter(unit => !excluded.includes(text(unit.category)))
    const rejected = matches.filter(unit => {
      const number = Number(text(unit.unit_number).replace(/\D/g, ''))
      const before = new RegExp(`\\b(?:no (?:quiero|prefiero|elijo|escojo|me interesa)|descarto|rechazo)\\s+(?:(?:el|la|departamento|suite|penthouse|local|unidad)\\s+)*0*${number}\\b`)
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
    context.comparison_ids = matches.length > 1 ? unitIds(matches) : []
    context.selected_ids = matches.length === 1 && !incomplete ? unitIds(matches) : []
    context.offered_ids = matches.length && !incomplete ? unitIds(matches) : []
    return result(matches, incomplete ? 'ambiguous' : literalUnits.length ? 'semantic_explicit' : 'explicit', !incomplete, incomplete)
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
    context.selected_ids = []; context.comparison_ids = []; context.offered_ids = []; context.phase = null
    return result([], 'category_change')
  }
  const followup = (semanticValid && ['comparison', 'followup'].includes(text(semantic.reference_kind)))
    || /^(?:y\s+)?(?:en\s+)?(?:el\s+)?(?:precio|valor)\b|\b(?:y (?:el|en) precio|que (?:precio|valor)|cuanto (?:cuesta|vale|cuestan|valen)|diferencia|ambos|ambas|entre ellos)\b/.test(m)
  if (followup && !/\b(?:edificio|proyecto|sector|alimentos|papas|vehiculos?|motos?)\b/.test(m)) {
    const requested = ids(context.comparison_ids).length ? ids(context.comparison_ids) : ids(context.selected_ids)
    const matches = fromIds(requested)
    if (matches.length !== requested.length) return { ...result(matches, 'ambiguous', false, true),
      clarification: 'Una de las unidades que estábamos revisando ya no aparece en el catálogo disponible. ¿Le gustaría revisar las opciones que siguen disponibles?' }
    if (matches.length) return result(matches, matches.length > 1 ? 'comparison_followup' : 'remembered')
    // Multiple offered options are not a comparison or an accepted selection.
    if (ids(context.offered_ids).length) return result(fromIds(context.offered_ids), 'ambiguous', false, true)
  }
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
    if (ids(context.selected_ids).some(id => !actual.includes(id))) context.selected_ids = []
    context.offered_ids = actual
  }
  if (explicitOffers.length) context.offered_ids = explicitOffers.filter(id => actual.includes(id))
  if (selected.length) { context.selected_ids = selected.filter(id => actual.includes(id)); context.comparison_ids = [] }
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
    context.offered_ids = []; context.comparison_ids = []; context.selected_ids = []
  }
  return { ...context, last_reply: reply }
}

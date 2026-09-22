import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { resolveCatalogReference } from './catalog-reference'
import { answersPendingQuestion, pendingQuestionFromReply } from './turn-semantics'

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
  const current: Row = { ...saved, offered_ids: ids(saved.offered_ids), comparison_ids: ids(saved.comparison_ids), selected_ids: ids(saved.selected_ids) }
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
  const semanticValid = semantic.confidence === 'high'
  const category = semanticValid ? text(semantic.category) : ''
  const excluded = semanticValid ? ids(semantic.excluded_categories) : []
  const eligible = (units: Row[]) => units.filter(unit => (!category || unit.category === category) && !excluded.includes(text(unit.category)))
  const fromIds = (value: unknown) => ids(value).flatMap(id => catalog.filter(unit => text(unit.id) === id))
  const result = (matches: Row[], reason: string, explicit = false, needsClarification = false) => ({
    ...base, matches, explicit, reason, needsClarification,
    memory: memory(matches), context,
    clarification: needsClarification ? (matches.length > 1
      ? `Entre las opciones que revisamos hay varias que encajan: ${matches.map(unit => `${text(unit.category)} ${text(unit.unit_number)}`).join(', ')}. ¿Cuál de estas opciones le gustaría conocer?`
      : 'Para orientarle con la opción correcta, ¿puede indicarme el número de la unidad que le interesa?') : '',
  })
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
  const selector = semanticValid ? semantic.reference_kind === 'relative' ? text(semantic.selector) : '' : relativeSelector(current)
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
  const lastReply = lastBot(history)
  const confirmsOption = answersPendingQuestion(semantics, 'unit_choice', 'affirmative')
    || /^(?:si(?: por favor| esta bien)?|claro|de acuerdo|perfecto)$/.test(m.replace(/[.!¡,]/g, '').trim())
      && (pendingQuestionFromReply(lastReply).id === 'unit_choice' || /le gustaria conocer esta opcion/.test(normalized(lastReply)))
  if (confirmsOption && ids(context.offered_ids).length) {
    const options = fromIds(context.offered_ids)
    if (options.length !== 1 || ids(context.offered_ids).length !== 1) return result(options, 'ambiguous', false, true)
    context.selected_ids = unitIds(options); context.comparison_ids = []
    return result(options, 'confirmed_single_option', true)
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
  return { ...base, reason: 'remembered', needsClarification: false, clarification: '', context }
}

/** Persist only after the reply was delivered. Offered, compared and chosen are different facts. */
export function rememberPropertyReply(catalog: Row[], contextRaw: unknown, reply: string, audit: Row): Row {
  const context = { ...object(contextRaw) }
  if (['business_out_of_scope', 'vehicle_out_of_scope', 'scope_clarification'].includes(text(audit.source))) {
    return { preference_category: context.preference_category || null, offered_ids: [], comparison_ids: [], selected_ids: [], phase: null, last_reply: reply }
  }
  const actual = unitIds(unitsInPropertyReply(catalog, reply))
  const explicitOffers = ids(audit.offered_unit_ids)
  const selected = ids(audit.selected_unit_ids)
  const compared = ids(audit.comparison_unit_ids)
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
  if (actual.length > 1 && /compar|diferencia|ambos|ambas/.test(normalized(reply))) context.comparison_ids = actual
  if (audit.alternative_phase) context.phase = audit.alternative_phase
  else if (audit.source === 'property_floor_options') context.phase = 'choose_unit'
  else if (selected.length) context.phase = 'review_unit'
  if (['unit_alternative', 'unit_alternative_journey'].includes(text(audit.source))) context.journey = 'residential_alternatives'
  if (['compare_categories', 'choose_category', 'choose_floor'].includes(text(context.phase)) && audit.alternative_phase) {
    context.offered_ids = []; context.comparison_ids = []; context.selected_ids = []
  }
  return { ...context, last_reply: reply }
}

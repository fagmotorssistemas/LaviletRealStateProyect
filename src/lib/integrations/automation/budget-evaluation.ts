import { object, text, type Row } from './data'

export const BUDGET_EVALUATION_VERSION = 'budget-evaluation-v1'
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const ids = (values: unknown) => Array.isArray(values) ? [...new Set(values.map(text).filter(Boolean))] : []

/** One comparison over an identified set. A projection, unknown price or entry
 * amount cannot prove that every physical alternative is affordable. */
export function evaluateBudgetOptions(input: {
  budget: Row; units: Row[]; pricesAuthorized: boolean; membershipComplete: boolean;
  unknownUnitIds?: string[]; scopeKnown?: boolean;
}): Row {
  const byId = new Map(input.units.filter(unit => !!text(unit.id)).map(unit => [text(unit.id), unit]))
  const units = [...byId.values()]
  const amount = positive(input.budget.amount) ? input.budget.amount : null
  const comparable = input.budget.status === 'maximum_total' && input.budget.confidence === 'high'
    && amount !== null && input.scopeKnown !== false
  const priceKnown = (unit: Row) => input.pricesAuthorized && positive(unit.published_commercial_price)
  const priced = units.filter(priceKnown)
  const missingIds = ids(input.unknownUnitIds)
  const unknown = ids([...missingIds, ...units.filter(unit => !priceKnown(unit)).map(unit => unit.id)])
  const within = comparable ? priced.filter(unit => Number(unit.published_commercial_price) <= amount!) : []
  const above = comparable ? priced.filter(unit => Number(unit.published_commercial_price) > amount!) : []
  const membershipComplete = input.membershipComplete && !missingIds.length && byId.size === input.units.length
  const complete = membershipComplete && input.pricesAuthorized && !unknown.length
  const coverage = !comparable || !complete || !units.length ? 'unknown'
    : within.length === units.length ? 'all' : within.length ? 'some' : 'none'
  const status = !comparable ? 'not_comparable' : !input.pricesAuthorized ? 'prices_not_authorized'
    : !complete ? 'incomplete_prices' : !units.length ? 'no_matching_features'
      : within.length ? 'matching_options' : 'below_available_prices'
  const categories = [...new Set(units.map(unit => text(unit.category)).filter(Boolean))]
  const byCategory = categories.map(category => {
    const members = units.filter(unit => unit.category === category)
    const matching = within.filter(unit => unit.category === category)
    const outside = above.filter(unit => unit.category === category)
    const unknownMembers = members.filter(unit => unknown.includes(text(unit.id)))
    const categoryComplete = membershipComplete && input.pricesAuthorized && !unknownMembers.length
    return { category, candidate_unit_ids: members.map(unit => text(unit.id)),
      matching_unit_ids: matching.map(unit => text(unit.id)), outside_unit_ids: outside.map(unit => text(unit.id)),
      unknown_price_unit_ids: unknownMembers.map(unit => text(unit.id)), complete: categoryComplete,
      coverage: !comparable || !categoryComplete ? 'unknown' : matching.length === members.length ? 'all' : matching.length ? 'some' : 'none',
      universal_affordability_allowed: comparable && categoryComplete && matching.length === members.length }
  })
  return { version: BUDGET_EVALUATION_VERSION, status, coverage, amount, comparable, complete,
    price_evidence_complete: complete, membership_complete: membershipComplete,
    prices_authorized: input.pricesAuthorized, candidate_unit_ids: units.map(unit => text(unit.id)),
    matching_unit_ids: within.map(unit => text(unit.id)), outside_unit_ids: above.map(unit => text(unit.id)),
    unknown_price_unit_ids: unknown, categories: byCategory,
    prices: priced.map(unit => ({ unit_id: unit.id, published_commercial_price: unit.published_commercial_price })),
    minimum_price: complete && priced.length ? Math.min(...priced.map(unit => Number(unit.published_commercial_price))) : null,
    universal_affordability_allowed: coverage === 'all' }
}

/** Available money may guide selection without becoming another money topic. */
export function budgetMentionPolicy(info: Row, indispensableComparison = false): Row {
  const semantics = object(info.semantica_turno || info.contrato_turno)
  const current = object(semantics.budget)
  const declaration = current.confidence === 'high' && current.status && current.status !== 'not_discussed'
    && !!text(current.evidence).trim()
  const requests = Array.isArray(info.solicitudes_interpretadas || semantics.requests)
    ? (info.solicitudes_interpretadas || semantics.requests) as Row[] : []
  const requested = semantics.primary_intent === 'discuss_budget'
    || requests.some(request => request.confidence === 'high' && request.domain === 'budget')
  return { allowed: !!declaration || requested || indispensableComparison,
    required: requested || indispensableComparison,
    reason: indispensableComparison ? 'indispensable_current_scope_gap' : requested ? 'current_budget_request'
      : declaration ? 'current_budget_declaration' : 'internal_selection_only' }
}

/** This is a statement contract, not an instruction to enumerate every price. */
export function budgetClaimContract(evaluation: Row): Row {
  return { version: BUDGET_EVALUATION_VERSION, budget_amount: evaluation.amount,
    candidate_unit_ids: evaluation.candidate_unit_ids, matching_unit_ids: evaluation.matching_unit_ids,
    outside_unit_ids: evaluation.outside_unit_ids, unknown_price_unit_ids: evaluation.unknown_price_unit_ids,
    categories: evaluation.categories, universal_affordability_allowed: evaluation.universal_affordability_allowed,
    instruction: 'Cada afirmación de suficiencia se limita a sus unidades o categoría. Las coincidencias parciales no acreditan los demás tipos. “Todas” requiere universal_affordability_allowed=true para el conjunto descrito; un precio desconocido impide esa conclusión. Tener información de presupuesto no obliga a repetir dinero ni precios.' }
}

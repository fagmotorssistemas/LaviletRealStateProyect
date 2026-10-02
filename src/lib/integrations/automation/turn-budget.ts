import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { confirmedInterpretationMemory } from './interpretation-memory'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Absence of an update never erases an accepted declaration. Ambiguous new
 * declarations do supersede the old amount for comparisons, without guessing. */
export function effectiveTurnBudget(verified: Row): Row {
  const current = object(object(verified.semantica_turno).budget || object(verified.contrato_turno).budget)
  if (current.status && current.status !== 'not_discussed') return { ...current, source: 'current_lead_statement' }
  const remembered = object(confirmedInterpretationMemory({ _interpretation_memory: verified.hechos_confirmados }).budget)
  return Object.keys(remembered).length ? { ...remembered, source: 'confirmed_lead_memory' } : current
}

export const BUDGET_CONTINUATION_RULES = `La continuación del presupuesto es una obligación comercial, con redacción libre. Aplique presupuesto_del_turno.continuation: presente opciones verificadas que alcancen; si solo hay alternativas, explique qué cambia sin sustituir la selección del cliente; si no alcanza y hay entidades autorizadas, ofrezca revisar las alternativas de financiamiento y acompañarle en el proceso. Un brochure no sustituye esa orientación. Respete una negativa actual al financiamiento. Ofrecer revisión no promete aprobación, cuotas, entrada mínima, préstamo directo ni un trámite ya iniciado. Si faltan precios o la búsqueda es parcial, limite la conclusión al alcance comprobado; no declare que no existen opciones en todo el proyecto. Si el importe es entrada, cuota o ambiguo, no lo compare como precio total ni lo multiplique por mil. Interprete cualquier formulación equivalente; no exija palabras exactas.`

/** Compute affordability from this turn's interpreted budget and complete
 * scoped catalogue. Never infer an amount from prose or approve financing. */
export function turnBudgetAssessment(verified: Row, audit: Row): Row | null {
  const budget = effectiveTurnBudget(verified)
  if (budget.confidence === 'high' && ['unknown', 'initial_capital'].includes(text(budget.status))) return {
    status: 'clarify_budget_basis', amount: budget.amount ?? null, evidence: budget.evidence,
    continuation: 'clarify_budget', instruction: BUDGET_CONTINUATION_RULES,
  }
  if (!['amount', 'maximum_total'].includes(text(budget.status)) || budget.confidence !== 'high' || typeof budget.amount !== 'number'
    || !Number.isFinite(budget.amount) || budget.amount <= 0 || !text(budget.evidence)) return null
  const result = object(audit.catalog_results)
  const raw = audit.verified_catalog === true ? result.units : verified.catalogo
  const units = (Array.isArray(raw) ? raw.map(object) : []).filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
  const authorized = object(verified.politica_comercial).precios_autorizados === true
  const prices = authorized ? units.filter(unit => typeof unit.published_commercial_price === 'number'
    && Number.isFinite(unit.published_commercial_price) && unit.published_commercial_price > 0) : []
  const complete = audit.verified_catalog === true ? object(verified.catalog_read).complete !== false && result.complete === true
    && Array.isArray(result.unknown_unit_ids) && result.unknown_unit_ids.length === 0
    : object(verified.catalog_read).complete === true
  const matching = prices.filter(unit => Number(unit.published_commercial_price) <= Number(budget.amount))
  const priceComplete = authorized && complete && prices.length === units.length
  const query = catalogQuery(audit.catalog_query || object(verified.semantica_turno).property)
  const group = query.group || (query.category === 'local' ? 'commercial' : query.category ? 'residential' : null)
  const excluded = object(object(verified.semantica_turno).property).excluded_categories
  // Compare authorized alternatives without changing the selected unit or relaxing requirements.
  const alternatives = !matching.length && authorized && group ? filterCatalog(rows(verified.catalogo_verificacion),
    { ...query, category: null, group }).filter(unit => !(Array.isArray(excluded) && excluded.includes(unit.category))
      && typeof unit.published_commercial_price === 'number' && unit.published_commercial_price > 0
      && unit.published_commercial_price <= Number(budget.amount)) : []
  const partners = Array.isArray(object(verified.financiamiento).partners)
    ? (object(verified.financiamiento).partners as unknown[]).map(text).filter(Boolean) : []
  const continuation = matching.length ? 'present_affordable_options' : alternatives.length ? 'present_affordable_alternatives'
    : priceComplete && units.length && partners.length ? 'offer_financing'
      : !priceComplete ? 'clarify_available_information' : 'clarify_requirements'
  return { amount: budget.amount, currency: 'USD', budget_source: budget.source, evidence: budget.evidence,
    query: audit.catalog_query || null, scope: audit.verified_catalog === true ? 'current_query' : 'available_context',
    status: !authorized ? 'prices_not_authorized' : matching.length ? 'matching_options'
      : !complete || prices.length !== units.length ? 'incomplete_prices'
        : !units.length ? 'no_matching_features' : 'below_available_prices',
    price_evidence_complete: priceComplete, candidate_unit_ids: units.map(unit => unit.id),
    matching_unit_ids: matching.map(unit => unit.id),
    alternatives, financing_partners: partners, continuation,
    continuation_instruction: BUDGET_CONTINUATION_RULES,
    prices: prices.map(unit => ({ unit_id: unit.id, published_commercial_price: unit.published_commercial_price })),
    minimum_price: priceComplete && prices.length ? Math.min(...prices.map(unit => Number(unit.published_commercial_price))) : null,
    instruction: 'Atienda explícitamente el presupuesto junto con las características antes de proponer otra elección. Compare únicamente los precios autorizados de estas unidades. No declare que no existen opciones dentro del presupuesto si faltan precios o la búsqueda es incompleta. Si el importe se destina a entrada en lugar del valor total, debe aclararlo el cliente; no lo suponga ni prometa financiación. Mantenga redacción libre y cifras exactas.' }
}

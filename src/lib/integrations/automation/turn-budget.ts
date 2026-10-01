import { object, text, type Row } from './data'

/** Compute affordability from this turn's interpreted budget and complete
 * scoped catalogue. Never infer an amount from prose or approve financing. */
export function turnBudgetAssessment(verified: Row, audit: Row): Row | null {
  const budget = object(object(verified.semantica_turno).budget || object(verified.contrato_turno).budget)
  if (budget.status !== 'amount' || budget.confidence !== 'high' || typeof budget.amount !== 'number'
    || !Number.isFinite(budget.amount) || budget.amount <= 0 || !text(budget.evidence)) return null
  const result = object(audit.catalog_results)
  const raw = audit.verified_catalog === true ? result.units : verified.catalogo
  const units = (Array.isArray(raw) ? raw.map(object) : []).filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
  const authorized = object(verified.politica_comercial).precios_autorizados === true
  const prices = authorized ? units.filter(unit => typeof unit.published_commercial_price === 'number'
    && Number.isFinite(unit.published_commercial_price) && unit.published_commercial_price > 0) : []
  const complete = audit.verified_catalog === true && result.complete === true
    && Array.isArray(result.unknown_unit_ids) && result.unknown_unit_ids.length === 0
  const matching = prices.filter(unit => Number(unit.published_commercial_price) <= Number(budget.amount))
  const priceComplete = authorized && complete && prices.length === units.length
  return { amount: budget.amount, currency: 'USD', budget_source: 'current_lead_statement', evidence: budget.evidence,
    query: audit.catalog_query || null, scope: audit.verified_catalog === true ? 'current_query' : 'available_context',
    status: !authorized ? 'prices_not_authorized' : matching.length ? 'matching_options'
      : !complete || prices.length !== units.length ? 'incomplete_prices'
        : !units.length ? 'no_matching_features' : 'below_available_prices',
    price_evidence_complete: priceComplete, candidate_unit_ids: units.map(unit => unit.id),
    matching_unit_ids: matching.map(unit => unit.id),
    prices: prices.map(unit => ({ unit_id: unit.id, published_commercial_price: unit.published_commercial_price })),
    minimum_price: priceComplete && prices.length ? Math.min(...prices.map(unit => Number(unit.published_commercial_price))) : null,
    instruction: 'Atienda explícitamente el presupuesto junto con las características antes de proponer otra elección. Compare únicamente los precios autorizados de estas unidades. No declare que no existen opciones dentro del presupuesto si faltan precios o la búsqueda es incompleta. Si el importe se destina a entrada en lugar del valor total, debe aclararlo el cliente; no lo suponga ni prometa financiación. Mantenga redacción libre y cifras exactas.' }
}

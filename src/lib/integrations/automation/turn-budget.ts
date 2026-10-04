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

/** Select one obligation, instead of asking the reviewer to choose between
 * mutually exclusive branches in a generic financial procedure. */
export function budgetContinuationInstruction(assessment: Row): string {
  const actions: Record<string, string> = {
    clarify_requirements: 'No hay coincidencias confirmadas con las características solicitadas. Explique el alcance comprobado y aclare únicamente el requisito que impide avanzar. No exija listar inmuebles incompatibles porque sean baratos, ni ofrecer financiamiento: el crédito no resuelve una característica ausente.',
    clarify_available_information: 'La información disponible no permite concluir si el presupuesto alcanza. Explique qué dato falta y el alcance comprobado. No afirme ausencia global de opciones ni exija ofrecer financiamiento sin precios comparables.',
    clarify_budget: 'Aclare si el importe es presupuesto total, entrada o cuota antes de compararlo con precios. No convierta una entrada en precio total.',
    clarify_budget_basis: 'Explique la relación entre el importe y los precios verificados, limitada al alcance comprobado, y pregunte si ese dinero es el total que desea invertir sin deuda o el capital que destinaría a una entrada. Esa finalidad todavía no está confirmada. No sustituya esta aclaración por ofrecer información, un asesor u otras opciones.',
    explain_budget_gap: 'Explique que las opciones compatibles verificadas superan el presupuesto. No prometa financiamiento ni entidades que no estén autorizadas.',
    present_affordable_options: 'Atienda la relación del presupuesto con las opciones verificadas que cumplen los requisitos. Puede mencionar ejemplos o un conjunto pertinente; no se exige enumerar todas las unidades ni una frase exacta.',
    present_affordable_alternatives: 'Explique las alternativas verificadas dentro del presupuesto y qué cambia respecto de la búsqueda original. No sustituya la selección del cliente ni relaje requisitos sin explicarlo.',
    offer_financing: 'Las opciones compatibles verificadas superan el presupuesto. Explique esa relación y ofrezca revisar financiamiento con las entidades autorizadas y acompañamiento, salvo negativa actual. No prometa aprobación, cuotas ni trámites realizados.',
  }
  return actions[text(assessment.continuation)] || BUDGET_CONTINUATION_RULES
}

/** Compute affordability from this turn's interpreted budget and complete
 * scoped catalogue. Never infer an amount from prose or approve financing. */
export function turnBudgetAssessment(verified: Row, audit: Row): Row | null {
  if (audit.source === 'clarify_previous_choice') return null
  const semantics = object(verified.semantica_turno), currentBudget = object(semantics.budget)
  const currentDeclaration = currentBudget.status && currentBudget.status !== 'not_discussed'
  const requests = rows(verified.solicitudes_interpretadas || object(verified.contrato_turno).requests)
  const financeAccepted = object(verified.etapa_financiamiento).accepted === true
    || object(object(verified.financiamiento).journey).accepted === true
    || object(object(verified.financiamiento).current).explicit_consent === true
  // A remembered budget remains evidence, but does not create the same sales
  // obligation on each later question, form field or accepted financing step.
  if (!currentDeclaration && (/^(?:financing|advisor_handoff)/.test(text(audit.source))
    || requests.length > 0 && requests.every(r => ['financing', 'courtesy', 'visit', 'advisor'].includes(text(r.domain)))
    || financeAccepted)) return null
  const budget = effectiveTurnBudget(verified)
  if (budget.confidence === 'high' && ['unknown', 'initial_capital'].includes(text(budget.status))) return {
    status: 'clarify_budget_basis', amount: budget.amount ?? null, evidence: budget.evidence,
    continuation: 'clarify_budget', instruction: BUDGET_CONTINUATION_RULES,
  }
  if (!['amount', 'maximum_total'].includes(text(budget.status)) || budget.confidence !== 'high' || typeof budget.amount !== 'number'
    || !Number.isFinite(budget.amount) || budget.amount <= 0 || !text(budget.evidence)) return null
  const result = object(audit.catalog_results)
  const query = catalogQuery(audit.catalog_query || object(verified.property_context).query || object(verified.semantica_turno).property)
  const raw = audit.verified_catalog === true ? result.units : filterCatalog(rows(verified.catalogo), query)
  const units = (Array.isArray(raw) ? raw.map(object) : []).filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
  const authorized = object(verified.politica_comercial).precios_autorizados === true
  const prices = authorized ? units.filter(unit => typeof unit.published_commercial_price === 'number'
    && Number.isFinite(unit.published_commercial_price) && unit.published_commercial_price > 0) : []
  const complete = audit.verified_catalog === true ? object(verified.catalog_read).complete !== false && result.complete === true
    && Array.isArray(result.unknown_unit_ids) && result.unknown_unit_ids.length === 0
    : object(verified.catalog_read).complete === true
  const matching = prices.filter(unit => Number(unit.published_commercial_price) <= Number(budget.amount))
  const priceComplete = authorized && complete && prices.length === units.length
  const group = query.group || (query.category === 'local' ? 'commercial' : query.category ? 'residential' : null)
  const excluded = object(object(verified.semantica_turno).property).excluded_categories
  // Compare authorized alternatives without changing the selected unit or relaxing requirements.
  const alternatives = !matching.length && authorized && group ? filterCatalog(rows(verified.catalogo_verificacion),
    { ...query, category: null, group }).filter(unit => !(Array.isArray(excluded) && excluded.includes(unit.category))
      && typeof unit.published_commercial_price === 'number' && unit.published_commercial_price > 0
      && unit.published_commercial_price <= Number(budget.amount)) : []
  const partners = Array.isArray(object(verified.financiamiento).partners)
    ? (object(verified.financiamiento).partners as unknown[]).map(text).filter(Boolean) : []
  const clarifyBudgetBasis = !!currentDeclaration && budget.status === 'amount' && !matching.length
    && !alternatives.length && prices.length > 0 && !financeAccepted
  const continuation = clarifyBudgetBasis ? 'clarify_budget_basis'
    : matching.length ? 'present_affordable_options' : alternatives.length ? 'present_affordable_alternatives'
    : priceComplete && units.length ? partners.length ? 'offer_financing' : 'explain_budget_gap'
      : !priceComplete ? 'clarify_available_information' : 'clarify_requirements'
  return { amount: budget.amount, currency: 'USD', budget_source: budget.source, evidence: budget.evidence,
    clarify_budget_basis: clarifyBudgetBasis,
    query: audit.catalog_query || null, scope: audit.verified_catalog === true ? 'current_query' : 'available_context',
    status: !authorized ? 'prices_not_authorized' : matching.length ? 'matching_options'
      : !complete || prices.length !== units.length ? 'incomplete_prices'
        : !units.length ? 'no_matching_features' : 'below_available_prices',
    price_evidence_complete: priceComplete, candidate_unit_ids: units.map(unit => unit.id),
    matching_unit_ids: matching.map(unit => unit.id),
    alternatives, financing_partners: partners, continuation,
    continuation_instruction: budgetContinuationInstruction({ continuation }),
    prices: prices.map(unit => ({ unit_id: unit.id, published_commercial_price: unit.published_commercial_price })),
    minimum_price: priceComplete && prices.length ? Math.min(...prices.map(unit => Number(unit.published_commercial_price))) : null,
    instruction: 'Atienda explícitamente el presupuesto junto con las características antes de proponer otra elección. Compare únicamente los precios autorizados de estas unidades. No declare que no existen opciones dentro del presupuesto si faltan precios o la búsqueda es incompleta. Si el importe se destina a entrada en lugar del valor total, debe aclararlo el cliente; no lo suponga ni prometa financiación. Mantenga redacción libre y cifras exactas.' }
}

import { informationOnly } from './interaction-mode'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { catalogQuery, filterCatalog, partitionCatalog } from './catalog-dialogue'
import { leadBudget } from './budget-state'
import { evaluateBudgetOptions, budgetClaimContract, budgetMentionPolicy, BUDGET_EVALUATION_VERSION } from './budget-evaluation'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Absence of an update never erases an accepted declaration. Ambiguous new
 * declarations do supersede the old amount for comparisons, without guessing. */
export function effectiveTurnBudget(verified: Row): Row {
  return leadBudget(verified)
}

export const BUDGET_CONTINUATION_RULES = `La continuación del presupuesto es una obligación comercial, con redacción libre. Aplique presupuesto_del_turno.continuation: presente opciones verificadas que alcancen; si solo hay alternativas, explique qué cambia sin sustituir la selección del cliente; si no alcanza y hay entidades autorizadas, ofrezca revisar las alternativas de financiamiento y acompañarle en el proceso. Un brochure no sustituye esa orientación. Respete una negativa actual al financiamiento. Ofrecer revisión no promete aprobación, cuotas, entrada mínima, préstamo directo ni un trámite ya iniciado. Si faltan precios o la búsqueda es parcial, limite la conclusión al alcance comprobado; no declare que no existen opciones en todo el proyecto. Si el importe es entrada, cuota o ambiguo, no lo compare como precio total ni lo multiplique por mil. Interprete cualquier formulación equivalente; no exija palabras exactas.`

/** Select one obligation, instead of asking the reviewer to choose between
 * mutually exclusive branches in a generic financial procedure. */
export function budgetContinuationInstruction(assessment: Row): string {
  if (assessment.continuation === 'commercial_next_step') return 'Use los hechos del presupuesto para responder. La única continuación autorizada es siguiente_paso_comercial; no proponga alternativas, financiamiento ni otra pregunta desde este bloque.'
  const actions: Record<string, string> = {
    continue_property_selection: 'El financiamiento ya fue aceptado. Atienda cualquier nuevo importe sin volver a descartar al lead por falta de efectivo. Si falta unidad, continúe eligiéndola; si ya está elegida, siga siguiente_paso_comercial sin reabrir la selección. No repita consentimiento ni afirme viabilidad o inviabilidad del crédito.',
    continue_needs_discovery: 'El lead no tiene presupuesto definido o lo pospuso. Continúe con las características pendientes sin insistir con una cifra, inventar cero ni ofrecer financiamiento por esa ausencia. Conserve cualquier unidad o preferencia conocida.',
    offer_financing_for_entry: 'El importe fue declarado para la entrada. Conserve ese papel y ofrezca analizar financiamiento con las entidades autorizadas; no lo compare como presupuesto total ni prometa aprobación. La aceptación primero retoma la elección de unidad pendiente.',
    ask_budget_amount: 'Confirmó tener presupuesto, pero falta el monto. Pregunte de cuánto es; no suponga una cifra ni vuelva a preguntar si lo tiene.',
    clarify_requirements: 'No hay coincidencias confirmadas con las características solicitadas. Explique el alcance comprobado y aclare únicamente el requisito que impide avanzar. No exija listar inmuebles incompatibles porque sean baratos, ni ofrecer financiamiento: el crédito no resuelve una característica ausente.',
    clarify_available_information: 'La información disponible no permite concluir si el presupuesto alcanza. Explique qué dato falta y el alcance comprobado. No afirme ausencia global de opciones ni exija ofrecer financiamiento sin precios comparables.',
    clarify_budget: 'Aclare si el importe es presupuesto total, entrada o cuota antes de compararlo con precios. No convierta una entrada en precio total.',
    clarify_budget_basis: 'Explique que el importe declarado es menor que los precios comparables y ofrezca explorar financiamiento si hay entidades autorizadas, sin asumir que ese dinero ya es una entrada. Pregunte si desea continuar; no obligue a aumentar el presupuesto ni sugiera otros proyectos.',
    explain_budget_gap: 'Explique que las opciones compatibles verificadas superan el presupuesto. No prometa financiamiento ni entidades que no estén autorizadas.',
    present_affordable_options: 'Atienda la relación del presupuesto con las opciones verificadas que cumplen los requisitos. Puede mencionar ejemplos o un conjunto pertinente; no se exige enumerar todas las unidades ni una frase exacta.',
    present_affordable_alternatives: 'Explique las alternativas verificadas dentro del presupuesto y qué cambia respecto de la búsqueda original. No sustituya la selección del cliente ni relaje requisitos sin explicarlo.',
    offer_financing: 'Las opciones compatibles verificadas superan el presupuesto. Explique esa relación y ofrezca revisar financiamiento con las entidades autorizadas y acompañamiento, salvo negativa actual. No prometa aprobación, cuotas ni trámites realizados.',
  }
  return actions[text(assessment.continuation)] || BUDGET_CONTINUATION_RULES
}

/** Budget calculations supply facts; one journey plan owns the continuation.
 * Affordable alternatives are not an instruction to switch the client's query. */
export function budgetForCommercialPlan(assessment: Row, plan: Row): Row {
  if (!plan.action) return assessment
  const alternativesRequested = plan.action === 'present_affordable_alternatives'
    || plan.presentation === 'affordable_alternatives'
  const guidance = object(plan.budget_guidance)
  return { ...assessment, ...(guidance.version === BUDGET_EVALUATION_VERSION ? guidance : {}), continuation: 'commercial_next_step',
    continuation_instruction: budgetContinuationInstruction({ continuation: 'commercial_next_step' }),
    alternatives: alternativesRequested ? assessment.alternatives : [],
    commercial_plan_action: plan.action }
}

/** Compute affordability from this turn's interpreted budget and complete
 * scoped catalogue. Never infer an amount from prose or approve financing. */
export function turnBudgetAssessment(verified: Row, audit: Row): Row | null {
  if (informationOnly(verified) || ['all_categories', 'other_categories'].includes(text(object(object(verified.semantica_turno).interaction_goal).catalog_scope))) return null
  if (audit.source === 'clarify_previous_choice') return null
  const semantics = object(verified.semantica_turno), currentBudget = object(semantics.budget)
  const currentDeclaration = currentBudget.status && currentBudget.status !== 'not_discussed'
  const requests = rows(verified.solicitudes_interpretadas || object(verified.contrato_turno).requests)
  const financeDeclined = object(object(verified.financiamiento).journey).status === 'declined'
  const financeAccepted = !financeDeclined && (object(verified.etapa_financiamiento).accepted === true
    || object(object(verified.financiamiento).journey).accepted === true
    || object(object(verified.financiamiento).current).explicit_consent === true)
  // A remembered budget remains evidence, but does not create the same sales
  // obligation on each later question, form field or accepted financing step.
  if (!currentDeclaration && (/^(?:financing|advisor_handoff)/.test(text(audit.source))
    || requests.length > 0 && requests.every(r => ['financing', 'courtesy', 'visit', 'advisor'].includes(text(r.domain)))
    || financeAccepted)) return null
  const budget = leadBudget(verified)
  if (['amount_pending', 'no_defined_budget'].includes(text(budget.status))) {
    if (financeAccepted && budget.status === 'no_defined_budget') return null
    const available = Array.isArray(object(verified.financiamiento).partners) && (object(verified.financiamiento).partners as unknown[]).length > 0
    const declined = object(object(verified.financiamiento).journey).status === 'declined'
    if (budget.status === 'no_defined_budget' && (!available || declined)) return null
    const continuation = budget.status === 'amount_pending' ? 'ask_budget_amount' : 'continue_needs_discovery'
    return { status: budget.status, amount: null, continuation,
      continuation_instruction: budgetContinuationInstruction({ continuation }) }
  }
  if (acceptedExtractorConfidence(budget.confidence) && ['unknown', 'initial_capital'].includes(text(budget.status))) {
    const available = Array.isArray(object(verified.financiamiento).partners) && (object(verified.financiamiento).partners as unknown[]).some(partner => !!text(partner))
    const continuation = budget.status === 'initial_capital' && available && !financeDeclined && !financeAccepted
      ? 'offer_financing_for_entry' : 'continue_needs_discovery'
    return { status: budget.status, amount: budget.amount ?? null, evidence: budget.evidence,
      continuation, continuation_instruction: budgetContinuationInstruction({ continuation }) }
  }
  if (budget.status === 'amount' && acceptedExtractorConfidence(budget.confidence)) return {
    ...evaluateBudgetOptions({ budget, units: [], pricesAuthorized: false, membershipComplete: false }),
    budget_source: budget.source, evidence: budget.evidence, continuation: 'clarify_budget',
    continuation_instruction: budgetContinuationInstruction({ continuation: 'clarify_budget' }),
    mention_allowed: true, mention_required: true,
  }
  if (budget.status !== 'maximum_total' || !acceptedExtractorConfidence(budget.confidence) || typeof budget.amount !== 'number'
    || !Number.isFinite(budget.amount) || budget.amount <= 0 || !text(budget.evidence)) return null
  const result = object(audit.catalog_results)
  const query = catalogQuery(audit.catalog_query || object(verified.property_context).query || object(verified.semantica_turno).property)
  const physicalQuery = catalogQuery({ ...query,
    requirements: rows(query.requirements).filter(requirement => requirement.field !== 'published_commercial_price') })
  const context = object(verified.property_context)
  const selectedIds = Array.isArray(context.selected_ids) ? context.selected_ids.map(text).filter(Boolean) : []
  const scopedIds = query.scope === 'selected' ? selectedIds
    : query.scope === 'offered' && Array.isArray(context.offered_ids) ? context.offered_ids.map(text).filter(Boolean)
      : query.scope === 'comparison' && Array.isArray(context.comparison_ids) ? context.comparison_ids.map(text).filter(Boolean) : undefined
  const fullCatalog = Array.isArray(verified.catalogo_verificacion) ? rows(verified.catalogo_verificacion) : null
  const scopedCatalog = audit.verified_catalog === true && !fullCatalog && Array.isArray(result.units)
    ? rows(result.units) : rows(verified.catalogo)
  const partition = partitionCatalog(fullCatalog || scopedCatalog, physicalQuery, scopedIds)
  const excludedCategories = Array.isArray(context.excluded_categories) ? context.excluded_categories : []
  const units = partition.units.filter(unit => !excludedCategories.includes(unit.category)
    && (!selectedIds.length || selectedIds.includes(text(unit.id))))
  const authorized = object(verified.politica_comercial).precios_autorizados === true
  const read = object(verified.catalog_verification_read || verified.catalog_read)
  const membershipComplete = fullCatalog ? read.complete === true
    : audit.verified_catalog === true ? read.complete !== false && result.complete === true
      && Array.isArray(result.unknown_unit_ids) && result.unknown_unit_ids.length === 0 : read.complete === true
  const evaluation = evaluateBudgetOptions({ budget, units, pricesAuthorized: authorized, membershipComplete,
    unknownUnitIds: [...partition.unknown.filter(unit => !excludedCategories.includes(unit.category)).map(unit => text(unit.id)),
      ...(!fullCatalog && Array.isArray(result.unknown_unit_ids) ? result.unknown_unit_ids.map(text) : [])] })
  const matching = rows(evaluation.prices).filter(unit => (evaluation.matching_unit_ids as string[]).includes(text(unit.unit_id)))
  const priceComplete = evaluation.price_evidence_complete === true
  const group = query.group || (query.category === 'local' ? 'commercial' : query.category ? 'residential' : null)
  const excluded = object(object(verified.semantica_turno).property).excluded_categories
  // Compare authorized alternatives without changing the selected unit or relaxing requirements.
  const alternatives = !matching.length && authorized && group ? filterCatalog(rows(verified.catalogo_verificacion),
    { ...query, category: null, group }).filter(unit => !(Array.isArray(excluded) && excluded.includes(unit.category))
      && typeof unit.published_commercial_price === 'number' && unit.published_commercial_price > 0
      && unit.published_commercial_price <= Number(budget.amount)) : []
  const partners = Array.isArray(object(verified.financiamiento).partners)
    ? (object(verified.financiamiento).partners as unknown[]).map(text).filter(Boolean) : []
  const continuation = financeAccepted ? 'continue_property_selection'
    : matching.length ? 'present_affordable_options' : alternatives.length ? 'present_affordable_alternatives'
    : priceComplete && units.length ? partners.length && !financeDeclined ? 'offer_financing' : 'explain_budget_gap'
      : !priceComplete ? 'clarify_available_information' : 'clarify_requirements'
  const mention = budgetMentionPolicy(verified, !financeAccepted && priceComplete && units.length > 0 && !matching.length)
  return { ...evaluation, currency: 'USD', budget_source: budget.source, evidence: budget.evidence,
    clarify_budget_basis: false, claim_contract: budgetClaimContract(evaluation),
    mention_policy: mention, mention_allowed: mention.allowed, mention_required: mention.required,
    query: audit.catalog_query || null, scope: audit.verified_catalog === true ? 'current_query' : 'available_context',
    alternatives, financing_partners: partners, continuation,
    continuation_instruction: budgetContinuationInstruction({ continuation }),
    instruction: mention.required === true
      ? 'Atienda la consulta actual de presupuesto con la evaluación del conjunto pertinente. No extienda una coincidencia parcial a los tipos fuera del importe ni afirme ausencia global con precios o miembros desconocidos. Mantenga redacción libre y cifras exactas.'
      : 'Use la evaluación internamente para orientar la selección. Un presupuesto recordado no obliga a mencionar dinero, repetir precios ni su condición en una consulta que no los requiere.' }
}

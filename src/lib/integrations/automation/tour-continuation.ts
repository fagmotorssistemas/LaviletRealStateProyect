import { object, text, type Row } from './data'
import { commercialJourneyPlan } from './commercial-journey'
import { budgetKindQuestion, budgetQuestion, leadBudget } from './budget-state'
import { normalizedPendingQuestion } from './turn-semantics'
import { financingStage } from './financing-stage'

type BudgetStatus = 'not_discussed' | 'unknown' | 'amount' | 'maximum_total' | 'initial_capital'
  | 'amount_pending' | 'no_defined_budget' | 'sufficient_for_selected_unit' | 'insufficient_for_selected_unit' | 'declines_to_disclose'
type Budget = Row & { status: BudgetStatus; amount: number | null; source: string }
export type TourContinuation = {
  reply: string
  question: string
  pending_question: Row
  reason: string
  budget: Budget
}

const positive = (value: unknown): number | null => value !== null && value !== '' && typeof value !== 'boolean'
  && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null

/** Tour and commercial planning consume the same validated declaration. Text
 * history, a unit number or a quoted price cannot create another budget here. */
function knownBudget(info: Row): Budget {
  const budget = leadBudget(info)
  return { ...budget, status: text(budget.status) as BudgetStatus, amount: positive(budget.amount), source: text(budget.source) || 'none' }
}

/** All single-unit tour routes share one next step. This plans conversation only:
 * it never changes the selected unit, starts financing or authorizes a visit. */
export function tourContinuation(info: Row, unit: Row = {}, current = ''): TourContinuation {
  void current // Current declarations are interpreted before entering this planner.
  const budget = knownBudget(info)
  const answer = (question: string, reason: string, id = '', statement = ''): TourContinuation => ({
    reply: [statement, question].filter(Boolean).join(' '), question, reason, budget,
    pending_question: id ? normalizedPendingQuestion({ id, question }) : {},
  })
  const semantics = object(info.semantica_turno)
  if (['request_visit', 'ask_financing'].includes(text(semantics.primary_intent)) && semantics.confidence === 'high') {
    return answer('', 'requested_action_pending')
  }
  if (info.recorrido_comercial) {
    const step = commercialJourneyPlan(info)
    const result = answer(text(step.question), text(step.action), text(step.question_id))
    if (step.question_act) result.pending_question = { ...result.pending_question, act: step.question_act,
      candidate_ids: object(step.selection_scope).unit_ids || [],
      target_ids: step.question_act === 'confirm_unit' ? object(step.selection_scope).unit_ids || [] : [] }
    return result
  }
  const deferred = object(info.memoria_comercial).deferred_fields
  const budgetDeferred = Array.isArray(deferred) && deferred.includes('presupuesto')
    && budget.source !== 'current_lead_statement'
  if (budgetDeferred) return answer('¿Qué le gustaría revisar con más detalle de esta opción?', 'budget_deferred')
  if (budget.status === 'amount_pending') return answer(budgetQuestion(info), 'budget_amount_missing', 'budget_amount')
  if (budget.status === 'not_discussed' || budget.status === 'maximum_total' && budget.amount === null) {
    return answer(budgetQuestion(info), 'budget_missing', 'budget_amount')
  }
  if (budget.status === 'initial_capital' && budget.amount === null) {
    return answer('¿Con qué monto aproximado cuenta para la entrada?', 'initial_capital_amount_missing', 'budget_amount')
  }
  const kindQuestion = budgetKindQuestion(budget)
  if (kindQuestion) return answer(kindQuestion, 'budget_kind_missing', 'budget_kind')
  const detailQuestion = '¿Qué le gustaría revisar con más detalle de esta opción?'
  if (budget.status === 'declines_to_disclose') return answer(detailQuestion, 'budget_declined')
  if (budget.status === 'unknown') return answer(detailQuestion, 'budget_deferred')
  const finance = object(info.financiamiento)
  const financingAvailable = Array.isArray(finance.partners) && finance.partners.some(partner => text(partner).trim())
  const financingActive = financingStage(info).accepted === true
  const price = object(info.politica_comercial).precios_autorizados === true ? positive(unit.published_commercial_price) : null
  const exceedsBudget = budget.status === 'maximum_total' && budget.amount !== null && price !== null && price > budget.amount
  const fitsBudget = budget.status === 'maximum_total' && budget.amount !== null && price !== null && price <= budget.amount
  const statement = exceedsBudget ? 'El valor de esta opción supera el presupuesto total que indicó.'
    : fitsBudget ? 'El valor de esta opción está dentro del presupuesto total que indicó.' : ''
  if ((budget.status === 'initial_capital' || budget.status === 'insufficient_for_selected_unit' || exceedsBudget)
    && financingAvailable && !financingActive) {
    return answer('¿Le gustaría conocer las opciones de financiamiento para esta unidad?', 'financing_information_available', '', statement)
  }
  return answer(detailQuestion, financingActive ? 'financing_already_started' : 'budget_already_known', '', statement)
}

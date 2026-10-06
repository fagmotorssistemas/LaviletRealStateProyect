import { object, text, type Row } from './data'
import { confirmedInterpretationMemory } from './interpretation-memory'

/** Structured declarations only. Absence, an explicit undefined budget and a
 * budget whose amount is still missing are different conversation states. */
export function leadBudget(info: Row): Row {
  const current = object(object(info.semantica_turno).budget || object(info.contrato_turno).budget)
  const saved = object(confirmedInterpretationMemory({ _interpretation_memory: info.hechos_confirmados }).budget)
  const isCurrent = current.confidence === 'high' && current.status && current.status !== 'not_discussed'
  const declared = isCurrent ? current : saved
  if (Object.keys(declared).length) return { ...declared,
    source: isCurrent ? 'current_lead_statement' : 'confirmed_lead_memory',
    answered: !['not_discussed', 'amount_pending', 'unknown'].includes(text(declared.status)) }
  const lead = object(info.lead)
  const amount = Number(lead.budget_max || lead.budget)
  return amount > 0 && Number.isFinite(amount)
    ? { status: 'amount', amount, confidence: 'high', source: 'lead_record', evidence: 'Presupuesto declarado guardado en la ficha', answered: true }
    : { status: 'not_discussed', amount: null, answered: false }
}

/** An amount alone does not establish whether it is the whole purchase budget
 * or funds for the initial payment. Every planner asks the same next decision. */
export function budgetKindQuestion(budget: Row): string {
  return budget.status === 'amount' && Number(budget.amount) > 0
    ? '¿Ese monto corresponde a su presupuesto total para la compra o al dinero disponible para la entrada?'
    : ''
}

export function budgetQuestion(info: Row): string {
  return leadBudget(info).status === 'amount_pending'
    ? '¿De cuánto es el presupuesto que tiene previsto?'
    : '¿Tiene un presupuesto estimado para esta compra?'
}

export function reviewedFinancingCovers(info: Row, unit: Row | null): boolean {
  const review = object(object(object(info.lead).behavior_signals).financing_review)
  const qualification = object(object(info.financiamiento).current)
  const price = Number(unit?.published_commercial_price)
  return !!unit && review.unit_id === unit.id && review.result === 'favorable'
    && !!text(review.reviewed_by) && !!text(review.reviewed_at)
    && !!review.qualification_updated_at && review.qualification_updated_at === qualification.updated_at
    && qualification.explicit_consent === true && qualification.status === 'lista'
    && object(info.politica_comercial).precios_autorizados === true && Number.isFinite(price) && price > 0
    && Number(review.unit_price) === price && Number(review.own_funds) >= 0 && Number(review.financing_amount) > 0
    && Math.round((Number(review.own_funds) + Number(review.financing_amount)) * 100) >= Math.round(price * 100)
}

import { object, text, type Row } from './data'
import { financingAmountStatements } from './financing-amounts'
import { leadBudget } from './budget-state'

export const FINANCING_ENTRY_QUESTION = '¿Qué monto tendría disponible para la entrada inicial de esta unidad?'
const literal = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())

/** A down payment is a separate declaration, never a reinterpretation of the
 * total purchase budget. Undefined/withheld answers are durable, not zero. */
export function rememberFinancingEntry(previous: Row, current: string, extracted: Row, pending: Row, messageId: string): Row {
  const semantics = object(extracted.turn_semantics)
  const statements = financingAmountStatements(extracted.financing_amounts || semantics.financing_amounts, current)
  const payment = statements.filter(item => item.role === 'down_payment').at(-1)
  if (payment) return { status: 'amount', amount: payment.amount, evidence: payment.evidence, source_message_id: messageId }
  const withdrawn = statements.find(item => item.replaces_role === 'down_payment')
  let next = withdrawn ? { status: 'missing', amount: null, evidence: withdrawn.evidence, source_message_id: messageId } : previous
  const budget = object(semantics.budget)
  if (pending.id !== 'financing_down_payment' || budget.confidence !== 'high' || !literal(budget.evidence, current)) return next
  if (['no_defined_budget', 'declines_to_disclose', 'amount_pending'].includes(text(budget.status))) next = {
    status: budget.status === 'no_defined_budget' ? 'not_defined' : budget.status === 'declines_to_disclose' ? 'declined' : 'amount_pending',
    amount: null, evidence: budget.evidence, source_message_id: messageId,
  }
  return next
}

/** Only grounded funds or an actual answer to our own entry question advance
 * the conversation. This records orientation, not a lender approval gate. */
export function financingEntryState(info: Row): Row {
  const finance = object(info.financiamiento)
  const entry = object(finance.entry || info.financing_entry)
  const validMemory = !!text(entry.evidence).trim() && !!text(entry.source_message_id).trim()
  if (validMemory && ['not_defined', 'declined'].includes(text(entry.status))) return { ...entry, answered: true }
  if (validMemory && entry.status === 'missing') return { ...entry, answered: false, question: FINANCING_ENTRY_QUESTION }
  const amounts = object(info.financing_amounts || finance.amounts)
  const down = object(amounts.down_payment)
  const budget = leadBudget(info)
  const declaration = validMemory && entry.status === 'amount' ? entry : Object.keys(down).length ? down
    : budget.status === 'initial_capital' ? budget : {}
  if (typeof declaration.amount === 'number' && Number.isFinite(declaration.amount) && declaration.amount >= 0
    && !!text(declaration.evidence).trim()) return { ...declaration, status: 'amount', answered: true }
  return { status: validMemory && entry.status === 'amount_pending' ? 'amount_pending' : 'missing',
    amount: null, answered: false, question: FINANCING_ENTRY_QUESTION }
}

export const FINANCING_ENTRY_RULES = `La entrada disponible es un dato distinto del presupuesto total. Con pregunta_pendiente.id=financing_down_payment, una respuesta monetaria directa declara financing_amounts.down_payment con evidencia literal actual, nunca total_budget ni loan. Un presupuesto total guardado no se convierte en entrada. Si aún no la ha definido, use budget.status=no_defined_budget con evidencia actual; si no quiere compartirla, declines_to_disclose. El sistema conserva esa respuesta por separado y continúa sin exigir una cifra ni inventar cero. Un sí sin cifra no aporta un monto: amount_pending. Si declara entrada y total en el mismo mensaje, conserve ambos roles. Si cambia o retira una entrada anterior, indique replaces_role=down_payment únicamente cuando lo retire explícitamente. No copie una cantidad histórica como declaración actual.`

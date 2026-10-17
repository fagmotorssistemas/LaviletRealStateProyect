import { leadBudget } from './budget-state'
import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { financingAmountStatements } from './financing-amounts'

export const FINANCING_ENTRY_QUESTION = 'Para orientar el financiamiento, ¿qué monto tendría disponible para la entrada inicial?'
const literal = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())

const formattedAmount = (amount: number) => `$${new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(amount)}`
/** Metadata identifies the delivered collection. Historical prose is opaque. */
export function actualFinancingEntryQuestion(_reply: string, questionRaw: unknown = {}): Row | null {
  const question = object(questionRaw)
  const id = text(question.id || question.continuation_id), act = text(question.act || question.continuation_act)
  const display = text(question.question || question.text).trim()
  return id === 'financing_down_payment' && act === 'financing' && display
    ? { id, act, question: display, entry_question: display } : null
}

/** The known total is offered as a possible entry, not silently reassigned.
 * This reference travels with the actual delivered question so an affirmative
 * answer can confirm its amount without copying historical evidence. */
export function financingEntryQuestion(info: Row): Row {
  const budget = leadBudget(info)
  const amounts = object(info.financing_amounts || object(info.financiamiento).amounts)
  const total = object(amounts.total_budget)
  const reference = budget.status === 'maximum_total' && acceptedExtractorConfidence(budget.confidence) ? budget : total
  if (typeof reference.amount !== 'number' || !Number.isFinite(reference.amount) || reference.amount <= 0
    || !text(reference.evidence).trim()) return { question: FINANCING_ENTRY_QUESTION }
  return {
    question: `Antes nos comentó que tenía un presupuesto de ${formattedAmount(reference.amount)}. Para orientar el financiamiento, ¿destinaría ese monto a la entrada inicial del crédito o tendría prevista otra cantidad?`,
    amount_reference: { kind: 'proposed_down_payment', original_role: 'total_budget', amount: reference.amount,
      evidence: reference.evidence, budget_source: budget.source || 'confirmed_financing_amount' },
  }
}

/** A bare affirmation only has monetary meaning when it answers a delivered
 * concrete amount proposal. The current affirmation supplies its evidence;
 * memory supplies a reference, never a new statement by itself. */
export function deliveredFinancingEntryReference(reply: string, reference: Row): Row | null {
  const amount = reference.amount
  if (reference.kind !== 'proposed_down_payment' || reference.original_role !== 'total_budget'
    || !text(reference.evidence).trim() || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  if (reference.resolution !== 'writer_structured_total_budget_entry_proposal'
    || text(reference.question_source) !== reply.trim() || !text(reference.delivered_question).trim()
    || reference.currency != null && reference.currency !== 'USD') return null
  return reference
}

export function confirmedFinancingEntryReference(raw: Row, current: string, pending: Row): Row | null {
  const reference = object(pending.amount_reference)
  const semantics = object(raw.turn_semantics), answer = object(semantics.answer_to_previous)
  const budget = object(semantics.budget)
  // Typed contextual resolutions are validated against canonical references by
  // the shared input validator. Legacy affirmation recovery must not replace
  // their identities, evidence or amounts (including invalid reference IDs).
  if (budget.amount_reference_id != null || (Array.isArray(raw.financing_amounts)
    && raw.financing_amounts.some(item => object(item).amount_reference_id != null))) return null
  // A historical sentence without the writer's amount receipt grants nothing.
  const delivered = deliveredFinancingEntryReference(text(reference.question_source), reference)
  if (!delivered || pending.act !== 'financing'
    || text(pending.question) !== text(reference.delivered_question).trim().slice(0, 500)) return null
  if (pending.id !== 'financing_down_payment' || !delivered
    || answer.question_id !== pending.id || answer.kind !== 'affirmative' || !acceptedExtractorConfidence(answer.confidence)
    || !literal(answer.evidence, current)
    || !['', 'not_discussed', 'initial_capital'].includes(text(budget.status))) return null
  const statements = financingAmountStatements(raw.financing_amounts || semantics.financing_amounts, current)
  if (statements.some(item => item.role !== 'down_payment' || item.amount !== reference.amount || item.replaces_role)
    || typeof budget.amount === 'number' && (budget.amount !== reference.amount || budget.status !== 'initial_capital')) return null
  return { amount: reference.amount, evidence: text(answer.evidence).trim(), confidence: answer.confidence, amount_reference: delivered,
    resolution: 'affirmative_to_delivered_amount_reference' }
}

export function resolveFinancingEntryReference(raw: Row, current: string, pending: Row): Row {
  const confirmation = confirmedFinancingEntryReference(raw, current, pending)
  if (!confirmation) return raw
  // An explicit current amount, replacement, or other role remains authoritative.
  const semantics = object(raw.turn_semantics)
  return { ...raw,
    financing_amounts: [{ role: 'down_payment', amount: confirmation.amount, evidence: confirmation.evidence, replaces_role: null }],
    turn_semantics: { ...semantics, budget: { status: 'initial_capital', amount: confirmation.amount,
      evidence: confirmation.evidence, confidence: confirmation.confidence } },
    financing_entry_resolution: { kind: confirmation.resolution, question_id: pending.id,
      amount: confirmation.amount, evidence: confirmation.evidence,
      delivered_question: object(confirmation.amount_reference).delivered_question },
  }
}

/** A down payment is a separate declaration, never a reinterpretation of the
 * total purchase budget. Undefined/withheld answers are durable, not zero. */
export function rememberFinancingEntry(previous: Row, current: string, extracted: Row, pending: Row, messageId: string): Row {
  extracted = resolveFinancingEntryReference(extracted, current, pending)
  const semantics = object(extracted.turn_semantics)
  const statements = financingAmountStatements(extracted.financing_amounts || semantics.financing_amounts, current)
  const payment = statements.filter(item => item.role === 'down_payment').at(-1)
  if (payment) return { status: 'amount', amount: payment.amount, evidence: payment.evidence, source_message_id: messageId }
  const withdrawn = statements.find(item => item.replaces_role === 'down_payment')
  let next = withdrawn ? { status: 'missing', amount: null, evidence: withdrawn.evidence, source_message_id: messageId } : previous
  const budget = object(semantics.budget)
  if (pending.id !== 'financing_down_payment' || !acceptedExtractorConfidence(budget.confidence) || !literal(budget.evidence, current)) return next
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
  if (validMemory && entry.status === 'amount_pending') return { status: 'amount_pending', amount: null,
    evidence: entry.evidence, source_message_id: entry.source_message_id, answered: false, question: FINANCING_ENTRY_QUESTION }
  const prompt = financingEntryQuestion(info)
  if (validMemory && entry.status === 'missing') return { ...entry, answered: false, ...prompt }
  const amounts = object(info.financing_amounts || finance.amounts)
  const down = object(amounts.down_payment)
  const budget = leadBudget(info)
  const declaration = validMemory && entry.status === 'amount' ? entry : Object.keys(down).length ? down
    : budget.status === 'initial_capital' ? budget : {}
  if (typeof declaration.amount === 'number' && Number.isFinite(declaration.amount) && declaration.amount >= 0
    && !!text(declaration.evidence).trim()) return { ...declaration, status: 'amount', answered: true }
  return { status: 'missing', amount: null, answered: false, ...prompt }
}

export const FINANCING_ENTRY_RULES = `La entrada disponible es un dato distinto del presupuesto total. Después de aceptar financiamiento, aclare la entrada antes de elegir unidad únicamente si falta. Con pregunta_pendiente.id=financing_down_payment, una respuesta monetaria directa declara financing_amounts.down_payment con evidencia literal actual, nunca total_budget ni loan. Un presupuesto total guardado no se convierte en entrada automáticamente. Si la pregunta REAL propone destinar ese monto conocido a la entrada y pregunta_pendiente.amount_reference lo acredita, una afirmación inequívoca confirma ese referente como down_payment; su evidence es la afirmación actual y conserva total_budget. Un sí a una pregunta genérica sin importe no aporta un monto: amount_pending. Si aún no la ha definido, use budget.status=no_defined_budget con evidencia actual; si no quiere compartirla, declines_to_disclose. El sistema conserva esa respuesta por separado y continúa sin exigir una cifra ni inventar cero. Si declara entrada y total en el mismo mensaje, conserve ambos roles. Si cambia o retira una entrada anterior, indique replaces_role=down_payment únicamente cuando lo retire explícitamente. No copie una cantidad histórica como declaración actual.`

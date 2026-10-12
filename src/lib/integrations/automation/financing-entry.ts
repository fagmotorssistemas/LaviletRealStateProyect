import { object, text, type Row } from './data'
import { financingAmountStatements } from './financing-amounts'
import { leadBudget } from './budget-state'
import { focusedNumericMentions } from './focused-numeric-syntax'

export const FINANCING_ENTRY_QUESTION = 'Para orientar el financiamiento, ¿qué monto tendría disponible para la entrada inicial?'
const literal = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())

const formattedAmount = (amount: number) => `$${new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(amount)}`
const normalizedQuestion = (value: unknown) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** The known total is offered as a possible entry, not silently reassigned.
 * This reference travels with the actual delivered question so an affirmative
 * answer can confirm its amount without copying historical evidence. */
export function financingEntryQuestion(info: Row): Row {
  const budget = leadBudget(info)
  const amounts = object(info.financing_amounts || object(info.financiamiento).amounts)
  const total = object(amounts.total_budget)
  const reference = budget.status === 'maximum_total' && budget.confidence === 'high' ? budget : total
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
  const question = reply.match(/¿[^?]*\?/g)?.at(-1) || ''
  const normalized = normalizedQuestion(question)
  if (!/entrada\s+inicial/.test(normalized) || !/destinar[ií]a\s+ese\s+monto/.test(normalized)) return null
  const preceding = reply.slice(0, reply.lastIndexOf(question))
  const budgetReference = [...preceding.matchAll(/\bpresupuesto\b/gi)].at(-1)
  if (!budgetReference) return null
  // One quantity in this actual budget reference, regardless of separators or
  // digit/written formatting. A range or competing amount has no single referent.
  const budgetClause = preceding.slice(budgetReference.index)
  const quantities = focusedNumericMentions(budgetClause.replace(/(?<=\d)\.(?=\s+(?:\p{L}|¿)|\s*$)/gu, ' '))
  if (quantities.length !== 1 || quantities[0].value !== amount
    || /\b(?:pesos|euros?|eur|libras|yuanes|yenes)\b|[€£¥]/i.test(budgetClause)) return null
  const source = reply.slice(Math.max(0, budgetReference.index - 90)).trim()
  return { ...reference, question_source: source }
}

export function confirmedFinancingEntryReference(raw: Row, current: string, pending: Row): Row | null {
  const reference = object(pending.amount_reference)
  const semantics = object(raw.turn_semantics), answer = object(semantics.answer_to_previous)
  const budget = object(semantics.budget)
  const answerText = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const unqualifiedAcceptance = /^(?:(?:si(?: si)?|claro|de acuerdo|correcto|exacto|esta bien|asi es)(?: (?:claro|por favor|esta bien|correcto|exacto))?|(?:si )?(?:ese (?:monto|presupuesto)|esa cantidad)(?: seria|tambien seria|es)?(?: para (?:la )?entrada(?: inicial)?)?|(?:si )?(?:usaria|destinaria) (?:ese (?:monto|presupuesto)|esa cantidad) (?:como|para) (?:la )?entrada(?: inicial)?)$/.test(answerText)
  const source = text(reference.question_source)
  const delivered = deliveredFinancingEntryReference(source, reference)
  const lastQuestion = source.match(/¿[^?]*\?/g)?.at(-1) || ''
  if (pending.id !== 'financing_down_payment' || !delivered
    || ![normalizedQuestion(source), normalizedQuestion(lastQuestion)].includes(normalizedQuestion(pending.question))
    || answer.question_id !== pending.id || answer.kind !== 'affirmative' || answer.confidence !== 'high'
    || !literal(answer.evidence, current) || !unqualifiedAcceptance
    || !['', 'not_discussed', 'amount_pending', 'initial_capital'].includes(text(budget.status))) return null
  const statements = financingAmountStatements(raw.financing_amounts || semantics.financing_amounts, current)
  if (statements.some(item => item.role !== 'down_payment' || item.amount !== reference.amount || item.replaces_role)
    || typeof budget.amount === 'number' && (budget.amount !== reference.amount || budget.status !== 'initial_capital')) return null
  return { amount: reference.amount, evidence: text(answer.evidence).trim(), amount_reference: delivered }
}

export function resolveFinancingEntryReference(raw: Row, current: string, pending: Row): Row {
  const confirmation = confirmedFinancingEntryReference(raw, current, pending)
  if (!confirmation) return raw
  // An explicit current amount, replacement, or other role remains authoritative.
  const semantics = object(raw.turn_semantics)
  return { ...raw,
    financing_amounts: [{ role: 'down_payment', amount: confirmation.amount, evidence: confirmation.evidence, replaces_role: null }],
    turn_semantics: { ...semantics, budget: { status: 'initial_capital', amount: confirmation.amount,
      evidence: confirmation.evidence, confidence: 'high' } },
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

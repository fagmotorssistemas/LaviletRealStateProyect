import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { financingAmountStatements } from './financing-amounts'
import { leadBudget } from './budget-state'
import { focusedNumericMentions } from './focused-numeric-syntax'
import { replyQuestions } from './reply-question'
import { normalized } from './sdr-rules'
import { simpleReservationAcceptance } from './reservation-invitation'

export const FINANCING_ENTRY_QUESTION = 'Para orientar el financiamiento, ¿qué monto tendría disponible para la entrada inicial?'
const literal = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())

const formattedAmount = (amount: number) => `$${new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(amount)}`
const normalizedQuestion = (value: unknown) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

const entryRole = (value: string) => /\bentrada(?:\s+inicial)?\b|\b(?:cuota|pago)\s+inicial\b/.test(normalized(value))
// A demonstrative points to the unique delivered monetary proposal; it does not
// need to repeat the entry role or a number. Meaning still requires the typed
// affirmative answer to this exact question and the verified receipt below.
const monetaryReference = (value: string) => /\b(?:es(?:[ea]|t[ea])|aquel(?:la)?|el mismo|la misma)\s+(?:monto|importe|presupuesto|dinero|capital|cantidad|suma)\b/.test(normalized(value))
const unqualified = (value: string) => {
  if (/[¿?]/.test(value)) return false
  const answer = normalized(value)
  // Strip the acknowledgement, never a subordinate condition. A remaining
  // "si" introduces an unresolved premise even when the model says affirmative.
  const remainder = answer.replace(/^si\b\s*/, '')
  return (!/\bsi\b/.test(remainder) || simpleReservationAcceptance(value))
    && !/\b(?:no|nunca|tampoco|pero|solo|solamente|parte|parcial|otra|otro|distint[oa]|depende|quizas|tal vez|siempre que|a condicion|en caso|fuera|fuese|hubiera|hubiese|tuviera|tuviese|pudiera|pudiese)\b/.test(answer)
}

/** Recognize the collection actually emitted, including an indirect request
 * followed by a generic confirmation. The latter is not an independent decision
 * and cannot inherit a planned meaning without the explicit entry proposition. */
export function actualFinancingEntryQuestion(reply: string): Row | null {
  const questions = replyQuestions(reply)
  if (!questions.length) return null
  const entryQuestions = questions.filter(entryRole)
  const last = questions.at(-1)!
  const genericConfirmation = /\bconfirm\w*\b/.test(normalized(last))
    && !/\b(?:nombre|residencia|presupuesto|credito|financiamiento|unidad|departamento|suite|penthouse|local|planta|piso|dormitorios?|visita|reserva)\b/.test(normalized(last))
  if (entryQuestions.length !== 1 || questions.some(question => question !== entryQuestions[0]
    && !(question === last && genericConfirmation))) return null
  const entry = entryQuestions[0]
  if (!/\b(?:que|cual|cuanto|cuanta|cuantos|cuantas|si|destinar\w*|usar\w*|utilizar\w*|dispon\w*|previst\w*|tendr\w*)\b/.test(normalized(entry))) return null
  // A question about a price or lender condition is information, not collection.
  if (/\b(?:cuesta|costo|precio|minim[oa]|requisitos|exige|requiere|requieren|obligatori[oa])\b/.test(normalized(entry))) return null
  return { id: 'financing_down_payment', act: 'financing', question: questions.join(' '), entry_question: entry }
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
  const actual = actualFinancingEntryQuestion(reply)
  if (!actual) return null
  const question = text(actual.entry_question)
  const preceding = reply.slice(0, reply.lastIndexOf(question))
  // The amount may appear inside the question itself, or in its immediately
  // preceding total-budget proposition. Only that delivered reference is used.
  const budgetReference = [...preceding.matchAll(/\bpresupuesto\b/gi)].at(-1)
  const proposition = budgetReference ? preceding.slice(budgetReference.index) + question : question
  if (!/\bpresupuesto\b/.test(normalized(proposition))
    || !/\b(?:destin\w*|usar\w*|utiliz\w*|correspond\w*|seria|es|entrada)\b/.test(normalized(question))) return null
  const quantities = focusedNumericMentions(proposition.replace(/(?<=\d)\.(?=\s+(?:\p{L}|¿)|\s*$)/gu, ' '))
  if (quantities.length !== 1 || quantities[0].value !== amount
    || /\b(?:pesos|euros?|eur|libras|yuanes|yenes)\b|[€£¥]/i.test(proposition)) return null
  return { ...reference, question_source: reply.trim(), delivered_question: actual.question,
    resolution: 'delivered_total_budget_entry_proposal' }
}

export function confirmedFinancingEntryReference(raw: Row, current: string, pending: Row): Row | null {
  const reference = object(pending.amount_reference)
  const semantics = object(raw.turn_semantics), answer = object(semantics.answer_to_previous)
  const budget = object(semantics.budget)
  const source = text(reference.question_source)
  const delivered = deliveredFinancingEntryReference(source, reference)
  const actualQuestion = actualFinancingEntryQuestion(source)
  const questions = replyQuestions(source)
  const currentQuantities = focusedNumericMentions(current)
  const interpretedEntry = budget.status === 'initial_capital' && budget.amount === reference.amount
    && acceptedExtractorConfidence(budget.confidence) && literal(budget.evidence, current)
  const receiptWordings = [source, text(actualQuestion?.question), ...questions]
  if (pending.id !== 'financing_down_payment' || !delivered
    // normalizedPendingQuestion bounds the receipt wording to 500 characters;
    // the complete delivered source and numeric proposal remain in the reference.
    || !receiptWordings.flatMap(question => [normalizedQuestion(question), normalizedQuestion(question.trim().slice(0, 500))]).includes(normalizedQuestion(pending.question))
    || answer.question_id !== pending.id || answer.kind !== 'affirmative' || !acceptedExtractorConfidence(answer.confidence)
    || !literal(answer.evidence, current) || !unqualified(current)
    || !(simpleReservationAcceptance(current) || entryRole(current) || monetaryReference(current) || interpretedEntry)
    || currentQuantities.some(quantity => quantity.value !== reference.amount)
    || !['', 'not_discussed', 'amount_pending', 'initial_capital'].includes(text(budget.status))) return null
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

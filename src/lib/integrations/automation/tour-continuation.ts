import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { parseCommercialPrice } from '@/lib/inmobiliaria/unitPrices'

type BudgetStatus = 'not_discussed' | 'unknown' | 'amount' | 'maximum_total' | 'initial_capital'
  | 'sufficient_for_selected_unit' | 'insufficient_for_selected_unit' | 'declines_to_disclose'
type Budget = { status: BudgetStatus; amount: number | null; source: string }
export type TourContinuation = {
  reply: string
  question: string
  pending_question: Row
  reason: string
  budget: Budget
}

const statuses = new Set<BudgetStatus>(['not_discussed', 'unknown', 'amount', 'maximum_total', 'initial_capital',
  'sufficient_for_selected_unit', 'insufficient_for_selected_unit', 'declines_to_disclose'])
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value : []).map(object)
const positive = (value: unknown): number | null => value !== null && value !== '' && typeof value !== 'boolean'
  && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
const budgetTopic = (value: string) => /presupuesto|capital|entrada|cuanto.*(?:invertir|dispone|cuenta)|monto disponible/.test(normalized(value))

function declaredAmount(value: string, contextual: boolean): number | null {
  const m = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  // Unit numbers, dates, income and prices in the assistant's messages are not
  // declarations of purchasing capacity. Anchor each candidate at the client's
  // financial declaration, never at the first number of a multi-topic message.
  const declarations = [...m.matchAll(/\b(?:presupuesto|capital(?: inicial)?|entrada|cuento con|dispongo de|tengo|puedo invertir)\b/g)]
  const candidates = declarations.map((declaration, index) => ({
    value: m.slice((declaration.index || 0) + declaration[0].length, declarations[index + 1]?.index),
    explicit: !['tengo', 'cuento con', 'dispongo de', 'puedo invertir'].includes(declaration[0]),
    negated: /\bno\s*$/.test(m.slice(Math.max(0, (declaration.index || 0) - 12), declaration.index)),
  }))
  const bareAnswer = /^(?:(?:si|unos?|aproximadamente|alrededor de|serian)\s*[,.:]?\s*)*\$?\s*\d[\d.,]*(?:\s*(?:mil|miles|k))?(?:\s*(?:dolares|usd))?[.!\s]*$/.test(m.trim())
  if (contextual && bareAnswer) candidates.push({ value: m, explicit: true, negated: false })
  // Also permit a literal amount preceding its explicit financial meaning.
  if (/^(?:(?:son|unos?|aproximadamente|alrededor de|con)\s+)*\$?\s*\d[\d.,]*(?:\s*(?:mil|miles|k))?(?:\s*(?:dolares|usd))?\s+(?:para (?:la )?entrada|de presupuesto|como capital inicial)\b/.test(m.trim())) {
    candidates.push({ value: m, explicit: true, negated: false })
  }
  let declared: number | null = null
  for (const candidate of candidates) {
    if (candidate.negated) continue
    const match = candidate.value.match(/(?:\$\s*)?(\d(?:[\d.,]*\d)?)(?:\s*(mil|miles|k)\b)?/)
    if (!match) continue
    const before = candidate.value.slice(0, match.index)
    if (!/^(?:\s|[,.:=]|\b(?:si|un|una|unos|unas|de|es|seria|serian|son|total|aproximado|aproximadamente|alrededor|para|la|el|compra|disponible|con)\b)*$/.test(before)) continue
    const after = candidate.value.slice((match.index || 0) + match[0].length)
    if (/^\s*(?:cuartos?|dormitorios?|habitaciones?|anos?|meses?|metros?|m2|personas?|hijos?|departamentos?|suites?|penthouses?|planta|piso|mensuales?)\b/.test(after)) continue
    if (/^\s*[a-z]/.test(after) && !/^\s*(?:dolares|usd|para|de|como|aproximadamente|y|pero)\b/.test(after)) continue
    if (!candidate.explicit && !match[2] && !/\$|\b(?:dolares|usd)\b/.test(candidate.value)) continue
    try {
      const amount = parseCommercialPrice(match[1])
      declared = positive(amount && amount * (match[2] ? 1000 : 1)) ?? declared
    } catch { /* An invalid monetary declaration cannot replace an earlier one. */ }
  }
  return declared
}

function budgetDeclaration(value: string, previous: Budget, previousQuestion = '', source = 'lead_declaration'): Budget | null {
  const m = normalized(value), context = budgetTopic(previousQuestion)
  if ((context || budgetTopic(m)) && /\b(?:prefiero no|no quiero|no deseo|no voy a|no me gustaria)\b.*(?:decir|indicar|compartir|dar|hablar)|\b(?:es privado|es personal|no lo voy a decir)\b/.test(m)) {
    return { status: 'declines_to_disclose', amount: null, source }
  }
  if ((context || budgetTopic(m)) && /\bno (?:se|estoy segur[oa]|tengo claro|he pensado|lo he pensado|tengo idea)\b/.test(m)) {
    return { status: 'unknown', amount: null, source }
  }
  const amount = declaredAmount(value, context)
  const entry = /\b(?:para (?:la )?entrada|capital inicial|de entrada|para (?:el )?(?:pago|aporte) inicial)\b/.test(m)
  const total = /\b(?:presupuesto(?: total)?|total para (?:la )?compra|valor total|monto total|para (?:la )?compra completa)\b/.test(m)
  if (amount === null && !(context && previous.amount !== null && (entry || total))) return null
  const status: BudgetStatus = entry ? 'initial_capital' : total ? 'maximum_total'
    : context && /presupuesto.*(?:para la compra|total)|total.*compra/.test(normalized(previousQuestion)) ? 'maximum_total' : 'amount'
  return { status, amount: amount ?? previous.amount, source }
}

function knownBudget(info: Row, current: string): Budget {
  const known = object(object(info.conversacion).datos_conocidos), lead = object(info.lead)
  const storedAmount = [known.presupuesto, lead.budget_max, lead.budget].map(positive).find(value => value !== null) ?? null
  let budget: Budget = { status: storedAmount === null ? 'not_discussed' : 'amount', amount: storedAmount, source: storedAmount === null ? 'none' : 'lead_budget' }
  const storedText = text(known.presupuesto_texto) || text(object(object(lead.behavior_signals).sdr).presupuesto_texto)
  budget = budgetDeclaration(storedText, budget, '', 'qualification') || budget
  let previousQuestion = ''
  for (const row of rows(info.historial)) {
    if (['bot', 'asesor'].includes(text(row.role))) previousQuestion = text(row.content)
    else if (row.role === 'cliente') budget = budgetDeclaration(text(row.content), budget, previousQuestion, 'history') || budget
  }
  budget = budgetDeclaration(current, budget, text(object(info.conversacion).ultima_respuesta) || previousQuestion, 'current_message') || budget
  const semantic = object(object(info.semantica_turno).budget)
  const status = text(semantic.status) as BudgetStatus
  if (semantic.confidence === 'high' && statuses.has(status) && status !== 'not_discussed') {
    budget = { status, amount: ['unknown', 'declines_to_disclose'].includes(status) ? null : positive(semantic.amount) ?? budget.amount, source: 'turn_semantics' }
  }
  const deferred = object(info.memoria_comercial).deferred_fields
  if (budget.status === 'not_discussed' && Array.isArray(deferred) && deferred.includes('presupuesto')) {
    budget = { status: 'unknown', amount: null, source: 'commercial_memory' }
  }
  return budget
}

/** All single-unit tour routes share one next step. This plans conversation only:
 * it never changes the selected unit, starts financing or authorizes a visit. */
export function tourContinuation(info: Row, unit: Row = {}, current = ''): TourContinuation {
  const budget = knownBudget(info, current)
  const answer = (question: string, reason: string, id = '', statement = ''): TourContinuation => ({
    reply: [statement, question].filter(Boolean).join(' '), question, reason, budget,
    pending_question: id ? { id, act: 'budget', question } : {},
  })
  const semantics = object(info.semantica_turno)
  if (['request_visit', 'ask_financing'].includes(text(semantics.primary_intent)) && semantics.confidence === 'high') {
    return answer('', 'requested_action_pending')
  }
  if (budget.status === 'not_discussed' || budget.status === 'maximum_total' && budget.amount === null) {
    return answer('¿Qué presupuesto aproximado tiene previsto para la compra?', 'budget_missing', 'budget_amount')
  }
  if (budget.status === 'initial_capital' && budget.amount === null) {
    return answer('¿Con qué monto aproximado cuenta para la entrada?', 'initial_capital_amount_missing', 'budget_amount')
  }
  if (budget.status === 'amount') return answer('¿Ese monto corresponde a su presupuesto total para la compra o al dinero disponible para la entrada?', 'budget_kind_missing', 'budget_kind')
  const detailQuestion = '¿Qué le gustaría revisar con más detalle de esta opción?'
  if (budget.status === 'declines_to_disclose') return answer(detailQuestion, 'budget_declined')
  if (budget.status === 'unknown') return answer(detailQuestion, 'budget_deferred')
  const finance = object(info.financiamiento)
  const financingAvailable = Array.isArray(finance.partners) && finance.partners.some(partner => text(partner).trim())
  const financingActive = object(finance.current).explicit_consent === true
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

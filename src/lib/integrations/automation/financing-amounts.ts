import { object, text, type Row } from './data'
import { BUDGET_QUESTION_CONTEXT_RULES } from './budget-question-context'

const amountRoles = ['total_budget', 'down_payment', 'loan']
export const FINANCING_AMOUNTS_SCHEMA = { type: 'array', maxItems: 3, items: {
  type: 'object', additionalProperties: false,
  properties: { role: { type: ['string', 'null'], enum: [...amountRoles, null] },
    amount: { type: ['number', 'null'] }, evidence: { type: 'string' },
    replaces_role: { type: ['string', 'null'], enum: [...amountRoles, null] } },
  required: ['role', 'amount', 'evidence', 'replaces_role'],
} }
export const FINANCING_AMOUNTS_RULES = `${BUDGET_QUESTION_CONTEXT_RULES}
financing_amounts separa cantidades declaradas: total_budget es presupuesto total, down_payment es entrada/capital aportado y loan es importe que desea financiar. Conserve máximo UNA cifra vigente por rol. Una autocorrección posterior sustituye la anterior: «financiar 10 mil, mejor 100 mil» deja loan=100000, nunca dos solicitudes vigentes contradictorias. «Entrada de 200 mil y financiar 100 mil» produce dos roles distintos; no invente que suman el precio de la unidad. Cada evidence es una cita literal actual; resuelva «los 100» con la magnitud inequívoca de la conversación, sin convertir cualquier cifra baja en miles. Una aclaración de la finalidad de un importe conocido es una novedad aunque repita la misma cantidad: conserve la evidencia de esa aclaración y su rol. Coordine AMBOS bloques: entrada explícita requiere down_payment y budget.status=initial_capital; presupuesto total explícito requiere total_budget y budget.status=maximum_total; un crédito solicitado requiere loan y nunca se convierte en presupuesto o entrada. budget.status=amount conserva únicamente una cantidad cuya finalidad sigue sin definir; no lo use cuando el cliente ya la precisó. La pregunta anterior permite identificar el referente y la finalidad expresamente preguntada, sin decidir un consentimiento ni completar el importe.
replaces_role identifica únicamente el rol anterior que el cliente retira o reasigna explícitamente en el mensaje actual; null en una declaración independiente, aunque coincidan los importes. «Esos 200 mil no son entrada, son el préstamo que solicitaría» declara loan=200000 y replaces_role=down_payment. «Los 200 mil no son entrada y aún no sé cómo repartirlos» retira down_payment usando role=null, amount=null y replaces_role=down_payment, y puede mantener budget.status=amount si el importe sigue conocido pero ambiguo. Para retirar un presupuesto total o un crédito aplique el mismo contrato. No retire otros roles ni iguale entrada y crédito por coincidencia numérica. Una retirada sin nueva cantidad no necesita inventarla. Solo una cita actual de la corrección autoriza replaces_role; el historial no. Si niega que sea entrada no lo marque down_payment; si aún no distingue total y entrada mantenga la ambigüedad sin inventar fondos. No calcule cuotas, aprobaciones o una entrada que el cliente no declaró.`

const citation = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
const sameStatement = (left: unknown, right: unknown) => !!citation(left) && !!citation(right)
  && (citation(left).includes(citation(right)) || citation(right).includes(citation(left)))

/** Current model meaning, including an explicit withdrawal without assigning a
 * replacement. Legacy declarations omit replaces_role and retain their role. */
export function financingAmountStatements(raw: unknown, current: string): Row[] {
  return (Array.isArray(raw) ? raw.map(object) : []).flatMap(item => {
    if (!citation(item.evidence) || !citation(current).includes(citation(item.evidence))) return []
    const replaces = amountRoles.includes(text(item.replaces_role)) ? text(item.replaces_role) : null
    if (item.replaces_role != null && !replaces) return []
    const declaration = amountRoles.includes(text(item.role)) && typeof item.amount === 'number'
      && Number.isFinite(item.amount) && item.amount >= 0
    const withdrawal = item.role === null && item.amount === null && !!replaces
    return declaration || withdrawal ? [{ role: declaration ? text(item.role) : null, amount: declaration ? item.amount : null,
      evidence: text(item.evidence).trim(), ...(replaces ? { replaces_role: replaces } : {}) }] : []
  }).slice(0, 3)
}

export function monetaryInterpretationIssues(raw: Row, current: string): string[] {
  const budget = object(object(raw.turn_semantics).budget)
  const expected = budget.status === 'initial_capital' ? 'down_payment' : budget.status === 'maximum_total' ? 'total_budget' : ''
  if (!expected || budget.confidence !== 'high' || !citation(budget.evidence) || !citation(current).includes(citation(budget.evidence))) return []
  const statements = financingAmountStatements(raw.financing_amounts, current)
  const amounts = financingAmounts({}, statements, current)
  const contradictoryReplacement = statements.some(item => item.replaces_role === expected && item.role !== expected
    && sameStatement(item.evidence, budget.evidence))
  return contradictoryReplacement || Object.entries(amounts).some(([role, value]) => role !== expected && object(value).amount === budget.amount
    && sameStatement(object(value).evidence, budget.evidence)) ? ['inconsistent_budget_role'] : []
}

/** The model owns monetary meaning. This reconciles only its already grounded
 * role declarations; no vocabulary rule assigns a role to an amount. */
export function reconcileMonetaryInterpretation(raw: Row, current: string): Row {
  if (monetaryInterpretationIssues(raw, current).length) return raw
  const semantics = object(raw.turn_semantics), budget = object(semantics.budget)
  const statements = financingAmountStatements(raw.financing_amounts, current)
  let amounts = financingAmounts({}, statements, current)
  const budgetCurrent = budget.confidence === 'high' && !!citation(budget.evidence)
    && citation(current).includes(citation(budget.evidence))
  const roleFromStatus = budget.status === 'initial_capital' ? 'down_payment'
    : budget.status === 'maximum_total' ? 'total_budget' : ''
  if (budgetCurrent && roleFromStatus && typeof budget.amount === 'number' && Number.isFinite(budget.amount)
    && budget.amount > 0 && !amounts[roleFromStatus]) {
    statements.push({ role: roleFromStatus, amount: budget.amount, evidence: budget.evidence })
    amounts = financingAmounts({}, statements, current)
  }
  const sameAmount = budgetCurrent && typeof budget.amount === 'number'
    ? Object.entries(amounts).filter(([, value]) => object(value).amount === budget.amount
      && sameStatement(object(value).evidence, budget.evidence)) : []
  let reconciledBudget = budget
  if (sameAmount.length === 1) {
    const [role, value] = sameAmount[0]
    reconciledBudget = role === 'loan'
      ? { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' }
      : { ...budget, status: role === 'down_payment' ? 'initial_capital' : 'maximum_total',
        evidence: object(value).evidence, confidence: 'high' }
  }
  return { ...raw, financing_amounts: statements,
    turn_semantics: { ...semantics, budget: reconciledBudget } }
}

export function financingAmounts(previous: Row, raw: unknown, current: string): Row {
  const next = { ...previous }
  for (const item of financingAmountStatements(raw, current)) {
    if (item.replaces_role) delete next[text(item.replaces_role)]
    if (item.role) next[text(item.role)] = { amount: item.amount, evidence: item.evidence }
  }
  return next
}

export function financingBalance(amounts: Row, unit: Row | null, authorized: boolean): Row | null {
  const price = unit?.published_commercial_price
  const down = object(amounts.down_payment).amount, loan = object(amounts.loan).amount
  if (!authorized || typeof price !== 'number' || typeof down !== 'number' || typeof loan !== 'number'
    || ![price, down, loan].every(Number.isFinite)) return null
  const difference = Math.round((price - down - loan) * 100) / 100
  return { unit_id: unit?.id, unit_number: unit?.unit_number, price, down_payment: down, loan,
    difference, status: difference > 0 ? 'shortfall' : difference < 0 ? 'excess' : 'balanced',
    instruction: difference === 0 ? 'La suma coincide con el precio publicado; esto no aprueba un crédito ni sus condiciones.'
      : 'La entrada y el crédito propuestos no coinciden con el precio publicado. Explique la diferencia y pregunte qué importe desea ajustar; no ajuste silenciosamente, no diga que cubren el saldo y no prometa aprobación.' }
}

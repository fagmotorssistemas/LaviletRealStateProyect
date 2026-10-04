import { object, text, type Row } from './data'

export const FINANCING_AMOUNTS_SCHEMA = { type: 'array', maxItems: 3, items: {
  type: 'object', additionalProperties: false,
  properties: { role: { type: 'string', enum: ['total_budget', 'down_payment', 'loan'] },
    amount: { type: 'number' }, evidence: { type: 'string' } }, required: ['role', 'amount', 'evidence'],
} }
export const FINANCING_AMOUNTS_RULES = `financing_amounts separa cantidades declaradas: total_budget es presupuesto total, down_payment es entrada/capital aportado y loan es importe que desea financiar. Conserve máximo UNA cifra vigente por rol. Una autocorrección posterior sustituye la anterior: «financiar 10 mil, mejor 100 mil» deja loan=100000, nunca dos solicitudes vigentes contradictorias. «Entrada de 200 mil y financiar 100 mil» produce dos roles distintos; no invente que suman el precio de la unidad. Cada evidence es una cita literal actual; resuelva «los 100» con la magnitud inequívoca de la conversación, sin convertir cualquier cifra baja en miles. No coloque loan en budget ni cambie presupuesto total por importe de crédito. No calcule cuotas, aprobaciones o una entrada que el cliente no declaró. Si la finalidad es ambigua conserve la ambigüedad y pida aclaración.`

export function financingAmounts(previous: Row, raw: unknown, current: string): Row {
  const next = { ...previous }
  for (const item of Array.isArray(raw) ? raw.map(object) : []) {
    if (!['total_budget', 'down_payment', 'loan'].includes(text(item.role))
      || typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0
      || !text(item.evidence).trim() || !current.toLowerCase().includes(text(item.evidence).trim().toLowerCase())) continue
    next[text(item.role)] = { amount: item.amount, evidence: item.evidence }
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

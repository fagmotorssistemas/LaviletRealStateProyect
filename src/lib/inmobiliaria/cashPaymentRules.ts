export type CashPaymentRules = {
  enabled: boolean; mode: 'todos' | 'lanzamiento' | 'preventa'
  definition: string; timing: string; reservation: string; expenses: string
  discount: 'unconfirmed' | 'none' | 'discount_rules'
  source: string; checkedOn: string; reviewBy: string
}
export type CashPaymentState = { settings: CashPaymentRules; version: string; saved: boolean }
export type CashPaymentResult = { ok: true; state: CashPaymentState } | { ok: false; error: string }
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
export function defaultCashPaymentRules(): CashPaymentRules {
  return { enabled: false, mode: 'todos', definition: '', timing: '', reservation: '', expenses: '', discount: 'unconfirmed', source: '', checkedOn: '', reviewBy: '' }
}
export function validateCashPaymentRules(value: unknown, today = new Date().toISOString().slice(0, 10)): CashPaymentRules {
  const v = row(value)
  const str = (key: string, max = 1600) => {
    if (typeof v[key] !== 'string' || (v[key] as string).length > max) throw Error('Revise los textos de las condiciones de pago al contado.')
    return (v[key] as string).trim()
  }
  if (typeof v.enabled !== 'boolean' || !['todos', 'lanzamiento', 'preventa'].includes(String(v.mode))
    || !['unconfirmed', 'none', 'discount_rules'].includes(String(v.discount))) throw Error('Revise el estado, la etapa y la política de descuento.')
  const result: CashPaymentRules = { enabled: v.enabled, mode: v.mode as CashPaymentRules['mode'], discount: v.discount as CashPaymentRules['discount'],
    definition: str('definition'), timing: str('timing'), reservation: str('reservation'), expenses: str('expenses'),
    source: str('source'), checkedOn: str('checkedOn', 10), reviewBy: str('reviewBy', 10) }
  for (const date of [result.checkedOn, result.reviewBy]) if (date && !validDate(date)) throw Error('Revise las fechas de comprobación de la fuente.')
  if (result.checkedOn > today || result.reviewBy && (!result.checkedOn || result.reviewBy < result.checkedOn)) throw Error('Revise las fechas de verificación y próxima revisión.')
  if (result.enabled && (!result.source || !result.checkedOn || ![result.definition, result.timing, result.reservation, result.expenses].some(Boolean)
    && result.discount === 'unconfirmed')) throw Error('Para activar, complete al menos una condición confirmada, su fuente y fecha de verificación.')
  return result
}
export function cashPaymentSettings(policies: unknown): CashPaymentRules {
  try { return validateCashPaymentRules(row(policies).cash_payment_rules) } catch { return defaultCashPaymentRules() }
}
export function changeCashPaymentRules(policies: unknown, settings: unknown, actor: string, now: string) {
  return { ...row(policies), cash_payment_rules: { ...validateCashPaymentRules(settings), updatedBy: actor, updatedAt: now } }
}
export function cashPaymentContext(policies: unknown, mode: string, today: string) {
  const settings = cashPaymentSettings(policies)
  const status = !settings.enabled ? 'unconfirmed' : settings.mode !== 'todos' && settings.mode !== mode ? 'out_of_stage'
    : settings.checkedOn > today || settings.reviewBy && settings.reviewBy < today ? 'source_review_due' : 'active'
  return { status, direct_credit: false,
    ...(status === 'active' ? { definition: settings.definition || null, timing: settings.timing || null,
      reservation: settings.reservation || null, expenses: settings.expenses || null, additional_cash_discount: settings.discount,
      source: settings.source, checked_on: settings.checkedOn } : {}),
    instruction: 'Comunique solo las condiciones activas y explícitas. Un campo vacío significa sin confirmar, no gratuito ni sin requisito. Pagar al contado no activa financiamiento ni implica que el proyecto dé crédito directo. additional_cash_discount=none significa que no hay rebaja adicional por esta forma de pago: no niega beneficios de lanzamiento ya incluidos. discount_rules remite a politica_descuentos y sus cotizaciones vigentes; no autoriza un porcentaje, cálculo, acumulación ni descuento nuevo. Una negociación personal se deriva al asesor. Las instrucciones de pago y la validación de fondos corresponden al equipo; no invente cuentas ni confirme un pago.' }
}

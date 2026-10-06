export const EARLY_PURCHASE_DISCOUNT_VERSION = 'early-purchase-discounts-v1'
export const EARLY_PURCHASE_DISCOUNT_RULES = `Los descuentos se comunican solo desde early_purchase_discount calculado y vigente para la unidad; una regla desactivada, sin fuente, vencida o fuera de alcance no acredita un beneficio. Con status=conditional explique la condición pendiente antes de mencionar el precio resultante; no lo presente como precio actual, concedido ni garantizado. La intención de reservar, una solicitud al asesor y un presupuesto no confirman la reserva ni satisfacen condition=reservation_confirmed. advance_purchase requiere las condiciones comerciales autorizadas y su comprobación, no supone que el cliente ya compró.
base_mode=catalog_additional calcula una sola rebaja sobre catalog_base_price. base_mode=included_in_catalog significa que el precio publicado YA contiene ese descuento: nunca vuelva a restarlo. Sin base_price y discount_amount autorizados no invente un precio original, ahorro monetario ni valor futuro mediante una operación inversa. Un precio original documentado no es una promesa de precio posterior. Los descuentos no se acumulan; prevalece una regla específica de unidad sobre una de categoría y sobre una general. Un conflicto deja el descuento pendiente de confirmar.
El ahorro comercial no es el monto de reserva, la entrada inicial ni la aprobación de un crédito; no reduce esos pagos automáticamente ni acredita inventario reservado. Conserve fuente, vigencia, porcentaje y condiciones. Los importes de referencia calculados por el sistema pueden comunicarse como condicionados; no invente cálculos alternativos. No ofrezca el porcentaje del borrador como si fuera una política publicada.`
export const DISCOUNT_CATEGORIES = ['suite', 'departamento', 'penthouse', 'local'] as const
export type DiscountCategory = typeof DISCOUNT_CATEGORIES[number]
export type DiscountRule = {
  id: string; name: string; enabled: boolean; percent: number
  categories: DiscountCategory[]; unitNumbers: string[]; mode: 'todos' | 'lanzamiento' | 'preventa'
  base: 'catalog_additional' | 'included_in_catalog'
  condition: 'reservation_confirmed' | 'advance_purchase'; conditions: string
  startDate: string; endDate: string; source: string; checkedOn: string; reviewBy: string
  referencePrices: { unitNumber: string; amount: number }[]
}
export type EarlyPurchaseDiscountSettings = {
  enabled: boolean; stacking: false; rules: DiscountRule[]; updatedAt?: string; updatedBy?: string
}
export type EarlyPurchaseDiscountState = { settings: EarlyPurchaseDiscountSettings; version: string; saved: boolean }
export type EarlyPurchaseDiscountResult = { ok: true; state: EarlyPurchaseDiscountState } | { ok: false; error: string }
type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
class DiscountConfigurationError extends Error {
  constructor(message: string, readonly code = 'invalid_settings') { super(message) }
}
const fail = (message: string, code?: string): never => { throw new DiscountConfigurationError(message, code) }
const unitKey = (value: string) => value.toUpperCase().replace(/\s+/g, '').replace(/^LC-?0*(\d+)$/, 'LC-$1').replace(/^0+(\d+)$/, '$1')
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function draftEarlyPurchaseDiscount(id = 'early-purchase-draft'): DiscountRule {
  return { id, name: 'Descuento por compra anticipada', enabled: false, percent: 5, categories: [], unitNumbers: [],
    mode: 'lanzamiento', base: 'catalog_additional', condition: 'reservation_confirmed', conditions: '',
    startDate: '', endDate: '', source: '', checkedOn: '', reviewBy: '', referencePrices: [] }
}
/** The example percentage is an unpublished draft, never a project benefit. */
export function defaultEarlyPurchaseDiscountSettings(): EarlyPurchaseDiscountSettings {
  return { enabled: false, stacking: false, rules: [draftEarlyPurchaseDiscount()] }
}
const priority = (rule: DiscountRule) => rule.unitNumbers.length ? 2 : rule.categories.length ? 1 : 0
const intersects = (a: string[], b: string[]) => !a.length || !b.length || a.some(value => b.includes(value))
export function conflictingDiscountRules(a: DiscountRule, b: DiscountRule) {
  return a.enabled && b.enabled && priority(a) === priority(b)
    && (a.mode === 'todos' || b.mode === 'todos' || a.mode === b.mode)
    && intersects(a.categories, b.categories) && intersects(a.unitNumbers.map(unitKey), b.unitNumbers.map(unitKey))
    && (!a.endDate || !b.startDate || a.endDate >= b.startDate)
    && (!b.endDate || !a.startDate || b.endDate >= a.startDate)
}

export function validateEarlyPurchaseDiscountSettings(value: unknown, today = new Date().toISOString().slice(0, 10)): EarlyPurchaseDiscountSettings {
  const input = record(value)
  const bool = (value: unknown) => typeof value === 'boolean' ? value : fail('Revise los interruptores de descuentos.')
  const str = (value: unknown, max = 1000) => typeof value === 'string' && value.length <= max ? value.trim() : fail('Revise los textos de las reglas de descuento.')
  const date = (value: unknown) => { const result = str(value, 10); return !result || validDate(result) ? result : fail('Revise las fechas del descuento.') }
  const choice = <T extends string>(value: unknown, allowed: T[]): T => allowed.includes(value as T) ? value as T : fail('Seleccione una opción válida para el descuento.')
  const numbers = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(n => typeof n === 'string' && /^(?:LC-?)?\d{1,4}$/i.test(n.trim()))
    ? [...new Set(value.map(n => unitKey(n.trim())))] : fail('Revise los códigos de unidad. Use, por ejemplo, 304 o LC-02.')
  if (input.stacking !== false) fail('Los descuentos no se acumulan; debe aplicarse una sola regla.')
  if (!Array.isArray(input.rules) || input.rules.length > 30) fail('Puede configurar hasta 30 reglas de descuento.')
  const rules = (input.rules as unknown[]).map(raw => {
    const r = record(raw)
    const categories = Array.isArray(r.categories) && r.categories.length <= 4 && r.categories.every(c => DISCOUNT_CATEGORIES.includes(c))
      ? [...new Set(r.categories)] as DiscountCategory[] : fail('Revise los tipos de inmueble del descuento.')
    const percent = typeof r.percent === 'number' && Number.isFinite(r.percent) && r.percent > 0 && r.percent < 100
      ? r.percent : fail('El descuento debe ser mayor que 0 y menor que 100 %.')
    const referencePrices = Array.isArray(r.referencePrices) && r.referencePrices.length <= 100 ? r.referencePrices.map(raw => {
      const reference = record(raw), unitNumber = numbers([reference.unitNumber])[0], amount = reference.amount
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 || money(amount) !== amount) fail('Revise los precios originales autorizados por unidad; use importes positivos con hasta dos decimales.')
      return { unitNumber, amount: amount as number }
    }) : fail('Revise las referencias de precio original.')
    if (new Set(referencePrices.map(price => price.unitNumber)).size !== referencePrices.length) fail('No repita una referencia de precio original para la misma unidad.')
    const rule: DiscountRule = { id: str(r.id, 80), name: str(r.name, 160), enabled: bool(r.enabled), percent,
      categories: categories.length === DISCOUNT_CATEGORIES.length ? [] : categories,
      unitNumbers: numbers(r.unitNumbers), mode: choice(r.mode, ['todos', 'lanzamiento', 'preventa']),
      base: choice(r.base, ['catalog_additional', 'included_in_catalog']), condition: choice(r.condition, ['reservation_confirmed', 'advance_purchase']),
      conditions: str(r.conditions, 1600), startDate: date(r.startDate), endDate: date(r.endDate),
      source: str(r.source, 1600), checkedOn: date(r.checkedOn), reviewBy: date(r.reviewBy), referencePrices }
    if (!/^[\w-]{1,80}$/.test(rule.id) || !rule.name) fail('Cada regla necesita un identificador y un nombre.')
    if (rule.endDate && (!rule.startDate || rule.endDate < rule.startDate)) fail('El fin de vigencia debe ser posterior o igual al inicio.')
    if (rule.reviewBy && (!rule.checkedOn || rule.reviewBy < rule.checkedOn)) fail('La revisión de la fuente debe ser posterior o igual a su verificación.')
    if (rule.checkedOn > today) fail('La fuente no puede haberse verificado en una fecha futura.')
    if (rule.enabled && (!rule.source || !rule.checkedOn || !rule.startDate || !rule.conditions)) fail('Para activar una regla complete la fuente, la verificación, el inicio de vigencia y las condiciones autorizadas.')
    if (rule.unitNumbers.length && referencePrices.some(price => !rule.unitNumbers.includes(price.unitNumber))) fail('Las referencias originales deben pertenecer a las unidades de esta regla.')
    return rule
  })
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) fail('No repita el identificador de una regla.')
  for (let i = 0; i < rules.length; i++) for (const other of rules.slice(i + 1)) if (conflictingDiscountRules(rules[i], other)) {
    fail(`Las reglas «${rules[i].name}» y «${other.name}» coinciden con la misma prioridad y vigencia. Ajuste su alcance o desactive una.`, 'same_priority_rules')
  }
  return { enabled: bool(input.enabled), stacking: false, rules,
    ...(typeof input.updatedAt === 'string' ? { updatedAt: input.updatedAt } : {}),
    ...(typeof input.updatedBy === 'string' ? { updatedBy: input.updatedBy } : {}) }
}

export function earlyPurchaseDiscountSettings(policies: unknown): EarlyPurchaseDiscountSettings {
  const stored = record(policies).early_purchase_discounts
  if (stored === undefined) return defaultEarlyPurchaseDiscountSettings()
  try { return validateEarlyPurchaseDiscountSettings(stored) } catch { return { enabled: false, stacking: false, rules: [] } }
}
export function changeEarlyPurchaseDiscountSettings(policies: unknown, settings: unknown, actor: string, now: string) {
  return { ...record(policies), early_purchase_discounts: { ...validateEarlyPurchaseDiscountSettings(settings), updatedBy: actor, updatedAt: now } }
}

export type DiscountContext = {
  mode: string; today?: string; pricesAuthorized: boolean; reservationConfirmed?: boolean; advancePurchaseConfirmed?: boolean
}
export type DiscountQuote = {
  version: string; settings_version: string | null; as_of: string; status: 'disabled' | 'not_applicable' | 'unavailable' | 'conflict' | 'conditional' | 'eligible'
  reason: string; unit_id: string | null; unit_number: string | null
  rule_id: string | null; rule_name: string | null; percent: number | null; base_mode: DiscountRule['base'] | null
  catalog_price: number | null; base_price: number | null; discount_amount: number | null; final_price: number | null
  condition: DiscountRule['condition'] | null; conditions: string | null; condition_met: boolean; price_is_conditional: boolean
  source: string | null; checked_on: string | null; valid_from: string | null; valid_until: string | null
  inventory_reserved: false; financial_consent: false
}
/** Scope, expiry and arithmetic are resolved on the server, never by an agent. */
export function discountQuote(unitInput: unknown, settingsInput: EarlyPurchaseDiscountSettings, context: DiscountContext): DiscountQuote {
  const unit = record(unitInput), price = unit.published_commercial_price
  const quoted: DiscountQuote = { version: EARLY_PURCHASE_DISCOUNT_VERSION, settings_version: settingsInput.updatedAt || null,
    as_of: context.today || new Date().toISOString().slice(0, 10),
    status: 'not_applicable', reason: 'no_matching_rule', unit_id: text(unit.id) || null, unit_number: text(unit.unit_number) || null,
    rule_id: null, rule_name: null, percent: null, base_mode: null, catalog_price: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null,
    base_price: null, discount_amount: null, final_price: null, condition: null, conditions: null, condition_met: false, price_is_conditional: false,
    source: null, checked_on: null, valid_from: null, valid_until: null, inventory_reserved: false, financial_consent: false }
  let settings: EarlyPurchaseDiscountSettings
  try { settings = validateEarlyPurchaseDiscountSettings(settingsInput, context.today) } catch (error) {
    return { ...quoted, status: error instanceof DiscountConfigurationError && error.code === 'same_priority_rules' ? 'conflict' : 'unavailable',
      reason: error instanceof DiscountConfigurationError ? error.code : 'invalid_settings' }
  }
  if (!settings.enabled) return { ...quoted, status: 'disabled', reason: 'discounts_disabled' }
  if (!text(unit.id) || !text(unit.unit_number) || !DISCOUNT_CATEGORIES.includes(unit.category as DiscountCategory)) return { ...quoted, status: 'unavailable', reason: 'unit_identity_or_category_unverified' }
  if (unit.is_published !== true || unit.status !== 'disponible') return { ...quoted, status: 'unavailable', reason: 'unit_not_available_or_published' }
  if (!context.pricesAuthorized || quoted.catalog_price === null) return { ...quoted, status: 'unavailable', reason: 'catalog_price_not_authorized' }
  const today = quoted.as_of
  if (!validDate(today)) return { ...quoted, status: 'unavailable', reason: 'invalid_reference_date' }
  const candidates = settings.rules.filter(rule => rule.enabled && (rule.mode === 'todos' || rule.mode === context.mode)
    && (!rule.categories.length || rule.categories.includes(unit.category as DiscountCategory))
    && (!rule.unitNumbers.length || rule.unitNumbers.includes(unitKey(text(unit.unit_number))))
    && rule.source && rule.checkedOn && rule.checkedOn <= today && rule.startDate <= today
    && (!rule.endDate || rule.endDate >= today) && (!rule.reviewBy || rule.reviewBy >= today)).sort((a, b) => priority(b) - priority(a))
  if (!candidates.length) return quoted
  if (candidates[1] && priority(candidates[0]) === priority(candidates[1])) return { ...quoted, status: 'conflict', reason: 'same_priority_rules' }
  const rule = candidates[0], catalogPrice = quoted.catalog_price
  const confirmed = rule.condition === 'reservation_confirmed' ? context.reservationConfirmed === true : context.advancePurchaseConfirmed === true
  const original = rule.referencePrices.find(reference => reference.unitNumber === unitKey(text(unit.unit_number)))?.amount
  if (rule.base === 'included_in_catalog' && original !== undefined && Math.abs(money(original * (1 - rule.percent / 100)) - catalogPrice) > 0.01) {
    return { ...quoted, status: 'unavailable', reason: 'included_price_reference_mismatch', rule_id: rule.id }
  }
  const basePrice = rule.base === 'catalog_additional' ? catalogPrice : original ?? null
  const finalPrice = rule.base === 'catalog_additional' ? money(catalogPrice * (1 - rule.percent / 100)) : catalogPrice
  if (finalPrice <= 0) return { ...quoted, status: 'unavailable', reason: 'discounted_price_not_positive', rule_id: rule.id }
  return { ...quoted, status: confirmed ? 'eligible' : 'conditional', reason: confirmed ? 'condition_verified' : 'condition_not_verified',
    rule_id: rule.id, rule_name: rule.name, percent: rule.percent, base_mode: rule.base,
    base_price: basePrice, discount_amount: basePrice === null ? null : money(basePrice - finalPrice), final_price: finalPrice,
    condition: rule.condition, conditions: rule.conditions, condition_met: confirmed, price_is_conditional: !confirmed,
    source: rule.source, checked_on: rule.checkedOn, valid_from: rule.startDate, valid_until: rule.endDate || null }
}

/** Keep the original catalogue value and the conditional quote separately.
 * A prospect's interest or a handoff receipt never confirms a reservation. */
export type DiscountPriceFields = { catalog_base_price: unknown; early_purchase_discount: DiscountQuote;
  discount_reference_price?: number | null; discount_amount_reference?: number | null; discounted_price_reference?: number | null;
  discount_percent?: number | null; discount_condition_met?: boolean }
export function applyEarlyPurchaseDiscount<T extends Row>(unit: T, quote: DiscountQuote): T & DiscountPriceFields {
  const active = ['conditional', 'eligible'].includes(quote.status) && quote.unit_id === unit.id && quote.catalog_price === unit.published_commercial_price
  return { ...unit, catalog_base_price: unit.published_commercial_price, early_purchase_discount: quote,
    ...(active ? { discount_reference_price: quote.base_price, discount_amount_reference: quote.discount_amount,
      discounted_price_reference: quote.final_price, discount_percent: quote.percent, discount_condition_met: quote.condition_met } : {}),
    ...(active && quote.status === 'eligible' && quote.condition_met && quote.final_price !== null ? { published_commercial_price: quote.final_price } : {}) }
}

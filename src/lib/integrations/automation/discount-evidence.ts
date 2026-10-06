import { object, text, type Row } from './data'
import { EARLY_PURCHASE_DISCOUNT_VERSION } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'

export const DISCOUNT_NUMBER_FIELDS = ['discount_reference_price', 'discount_amount_reference',
  'discounted_price_reference', 'discount_percent'] as const
export type DiscountNumberField = typeof DISCOUNT_NUMBER_FIELDS[number]
export const DISCOUNT_FACT_UNITS: Record<DiscountNumberField, string> = {
  discount_reference_price: 'USD', discount_amount_reference: 'USD', discounted_price_reference: 'USD', discount_percent: 'percent',
}
const quoteField: Record<DiscountNumberField, string> = {
  discount_reference_price: 'base_price', discount_amount_reference: 'discount_amount',
  discounted_price_reference: 'final_price', discount_percent: 'percent',
}
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

/** Only a current, code-computed, individual quote supplies discount references.
 * These references attest arithmetic, never commercial fulfillment or a booking. */
export function discountReferenceEvidence(unit: Row): { available: boolean; quote: Row; values: Partial<Record<DiscountNumberField, number>> } {
  const quote = object(unit.early_purchase_discount)
  const unavailable = { available: false, quote, values: {} }
  if (unit.aggregation || Array.isArray(unit.member_ids) || quote.version !== EARLY_PURCHASE_DISCOUNT_VERSION
    || !['conditional', 'eligible'].includes(text(quote.status)) || quote.unit_id !== unit.id
    || !text(unit.id) || quote.unit_number !== unit.unit_number || !text(quote.rule_id) || !text(quote.source)
    || !text(quote.conditions) || !['reservation_confirmed', 'advance_purchase'].includes(text(quote.condition))
    || !validDate(quote.as_of) || !validDate(quote.checked_on) || text(quote.checked_on) > text(quote.as_of)
    || !validDate(quote.valid_from) || text(quote.valid_from) > text(quote.as_of)
    || quote.valid_until != null && (!validDate(quote.valid_until) || text(quote.valid_until) < text(quote.as_of))
    || !numeric(quote.catalog_price) || quote.catalog_price <= 0
    || !numeric(quote.percent) || quote.percent <= 0 || quote.percent >= 100
    || !numeric(quote.final_price) || quote.final_price <= 0) return unavailable
  const met = quote.status === 'eligible'
  if (quote.condition_met !== met || quote.price_is_conditional !== !met
    || unit.discount_condition_met !== undefined && unit.discount_condition_met !== met
    || unit.catalog_base_price !== undefined && unit.catalog_base_price !== quote.catalog_price
    || unit.published_commercial_price !== (met ? quote.final_price : quote.catalog_price)) return unavailable
  if (quote.base_mode === 'catalog_additional') {
    if (quote.base_price !== quote.catalog_price || quote.final_price !== money(quote.catalog_price * (1 - quote.percent / 100))) return unavailable
  } else if (quote.base_mode === 'included_in_catalog') {
    if (quote.final_price !== quote.catalog_price || quote.base_price == null && quote.discount_amount != null
      || quote.base_price != null && (!numeric(quote.base_price) || quote.base_price <= 0
        || Math.abs(money(quote.base_price * (1 - quote.percent / 100)) - quote.final_price) > 0.01)) return unavailable
  } else return unavailable
  if (quote.base_price != null && (!numeric(quote.base_price)
    || quote.discount_amount !== money(quote.base_price - quote.final_price))) return unavailable
  const values: Partial<Record<DiscountNumberField, number>> = {}
  for (const field of DISCOUNT_NUMBER_FIELDS) {
    const value = quote[quoteField[field]]
    if (unit[field] !== undefined && unit[field] !== value) return unavailable
    if (numeric(value)) values[field] = value
  }
  return { available: true, quote, values }
}

/** Retain the meaning and provenance, without shipping the full policy editor.
 * A price-prohibited context cannot expose monetary quote references. */
export function compactDiscountEvidence(unit: Row, prices: boolean): Row {
  const evidence = discountReferenceEvidence(unit)
  const quote = evidence.quote
  if (!Object.keys(quote).length) return {}
  const metadata = ['version', 'settings_version', 'as_of', 'status', 'reason', 'unit_id', 'unit_number', 'rule_id', 'rule_name',
    'base_mode', 'condition', 'conditions', 'condition_met', 'price_is_conditional', 'source', 'checked_on',
    'valid_from', 'valid_until', 'inventory_reserved', 'financial_consent']
  const compact = Object.fromEntries(metadata.filter(key => quote[key] !== undefined).map(key => [key, quote[key]]))
  if (!prices || !evidence.available) return { early_purchase_discount: {
    ...compact, ...(['conditional', 'eligible'].includes(text(quote.status)) ? { status: 'unavailable',
      reason: prices ? 'discount_evidence_incomplete' : 'prices_not_authorized', condition_met: false, price_is_conditional: false } : {}),
  } }
  return { catalog_base_price: quote.catalog_price, early_purchase_discount: { ...compact,
    ...Object.fromEntries(['catalog_price', 'base_price', 'discount_amount', 'final_price', 'percent'].map(key => [key, quote[key]])) },
  ...evidence.values, discount_condition_met: quote.condition_met }
}

export const DISCOUNT_REFERENCE_RULES = `Los campos discount_reference_price, discount_amount_reference y discounted_price_reference se miden en USD; discount_percent se mide en percent. Identifique la unidad concreta y su early_purchase_discount vigente, no un grupo ni otra regla. Estas cifras son referencias del cálculo: no prueban que el descuento esté concedido, que la reserva esté confirmada ni que haya consentimiento financiero. Con status=conditional el precio publicado sigue siendo published_commercial_price y el precio resultante es condicionado. La condición, fuente y vigencia se revisan semánticamente; la coincidencia numérica no las satisface. included_in_catalog no admite otra resta ni un precio original inventado. Sin referencia original autorizada, no afirme un ahorro monetario. No agregue descuentos de reglas distintas ni use discount_percent como porcentaje de entrada o reserva.`

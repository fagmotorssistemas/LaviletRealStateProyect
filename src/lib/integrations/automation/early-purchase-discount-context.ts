import { applyEarlyPurchaseDiscount, discountQuote, type EarlyPurchaseDiscountSettings } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { type Row } from './data'

/** Interest, a reservation request and a handoff never satisfy a discount.
 * This context quotes the authorized offer; fulfilment requires a formal
 * commercial receipt, which this conversational workflow does not issue. */
export function earlyPurchaseDiscountContext(units: Row[], settings: EarlyPurchaseDiscountSettings,
  input: { mode: string; today: string; pricesAuthorized: boolean }) {
  const quotes = units.map(unit => discountQuote(unit, settings, input))
  const active = quotes.filter(quote => quote.status === 'conditional' || quote.status === 'eligible')
  const rules = [...new Set(active.map(quote => quote.rule_id))].map(id => {
    const quote = active.find(quote => quote.rule_id === id)!
    const rule = settings.rules.find(rule => rule.id === id)!
    return { id, name: quote.rule_name, percent: quote.percent, base_mode: quote.base_mode,
      categories: rule.categories, unit_numbers: rule.unitNumbers, mode: rule.mode,
      condition: quote.condition, conditions: quote.conditions, source: quote.source,
      checked_on: quote.checked_on, valid_from: quote.valid_from, valid_until: quote.valid_until }
  })
  return { units: units.map((unit, index) => active.includes(quotes[index])
    ? applyEarlyPurchaseDiscount(unit, quotes[index]) : unit),
  policy: { enabled: settings.enabled, version: 'early-purchase-discounts-v1',
    as_of: input.today,
    settings_version: settings.updatedAt || null, stacking: false,
    status: !settings.enabled ? 'disabled' : rules.length ? 'conditional_offers' : 'no_verified_applicable_offer',
    rules,
    instruction: 'Solo las reglas y cotizaciones activas aquí son fuente de descuentos. No hay confirmación comercial de cumplimiento: el interés en comprar o reservar no concede el beneficio. Sin oferta aplicable no afirme un porcentaje, ahorro ni ausencia permanente de descuentos. Un descuento documentado no demuestra un precio futuro. La reserva y la entrada tienen sus propias condiciones.' } }
}

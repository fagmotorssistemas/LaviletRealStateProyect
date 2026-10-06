import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultEarlyPurchaseDiscountSettings, draftEarlyPurchaseDiscount } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { defaultFinancingGuidance } from '@/lib/inmobiliaria/financingGuidance'
import { earlyPurchaseDiscountContext } from './early-purchase-discount-context'
import { financingPolicyContext, financingQuoteContext } from './financing-quote'

const unit = { id: 'unit304', category: 'departamento', unit_number: '304', is_published: true,
  status: 'disponible', published_commercial_price: 270000 }
const current = { mode: 'lanzamiento', today: '2026-10-06', pricesAuthorized: true }
const configured = () => ({ enabled: true, stacking: false as const, rules: [{ ...draftEarlyPurchaseDiscount(),
  enabled: true, conditions: 'Reserva confirmada por el equipo con el pago acordado.',
  source: 'Oferta comercial autorizada', checkedOn: '2026-10-01', startDate: '2026-10-01', endDate: '2026-10-31' }] })

test('disabled example never enters catalogue evidence or active offer context', () => {
  const result = earlyPurchaseDiscountContext([unit], defaultEarlyPurchaseDiscountSettings(), current)
  assert.deepEqual(result.units, [unit])
  assert.deepEqual(result.policy.rules, [])
  assert.equal(result.policy.status, 'disabled')
  assert.equal(JSON.stringify(result).includes('"percent":5'), false)
})

test('authorized discount is quoted conditionally without changing affordability or reserving inventory', () => {
  const result = earlyPurchaseDiscountContext([unit], configured(), current)
  const quote = result.units[0].early_purchase_discount
  assert.equal(result.units[0].published_commercial_price, 270000)
  assert.equal(result.units[0].discounted_price_reference, 256500)
  assert.equal(quote.status, 'conditional')
  assert.equal(quote.condition_met, false)
  assert.equal(quote.inventory_reserved, false)
  assert.equal(quote.financial_consent, false)
  assert.equal(result.policy.rules[0].percent, 5)
  assert.equal(result.policy.rules[0].source, 'Oferta comercial autorizada')
})

test('expired, hidden and unavailable units cannot expose an active benefit', () => {
  for (const [units, input] of [
    [[unit], { ...current, today: '2026-11-01' }],
    [[unit], { ...current, pricesAuthorized: false }],
    [[{ ...unit, status: 'vendido' }], current],
    [[{ ...unit, is_published: false }], current],
  ] as const) {
    const result = earlyPurchaseDiscountContext([...units], configured(), input)
    assert.deepEqual(result.policy.rules, [])
    assert.equal(result.units[0].early_purchase_discount, undefined)
  }
})

test('unit-specific offers retain their scope rather than becoming a universal percentage', () => {
  const settings = configured(); settings.rules[0].unitNumbers = ['304']
  const result = earlyPurchaseDiscountContext([unit, { ...unit, id: 'unit404', unit_number: '404' }], settings, current)
  assert.equal(result.units[0].discount_percent, 5)
  assert.equal(result.units[1].discount_percent, undefined)
  assert.deepEqual(result.policy.rules[0].unit_numbers, ['304'])
})

test('discount already included in the price is never applied again or inverted without a reference', () => {
  const settings = configured(); settings.rules[0].base = 'included_in_catalog'
  const result = earlyPurchaseDiscountContext([unit], settings, current)
  assert.equal(result.units[0].published_commercial_price, 270000)
  assert.equal(result.units[0].discounted_price_reference, 270000)
  assert.equal(result.units[0].discount_reference_price, null)
  assert.equal(result.units[0].discount_amount_reference, null)
})

test('financing keeps the published basis while the commercial discount is pending', () => {
  const result = earlyPurchaseDiscountContext([unit], configured(), current)
  const info = { catalogo: result.units, property_context: { selected_ids: ['unit304'] }, modo_comercial: current.mode,
    politica_comercial: { precios_autorizados: true }, politica_descuentos: result.policy,
    politica_financiera: { guidance: financingPolicyContext(defaultFinancingGuidance(), ['Banco Pichincha'], current.today) } }
  const quote = financingQuoteContext(info, { requested: true, beforeApplication: true,
    evidence: 'cuánto sería la entrada y la cuota', years: null })
  assert.equal(quote.estimates[0].price, 270000)
  assert.equal(quote.estimates[0].maximum_loan_reference, 216000)
  assert.equal(quote.estimates[0].pricing_basis, 'catalog_price_pending_discount')
  assert.equal(quote.pending_discount.final_price, 256500)
  assert.equal(quote.pending_discount.condition_met, false)
})

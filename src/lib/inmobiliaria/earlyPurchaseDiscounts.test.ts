import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEarlyPurchaseDiscount, changeEarlyPurchaseDiscountSettings, defaultEarlyPurchaseDiscountSettings, discountQuote, draftEarlyPurchaseDiscount, earlyPurchaseDiscountSettings, validateEarlyPurchaseDiscountSettings, type DiscountRule, type EarlyPurchaseDiscountSettings } from './earlyPurchaseDiscounts'

const today = '2026-10-06'
const unit = { id: 'u304', unit_number: '304', category: 'departamento', is_published: true, status: 'disponible', published_commercial_price: 270000 }
const context = { today, mode: 'lanzamiento', pricesAuthorized: true }
const activeRule = (values: Partial<DiscountRule> = {}): DiscountRule => ({ ...draftEarlyPurchaseDiscount(), enabled: true,
  name: 'Beneficio autorizado', startDate: '2026-10-01', endDate: '2026-10-31', checkedOn: '2026-10-01', reviewBy: '2026-10-31',
  source: 'Resolución comercial autorizada', conditions: 'Beneficio sujeto a una reserva formal confirmada por el proyecto.', ...values })
const activeSettings = (rules: DiscountRule[] = [activeRule()]): EarlyPurchaseDiscountSettings => ({ enabled: true, stacking: false, rules, updatedAt: 'revision-1' })

test('the sample percentage is an inactive draft and malformed stored settings fail closed', () => {
  const settings = defaultEarlyPurchaseDiscountSettings()
  assert.equal(settings.enabled, false)
  assert.equal(settings.rules[0].enabled, false)
  assert.equal(settings.rules[0].percent, 5)
  assert.equal(discountQuote(unit, settings, context).status, 'disabled')
  assert.deepEqual(earlyPurchaseDiscountSettings({ early_purchase_discounts: { enabled: 'true' } }), { enabled: false, stacking: false, rules: [] })
})

test('additional discounts calculate exact money while retaining the published price until the condition is confirmed', () => {
  const quote = discountQuote(unit, activeSettings(), context)
  assert.equal(quote.status, 'conditional')
  assert.equal(quote.catalog_price, 270000)
  assert.equal(quote.base_price, 270000)
  assert.equal(quote.discount_amount, 13500)
  assert.equal(quote.final_price, 256500)
  assert.equal(quote.percent, 5)
  assert.equal(quote.condition_met, false)
  assert.equal(quote.inventory_reserved, false)
  assert.equal(quote.financial_consent, false)
  const scoped = applyEarlyPurchaseDiscount(unit, quote)
  assert.equal(scoped.published_commercial_price, 270000)
  assert.equal(scoped.catalog_base_price, 270000)
  assert.equal(scoped.discounted_price_reference, 256500)
  assert.equal(scoped.discount_amount_reference, 13500)
  assert.equal(unit.published_commercial_price, 270000)
  const confirmed = discountQuote(unit, activeSettings(), { ...context, reservationConfirmed: true })
  assert.equal(confirmed.status, 'eligible')
  assert.equal(applyEarlyPurchaseDiscount(unit, confirmed).published_commercial_price, 256500)
})

test('included discounts are never subtracted again or inverted to invent a reference price', () => {
  const settings = activeSettings([activeRule({ base: 'included_in_catalog' })])
  const quote = discountQuote(unit, settings, context)
  assert.equal(quote.final_price, 270000)
  assert.equal(quote.base_price, null)
  assert.equal(quote.discount_amount, null)
  assert.equal(quote.percent, 5)
  assert.equal(applyEarlyPurchaseDiscount(unit, quote).published_commercial_price, 270000)
  const reference = activeSettings([activeRule({ base: 'included_in_catalog', percent: 10, referencePrices: [{ unitNumber: '304', amount: 300000 }] })])
  const known = discountQuote(unit, reference, context)
  assert.equal(known.base_price, 300000)
  assert.equal(known.discount_amount, 30000)
  assert.equal(known.final_price, 270000)
  reference.rules[0].referencePrices[0].amount = 310000
  assert.equal(discountQuote(unit, reference, context).reason, 'included_price_reference_mismatch')
})

test('a source authorizing original reference prices does not turn them into guaranteed future prices', () => {
  const settings = activeSettings([activeRule({ base: 'included_in_catalog', percent: 10, referencePrices: [{ unitNumber: '304', amount: 300000 }] })])
  const quote = discountQuote(unit, settings, context)
  assert.equal(quote.price_is_conditional, true)
  assert.equal(quote.settings_version, 'revision-1')
  assert.equal(quote.source, 'Resolución comercial autorizada')
  assert.equal(quote.condition, 'reservation_confirmed')
  assert.equal(quote.valid_until, '2026-10-31')
  assert.equal('future_price' in quote, false)
})

test('unit, category and general priority applies one rule without stacking', () => {
  const rules = [activeRule({ id: 'all', percent: 3 }), activeRule({ id: 'category', categories: ['departamento'], percent: 4 }),
    activeRule({ id: 'one', unitNumbers: ['304'], percent: 5 })]
  const settings = activeSettings(rules)
  validateEarlyPurchaseDiscountSettings(settings, today)
  assert.equal(discountQuote(unit, settings, context).rule_id, 'one')
  assert.equal(discountQuote({ ...unit, unit_number: '404' }, settings, context).rule_id, 'category')
  assert.equal(discountQuote({ ...unit, unit_number: '601', category: 'penthouse' }, settings, context).rule_id, 'all')
  assert.equal(discountQuote(unit, settings, context).final_price, 256500)
})

test('equal priority overlap is rejected while disjoint units, categories, modes or validity periods remain configurable', () => {
  assert.throws(() => validateEarlyPurchaseDiscountSettings(activeSettings([activeRule({ id: 'a' }), activeRule({ id: 'b' })]), today), /misma prioridad/)
  assert.equal(discountQuote(unit, activeSettings([activeRule({ id: 'a' }), activeRule({ id: 'b' })]), context).status, 'conflict')
  assert.equal(discountQuote(unit, activeSettings([activeRule({ id: 'a' }), activeRule({ id: 'b' })]), context).final_price, null)
  for (const [first, second] of [
    [{ unitNumbers: ['304'] }, { unitNumbers: ['404'] }],
    [{ categories: ['suite'] }, { categories: ['departamento'] }],
    [{ mode: 'lanzamiento' }, { mode: 'preventa' }],
    [{ startDate: '2026-10-01', endDate: '2026-10-10' }, { startDate: '2026-10-11', endDate: '2026-10-31' }],
  ] as [Partial<DiscountRule>, Partial<DiscountRule>][]) {
    assert.doesNotThrow(() => validateEarlyPurchaseDiscountSettings(activeSettings([activeRule({ id: 'a', ...first }), activeRule({ id: 'b', ...second })]), today))
  }
})

test('code normalization matches commercial zero padding without confusing it with residential units', () => {
  const settings = activeSettings([activeRule({ unitNumbers: ['LC-002'] })])
  assert.equal(discountQuote({ ...unit, category: 'local', unit_number: 'LC02' }, settings, context).status, 'conditional')
  assert.equal(discountQuote({ ...unit, unit_number: '002' }, settings, context).status, 'not_applicable')
  assert.equal(discountQuote({ ...unit, unit_number: '0304' }, activeSettings([activeRule({ unitNumbers: ['304'] })]), context).status, 'conditional')
})

test('global, rule and source activation, dates and exact scope control eligibility independently from testing mode', () => {
  for (const rule of [activeRule({ enabled: false }), activeRule({ categories: ['suite'] }), activeRule({ unitNumbers: ['404'] }),
    activeRule({ mode: 'preventa' }), activeRule({ startDate: '2026-10-07' }), activeRule({ endDate: '2026-10-05' }), activeRule({ reviewBy: '2026-10-05' })]) {
    assert.equal(discountQuote(unit, activeSettings([rule]), context).status, 'not_applicable')
  }
  const paused = activeSettings(); paused.enabled = false
  assert.equal(discountQuote(unit, paused, context).status, 'disabled')
  for (const change of [{ source: '' }, { checkedOn: '' }, { conditions: '' }, { startDate: '' }]) {
    assert.throws(() => validateEarlyPurchaseDiscountSettings(activeSettings([activeRule(change)]), today))
  }
})

test('absent, unapproved, unpublished or unavailable prices never produce a monetary quote', () => {
  for (const changed of [{ published_commercial_price: undefined }, { published_commercial_price: null }, { published_commercial_price: 0 },
    { published_commercial_price: -10 }, { published_commercial_price: Infinity }, { is_published: false }, { status: 'vendido' }, { status: 'reservado' },
    { id: undefined }, { unit_number: '' }, { category: 'casa' }]) {
    const quote = discountQuote({ ...unit, ...changed }, activeSettings(), context)
    assert.equal(quote.status, 'unavailable')
    assert.equal(quote.final_price, null)
    assert.equal(quote.discount_amount, null)
  }
  assert.equal(discountQuote(unit, activeSettings(), { ...context, pricesAuthorized: false }).final_price, null)
})

test('reservation and advance purchase conditions require separate verified state', () => {
  assert.equal(discountQuote(unit, activeSettings(), { ...context, advancePurchaseConfirmed: true }).condition_met, false)
  const settings = activeSettings([activeRule({ condition: 'advance_purchase' })])
  assert.equal(discountQuote(unit, settings, { ...context, reservationConfirmed: true }).condition_met, false)
  assert.equal(discountQuote(unit, settings, { ...context, advancePurchaseConfirmed: true }).condition_met, true)
})

test('rounding produces cents without a zero-priced or negative result', () => {
  const quoted = discountQuote({ ...unit, published_commercial_price: 123456.78 }, activeSettings([activeRule({ percent: 7.5 })]), context)
  assert.equal(quoted.final_price, 114197.52)
  assert.equal(quoted.discount_amount, 9259.26)
  assert.equal(discountQuote({ ...unit, published_commercial_price: 0.01 }, activeSettings([activeRule({ percent: 99.99 })]), context).status, 'unavailable')
})

test('applying a quote cannot reuse another unit or a stale catalog price', () => {
  const quote = discountQuote(unit, activeSettings(), { ...context, reservationConfirmed: true })
  for (const other of [{ ...unit, id: 'other' }, { ...unit, published_commercial_price: 300000 }]) {
    const copy = applyEarlyPurchaseDiscount(other, quote)
    assert.equal(copy.published_commercial_price, other.published_commercial_price)
    assert.equal('discounted_price_reference' in copy, false)
  }
})

test('malformed scopes, dates, percent, identifiers and stacking cannot enter published configuration', () => {
  for (const change of [{ percent: 0 }, { percent: 100 }, { percent: NaN }, { checkedOn: '2026-10-07' },
    { startDate: '2026-02-30' }, { endDate: '2026-09-30' }, { unitNumbers: ['unknown'] }, { categories: ['casa'] },
    { referencePrices: [{ unitNumber: '304', amount: -10 }] }, { id: '' }]) {
    assert.throws(() => validateEarlyPurchaseDiscountSettings(activeSettings([activeRule(change as Partial<DiscountRule>)]), today))
  }
  const stacked = { ...activeSettings(), stacking: true }
  assert.throws(() => validateEarlyPurchaseDiscountSettings(stacked, today), /no se acumulan/)
})

test('updating discounts preserves every other project policy and audit identity', () => {
  const policies = changeEarlyPurchaseDiscountSettings({ response_review: { enabled: false }, financing_guidance: { keep: 'exact' } }, activeSettings(), 'administrator', '2026-10-06T10:00:00Z')
  assert.deepEqual(policies.response_review, { enabled: false })
  assert.deepEqual(policies.financing_guidance, { keep: 'exact' })
  const settings = earlyPurchaseDiscountSettings(policies)
  assert.equal(settings.updatedBy, 'administrator')
  assert.equal(settings.updatedAt, '2026-10-06T10:00:00Z')
})

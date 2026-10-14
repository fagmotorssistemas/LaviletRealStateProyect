import test from 'node:test'
import assert from 'node:assert/strict'
import { cashPaymentContext, changeCashPaymentRules, defaultCashPaymentRules, validateCashPaymentRules } from './cashPaymentRules'
import { discountSettingsDiagnostics } from './discountSettingsDiagnostics'
import { draftEarlyPurchaseDiscount } from './earlyPurchaseDiscounts'
import { nextUrgentReservation } from './urgentReservationNotifications'
import { verifiedClaimSources } from '@/lib/integrations/automation/turn-evidence'
import { businessRiskContext } from '@/lib/integrations/automation/business-risk-review'
import type { AdvisorNotification } from '@/types/inmobiliaria'

test('cash rules default to unknown and never invent payment timing, a discount or direct credit', () => {
  const context = cashPaymentContext({}, 'lanzamiento', '2026-10-14')
  assert.equal(context.status, 'unconfirmed'); assert.equal(context.direct_credit, false)
  assert.equal('timing' in context, false)
  assert.throws(() => validateCashPaymentRules({ ...defaultCashPaymentRules(), enabled: true }))
})
test('published cash terms preserve other policies, scope and verification dates, and reach factual review', () => {
  const rules = { ...defaultCashPaymentRules(), enabled: true, definition: 'Pago con fondos propios.', discount: 'none' as const,
    mode: 'lanzamiento' as const, source: 'Responsable comercial', checkedOn: '2026-10-01', reviewBy: '2026-10-31' }
  const policies = changeCashPaymentRules({ early_purchase_discounts: { preserve: true } }, rules, 'admin', '2026-10-14T00:00:00Z')
  assert.deepEqual(policies.early_purchase_discounts, { preserve: true })
  const context = cashPaymentContext(policies, 'lanzamiento', '2026-10-14')
  assert.equal(context.status, 'active'); assert.equal(context.additional_cash_discount, 'none'); assert.equal(context.timing, null)
  assert.equal(cashPaymentContext(policies, 'preventa', '2026-10-14').status, 'out_of_stage')
  assert.equal(cashPaymentContext(policies, 'lanzamiento', '2026-11-01').status, 'source_review_due')
  const verified = { politica_pago_contado: context }
  const sources = verifiedClaimSources(verified, {}, { units: [], groups: [] }, '')
  assert.ok(sources.some(source => source.path === 'contexto_verificado.politica_pago_contado'))
  const review = businessRiskContext({ current: '', reply: 'Pago con fondos propios.', obligations: [], units: [], groups: [], projectFacts: [], claimSources: sources, verified, audit: {}, allowedLinks: [] })
  assert.match(JSON.stringify(review), /Pago con fondos propios/)
})
test('cash settings reject malformed dates and missing authorized sources', () => {
  for (const patch of [{ checkedOn: '2026-02-30' }, { checkedOn: '2999-01-01' }, { checkedOn: '2026-10-01', reviewBy: '2026-09-01' }])
    assert.throws(() => validateCashPaymentRules({ ...defaultCashPaymentRules(), ...patch }, '2026-10-14'))
})
test('discount diagnostics explain an empty configuration, disabled rule, stage, expiry and real included quote', () => {
  const context = { today: '2026-10-14', mode: 'lanzamiento', pricesAuthorized: true }
  const settings = { enabled: true, stacking: false as const, rules: [{ ...draftEarlyPurchaseDiscount(), enabled: true, percent: 10,
    base: 'included_in_catalog' as const, condition: 'published_price' as const, source: 'Responsable', checkedOn: '2026-10-01',
    startDate: '2026-10-01', conditions: 'El precio publicado ya incluye el beneficio.' }] }
  const units = [{ id: 'u', unit_number: '202', category: 'departamento', status: 'disponible', is_published: true, published_commercial_price: 250000 }]
  assert.match(discountSettingsDiagnostics({ ...settings, rules: [] }, units, context).summary, /no hay reglas guardadas/)
  assert.match(discountSettingsDiagnostics({ ...settings, rules: [{ ...settings.rules[0], enabled: false }] }, units, context).summary, /todas las reglas están desactivadas/)
  assert.match(discountSettingsDiagnostics(settings, units, { ...context, mode: 'preventa' }).rules[0].message, /proyecto está en preventa/)
  assert.match(discountSettingsDiagnostics(settings, units, { ...context, today: '2026-09-01' }).rules[0].message, /todavía no está vigente/)
  const diag = discountSettingsDiagnostics(settings, units, context)
  assert.equal(diag.rules[0].unitCount, 1); assert.match(diag.rules[0].message, /10 % ya incluido/)
  assert.match(discountSettingsDiagnostics({ ...settings, rules: [{ ...settings.rules[0], endDate: '2026-10-13' }] }, units, context).rules[0].message, /Venció/)
})
test('urgent alerts only select unread reservations for the authenticated recipient, in order, without repeating acknowledged alerts', () => {
  const base = { recipient_id: 'advisor', read_at: null, metadata: {}, created_at: '2026-10-14T00:00:00Z' }
  const items = [
    { ...base, id: 'assignment', kind: 'lead_assigned' }, { ...base, id: 'foreign', kind: 'reservation_requested', recipient_id: 'other' },
    { ...base, id: 'read', kind: 'reservation_confirmed', read_at: 'read' }, { ...base, id: 'old', kind: 'reservation_requested' },
    { ...base, id: 'new', kind: 'reservation_confirmed', created_at: '2026-10-15T00:00:00Z' },
  ] as AdvisorNotification[]
  assert.equal(nextUrgentReservation(items, 'advisor', new Set())?.id, 'old')
  assert.equal(nextUrgentReservation(items, 'advisor', new Set(['old']))?.id, 'new')
  assert.equal(nextUrgentReservation(items, 'advisor', new Set(['old', 'new'])), null)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import Ajv from 'ajv'
import { applyEarlyPurchaseDiscount, discountQuote, draftEarlyPurchaseDiscount, type EarlyPurchaseDiscountSettings } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { object, type Row } from './data'
import { compactCatalogUnit, completeCatalogResult } from './catalog-result'
import { catalogQuery } from './catalog-dialogue'
import { DISCOUNT_NUMBER_FIELDS, DISCOUNT_FACT_UNITS, discountReferenceEvidence } from './discount-evidence'
import { businessFactSchema, validateBusinessFacts } from './business-facts'
import { structuredFactIssues, structuredProjectIssues, structuredReviewSchema, normalizeStructuredFacts } from './structured-facts'
import { factualValueIssues, factualValuesSchema } from './semantic-review'
import { projectQuantityEvidence } from './project-quantities'
import { turnEvidence, verifiedClaimSources } from './turn-evidence'

const today = '2026-10-06'
const settings: EarlyPurchaseDiscountSettings = { enabled: true, stacking: false, updatedAt: 'settings-v1', rules: [{
  ...draftEarlyPurchaseDiscount('launch'), enabled: true, name: 'Compra anticipada', percent: 5,
  source: 'Condición comercial autorizada', conditions: 'Reserva confirmada por el equipo comercial.',
  startDate: '2026-10-01', endDate: '2026-10-31', checkedOn: '2026-10-01', reviewBy: '2026-10-31',
}] }
const rawUnit: Row = { id: 'unit-605', unit_number: '605', category: 'penthouse', bedrooms: 3,
  area_internal_m2: 140, published_commercial_price: 300000, is_published: true, status: 'disponible' }
const context = { mode: 'lanzamiento', today, pricesAuthorized: true }
const unit = applyEarlyPurchaseDiscount(rawUnit, discountQuote(rawUnit, settings, context))
const values: Record<string, number> = { discount_reference_price: 300000, discount_amount_reference: 15000,
  discounted_price_reference: 285000, discount_percent: 5 }
const fact = (field: typeof DISCOUNT_NUMBER_FIELDS[number], value = values[field]): Row => ({
  statement: 'Importe de referencia condicionado.', kind: 'catalog_value', subject_id: rawUnit.id, scope: null,
  field, value, relation: 'eq', upper_value: null, unit: DISCOUNT_FACT_UNITS[field],
})
const structured = (field: typeof DISCOUNT_NUMBER_FIELDS[number], value = values[field]): Row => ({
  unit_id: rawUnit.id, field, value, operator: 'eq', upper_value: null, measurement_unit: DISCOUNT_FACT_UNITS[field], fragment: 'S1',
})

test('each scoped discount reference has exact USD or percent semantics without granting the offer', () => {
  const validate = new Ajv({ strict: false }).compile(businessFactSchema)
  for (const field of DISCOUNT_NUMBER_FIELDS) {
    assert.ok(validate(fact(field)))
    const checked = validateBusinessFacts([fact(field)], [unit], [], {})[0]
    assert.equal(checked.status, 'verified')
    assert.equal(object(checked.source).verification_scope, 'conditional_arithmetic_reference_only')
    assert.equal(object(object(checked.source).early_purchase_discount).condition_met, false)
    assert.deepEqual(structuredFactIssues([structured(field)], [unit]), [])
    assert.equal(validateBusinessFacts([fact(field, values[field] + 0.000001)], [unit], [], {})[0].status, 'contradiction')
    assert.equal(structuredFactIssues([structured(field, values[field] + 0.000001)], [unit])[0].code, 'catalog_value_mismatch')
  }
  assert.equal(unit.published_commercial_price, 300000)
  assert.equal(unit.early_purchase_discount.inventory_reserved, false)
  assert.equal(unit.early_purchase_discount.financial_consent, false)
  assert.equal(validateBusinessFacts([{ ...fact('discount_percent'), unit: 'USD' }], [unit], [], {})[0].status, 'unverified')
  assert.equal(structuredFactIssues([{ ...structured('discount_percent'), measurement_unit: 'USD' }], [unit])[0].code, 'numeric_unit_mismatch')
})

test('compact catalog preserves provenance and condition while withholding unauthorized price references', () => {
  const compact = compactCatalogUnit({ ...unit, raw_editor_configuration: settings }, true)
  for (const field of DISCOUNT_NUMBER_FIELDS) assert.equal(compact[field], values[field])
  for (const field of ['source', 'condition', 'conditions', 'valid_from', 'valid_until', 'settings_version', 'as_of'])
    assert.equal(object(compact.early_purchase_discount)[field], unit.early_purchase_discount[field as keyof typeof unit.early_purchase_discount])
  assert.equal(compact.published_commercial_price, 300000)
  assert.equal(compact.catalog_base_price, 300000)
  assert.equal(compact.raw_editor_configuration, undefined)
  assert.equal(discountReferenceEvidence(compact).available, true)
  const hidden = compactCatalogUnit(unit, false)
  for (const field of [...DISCOUNT_NUMBER_FIELDS, 'published_commercial_price', 'catalog_base_price']) assert.equal(hidden[field], undefined)
  assert.equal(object(hidden.early_purchase_discount).status, 'unavailable')
  for (const field of ['catalog_price', 'base_price', 'discount_amount', 'final_price', 'percent']) assert.equal(object(hidden.early_purchase_discount)[field], undefined)
})

test('inactive, expired, inconsistent or different-unit quotes cannot supply numeric discount evidence', () => {
  for (const change of [{ status: 'disabled' }, { status: 'conflict' }, { unit_id: 'other-unit' }, { unit_number: '604' },
    { source: '' }, { valid_until: '2026-10-05' }, { valid_from: '2026-10-07' }, { checked_on: '2026-10-07' },
    { final_price: 270000 }, { discount_amount: 1 }, { condition_met: true }, { price_is_conditional: false }, { as_of: 'bad' }]) {
    const invalid: Row = { ...unit, early_purchase_discount: { ...unit.early_purchase_discount, ...change } }
    assert.equal(discountReferenceEvidence(invalid).available, false, JSON.stringify(change))
    assert.equal(validateBusinessFacts([fact('discount_percent')], [invalid], [], {})[0].status, 'unverified')
    assert.equal(structuredFactIssues([structured('discount_percent')], [invalid])[0].code, 'discount_reference_unavailable')
    assert.equal(compactCatalogUnit(invalid, true).discount_percent, undefined)
  }
  assert.equal(discountReferenceEvidence({ ...unit, discount_percent: 15 }).available, false)
  const permitted = applyEarlyPurchaseDiscount(rawUnit, discountQuote(rawUnit, settings, { ...context, reservationConfirmed: true }))
  assert.equal(permitted.published_commercial_price, 285000)
  assert.equal(discountReferenceEvidence(permitted).available, true)
})

test('included discount keeps the published amount and cannot invent an original price or monetary saving', () => {
  const includedSettings = { ...settings, rules: settings.rules.map(rule => ({ ...rule, base: 'included_in_catalog' as const })) }
  const included = applyEarlyPurchaseDiscount({ ...rawUnit, published_commercial_price: 285000 },
    discountQuote({ ...rawUnit, published_commercial_price: 285000 }, includedSettings, context))
  assert.equal(discountReferenceEvidence(included).available, true)
  assert.deepEqual(structuredFactIssues([{ ...structured('discounted_price_reference'), value: 285000 }], [included]), [])
  assert.equal(structuredFactIssues([structured('discount_reference_price')], [included])[0].code, 'catalog_value_unavailable')
  assert.equal(validateBusinessFacts([fact('discount_amount_reference')], [included], [], {})[0].status, 'unverified')
  assert.equal(included.published_commercial_price, 285000)
  assert.equal(object(compactCatalogUnit(included, true).early_purchase_discount).base_price, null)
})

test('discount numbers cannot migrate into fabricated group ranges or normalized extrema', () => {
  const evidence = turnEvidence({ catalogo: [unit], politica_comercial: { precios_autorizados: true } })
  const group = evidence.groups[0]
  for (const entry of evidence.groups) for (const field of DISCOUNT_NUMBER_FIELDS) assert.equal(entry[field], undefined)
  const invented = { ...group, discount_percent: 5, upper_values: { discount_percent: 5 }, early_purchase_discount: unit.early_purchase_discount }
  const business = { ...fact('discount_percent'), subject_id: group.id }
  assert.equal(validateBusinessFacts([business], [unit], [invented], {})[0].status, 'unverified')
  const ranged = { ...structured('discount_percent'), unit_id: invented.id, operator: 'between', upper_value: 5 }
  assert.equal(structuredFactIssues([ranged], [invented])[0].code, 'discount_reference_unavailable')
  assert.deepEqual(normalizeStructuredFacts([ranged], [invented]).corrections, [])
  const result = completeCatalogResult({ catalogo: [unit], politica_comercial: { precios_autorizados: true }, catalog_read: { complete: true } },
    catalogQuery({ category: 'penthouse' }), {})
  for (const entry of result.groups) for (const field of DISCOUNT_NUMBER_FIELDS) assert.equal(entry[field], undefined)
})

test('structured schema admits percent references and legacy numeric checks distinguish currency from percent', () => {
  const schema = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], [unit], [])
  const properties = object((object(object(object(schema.properties).factual_values).items).anyOf as Row[])[0].properties)
  assert.ok((object(properties.field).enum as string[]).includes('discount_percent'))
  assert.ok((object(properties.measurement_unit).enum as string[]).includes('percent'))
  for (const [field, fragment] of [['discount_reference_price', 'Precio original: $300,000.'],
    ['discount_amount_reference', 'Ahorro condicionado: $15,000.'], ['discounted_price_reference', 'Precio condicionado: $285,000.'],
    ['discount_percent', 'Descuento condicionado de cinco por ciento.']] as const) {
    assert.deepEqual(factualValueIssues([{ ...structured(field), fragment }], fragment, [unit]), [])
  }
  for (const [field, fragment, value] of [['discount_percent', 'Descuento de $5.', 5],
    ['discount_amount_reference', 'Ahorro de 15000%.', 15000]] as const)
    assert.equal(factualValueIssues([{ ...structured(field), value, fragment }], fragment, [unit])[0].code, 'numeric_field_not_in_reply')
})

test('audit candidates receive only matching current commercial evidence and never stale offers', () => {
  const audit = { verified_catalog: true, catalog_results: { units: [{ id: rawUnit.id, unit_number: rawUnit.unit_number, category: 'penthouse' }] } }
  const verified = { catalogo: [unit], politica_comercial: { precios_autorizados: true }, politica_descuentos: { enabled: true } }
  const evidence = turnEvidence(verified, audit)
  assert.equal(evidence.units.length, 1)
  assert.equal(evidence.units[0].published_commercial_price, 300000)
  assert.equal(evidence.units[0].discount_percent, 5)
  assert.equal(object(evidence.units[0].early_purchase_discount).condition_met, false)
  assert.equal(verifiedClaimSources(verified, audit, evidence).find(source => source.reference_id === rawUnit.id)?.discount_scope,
    'arithmetic_reference_not_commercial_fulfillment')
  const disabled = turnEvidence({ ...verified, politica_descuentos: { enabled: false } }, { ...audit, catalog_results: { units: [unit] } })
  assert.equal(disabled.units[0].early_purchase_discount, undefined)
  const missing = turnEvidence({ ...verified, catalogo: [] }, { ...audit, catalog_results: { units: [unit] } })
  assert.equal(missing.units[0].discount_percent, undefined)
  const wrongNumber = turnEvidence(verified, { ...audit, catalog_results: { units: [{ ...rawUnit, unit_number: '604' }] } })
  assert.equal(wrongNumber.units[0].discount_percent, undefined)
  const mismatch = turnEvidence(verified, { ...audit, catalog_results: { units: [{ ...rawUnit, published_commercial_price: 310000 }] } })
  assert.ok(mismatch.conflicts.some(conflict => conflict.field === 'published_commercial_price'))
  assert.equal(mismatch.units[0].discount_percent, undefined)
})

test('general rule percentages require server-authorized scope and do not expose raw drafts or USD aggregates', () => {
  const quote = unit.early_purchase_discount
  const policy: Row = { enabled: true, version: quote.version, status: 'conditional_offers', as_of: today, settings_version: 'settings-v1',
    rules: [{ id: quote.rule_id, name: quote.rule_name, percent: 5, categories: ['penthouse'], unit_numbers: [], mode: 'lanzamiento',
      base_mode: quote.base_mode, source: quote.source, checked_on: quote.checked_on, valid_from: quote.valid_from,
      valid_until: quote.valid_until, condition: quote.condition, conditions: quote.conditions }] }
  const facts = projectQuantityEvidence({ politica_descuentos: policy,
    politica_comercial: { early_purchase_discounts: { ...settings, rules: [{ description: 'Descuento de 90% sin publicar' }] } } })
  assert.equal(facts.length, 1)
  assert.equal(facts[0].value, 5)
  assert.equal(facts[0].unit, 'percent')
  assert.deepEqual(facts[0].scope?.categories, ['penthouse'])
  assert.equal(facts[0].grant_confirmed, false)
  const checked = { source_id: facts[0].id, value: 5, dimension: 'percentage', measurement_unit: 'percent', fragment: 'S1' }
  assert.deepEqual(structuredProjectIssues([checked], facts), [])
  assert.ok(structuredProjectIssues([{ ...checked, value: 10 }], facts).length)
  for (const altered of [{ enabled: false }, { status: 'disabled' }, { version: 'unverified' },
    { rules: [{ ...object((policy.rules as unknown[])[0]), source: '' }] },
    { rules: [{ ...object((policy.rules as unknown[])[0]), valid_until: '2026-10-05' }] }])
    assert.deepEqual(projectQuantityEvidence({ politica_descuentos: { ...policy, ...altered } }), [])
})

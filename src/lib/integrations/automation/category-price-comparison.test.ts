import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryPriceComparison, interpretedPriceComparison } from './category-price-comparison'
import { responseContentScope } from './response-content-scope'
import { turnEvidence } from './turn-evidence'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { object, type Row } from './data'

const current = 'los departamentos me interesan más porque los penthouse deben ser más costosos'
const catalog = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, published_commercial_price: 250000, is_published: true, status: 'disponible' },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, published_commercial_price: 310000, is_published: true, status: 'disponible' },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, published_commercial_price: 539900, is_published: true, status: 'disponible' },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, published_commercial_price: 550000, is_published: true, status: 'disponible' },
  { id: 'p601', unit_number: '601', category: 'penthouse', bedrooms: 2, published_commercial_price: 389750, is_published: true, status: 'disponible' },
  { id: 'unpublished', unit_number: '607', category: 'penthouse', bedrooms: 3, published_commercial_price: 200000, is_published: false, status: 'disponible' },
  { id: 'sold', unit_number: '608', category: 'penthouse', bedrooms: 3, published_commercial_price: 150000, is_published: true, status: 'vendido' },
]
function fixture(): Row {
  const requests = [{ domain: 'property', topics: ['property_options'], request: current, evidence: current, confidence: 'high' }]
  return { catalogo: catalog.filter(unit => unit.category === 'departamento'), catalogo_verificacion: catalog,
    catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    solicitudes_interpretadas: requests, contrato_turno: { requests },
    semantica_turno: { confidence: 'high', primary_intent: 'answer_previous', property: { category: 'departamento', filters: {} },
      catalog_request: { purpose: 'search', requirements: [], semantic_preferences: [], evidence: current, confidence: 'high',
        price_comparison: { categories: ['departamento', 'penthouse'], evidence: current, confidence: 'medium' } } },
    hechos_confirmados: { property: { filters: { bedrooms: 3 } } },
    property_context: { selected_ids: ['d502'], query: { category: 'departamento', group: 'residential', operation: 'search', filters: { bedrooms: 3 } } },
    siguiente_paso_comercial: { action: 'select_property', question_id: 'property_floor' } }
}

test('implicit typed price comparison uses comparable published units and preserves the selected department and bedroom need', () => {
  const info = fixture(), before = JSON.stringify(info), result = categoryPriceComparison(info, current)!
  assert.equal(result.status, 'verified')
  const groups = result.groups as Row[]
  assert.deepEqual(groups.map(group => [group.category, group.published_commercial_price, object(group.upper_values).published_commercial_price]),
    [['departamento', 250000, 310000], ['penthouse', 539900, 550000]])
  assert.deepEqual(groups[1].member_ids, ['p605', 'p602'])
  assert.equal(JSON.stringify(info), before)
  assert.equal(object(object(responseContentScope(current, info).topics).purchase_prices).allowed, true)
})

test('ordinary category preference, stale comparison, low confidence and unknown category do not authorize extra prices', () => {
  const info = fixture()
  assert.equal(interpretedPriceComparison(info, 'prefiero departamentos'), null)
  for (const change of [{ price_comparison: null }, { price_comparison: { categories: ['departamento', 'penthouse'], confidence: 'low', evidence: current } },
    { price_comparison: { categories: ['departamento', 'vehicle'], confidence: 'high', evidence: current } }]) {
    const altered = { ...info, semantica_turno: { ...object(info.semantica_turno), catalog_request: { ...object(object(info.semantica_turno).catalog_request), ...change } } }
    assert.equal(categoryPriceComparison(altered, current), null)
    assert.equal(object(object(responseContentScope(current, altered).topics).purchase_prices).allowed, false)
  }
})

test('unknown prices or partial inventory cannot certify which category is cheaper; hidden prices stay hidden', () => {
  const info = fixture()
  assert.equal(categoryPriceComparison({ ...info, catalog_read: { complete: false } }, current)!.status, 'needs_complete_inventory')
  assert.deepEqual(categoryPriceComparison({ ...info, politica_comercial: { precios_autorizados: false } }, current)!.groups, [])
  const unknown = catalog.map(unit => unit.id === 'p605' ? { ...unit, published_commercial_price: null } : unit)
  const result = categoryPriceComparison({ ...info, catalogo_verificacion: unknown }, current)!
  assert.equal(result.status, 'incomplete_comparison')
  assert.deepEqual(result.missing_categories, ['penthouse'])
})

test('a confirmed minimum bedroom count remains a minimum in the comparison rather than becoming exact equality', () => {
  const info = fixture()
  object(object(info.property_context).query).filters = {}
  info.hechos_confirmados = { property: { filters: { bedrooms: 2, bedrooms_operator: 'gte' } } }
  const result = categoryPriceComparison(info, current)!
  const penthouse = (result.groups as Row[]).find(group => group.category === 'penthouse')!
  assert.equal(penthouse.published_commercial_price, 389750)
  assert.equal(object(penthouse.upper_values).published_commercial_price, 550000)
})

test('writer and reviewer projection retains both exact ranges without loading penthouse floor plans or reopening selection', () => {
  const info = fixture(), comparison = categoryPriceComparison(info, current)!
  const verified = { ...info, category_price_comparison: comparison }
  const audit = { source: 'catalog_search', verified_catalog: true,
    catalog_query: object(object(info.property_context).query), catalog_results: { complete: true, units: catalog.filter(unit => unit.category === 'departamento') },
    catalog_retrieval: { optimized: true } }
  const projected = taskVerifiedContext(verified, audit, current)
  const evidence = turnEvidence(verified, audit), models = taskModelEvidence(evidence, projected)
  const groups = models.groups.filter(group => group.source_scope === 'category_price_comparison')
  assert.equal(groups.length, 2)
  assert.equal(groups[1].bedrooms, 3)
  assert.equal(groups[1].bedrooms_filter, 3)
  assert.equal(groups[1].published_commercial_price, 539900)
  assert.equal(object(groups[1].upper_values).published_commercial_price, 550000)
  assert.equal(models.units.some(unit => unit.category === 'penthouse'), false)
  assert.equal(object(projected.category_price_comparison).units, undefined)
  assert.deepEqual(object(projected.property_context).selected_ids, ['d502'])
})

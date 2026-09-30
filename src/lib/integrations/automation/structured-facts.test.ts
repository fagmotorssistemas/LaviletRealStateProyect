import assert from 'node:assert/strict'
import test from 'node:test'
import { structuredFactIssues, structuredProjectIssues, structuredReviewSchema, normalizeStructuredFacts } from './structured-facts'
import { turnEvidence } from './turn-evidence'
import { factualValuesSchema } from './semantic-review'
import { object, type Row } from './data'

const units = [{ id: '202', area_internal_m2: 120.83, area_exterior_m2: 27.03, floor_number: 2,
  published_commercial_price: 250000, bedrooms: 3, bathrooms_full: 2 },
{ id: '302', area_internal_m2: 100, floor_number: 3, published_commercial_price: 270000 }]
const fact = (field: string, value: number, measurement_unit: string) => ({ unit_id: '202', field, value, measurement_unit, operator: 'eq', upper_value: null })

test('exact field/value/source comparisons do not consume or interpret prose', () => {
  for (const f of [fact('area_internal_m2',120.83,'m2'), fact('floor_number',2,'floor'), fact('published_commercial_price',250000,'USD')]) {
    assert.deepEqual(structuredFactIssues([f], units), [])
    assert.deepEqual(structuredFactIssues([{...f, fragment:'Cualquier formulación, incluso en otro idioma.'}], units), [])
    assert.equal(structuredFactIssues([{...f,value:f.value + 0.01}], units)[0].code,'catalog_value_mismatch')
    assert.equal(structuredFactIssues([{...f,unit_id:'302'}], units)[0].code,'catalog_value_mismatch')
  }
  assert.equal(structuredFactIssues([fact('area_internal_m2',120.8,'m2')],units)[0].code,'catalog_value_mismatch')
  assert.equal(structuredFactIssues([fact('area_internal_m2',120.83,'floor')],units)[0].code,'numeric_unit_mismatch')
  assert.equal(structuredFactIssues([{...fact('area_internal_m2',120.83,'m2'),unit_id:'invented'}],units)[0].code,'invalid_unit_fact')
})

test('range and extrema must match their exact scoped aggregates', () => {
  const group = {id:'range',aggregation:'range',published_commercial_price:145000,upper_values:{published_commercial_price:550000}}
  const f = {...fact('published_commercial_price',145000,'USD'),unit_id:'range',operator:'between',upper_value:550000}
  assert.deepEqual(structuredFactIssues([f],[group]),[])
  assert.equal(structuredFactIssues([{...f,upper_value:600000}],[group])[0].code,'catalog_range_mismatch')
  assert.equal(structuredFactIssues([{...f,operator:'gte'}],[group])[0].code,'invalid_numeric_bounds')
  assert.equal(structuredFactIssues([{...f,operator:'gte',value:144999,upper_value:null}], [{...group,aggregation:'min'}])[0].code,'catalog_value_mismatch')
})

test('project quantities retain subject-specific sources and dimensions', () => {
  const sources=[{id:'security',value:24,dimension:'duration',unit:'hour'},{id:'distance',value:24,dimension:'distance',unit:'meter'}]
  const f={source_id:'security',value:24,dimension:'duration',measurement_unit:'hour'}
  assert.deepEqual(structuredProjectIssues([f],sources),[])
  for(const change of [{value:48},{source_id:'distance'},{measurement_unit:'meter'}])
    assert.equal(structuredProjectIssues([{...f,...change}],sources)[0].code,'project_quantity_mismatch')
})

test('live schema lets the reviewer interpret written quantities and requires inventory coverage', () => {
  const schema=structuredReviewSchema({properties:{factual_values:factualValuesSchema},required:['factual_values']},['S1'],units,[])
  const p=object(schema.properties), variants=object(object(p.factual_values).items).anyOf as Row[]
  assert.equal(object(p.factual_values).maxItems,80)
  assert.deepEqual(object(variants[0].properties).value,{type:'number'})
  assert.ok((schema.required as string[]).includes('factual_inventory_complete'))
  assert.deepEqual(object(object(variants[0].properties).unit_id).enum,['202','302'])
})

const scopedUnits = [
  { id: 'd201', category: 'departamento', bedrooms: 2, area_internal_m2: 109.69 },
  { id: 'd301', category: 'departamento', bedrooms: 2, area_internal_m2: 115.04 },
  { id: 'd202', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 },
  { id: 'p602', category: 'penthouse', bedrooms: 3, area_internal_m2: 142.09 },
]
const snapshot = turnEvidence({ catalogo: scopedUnits })
const catalog = [...snapshot.units, ...snapshot.groups]
const endpoint = (bedrooms: number, value: number, operator: string) => ({ fragment: 'S1',
  unit_id: `group:departamento:${bedrooms}:range`, field: 'area_internal_m2', value, operator, upper_value: null, measurement_unit: 'm2' })

test('exact scoped endpoints repair only the reference, preserving numbers and draft provenance', () => {
  const input = [endpoint(2, 109.69, 'gte'), endpoint(3, 120.83, 'lte')]
  const original = structuredClone(input)
  const normalized = normalizeStructuredFacts(input, catalog)
  assert.deepEqual(input, original)
  assert.deepEqual(normalized.facts, input.map((row, i) => ({ ...row, unit_id: `group:departamento:${i + 2}:${i ? 'max' : 'min'}` })))
  assert.equal(normalized.corrections.length, 2)
  assert.deepEqual(structuredFactIssues(input, catalog), [])
  assert.deepEqual(normalizeStructuredFacts(normalized.facts, catalog).corrections, [])
})

test('reference repair cannot round, move between scopes, infer an endpoint, or choose an ambiguous source', () => {
  for (const f of [endpoint(2, 109.7, 'gte'), endpoint(2, 120.83, 'lte'), endpoint(2, 109.69, 'eq'), endpoint(2, 109.69, 'lt')]) {
    assert.deepEqual(normalizeStructuredFacts([f], catalog).corrections, [])
    assert.ok(structuredFactIssues([f], catalog).length)
  }
  const f = endpoint(2, 109.69, 'gte'), min = catalog.find(row => row.id === 'group:departamento:2:min')!
  for (const candidates of [catalog.filter(row => row !== min), [...catalog, { ...min, id: 'duplicate' }],
    catalog.map(row => row === min ? { ...min, member_ids: ['unrelated'] } : row),
    catalog.map(row => row === min ? { ...min, source_scope: 'other_query' } : row)]) {
    assert.deepEqual(normalizeStructuredFacts([f], candidates).corrections, [])
    assert.ok(structuredFactIssues([f], candidates).length)
  }
  // A scalar can refer to a range only when both exact endpoints coincide.
  assert.equal(normalizeStructuredFacts([endpoint(3, 120.83, 'eq')], catalog).corrections.length, 1)
})

test('schema and runtime distinguish scalar extrema from complete intervals', () => {
  const schema = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], catalog, [])
  const variants = object(object(object(schema.properties).factual_values).items).anyOf as Row[]
  for (const group of snapshot.groups) {
    const allowed = variants.filter(v => (object(object(v.properties).unit_id).enum as string[]).includes(textId(group)))
    assert.equal(allowed.length, 1)
    assert.deepEqual(object(object(allowed[0].properties).operator).enum,
      group.aggregation === 'range' ? ['between'] : group.aggregation === 'min' ? ['eq', 'gte'] : ['eq', 'lte'])
  }
  for (const [aggregation, operator] of [['min', 'lte'], ['max', 'gte']]) {
    const source = catalog.find(row => row.id === `group:departamento:2:${aggregation}`)!
    assert.equal(structuredFactIssues([{ ...endpoint(2, Number(source.area_internal_m2), operator), unit_id: source.id }], catalog)[0].code, 'aggregate_operator_mismatch')
  }
})

function textId(row: Row) { return String(row.id) }

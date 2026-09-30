import assert from 'node:assert/strict'
import test from 'node:test'
import { structuredFactIssues, structuredProjectIssues, structuredReviewSchema } from './structured-facts'
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

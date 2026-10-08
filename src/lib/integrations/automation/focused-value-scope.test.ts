import assert from 'node:assert/strict'
import test from 'node:test'
import Ajv from 'ajv'
import { focusedValueScopeIssues, focusedValueScopeSchema } from './focused-value-scope'
import { factualValuesSchema } from './semantic-review'
import { normalizeStructuredFacts, structuredReviewSchema } from './structured-facts'
import { normalizeReviewReferences } from './turn-evidence'
import { object } from './data'

const units = [{ id: 'a', unit_number: '202', published_commercial_price: 225000, bedrooms: 3 },
  { id: 'b', unit_number: '302', published_commercial_price: 275000, bedrooms: 3 }]
const groups = [
  { id: 'g:min', aggregation: 'min', member_ids: ['a', 'b'], published_commercial_price: 225000, bedrooms: 3 },
  { id: 'g:max', aggregation: 'max', member_ids: ['a', 'b'], published_commercial_price: 275000, bedrooms: 3 },
  { id: 'g:range', aggregation: 'range', member_ids: ['a', 'b'], published_commercial_price: 225000, bedrooms: 3,
    upper_values: { published_commercial_price: 275000, bedrooms: 3 } },
]
const catalog = [...units, ...groups]
const fact = { fragment: 'S1', unit_id: 'g:min', field: 'published_commercial_price', value: 225000,
  operator: 'eq', upper_value: null, value_scope: 'each_member' }

test('universal prices check every group member while an exact group range remains valid', () => {
  const issues = focusedValueScopeIssues([fact], catalog, true)
  assert.equal(issues[0].code, 'each_member_value_mismatch')
  assert.deepEqual(issues[0].failing_member_ids, ['b'])
  assert.equal(issues[0].kind, 'catalog_data')
  assert.deepEqual(focusedValueScopeIssues([{ ...fact, value_scope: 'group_summary' }], catalog, true), [])
  const range = { ...fact, unit_id: 'g:range', value_scope: 'group_summary', operator: 'between', upper_value: 275000 }
  assert.deepEqual(focusedValueScopeIssues([range], catalog, true), [])
  assert.deepEqual(focusedValueScopeIssues([{ ...range, value_scope: 'each_member' }], catalog, true), [])
  assert.ok(focusedValueScopeIssues([{ ...range, value_scope: 'each_member', upper_value: 250000 }], catalog, true).length)
})

test('universal facts accept uniform values, exact bounds, and no rounding', () => {
  assert.deepEqual(focusedValueScopeIssues([{ ...fact, field: 'bedrooms', value: 3 }], catalog, true), [])
  assert.deepEqual(focusedValueScopeIssues([{ ...fact, operator: 'gte' }], catalog, true), [])
  assert.deepEqual(focusedValueScopeIssues([{ ...fact, unit_id: 'g:max', value: 275000, operator: 'lte' }], catalog, true), [])
  assert.ok(focusedValueScopeIssues([{ ...fact, field: 'bedrooms', value: 3.001 }], catalog, true).length)
  const uniform = catalog.map(row => ({ ...row, published_commercial_price: 225000 }))
  assert.deepEqual(focusedValueScopeIssues([fact], uniform, true), [])
})

test('scope consistency never treats one unit or incomplete membership as a full group', () => {
  assert.equal(focusedValueScopeIssues([{ ...fact, value_scope: 'individual' }], catalog, true)[0].code, 'individual_value_uses_group')
  assert.equal(focusedValueScopeIssues([{ ...fact, unit_id: 'a' }], catalog, true)[0].code, 'group_value_uses_individual')
  assert.deepEqual(focusedValueScopeIssues([{ ...fact, unit_id: 'a', value_scope: 'individual' }], catalog, true), [])
  assert.equal(focusedValueScopeIssues([fact], catalog.filter(row => row.id !== 'b'), true)[0].code, 'numeric_group_members_unverified')
  assert.equal(focusedValueScopeIssues([fact], catalog.map(row => row.id === 'g:min' ? { ...row, member_ids: [] } : row), true)[0].code, 'invalid_numeric_group_members')
  assert.equal(focusedValueScopeIssues([fact], catalog.map(row => row.id === 'b' ? { ...row, published_commercial_price: null } : row), true)[0].code, 'numeric_group_members_unverified')
})

test('legacy rows remain readable while focused schema explicitly requires the semantic value scope first', () => {
  const { value_scope: omitted, ...legacy } = fact
  assert.equal(omitted, 'each_member')
  assert.deepEqual(focusedValueScopeIssues([legacy], catalog), [])
  assert.equal(focusedValueScopeIssues([legacy], catalog, true)[0].code, 'invalid_numeric_value_scope')
  const old = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], catalog, [])
  const snapshot = JSON.stringify(old)
  const schema = focusedValueScopeSchema(old)
  const list = (schema.properties as Record<string, { items: { anyOf: { properties: Record<string, unknown>; required: string[] }[] } }>).factual_values
  for (const item of list.items.anyOf) {
    const fields = object(item.properties)
    if ((object(fields.field).enum as unknown[]).includes('derived_value')) {
      assert.deepEqual(object(fields.value_scope).enum, ['individual'])
      assert.equal(object(fields.unit_id).type, 'null')
      assert.ok(item.required.includes('calculation'))
      continue
    }
    assert.equal(Object.keys(item.properties)[0], 'value_scope')
    assert.deepEqual(Object.keys(item.properties), ['value_scope', 'fragment', 'field', 'value', 'upper_value', 'measurement_unit', 'operator', 'unit_id'])
    assert.ok(item.required.includes('value_scope'))
  }
  assert.equal(JSON.stringify(old), snapshot)
})

test('reference and endpoint normalization preserve quantified scope independently of wording', () => {
  for (const reply of ['Cada unidad tiene tres dormitorios.', 'Las dos unidades tienen 3 dormitorios cada una.']) {
    const raw = { ...fact, fragment: 'S1', field: 'bedrooms', value: 3, unit_id: 'g:range' }
    const normalized = normalizeReviewReferences({ factual_values: [raw] }, catalog, reply, '', true).review
    const fixed = normalizeStructuredFacts(normalized.factual_values, catalog).facts as typeof raw[]
    assert.equal(fixed[0].value_scope, 'each_member')
    assert.equal(fixed[0].unit_id, 'g:min')
    assert.equal(fixed[0].fragment, reply)
    assert.deepEqual(focusedValueScopeIssues(fixed, catalog, true), [])
  }
  for (const fragment of ['Cada uno vale doscientos veinticinco mil dólares.', 'Cuestan $225.000 cada uno.', 'S1'])
    assert.equal(focusedValueScopeIssues([{ ...fact, fragment }], catalog, true)[0].code, 'each_member_value_mismatch')
})

test('authoritative catalogue binds individual and group scopes to disjoint source IDs in the schema', () => {
  const old = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], catalog, [])
  const before = JSON.stringify(old)
  const schema = focusedValueScopeSchema(old, catalog)
  const list = object(object(schema.properties).factual_values)
  for (const raw of object(list.items).anyOf as unknown[]) {
    const fields = Object.keys(object(object(raw).properties))
    assert.ok(fields.indexOf('value') < fields.indexOf('unit_id'))
    assert.equal(fields.at(-1), 'unit_id')
  }
  const validate = new Ajv({ allErrors: true }).compile(list)
  for (const [unitId, scope, expected] of [
    ['a', 'individual', true], ['a', 'each_member', false], ['a', 'group_summary', false],
    ['g:min', 'individual', false], ['g:min', 'each_member', true], ['g:min', 'group_summary', true],
    ['not_in_catalogue', 'individual', false],
  ] as const) {
    assert.equal(validate([{ ...fact, unit_id: unitId, value_scope: scope, measurement_unit: 'USD' }]), expected,
      `${unitId}/${scope}: ${JSON.stringify(validate.errors)}`)
  }
  assert.equal(validate([{ ...fact, unit_id: 'g:range', value_scope: 'group_summary', operator: 'between', upper_value: 275000, measurement_unit: 'USD' }]), true)
  assert.equal(validate([{ ...fact, unit_id: 'g:range', value_scope: 'group_summary', operator: 'eq', measurement_unit: 'USD' }]), false)
  assert.equal(validate([{ ...fact, unit_id: 'g:min', value_scope: 'group_summary', operator: 'lte', measurement_unit: 'USD' }]), false)
  assert.equal(JSON.stringify(old), before)
})

test('schema source kinds come from catalogue rows instead of guessed ID prefixes', () => {
  const arbitraryCatalog = [{ id: 'group:pretend', bedrooms: 3 },
    { id: 'plain-unit-id', aggregation: 'min', member_ids: ['group:pretend'], bedrooms: 3 }]
  const old = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], arbitraryCatalog, [])
  const schema = focusedValueScopeSchema(old, arbitraryCatalog)
  const validate = new Ajv({ allErrors: true }).compile(object(object(schema.properties).factual_values))
  const numeric = { fragment: 'S1', field: 'bedrooms', value: 3, operator: 'eq', upper_value: null, measurement_unit: 'count' }
  assert.equal(validate([{ ...numeric, unit_id: 'group:pretend', value_scope: 'individual' }]), true)
  assert.equal(validate([{ ...numeric, unit_id: 'group:pretend', value_scope: 'each_member' }]), false)
  assert.equal(validate([{ ...numeric, unit_id: 'plain-unit-id', value_scope: 'each_member' }]), true)
  assert.equal(validate([{ ...numeric, unit_id: 'plain-unit-id', value_scope: 'individual' }]), false)
})

test('empty authoritative catalogue forbids catalogue facts while retaining calculations with proof', () => {
  const old = structuredReviewSchema({ properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }, ['S1'], catalog, [])
  const schema = focusedValueScopeSchema(old, [])
  const list = object(object(schema.properties).factual_values)
  assert.equal(list.maxItems, 80)
  const variants = object(list.items).anyOf as unknown[]
  assert.ok(variants.every(raw => (object(object(object(raw).properties).field).enum as unknown[]).includes('derived_value')))
  const validate = new Ajv({ allErrors: true }).compile(list)
  assert.equal(validate([]), true)
  assert.equal(validate([{ ...fact, measurement_unit: 'USD' }]), false)
  const calculated = { fragment: 'S1', unit_id: null, field: 'derived_value', value: 5, measurement_unit: 'count', operator: 'eq', upper_value: null, value_scope: 'individual',
    calculation: { operation: 'add', operands: [2, 3].map(value => ({ value, unit: 'count', source: { kind: 'lead_current', reference: '', quote: value + ' objetos' } })),
      result: { value: 5, unit: 'count' }, scope: 'grounded' } }
  assert.equal(validate([calculated]), true, JSON.stringify(validate.errors))
  const { calculation: omittedProof, ...unproven } = calculated
  assert.ok(omittedProof)
  assert.equal(validate([unproven]), false)
  assert.equal(validate([{ ...calculated, value_scope: 'group_summary' }]), false)
  const alreadyEmpty = focusedValueScopeSchema({ properties: { factual_values: { ...object(object(old.properties).factual_values), maxItems: 0 } } }, catalog)
  assert.equal(object(object(alreadyEmpty.properties).factual_values).maxItems, 0)
})

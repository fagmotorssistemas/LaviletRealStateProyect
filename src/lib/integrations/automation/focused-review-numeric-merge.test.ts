import test from 'node:test'
import assert from 'node:assert/strict'
import { focusedRepairScope, mergeFocusedRepair } from './focused-review'
import { buildNumericReferences } from './focused-numeric-coverage'
import type { Row } from './data'

const sentences = [{ id: 'S1', text: 'Su precio es $550.000 y está en la sexta planta.' },
  { id: 'S2', text: 'Tiene 120,83 m² interiores.' }]
const refs = buildNumericReferences(sentences)
const numberId = (value: number) => refs.find(ref => ref.value === value)!.id
const price = { fragment: sentences[0].text, unit_id: 'u1', field: 'published_commercial_price', value: 550000, operator: 'eq', upper_value: null, measurement_unit: 'USD', value_scope: 'individual' }
const area = { ...price, fragment: sentences[1].text, field: 'area_internal_m2', value: 120.83, measurement_unit: 'm2' }
const floor = { ...price, field: 'floor_number', value: 6, measurement_unit: 'floor', unit_id: 'wrong-id' }
const check = (value: number, index: number): Row => ({ numeric_id: numberId(value), classification: 'business_quantity',
  factual_value_indexes: [index], project_value_indexes: [], unit_ids: [], reason: 'Cantidad expresada en el borrador.' })
const previous = { claims: [], factual_values: [area, price, floor], project_values: [], pending_checks: [],
  non_factual_sentence_ids: [], obligation_checks: [], numeric_checks: [check(550000, 1), check(6, 2), check(120.83, 0)] }
const scope = focusedRepairScope([{ code: 'invalid_unit_fact', fragment: 'S1', field: 'floor_number' }], sentences, [])
const repaired = { claims: [], factual_values: [{ ...floor, fragment: 'S1', unit_id: 'u1' }, { ...price, fragment: 'S1' }],
  project_values: [], pending_checks: [], non_factual_sentence_ids: [], obligation_checks: [], numeric_checks: [check(550000, 1), check(6, 0)] }

test('numeric repair remaps both retained and repaired indexes after scoped rows merge with ID/text aliases', () => {
  const merged = mergeFocusedRepair(previous, repaired, scope, sentences)
  assert.deepEqual(merged.factual_values, [area, price, repaired.factual_values[0]])
  const checks = merged.numeric_checks as Row[]
  assert.deepEqual(checks.find(item => item.numeric_id === numberId(120.83))?.factual_value_indexes, [0])
  assert.deepEqual(checks.find(item => item.numeric_id === numberId(550000))?.factual_value_indexes, [1])
  assert.deepEqual(checks.find(item => item.numeric_id === numberId(6))?.factual_value_indexes, [2])
  assert.deepEqual(merged.numeric_repair_issues, [])
})

test('out-of-scope numeric checks are reported without replacing an existing independent check', () => {
  const extra = { ...check(120.83, 0), classification: 'not_quantity', factual_value_indexes: [], reason: 'Un intento ajeno al scope.' }
  const merged = mergeFocusedRepair(previous, { ...repaired, numeric_checks: [...repaired.numeric_checks, extra,
    { ...extra, numeric_id: 'N999' }] }, scope, sentences)
  const checks = merged.numeric_checks as Row[]
  assert.deepEqual(checks.filter(item => item.numeric_id === numberId(120.83)), [previous.numeric_checks[2]])
  assert.equal(checks.some(item => item.numeric_id === 'N999'), false)
  const issues = merged.numeric_repair_issues as Row[]
  assert.equal(issues.length, 2)
  assert.ok(issues.every(issue => issue.code === 'numeric_repair_outside_scope' && issue.kind === 'review_metadata'))
})

test('duplicate or omitted numeric checks are not silently filled or deduplicated during repair', () => {
  const duplicated = mergeFocusedRepair(previous, { ...repaired, numeric_checks: [...repaired.numeric_checks, check(6, 0)] }, scope, sentences)
  assert.equal((duplicated.numeric_checks as Row[]).filter(item => item.numeric_id === numberId(6)).length, 2)
  const missing = mergeFocusedRepair(previous, { ...repaired, numeric_checks: [check(550000, 1)] }, scope, sentences)
  assert.equal((missing.numeric_checks as Row[]).some(item => item.numeric_id === numberId(6)), false)
  assert.ok((missing.numeric_checks as Row[]).some(item => item.numeric_id === numberId(120.83)))
})

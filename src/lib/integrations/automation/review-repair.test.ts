import test from 'node:test'
import assert from 'node:assert/strict'
import { concreteReviewRepairs, numericRepairProgress, repairReviewSummary } from './review-repair'
import { numericSubjectIssues } from './focused-subject-scope'
import { structuredFactIssues } from './structured-facts'
import { requireReviewedResponse, ResponseReviewRecoveryError } from './response-review-recovery'
import { object, type Row } from './data'

const units = [
  { id: 'p601', category: 'penthouse', area_internal_m2: 106.58 },
  { id: 'p602', category: 'penthouse', area_internal_m2: 142.09 },
  { id: 'p604', category: 'penthouse', area_internal_m2: 99.71 },
  { id: 'l001', category: 'local', area_internal_m2: 46.65 },
]
const group = { id: 'group:penthouse:all:range', category: 'penthouse', aggregation: 'range',
  member_ids: ['p601', 'p602', 'p604'], area_internal_m2: 99.71, upper_values: { area_internal_m2: 142.09 } }
const all = { ...group, id: 'group:context:all:range', category: null, area_internal_m2: 46.65, member_ids: units.map(row => row.id) }
const catalog = [...units, group, all]
const fact = { fragment: 'Penthouses entre 106,58 y 142,09 m².', subject_category: 'penthouse',
  unit_id: group.id, field: 'area_internal_m2', operator: 'between', value: 106.58, upper_value: 142.09,
  measurement_unit: 'm2', value_scope: 'group_summary' }

test('repair binds both exact endpoints to the same category source, even when the wrong minimum is a real unit', () => {
  const issues = structuredFactIssues([fact], catalog)
  assert.equal(issues[0].code, 'catalog_range_mismatch')
  const [repair] = concreteReviewRepairs(issues, { factual_values: [fact] }, catalog, [])
  assert.equal(object(repair.source).id, group.id)
  assert.deepEqual(repair.authoritative, { value: 99.71, upper_value: 142.09 })
  assert.equal(object(repair.observed).value, 106.58)
  assert.equal(repair.measurement_unit, 'm2')
  assert.equal(repairReviewSummary({ answers_supported: true }, issues).answers_supported, false)
})

test('exact repair applies to prices, areas, dimensions, counts and floors without rounding', () => {
  for (const [field, value, wrong, measurement] of [
    ['published_commercial_price', 245123, 245000, 'USD'], ['area_internal_m2', 120.83, 121, 'm2'],
    ['bedrooms', 3, 5, 'count'], ['floor_number', 2, 3, 'floor'],
  ] as const) {
    const unit = { id: 'u', category: 'departamento', [field]: value }
    const row = { ...fact, unit_id: 'u', field, value: wrong, upper_value: null, operator: 'eq' }
    const repairs = concreteReviewRepairs([{ code: 'catalog_value_mismatch', kind: 'catalog_data', unit_id: 'u', field, fragment: row.fragment }], { factual_values: [row] }, [unit], [])
    assert.equal(object(repairs[0].authoritative).value, value)
    // Unit labels are taken from the canonical field contract, never guessed.
    assert.equal(typeof repairs[0].measurement_unit, 'string', measurement)
  }
})

test('a wrong group chosen by the reviewer is a metadata defect, not a replacement number for the writer', () => {
  const issues = numericSubjectIssues([{ ...fact, unit_id: all.id }], catalog)
  assert.equal(issues[0].code, 'numeric_subject_source_mismatch')
  assert.equal(issues[0].kind, 'review_metadata')
  assert.equal(issues[0].repair_owner, 'reviewer')
  assert.deepEqual(issues[0].candidate_source_ids, [group.id])
  const repair = concreteReviewRepairs(issues, {}, catalog, [])[0]
  assert.equal(repair.authoritative, undefined)
  assert.deepEqual(numericSubjectIssues([fact], catalog), [])
  assert.deepEqual(numericSubjectIssues([{ ...fact, unit_id: all.id, subject_category: null }], catalog), [])
})

test('repair progress follows the numerical defect across different phrasing and tracks newly introduced errors', () => {
  const before = structuredFactIssues([fact], catalog)
  const after = structuredFactIssues([{ ...fact, fragment: 'Su superficie parte de 106,58 y llega a 142,09 m².' }], catalog)
  assert.equal(numericRepairProgress(before, after).status, 'same_numeric_defect')
  assert.equal(numericRepairProgress(before, after).repeated_count, 1)
  assert.equal(numericRepairProgress(before, structuredFactIssues([{ ...fact, value: 99.71 }], catalog)).status, 'validated')
  assert.equal(numericRepairProgress(before, structuredFactIssues([{ ...fact, value: 99.71, upper_value: 143 }], catalog)).status, 'other_checks_pending')
})

test('only unvalidated exhausted answers require operational recovery; approved responses and protected routes remain available', () => {
  for (const audit of [{ recovery: { pending: true } }, { fallback_validation: { passed: false } }])
    assert.throws(() => requireReviewedResponse(audit), ResponseReviewRecoveryError)
  for (const audit of [{}, { status: 'checked', recovery: { pending: false } }, { fallback_validation: { passed: true } }] as Row[])
    assert.doesNotThrow(() => requireReviewedResponse(audit))
})

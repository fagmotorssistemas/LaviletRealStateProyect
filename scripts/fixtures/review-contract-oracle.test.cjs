/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict')
const { reviewFidelity } = require('./review-contract-oracle.cjs')
const expected = { claims: [{ sentence_id: 'S1', claim_kind: 'project_fact', evidence_source: 'verified_context',
  source_paths: ['contexto_verificado.proyecto'], exclusive_kind: true }] }
const observations = [{ request_kind: 'review', sentence_references: [{ id: 'S1', text: 'La Vilet está en Cuenca.' }],
  source_references: [{ id: 'E1', kind: 'project_fact', path: 'contexto_verificado.proyecto' },
    { id: 'E2', kind: 'lead_statement', path: 'mensaje_actual' }],
  catalog_references: [{ id: '202', canonical_id: 'eval-d202', unit_number: '202', category: 'departamento' }] }]
const claim = { fragment: 'S1', claim_kind: 'project_fact', verdict: 'supported', evidence_source: 'verified_context', evidence_ids: ['E1'] }
test('oracle accepts project location with its actual business source', () => {
  assert.equal(reviewFidelity(expected, { claims: [claim] }, observations).status, 'passed')
})
test('a pipeline acceptance cannot hide location misclassified as a lead statement or guidance', () => {
  for (const kind of ['lead_statement', 'contextual_guidance']) {
    const result = reviewFidelity(expected, { claims: [{ ...claim, claim_kind: kind, evidence_ids: ['E2'] }] }, observations)
    assert.equal(result.status, 'failed')
    assert.ok(result.issues.some(issue => issue.code === 'oracle_wrong_claim_kind'))
  }
})
test('correct claim kind still needs a source of that kind and the independently expected path', () => {
  assert.equal(reviewFidelity(expected, { claims: [{ ...claim, evidence_ids: ['E2'] }] }, observations).status, 'failed')
})
test('oracle checks every numeric attribute and accepts code-owned unit aliases', () => {
  const expectations = { facts: [
    { sentence_id: 'S1', field: 'floor_number', value: 2, operator: 'eq', unit_number: '202' },
    { sentence_id: 'S1', field: 'area_internal_m2', value: 120.83, operator: 'eq', unit_number: '202' },
  ] }
  const facts = expectations.facts.map(fact => ({ ...fact, fragment: 'La Vilet está en Cuenca.', unit_id: 'eval-d202' }))
  assert.equal(reviewFidelity(expectations, { factual_values: facts }, observations).status, 'passed')
  const partial = reviewFidelity(expectations, { factual_values: facts.slice(0, 1) }, observations)
  assert.equal(partial.status, 'failed')
  assert.equal(partial.issues[0].field, 'area_internal_m2')
})
test('a full range accepts exact min/max endpoints from the same member set', () => {
  const expected = { ranges: [{ sentence_id: 'S1', field: 'published_commercial_price', lower: 250000, upper: 275000, category: 'departamento' }] }
  const groups = [{ id: 'g:min', aggregation: 'min', category: 'departamento', member_ids: ['202', '302'] },
    { id: 'g:max', aggregation: 'max', category: 'departamento', member_ids: ['302', '202'] }]
  const context = [{ ...observations[0], catalog_references: groups }]
  const facts = [
    { fragment: 'S1', unit_id: 'g:min', field: 'published_commercial_price', operator: 'eq', value: 250000 },
    { fragment: 'S1', unit_id: 'g:max', field: 'published_commercial_price', operator: 'eq', value: 275000 },
  ]
  assert.equal(reviewFidelity(expected, { factual_values: facts }, context).status, 'passed')
  assert.equal(reviewFidelity(expected, { factual_values: facts.slice(0, 1) }, context).status, 'failed')
  for (const difference of [{ member_ids: ['202', '402'] }, { category: 'penthouse' }]) {
    const unrelated = [{ ...context[0], catalog_references: [groups[0], { ...groups[1], ...difference }] }]
    assert.equal(reviewFidelity(expected, { factual_values: facts }, unrelated).status, 'failed')
  }
})
test('each-member fixture cannot pass by citing only a summary or a partial group', () => {
  const expected = { facts: [{ sentence_id: 'S1', field: 'published_commercial_price', value: 550000,
    operator: 'eq', category: 'penthouse', value_scope: 'each_member', member_ids: ['601', '602'] }] }
  const reference = { id: 'g:penthouse:min', category: 'penthouse', aggregation: 'min', member_ids: ['601', '602'] }
  const context = [{ ...observations[0], catalog_references: [reference] }]
  const fact = { fragment: 'S1', unit_id: reference.id, field: 'published_commercial_price', value: 550000,
    operator: 'eq', value_scope: 'each_member' }
  assert.equal(reviewFidelity(expected, { factual_values: [fact] }, context).status, 'passed')
  assert.equal(reviewFidelity(expected, { factual_values: [{ ...fact, value_scope: 'group_summary' }] }, context).status, 'failed')
  assert.equal(reviewFidelity(expected, { factual_values: [fact] }, [{ ...context[0], catalog_references: [{ ...reference, member_ids: ['601'] }] }]).status, 'failed')
})

test('each-member assertion accepts only a complete equivalent set of individual checks', () => {
  const expected = { facts: [{ sentence_id: 'S1', field: 'published_commercial_price', value: 550000,
    operator: 'eq', category: 'penthouse', value_scope: 'each_member', member_ids: ['eval-p601', 'eval-p602'] }] }
  const units = ['601', '602'].map(number => ({ id: number, canonical_id: `eval-p${number}`, unit_number: number, category: 'penthouse' }))
  const context = [{ ...observations[0], catalog_references: units }]
  const facts = units.map(unit => ({ fragment: 'S1', unit_id: unit.canonical_id, field: 'published_commercial_price',
    value: 550000, operator: 'eq', value_scope: 'individual' }))
  assert.equal(reviewFidelity(expected, { factual_values: facts }, context).status, 'passed')
  for (const incomplete of [facts.slice(0, 1), [facts[0], facts[0]],
    [facts[0], { ...facts[1], value: 549999 }], [facts[0], { ...facts[1], operator: 'gte' }],
    [facts[0], { ...facts[1], value_scope: 'group_summary' }]])
    assert.equal(reviewFidelity(expected, { factual_values: incomplete }, context).status, 'failed')
  assert.equal(reviewFidelity(expected, { factual_values: facts }, [{ ...context[0],
    catalog_references: [units[0], { ...units[1], category: 'departamento' }] }]).status, 'failed')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { atomicNumericSchema, materializeNumericReview, mergeNumericPatch, numericPatchSchema, numericPatchScope } from './atomic-numeric-review'
import { buildNumericReferences, numericCoverageIssues, numericCoverageSchema } from './focused-numeric-coverage'
import { aiOutputBudget } from './ai-output'
import { object, type Row } from './data'

const sentences = [{ id: 'S1', text: 'Seguridad 24h.' }]
const refs = buildNumericReferences(sentences)
const fact = { fragment: 'S1', value: 24, dimension: 'duration', measurement_unit: 'hour' }
const inline = (value = 24): Row => ({ numeric_contract: 'numeric-inline-v1', numeric_checks: [{
  numeric_id: refs[0].id, classification: 'business_quantity', unit_ids: [], reason: 'Horario del proyecto.',
  factual_values: [], project_values: [{ ...fact, value }],
}] })
const factSchema = { type: 'object', additionalProperties: false, properties: {
  fragment: { type: 'string' }, value: { type: 'number' }, dimension: { type: 'string' }, measurement_unit: { type: 'string' },
}, required: Object.keys(fact) }
const schema = numericCoverageSchema({ type: 'object', additionalProperties: false, properties: {
  factual_values: { type: 'array', items: factSchema, maxItems: 80 },
  project_values: { type: 'array', items: factSchema, maxItems: 80 },
}, required: ['factual_values', 'project_values'] }, refs, [])

test('wire schema requires self-contained facts and forbids model-generated positional bindings', () => {
  const validate = new Ajv({ strict: false }).compile(atomicNumericSchema(schema))
  assert.equal(validate(inline()), true, JSON.stringify(validate.errors))
  const old = inline()
  object((old.numeric_checks as Row[])[0]).project_value_indexes = [0]
  assert.equal(validate(old), false)
  const missing = inline(); (missing.numeric_checks as Row[])[0].project_values = []
  assert.equal(validate(missing), false)
})

test('24h binds to its own fact; a changed quantity still fails exact validation', () => {
  const canonical = materializeNumericReview(inline())
  assert.deepEqual(numericCoverageIssues(canonical, refs, []), [])
  assert.ok(numericCoverageIssues(materializeNumericReview(inline(25)), refs, []).length)
  assert.deepEqual(materializeNumericReview(canonical), canonical)
})

test('numeric patch preserves semantic decisions, rejects missing checks and refuses a changed draft', () => {
  const previous = { ...materializeNumericReview(inline(25)), claims: [{ verdict: 'supported', fragment: 'S1' }],
    obligations: [{ verdict: 'met' }] }
  const merged = mergeNumericPatch(previous, inline(), refs, 'same', 'same')
  assert.deepEqual(merged.claims, previous.claims)
  assert.deepEqual(merged.obligations, previous.obligations)
  assert.deepEqual(numericCoverageIssues(merged, refs, []), [])
  assert.throws(() => mergeNumericPatch(previous, inline(), refs, 'old', 'new'), /DRAFT_CHANGED/)
  assert.equal((mergeNumericPatch(previous, { numeric_checks: [] }, refs, 'same', 'same').numeric_repair_issues as Row[]).length, 1)
  const narrowed = numericPatchSchema(schema, refs.map(r => r.id), ['S1'])
  assert.deepEqual(Object.keys(object(narrowed.properties)).sort(), ['numeric_checks', 'numeric_contract', 'review_contract'])
})

test('only numeric failures qualify for a narrow repair; shared interval checks stay together', () => {
  const rangeRefs = buildNumericReferences([{ id: 'S1', text: 'De $200.000 a $300.000.' }])
  const review = { numeric_checks: rangeRefs.map(r => ({ numeric_id: r.id, factual_value_indexes: [0] })) }
  assert.deepEqual(numericPatchScope([{ kind: 'review_metadata', numeric_id: rangeRefs[0].id }], review, rangeRefs), rangeRefs)
  assert.equal(numericPatchScope([{ kind: 'review_metadata', code: 'invalid_claim' }], review, rangeRefs), null)
})

test('pending numeric references materialize without asking the model for array positions', () => {
  const review = materializeNumericReview({ ...inline(), pending_resolutions: [{ numeric_ids: [refs[0].id], claim_indexes: [2] }] })
  assert.deepEqual(review.pending_resolutions, [{ claim_indexes: [2], factual_value_indexes: [], project_value_indexes: [0] }])
})

test('patch budget depends on affected sentences, not unrelated draft numbers', () => {
  const wire = numericPatchSchema(schema, refs.map(r => r.id), ['S1'])
  const input = { respuesta_propuesta: 'Seguridad 24h.', reparacion_numerica: {}, oraciones_borrador: sentences, referencias_numericas: refs }
  const budget = aiOutputBudget(wire, 'review', input)
  assert.ok(budget >= 2500 && budget <= 12000)
  assert.equal(aiOutputBudget(wire, 'review', { ...input, respuesta_propuesta: input.respuesta_propuesta + ' Precios 100 200 300 400 500.' }), budget)
})

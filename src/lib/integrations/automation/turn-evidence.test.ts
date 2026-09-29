import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeReviewReferences } from './turn-evidence'
import { factualValueIssues } from './semantic-review'
import { validateCatalogReply } from './catalog-dialogue'

test('an abbreviated reviewer citation resolves to its unique literal sentence', () => {
  const reply = 'Los departamentos de tres dormitorios ofrecen 120.83 m² de área interior y 27.03 m² de balcón, todos con dos baños completos.'
  const unit = { id: 'unit-1', unit_number: '202', area_exterior_m2: 27.03 }
  const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null,
    fragment: 'departamentos de tres dormitorios ofrecen ... 27.03 m² de balcón' }
  const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
  assert.equal((result.review.factual_values as typeof fact[])[0].fragment, reply)
  assert.deepEqual(factualValueIssues(result.review.factual_values, reply, [unit]), [])
  assert.equal(result.corrections[0].code, 'abbreviated_sentence_reference_resolved')
})

test('an ambiguous or invented abbreviation cannot repair reviewer evidence', () => {
  const reply = 'La suite tiene 27.03 m² de balcón. Otra suite tiene 27.03 m² de balcón.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  for (const fragment of ['suite tiene ... 27.03 m² de balcón', 'suite tiene ... 99.99 m² de balcón']) {
    const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null, fragment }
    const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
    assert.equal((result.review.factual_values as typeof fact[])[0].fragment, fragment)
    assert.equal(factualValueIssues(result.review.factual_values, reply, [unit])[0].code, 'review_fragment_not_in_reply')
  }
})

test('a paraphrased reviewer fragment resolves regardless of the writer word order', () => {
  const reply = 'El balcón tiene 27.03 metros cuadrados y el área interior tiene 120.83 metros cuadrados.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null,
    fragment: 'La superficie exterior mide 27.03 m²' }
  const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
  assert.equal((result.review.factual_values as typeof fact[])[0].fragment, reply)
  assert.equal(result.corrections[0].code, 'unique_numeric_sentence_reference_resolved')
  assert.deepEqual(factualValueIssues(result.review.factual_values, reply, [unit]), [])
  assert.equal(validateCatalogReply(reply, {
    verified_catalog: true,
    catalog_results: { units: [{ ...unit, unit_number: '202', category: 'departamento', area_internal_m2: 120.83 }] },
    semantic_review: { ...result.review, status: 'checked' },
  }).valid, true)
})

test('a reviewer citation with a contradictory number is not anchored to a real sentence', () => {
  const reply = 'El balcón tiene 27.03 metros cuadrados.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  for (const fragment of ['El balcón tiene 99.99 metros cuadrados.', 'El balcón tiene 27.03 y 99.99 metros cuadrados.']) {
    const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null, fragment }
    const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
    assert.equal((result.review.factual_values as typeof fact[])[0].fragment, fact.fragment)
    assert.equal(factualValueIssues(result.review.factual_values, reply, [unit])[0].code, 'review_fragment_not_in_reply')
  }
})

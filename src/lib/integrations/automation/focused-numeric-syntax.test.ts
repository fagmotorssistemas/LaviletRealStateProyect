import assert from 'node:assert/strict'
import test from 'node:test'
import { focusedNumericMentions } from './focused-numeric-syntax'
import { buildNumericReferences, numericCoverageIssues, numericReferencesForPrompt } from './focused-numeric-coverage'
import { observedNumericIssues } from './focused-numeric-observations'

test('signed and initial-decimal quantities retain exact values and original spans across both validators', () => {
  for (const [phrase, value] of [['-3', -3], ['−3', -3], ['+3', 3], ['$-3', -3], ['-$3', -3],
    ['.5', 0.5], [',5', 0.5], ['-.5', -0.5], ['+.5', 0.5]] as const) {
    const text = `Dato: ${phrase}.`, sentences = [{ id: 'S1', text }]
    const mentions = focusedNumericMentions(text)
    assert.deepEqual(mentions.map(row => row.value), [value], phrase)
    assert.equal(text.slice(mentions[0].index, mentions[0].end), mentions[0].text)
    const fact = { fragment: 'S1', field: 'floor_number', value, operator: 'eq' }
    const review = { factual_values: [fact], numeric_checks: [{ numeric_id: 'N1', classification: 'business_quantity',
      factual_value_indexes: [0], project_value_indexes: [], unit_ids: [], reason: 'Cantidad expresada.' }] }
    assert.deepEqual(observedNumericIssues(review, sentences), [], phrase)
    assert.deepEqual(numericCoverageIssues(review, buildNumericReferences(sentences), []), [], phrase)
    assert.ok(observedNumericIssues({ factual_values: [{ ...fact, value: value + 0.001 }] }, sentences).length)
  }
  assert.deepEqual(focusedNumericMentions('2 - 3; 2–3; -3 a -1').map(row => row.value), [2, 3, 2, 3, -3, -1])
})

test('million-scale cardinal sections and compound ordinals share exact interpretation without legacy edits', () => {
  for (const [phrase, value] of [['dos millones quinientos mil', 2500000],
    ['un millón doscientos treinta mil quinientos', 1230500], ['dos millones cien', 2000100],
    ['mil doscientos', 1200], ['ciento veintitrés', 123], ['vigésimo sexto', 26]] as const) {
    const text = `Dato: ${phrase}.`, sentences = [{ id: 'S1', text }]
    assert.deepEqual(focusedNumericMentions(text).map(row => row.value), [value], phrase)
    assert.deepEqual(buildNumericReferences(sentences).map(row => row.value), [value], phrase)
    assert.deepEqual(observedNumericIssues({ factual_values: [{ fragment: 'S1', value }] }, sentences), [], phrase)
  }
})

test('leading decimal dimensions preserve exact conversions, including signs', () => {
  for (const [phrase, value] of [['.5 km', 500], [',5 km', 500], ['-.5 km', -500]] as const) {
    const sentences = [{ id: 'S1', text: phrase }]
    const fact = { fragment: 'S1', value, dimension: 'distance', measurement_unit: 'meter' }
    const review = { project_values: [fact], numeric_checks: [{ numeric_id: 'N1', classification: 'business_quantity',
      factual_value_indexes: [], project_value_indexes: [0], unit_ids: [], reason: 'Distancia expresada.' }] }
    assert.deepEqual(observedNumericIssues(review, sentences), [], phrase)
    assert.deepEqual(numericCoverageIssues(review, buildNumericReferences(sentences), []), [], phrase)
  }
})

test('prompt projection preserves numeric references without repeating the full sentence or internal offsets', () => {
  const refs = buildNumericReferences([{ id: 'S1', text: 'La distancia es .5 km y hay 3 opciones.' }])
  const projected = numericReferencesForPrompt(refs)
  assert.deepEqual(projected.map(row => row.id), refs.map(row => row.id))
  assert.deepEqual(projected.map(row => row.value), [0.5, 3])
  assert.deepEqual(projected[0].quantities, [{ value: 500, dimension: 'distance', unit: 'meter' }])
  assert.ok(projected.every(row => !('sentence_text' in row) && !('start' in row) && !('end' in row)))
  assert.equal('quantities' in projected[1], false)
})

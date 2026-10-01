import assert from 'node:assert/strict'
import test from 'node:test'
import { observedNumericIssues } from './focused-numeric-observations'

const facts = (value: number, field = 'published_commercial_price') => ({ factual_values: [
  { fragment: 'S1', value, field, operator: 'eq' },
] })
const sentences = (text: string) => [{ id: 'S1', text }]

test('numeric evidence accepts decimal, grouped, word and fractional notation without rounding', () => {
  for (const phrase of ['$550.000', '550 000 USD', '550\u00a0000 USD', '550\u202f000 USD',
    'quinientos cincuenta mil dólares', '0,55 millones de dólares'])
    assert.deepEqual(observedNumericIssues(facts(550000), sentences(`Importe: ${phrase}.`)), [], phrase)
  for (const [phrase, value] of [['medio millón de dólares', 500000], ['un millón y medio de dólares', 1500000],
    ['un cuarto de millón de dólares', 250000], ['tres cuartos de millón de dólares', 750000]] as const)
    assert.deepEqual(observedNumericIssues(facts(value), sentences(`Importe: ${phrase}.`)), [], phrase)
  assert.deepEqual(observedNumericIssues(facts(120.83, 'area_internal_m2'), sentences('Superficie: ciento veinte coma ochenta y tres m².')), [])
  assert.deepEqual(observedNumericIssues(facts(6, 'floor_number'), sentences('Se encuentra en la sexta planta.')), [])
  assert.equal(observedNumericIssues(facts(120.83, 'area_internal_m2'), sentences('Superficie: 121 m².'))[0].code, 'review_number_not_in_draft')
  assert.equal(observedNumericIssues(facts(550000), sentences('El precio es $550.001.'))[0].code, 'review_number_not_in_draft')
})

test('project quantities accept only exact dimension-labelled distance and time conversions', () => {
  for (const [phrase, value, dimension, measurement_unit] of [
    ['Distancia: 0,5 km.', 500, 'distance', 'meter'],
    ['Distancia: medio kilómetro.', 500, 'distance', 'meter'],
    ['Distancia: un kilómetro y medio.', 1500, 'distance', 'meter'],
    ['Duración: 90 minutos.', 1.5, 'duration', 'hour'],
    ['Duración: una hora y media.', 1.5, 'duration', 'hour'],
    ['Duración: treinta minutos.', 0.5, 'duration', 'hour'],
  ] as const) {
    const review = { project_values: [{ fragment: 'S1', value, dimension, measurement_unit }] }
    assert.deepEqual(observedNumericIssues(review, sentences(phrase)), [], phrase)
    assert.ok(observedNumericIssues({ project_values: [{ ...review.project_values[0], value: value + 0.01 }] }, sentences(phrase)).length, phrase)
  }
  for (const phrase of ['Distancia: 0,5 m.', 'Distancia: 0,5.', 'Duración: 0,5 horas.', 'Distancia: 500 km.', 'Duración: 500 horas.']) {
    const review = { project_values: [{ fragment: 'S1', value: 500, dimension: 'distance', measurement_unit: 'meter' }] }
    assert.equal(observedNumericIssues(review, sentences(phrase))[0].code, 'review_number_not_in_draft')
  }
})

test('numeric evidence keeps errors local and never treats a URL or a unit exponent as a quantity', () => {
  assert.equal(observedNumericIssues(facts(550000), sentences('Consulte https://example.org/550000.'))[0].code, 'review_number_not_in_draft')
  assert.equal(observedNumericIssues(facts(2, 'bedrooms'), sentences('Superficie: 120 m2.'))[0].code, 'review_number_not_in_draft')
  const result = observedNumericIssues({ factual_values: [{ fragment: 'S1', value: 200000, upper_value: 300000, operator: 'between', field: 'published_commercial_price' }] },
    sentences('Entre $200.000 y $250.000.'))
  assert.equal(result[0].sentence_id, 'S1')
  assert.equal(result[0].field, 'published_commercial_price')
  assert.equal(result[0].repair_owner, 'reviewer')
  assert.deepEqual(observedNumericIssues({ factual_values: [{ fragment: 'S99', value: 9 }] }, sentences('Mensaje.')), [])
})

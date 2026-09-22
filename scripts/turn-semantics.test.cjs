/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { normalizeTurnSemantics, normalizedPendingQuestion, pendingQuestionFromReply, TURN_SEMANTICS_SCHEMA } = require('../src/lib/integrations/automation/turn-semantics.ts')

function extract(current, property, pending = {}, answer = {}) {
  return normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { ...property, evidence: current, confidence: 'high' },
    answer_to_previous: { ...answer, evidence: current, confidence: 'high' },
  } }, current, pending)
}

test('general housing interest cannot silently become an apartment category', () => {
  for (const current of ['me interesa vivienda', 'quiero algo para vivir']) {
    const result = extract(current, { category: 'departamento', operation: 'select' })
    assert.equal(result.property.group, 'residential')
    assert.equal(result.property.category, null)
    assert.equal(result.property.operation, 'search')
    assert.ok(result.normalization_issues.includes('generic_residential_is_not_category'))
  }
})

test('ranking asks for information and does not inherit an erroneous select intent', () => {
  const result = extract('cual es la opcion mas grande?', { operation: 'select', reference_kind: 'relative', selector: 'largest' })
  assert.equal(result.property.operation, 'rank')
  assert.equal(result.property.query_scope, 'catalog')
})

test('spelled, ordinal and compact floor restrictions share a normalized field', () => {
  for (const current of ['entiendo quiero la opcion de la 5ta planta', 'quinta planta', 'piso cinco', 'planta 5']) {
    const result = extract(current, {}, { id: 'property_floor', question: '¿Qué planta prefiere?' })
    assert.equal(result.property.filters.floor_number, 5, current)
    assert.equal(result.property.operation, 'search', current)
  }
})

test('a new room requirement is not swallowed as a negative budget answer', () => {
  const current = 'no tiene opciones de5habiataciones'
  const result = extract(current, {}, { id: 'budget_amount', question: '¿Con qué presupuesto cuenta?' }, { question_id: 'budget_amount', kind: 'negative' })
  assert.equal(result.property.filters.bedrooms, 5)
  assert.equal(result.property.operation, 'search')
  assert.equal(result.answer_to_previous.question_id, null)
  assert.equal(result.answer_to_previous.kind, 'none')
})

test('a comparison preserves its normalized constraints and indispensable room requirements', () => {
  const result = extract('compare los departamentos de tres dormitorios', { operation: 'compare', category: 'departamento', reference_kind: 'comparison' })
  assert.equal(result.property.operation, 'compare')
  assert.equal(result.property.filters.bedrooms, 3)
  assert.equal(extract('necesito exactamente cinco dormitorios', {}).property.filters.bedrooms_required, true)
})

test('durable pending metadata preserves the question action and validates target IDs', () => {
  const result = normalizedPendingQuestion({ id: 'unit_choice', act: 'show_unit_details', question: '¿Desea más detalles?',
    target_ids: ['u502', 'invented'], candidate_ids: ['u502', 'u504'] }, [{ id: 'u502' }, { id: 'u504' }])
  assert.deepEqual(result.target_ids, ['u502'])
  assert.deepEqual(result.candidate_ids, ['u502', 'u504'])
  assert.equal(result.act, 'show_unit_details')
  const current = 'si prefiero esa opcion'
  assert.equal(extract(current, { reference_kind: 'followup' }, result, { question_id: 'unit_choice', kind: 'affirmative' }).answer_to_previous.kind, 'affirmative')
  assert.equal(pendingQuestionFromReply('¿Desea que le presente más detalles sobre el departamento 502, que es la opción más grande de la quinta planta?').id, 'unit_choice')
})

test('the strict extraction schema requires every field and forbids unexpected keys recursively', () => {
  function check(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort())
      Object.values(schema.properties).forEach(check)
    } else if (schema.type === 'array') check(schema.items)
  }
  check(TURN_SEMANTICS_SCHEMA)
  assert.ok(TURN_SEMANTICS_SCHEMA.properties.property.properties.filters.properties.floor_number)
})

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

test('five bedrooms are not mandatory merely because the model asserts they are', () => {
  for (const current of ['Me interesa una vivienda, tiene opciones de 5 habitaciones?', 'Es que si me serviría con 5 dormitorios.']) {
    const result = extract(current, { group: 'residential', operation: 'search', filters: { bedrooms: 5, bedrooms_required: true } })
    assert.equal(result.property.filters.bedrooms, 5)
    assert.equal(result.property.filters.bedrooms_required, null)
    assert.ok(result.normalization_issues.includes('bedrooms_requirement_without_explicit_evidence'))
  }
  for (const current of ['Necesito exactamente 5 dormitorios', 'Necesito 5 dormitorios, menos no me sirve', 'Son indispensables 5 habitaciones']) {
    assert.equal(extract(current, { filters: { bedrooms: 5, bedrooms_required: true } }).property.filters.bedrooms_required, true)
  }
  assert.equal(extract('No es indispensable tener 5 dormitorios', { filters: { bedrooms: 5, bedrooms_required: true } }).property.filters.bedrooms_required, null)
})

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

test('alternative proposals retain verified search constraints without carrying a selection action', () => {
  const pending = normalizedPendingQuestion({ id: 'property_category', act: 'explore_alternatives', question: '¿Revisamos las alternativas de tres dormitorios?',
    candidate_ids: ['u202', 'unknown'], proposed_query: { group: 'residential', category: null, operation: 'select', selector: 'first', scope: 'catalog',
      filters: { bedrooms: 3, floor_number: -1, bedrooms_required: false }, requested_visit: true } }, [{ id: 'u202' }])
  assert.equal(pending.act, 'explore_alternatives')
  assert.deepEqual(pending.candidate_ids, ['u202'])
  assert.equal(pending.proposed_query.operation, 'search')
  assert.equal(pending.proposed_query.selector, null)
  assert.equal(pending.proposed_query.filters.bedrooms, 3)
  assert.equal(pending.proposed_query.filters.floor_number, null)
  assert.equal(pending.proposed_query.requested_visit, undefined)
  assert.equal(extract('sí está bien', { operation: 'none' }, pending, { question_id: 'property_category', kind: 'affirmative' }).answer_to_previous.kind, 'affirmative')
  assert.equal(normalizedPendingQuestion({ ...pending, act: 'choose_category' }).proposed_query, undefined)
})

test('choosing a category searches within it while choosing a concrete unit still selects it', () => {
  const category = extract('Prefiero departamentos porque los penthouses son caros', { category: 'departamento', excluded_categories: ['penthouse'], operation: 'select' })
  assert.equal(category.property.operation, 'search')
  assert.ok(category.normalization_issues.includes('category_choice_refines_search'))
  assert.equal(extract('Prefiero el departamento 202', { category: 'departamento', operation: 'select', reference_kind: 'explicit', unit_numbers: ['202'] }).property.operation, 'select')
  assert.equal(extract('Prefiero el departamento más grande de esos', { category: 'departamento', operation: 'select', reference_kind: 'relative', selector: 'largest' }).property.operation, 'select')
})

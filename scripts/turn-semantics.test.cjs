/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { normalizeTurnSemantics, normalizedPendingQuestion, pendingQuestionFromReply, propertyPreferenceChange, TURN_SEMANTICS_SCHEMA } = require('../src/lib/integrations/automation/turn-semantics.ts')

function extract(current, property, pending = {}, answer = {}) {
  return normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { ...property, evidence: current, confidence: 'high' },
    answer_to_previous: { ...answer, evidence: current, confidence: 'high' },
  } }, current, pending)
}

function quantitiesTurn(current, quantities, property = {}, pending = {}) {
  return normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high', housing_quantities: quantities,
    property: { operation: 'search', ...property, evidence: current, confidence: 'high' },
  } }, current, pending)
}

const quantity = (dimension, values, evidence, role = 'context', count_basis = 'total') =>
  ({ dimension, values, role, count_basis, evidence, confidence: 'high' })

test('household counts never become bedroom filters, including the speaker when explicitly excluded', () => {
  const current = 'es para mi y para mi familia, busco algo para unas 5 sin contar conmigo'
  const result = quantitiesTurn(current, [quantity('people', [5], 'para unas 5 sin contar conmigo', 'context', 'excluding_speaker')],
    { filters: { bedrooms: 5, bedrooms_required: true }, filter_evidence: { bedrooms: 'para unas 5 sin contar conmigo', bedrooms_required: current } })
  assert.equal(result.household.occupants, 6)
  assert.equal(result.property.filters.bedrooms, null)
  assert.equal(result.property.filters.bedrooms_required, null)
  assert.ok(result.normalization_issues.includes('bedroom_filter_without_bedroom_requirement'))
  const explicit = 'Somos cinco personas en mi familia'
  assert.equal(quantitiesTurn(explicit, [quantity('people', [5], explicit)]).household.occupants, 5)
})

test('people and bedroom requirements remain independent even with identical or competing numbers', () => {
  for (const [current, people, bedrooms] of [['Somos seis y busco tres cuartos', 6, 3], ['Somos tres y necesitamos tres habitaciones', 3, 3]]) {
    const result = quantitiesTurn(current, [quantity('people', [people], current), quantity('bedrooms', [bedrooms], current, 'requirement')],
      { filters: { bedrooms }, filter_evidence: { bedrooms: current } })
    assert.equal(result.household.occupants, people)
    assert.equal(result.property.filters.bedrooms, bedrooms)
  }
  const current = 'Necesito cinco dormitorios'
  const result = quantitiesTurn(current, [quantity('bedrooms', [5], current, 'requirement')],
    { filters: { bedrooms: 5 }, filter_evidence: { bedrooms: current } })
  assert.equal(result.property.filters.bedrooms, 5)
  assert.equal(result.household, null)
  const alternatives = 'Busco cinco o seis dormitorios'
  assert.deepEqual(quantitiesTurn(alternatives, [quantity('bedrooms', [5, 6], alternatives, 'requirement')],
    { filters: { bedrooms_any: [5, 6] }, filter_evidence: { bedrooms_any: alternatives } }).property.filters.bedrooms_any, [5, 6])
})

test('evaluating room suitability keeps the offered reference without manufacturing a new bedroom requirement', () => {
  const current = '¿Me alcanzarán 3 dormitorios para una familia de 6?'
  const pending = { id: 'unit_choice', act: 'explore_quoted_options', candidate_ids: ['u602', 'u605'], proposed_query: { filters: { bedrooms: 3 } } }
  const result = quantitiesTurn(current, [quantity('bedrooms', [3], '3 dormitorios', 'evaluation'), quantity('people', [6], 'familia de 6')],
    { operation: 'details', reference_kind: 'followup', query_scope: 'offered', filters: { bedrooms: 3 }, filter_evidence: { bedrooms: '3 dormitorios' } }, pending)
  assert.equal(result.household.occupants, 6)
  assert.equal(result.property.filters.bedrooms, null)
  assert.equal(result.property.operation, 'details')
  assert.equal(result.property.reference_kind, 'followup')
  assert.equal(result.property.query_scope, 'offered')
  assert.equal(result.answer_to_previous.question_id, null)
})

test('unclear quantities and ungrounded claims stay unknown instead of generating room filters', () => {
  for (const [current, quantities] of [
    ['Somos varios', [quantity('people', [], 'Somos varios', 'context', 'unspecified')]],
    ['Busco algo para cinco', [quantity('unknown', [5], 'para cinco', 'unknown', 'unspecified')]],
    ['Somos cuatro', [quantity('bedrooms', [5], 'necesito cinco dormitorios', 'requirement')]],
    ['Somos cuatro', [{ ...quantity('bedrooms', [5], 'Somos cuatro', 'requirement'), confidence: 'low' }]],
  ]) {
    const result = quantitiesTurn(current, quantities, { filters: { bedrooms: 5 }, filter_evidence: { bedrooms: current } })
    assert.equal(result.property.filters.bedrooms, null, current)
    assert.equal(result.household, null, current)
  }
  const current = 'somos cuatro o cinco'
  assert.equal(quantitiesTurn(current, [quantity('people', [4, 5], current)]).household, null)
})

test('a contextual bedroom answer remains valid without lexical room words', () => {
  const current = 'tres'
  const result = quantitiesTurn(current, [quantity('bedrooms', [3], current, 'requirement')],
    { filters: { bedrooms: 3 }, filter_evidence: { bedrooms: current } }, { id: 'property_bedrooms', question: '¿Cuántos dormitorios necesita?' })
  assert.equal(result.property.filters.bedrooms, 3)
})

test('per-field evidence separates current constraints from repeated historical characteristics', () => {
  const inherited = extract('qué cambia entre estas opciones?', { operation: 'compare', reference_kind: 'comparison',
    filters: { bedrooms: 3, floor_number: 6 }, filter_evidence: { bedrooms: '', floor_number: 'sexta planta' } })
  assert.equal(inherited.property.filters.bedrooms, null)
  assert.equal(inherited.property.filters.floor_number, null)
  assert.ok(inherited.normalization_issues.includes('property_filter_without_current_evidence:floor_number'))
  const current = 'compare solo las que superen cien metros cuadrados'
  const interpreted = extract(current, { operation: 'compare', reference_kind: 'comparison', filters: { min_area_m2: 100 },
    filter_evidence: { min_area_m2: 'superen cien metros cuadrados' } })
  assert.equal(interpreted.property.filters.min_area_m2, 100)
  assert.equal(interpreted.property.filter_evidence.min_area_m2, 'superen cien metros cuadrados')
  const explicit = extract('quiero 2 cuartos', { operation: 'search', filters: {}, filter_evidence: {} })
  assert.equal(explicit.property.filters.bedrooms, 2)
})

test('preference changes distinguish explicit fewer bedrooms from unqualified cheaper requests and rankings', () => {
  const prior = { filters: { bedrooms: 3 } }
  for (const current of ['quiero menos cuartos', 'prefiero algo con menos dormitorios', 'algo de dos habitaciones']) {
    assert.equal(propertyPreferenceChange(current, prior).kind, 'fewer_bedrooms', current)
  }
  assert.equal(propertyPreferenceChange('algo más económico', prior).requires_bedroom_confirmation, true)
  const explicit = propertyPreferenceChange('opciones más baratas de 3 cuartos', prior)
  assert.equal(explicit.kind, 'cheaper')
  assert.equal(explicit.bedrooms, 3)
  assert.equal(explicit.requires_bedroom_confirmation, false)
  for (const current of ['no quiero menos cuartos', 'no necesito algo más económico', 'no más barato', 'no másbarato', 'cuál es el más barato de estos?', 'cuál es el más económico?', 'prefiero el más barato', 'el más económico']) {
    assert.equal(propertyPreferenceChange(current, prior).kind, null, current)
  }
  for (const current of ['algo más económico de 2 cuartos', 'más barato con menos dormitorios']) {
    const both = propertyPreferenceChange(current, prior)
    assert.equal(both.kind, 'cheaper', current)
    assert.equal(both.fewer_bedrooms, true, current)
    assert.equal(both.requires_bedroom_confirmation, false, current)
  }
})

test('generic fewer bedrooms never adopts an invented exact count or an unmentioned category', () => {
  const result = extract('prefiero menos cuartos', { category: 'penthouse', operation: 'search', filters: { bedrooms: 2 } })
  assert.equal(result.property.filters.bedrooms, null)
  assert.equal(result.property.category, null)
  assert.equal(result.property.operation, 'search')
  const exact = extract('quiero departamentos de 2 cuartos', { category: 'departamento', operation: 'search', filters: { bedrooms: 2 } })
  assert.equal(exact.property.filters.bedrooms, 2)
  assert.equal(exact.property.category, 'departamento')
})

test('quoted details and bedroom confirmation preserve their distinct durable question actions', () => {
  assert.equal(normalizedPendingQuestion({ id: 'unit_choice', act: 'explore_quoted_options', candidate_ids: ['a', 'b'] }).act, 'explore_quoted_options')
  const pending = normalizedPendingQuestion({ id: 'property_bedrooms', act: 'confirm_bedrooms', candidate_ids: ['a'],
    proposed_query: { group: 'residential', filters: { bedrooms: 4 }, scope: 'offered' } })
  assert.equal(pending.act, 'confirm_bedrooms')
  assert.equal(pending.proposed_query.filters.bedrooms, 4)
  assert.equal(pending.proposed_query.scope, 'offered')
  assert.equal(extract('sí', {}, pending, { question_id: 'property_bedrooms', kind: 'affirmative' }).answer_to_previous.question_id, 'property_bedrooms')
})

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

test('ranking uses the extractor operation and does not turn into selecting a unit', () => {
  const result = extract('cual es la opcion mas grande?', { operation: 'rank', reference_kind: 'relative', selector: 'largest' })
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

test('profile confirmation keeps its declared place separate from catalogue candidate IDs', () => {
  const pending = normalizedPendingQuestion({ id: 'lead_residence_confirmation', act: 'visit',
    question: 'Entiendo que es de Cuenca. ¿Es también su lugar de residencia actual?',
    residence_candidate: { city: 'Cuenca', country: null, evidence: 'soy de Cuenca', unit_id: 'u502' },
    target_ids: ['u502'], candidate_ids: ['u502'], proposed_query: { category: 'departamento' },
  }, [{ id: 'u502' }])
  assert.equal(pending.act, 'profile')
  assert.deepEqual(pending.target_ids, [])
  assert.deepEqual(pending.candidate_ids, [])
  assert.deepEqual(pending.residence_candidate, { city: 'Cuenca', country: null, evidence: 'soy de Cuenca' })
  assert.equal(pending.proposed_query, undefined)
  for (const id of ['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'unit_choice']) {
    assert.equal(normalizedPendingQuestion({ ...pending, id }).residence_candidate, undefined)
  }
  assert.equal(normalizedPendingQuestion({ ...pending, residence_candidate: { city: 'Cuenca' } }).residence_candidate, undefined)
})

test('a yes to residence confirmation answers only the recorded profile question without authorizing a visit or property choice', () => {
  const pending = { id: 'lead_residence_confirmation', residence_candidate: { city: 'Cuenca', country: null, evidence: 'soy de Cuenca' } }
  const semantics = question_id => normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'answer_previous', primary_evidence: 'sí', confidence: 'high',
    answer_to_previous: { question_id, kind: 'affirmative', evidence: 'sí', confidence: 'high' },
    property: { operation: 'none', reference_kind: 'none', unit_numbers: [], evidence: '', confidence: 'low' },
  } }, 'sí', pending)
  const result = semantics('lead_residence_confirmation')
  assert.equal(result.answer_to_previous.question_id, 'lead_residence_confirmation')
  assert.equal(result.answer_to_previous.kind, 'affirmative')
  assert.equal(result.primary_intent, 'answer_previous')
  assert.equal(result.property.operation, 'none')
  assert.deepEqual(result.property.unit_numbers, [])
  for (const other of ['lead_profile', 'visit_invitation', 'unit_choice', 'none']) {
    assert.equal(semantics(other).answer_to_previous.question_id, null)
  }
})

test('legacy reply parsing recognizes generic profile questions without inventing a confirmation place', () => {
  for (const [reply, expected] of [
    ['Para compartirle el brochure y una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?', 'lead_profile'],
    ['¿Con qué nombre tengo el gusto de comunicarme?', 'lead_profile_name'],
    ['¿En qué ciudad o país vive actualmente?', 'lead_profile_residence'],
    ['Entiendo que es de Cuenca. ¿Es también su lugar de residencia actual?', 'lead_profile_residence'],
  ]) {
    const question = pendingQuestionFromReply(reply)
    assert.equal(question.id, expected, reply)
    assert.equal(question.act, 'profile')
    assert.equal(question.residence_candidate, undefined)
  }
  assert.equal(pendingQuestionFromReply('Su nombre y residencia fueron registrados.').id, undefined)
  const ids = TURN_SEMANTICS_SCHEMA.properties.answer_to_previous.properties.question_id.enum
  for (const id of ['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'lead_residence_confirmation']) assert.ok(ids.includes(id))
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
  assert.equal(normalizedPendingQuestion({ ...pending, act: 'choose_category' }).proposed_query.filters.bedrooms, 3)
  assert.equal(normalizedPendingQuestion({ ...pending, act: 'choose_unit' }).proposed_query, undefined)
})

test('choosing a category searches within it while choosing a concrete unit still selects it', () => {
  const category = extract('Prefiero departamentos porque los penthouses son caros', { category: 'departamento', excluded_categories: ['penthouse'], operation: 'select' })
  assert.equal(category.property.operation, 'search')
  assert.ok(category.normalization_issues.includes('category_choice_refines_search'))
  assert.equal(extract('Prefiero el departamento 202', { category: 'departamento', operation: 'select', reference_kind: 'explicit', unit_numbers: ['202'] }).property.operation, 'select')
  assert.equal(extract('Prefiero el departamento más grande de esos', { category: 'departamento', operation: 'select', reference_kind: 'relative', selector: 'largest' }).property.operation, 'select')
})

test('incidental ranking keywords cannot overwrite a current model details operation', () => {
  const current = 'Ya sé cuál es la más grande, ahora quiero detalles de esa opción'
  const result = extract(current, { operation: 'details', reference_kind: 'followup', query_scope: 'selected' })
  assert.equal(result.property.operation, 'details')
  assert.equal(result.property.query_scope, 'selected')
  assert.ok(result.normalization_issues.includes('extractor_operation_precedes_ranking_keywords'))
})

test('a current reservation request takes priority without losing a negative answer to the previous proposal', () => {
  const current = 'por el momento no, entonces quiero separar el departametno 605}'
  const result = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'answer_previous', primary_evidence: 'por el momento no', confidence: 'high',
    answer_to_previous: { question_id: 'budget_amount', kind: 'negative', evidence: 'por el momento no', confidence: 'high' },
    reservation: { kind: 'request', evidence: 'quiero separar el departametno 605', unit_numbers: ['605'], confidence: 'high' },
    property: { operation: 'select', reference_kind: 'explicit', unit_numbers: ['605'], evidence: 'departametno 605', confidence: 'high' },
  } }, current, { id: 'budget_amount' })
  assert.equal(result.primary_intent, 'request_reservation')
  assert.equal(result.primary_evidence, 'quiero separar el departametno 605')
  assert.equal(result.answer_to_previous.kind, 'negative')
  assert.equal(result.reservation.kind, 'request')
  assert.deepEqual(result.reservation.unit_numbers, ['605'])
  assert.equal(result.interpretation.extractor_primary_intent, 'answer_previous')
  assert.equal(result.interpretation.canonical_primary_intent, 'request_reservation')
  assert.ok(result.interpretation.decisions.some(item => item.code === 'current_reservation_takes_priority'))
})

test('reservation information, refusal, missing evidence and legacy scoring events never authorize initiation', () => {
  const cases = [
    { current: '¿Qué requisitos necesito para reservar?', kind: 'information', expected: 'information', primary: 'ask_reservation' },
    { current: 'Por ahora no quiero reservar', kind: 'declined', expected: 'declined', primary: 'answer_previous' },
    { current: 'Quiero ver el recorrido', kind: 'request', evidence: 'quiero reservar', expected: 'none', primary: 'answer_previous' },
    { current: 'Tal vez lo reserve', kind: 'request', confidence: 'medium', expected: 'none', primary: 'answer_previous' },
  ]
  for (const item of cases) {
    const result = normalizeTurnSemantics({ events: ['asked_reservation'], turn_semantics: {
      primary_intent: 'answer_previous', primary_evidence: item.current, confidence: 'high',
      reservation: { kind: item.kind, evidence: item.evidence || item.current, confidence: item.confidence || 'high', unit_numbers: [] },
    } }, item.current, {})
    assert.equal(result.reservation.kind, item.expected, item.current)
    assert.equal(result.primary_intent, item.primary, item.current)
  }
  const unsupported = normalizeTurnSemantics({ events: ['asked_reservation'], turn_semantics: {
    primary_intent: 'request_reservation', primary_evidence: 'sí', confidence: 'high',
  } }, 'sí', { id: 'unit_choice', act: 'show_unit_details' })
  assert.equal(unsupported.primary_intent, 'other')
  assert.equal(unsupported.reservation.kind, 'none')
  assert.ok(unsupported.interpretation.decisions.some(item => item.code === 'reservation_intent_without_current_action_evidence'))
})

test('reservation evidence is action scoped and model references remain catalogue candidates, not confirmed units', () => {
  const reservation = { kind: 'request', evidence: 'quiero separar el LC-02', unit_numbers: ['LC-02', 'LC-02', 'https://example.test', '605'], confidence: 'high' }
  const semantics = { primary_intent: 'request_reservation', primary_evidence: reservation.evidence, confidence: 'high', reservation }
  const accepted = normalizeTurnSemantics({ turn_semantics: semantics }, reservation.evidence, {})
  assert.deepEqual(accepted.reservation.unit_numbers, ['LC-02', '605'])
  assert.equal(accepted.reservation.confirmed, undefined)
  const scoped = normalizeTurnSemantics({ turn_semantics: semantics }, '¿Cuál es el precio del departamento?', {})
  assert.equal(scoped.reservation.kind, 'none')
  assert.equal(scoped.primary_intent, 'other')
})

test('grounded extractor filters prevail over the first number found by a lexical fallback', () => {
  const current = 'Ya no quiero 3 cuartos, prefiero 2 dormitorios'
  const result = extract(current, { operation: 'search', category: 'departamento', filters: { bedrooms: 2 },
    filter_evidence: { bedrooms: 'prefiero 2 dormitorios' } })
  assert.equal(result.property.filters.bedrooms, 2)
  assert.ok(result.normalization_issues.includes('extractor_filter_precedes_keywords:bedrooms'))
  const mandatory = extract('La habitación adicional es una condición para decidirme', { operation: 'search',
    filters: { bedrooms: 3, bedrooms_required: true }, filter_evidence: {
      bedrooms: 'La habitación adicional', bedrooms_required: 'es una condición para decidirme',
    } })
  assert.equal(mandatory.property.filters.bedrooms_required, true)
})

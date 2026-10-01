import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { buildNumericReferences, numericCoverageIssues, numericCoverageSchema, remapNumericChecks } from './focused-numeric-coverage'
import type { Row } from './data'

const catalog = [{ id: 'u602', unit_number: '602', published_commercial_price: 550000, floor_number: 6 },
  { id: 'group:min', aggregation: 'min', member_ids: ['u602'], unit_number: '602' }]
const sentences = (text: string) => [{ id: 'S1', text }]
const check = (numeric_id: string, classification: string, extra: Row = {}): Row => ({ numeric_id, classification,
  factual_value_indexes: [], project_value_indexes: [], unit_ids: [], reason: 'Clasificación de esta expresión en su oración.', ...extra })
const price = { fragment: 'S1', unit_id: 'u602', field: 'published_commercial_price', value: 550000, operator: 'eq', value_scope: 'individual' }
const floor = { fragment: 'S1', unit_id: 'u602', field: 'floor_number', value: 6, operator: 'eq', value_scope: 'individual' }

test('numeric references enumerate digits, words, ordinals and ambiguous articles while masking URL and square-unit exponent', () => {
  const original = 'Un proyecto. La unidad 602 cuesta $550.000 en la sexta planta, tiene 120,83 m2. Una familia de seis. https://example.com/99-v3.pdf'
  const refs = buildNumericReferences(sentences(original))
  assert.deepEqual(refs.map(ref => ref.value), [1, 602, 550000, 6, 120.83, 1, 6])
  assert.deepEqual(refs.map(ref => ref.id), refs.map((_, index) => `N${index + 1}`))
  for (const ref of refs) assert.equal(original.slice(ref.start, ref.end), ref.text)
  assert.deepEqual(buildNumericReferences(sentences('El segundo es este; la cuarta alternativa.')).map(ref => ref.value), [2, 4])
  assert.deepEqual(buildNumericReferences(sentences('quinientos cincuenta mil dólares; ciento veinte coma ochenta y tres m²')).map(ref => ref.value), [550000, 120.83])
})

test('numeric syntax handles equivalent grouping and fractions without changing their exact values', () => {
  for (const phrase of ['550 000 USD', '550\u00a0000 USD', '550\u202f000 USD', '$550.000', '$550,000'])
    assert.deepEqual(buildNumericReferences(sentences(phrase)).map(ref => ref.value), [550000], phrase)
  for (const [phrase, value] of [['medio millón', 500000], ['un millón y medio', 1500000],
    ['un cuarto de millón', 250000], ['tres cuartos de millón', 750000]] as const)
    assert.deepEqual(buildNumericReferences(sentences(phrase)).map(ref => ref.value), [value], phrase)
})

test('a narrated price and floor cannot pass with empty numeric extraction', () => {
  const refs = buildNumericReferences(sentences('Cuesta $550.000 y está en la sexta planta.'))
  const review = { claims: [{ fragment: 'S1', verdict: 'supported' }], factual_values: [], project_values: [],
    numeric_checks: refs.map(ref => check(ref.id, 'business_quantity')) }
  assert.deepEqual(numericCoverageIssues(review, refs, catalog).map(row => row.code),
    ['numeric_business_binding_missing', 'numeric_business_binding_missing'])
  const withRows = { ...review, factual_values: [price, floor], numeric_checks: refs.map((ref, index) =>
    check(ref.id, 'business_quantity', { factual_value_indexes: [index] })) }
  assert.deepEqual(numericCoverageIssues(withRows, refs, catalog), [])
  const noInventory = { ...withRows, numeric_checks: [] }
  assert.equal(numericCoverageIssues(noInventory, refs, catalog).filter(row => row.code === 'unreviewed_numeric_reference').length, 2)
})

test('missing, duplicate, unknown and empty-reason numeric checks stay pending', () => {
  const refs = buildNumericReferences(sentences('Familia de seis.'))
  assert.equal(numericCoverageIssues({}, refs, catalog)[0].code, 'invalid_numeric_coverage')
  assert.equal(numericCoverageIssues({ numeric_checks: [] }, refs, catalog)[0].code, 'unreviewed_numeric_reference')
  const valid = check('N1', 'lead_context')
  assert.equal(numericCoverageIssues({ numeric_checks: [valid, valid] }, refs, catalog)[0].code, 'duplicate_numeric_reference')
  assert.equal(numericCoverageIssues({ numeric_checks: [{ ...valid, numeric_id: 'N9' }] }, refs, catalog)[0].code, 'unknown_numeric_reference')
  assert.equal(numericCoverageIssues({ numeric_checks: [{ ...valid, reason: '  ' }] }, refs, catalog)[0].code, 'invalid_numeric_classification')
  assert.deepEqual(numericCoverageIssues({ numeric_checks: [valid] }, refs, catalog), [])
  assert.deepEqual(numericCoverageIssues({ numeric_checks: [] }, buildNumericReferences(sentences('Gracias.')), catalog), [])
})

test('business bindings must use existing exact values in the same sentence, including both range endpoints', () => {
  const refs = buildNumericReferences(sentences('De $200.000 a $300.000.'))
  const range = { fragment: 'S1', field: 'published_commercial_price', value: 200000, upper_value: 300000, operator: 'between' }
  const review = { factual_values: [range], numeric_checks: refs.map(ref => check(ref.id, 'business_quantity', { factual_value_indexes: [0] })) }
  assert.deepEqual(numericCoverageIssues(review, refs, catalog), [])
  for (const replacement of [{ ...range, upper_value: 299999.999 }, { ...range, fragment: 'S2' }])
    assert.ok(numericCoverageIssues({ ...review, factual_values: [replacement] }, refs, catalog).length)
  assert.ok(numericCoverageIssues({ ...review, numeric_checks: refs.map(ref => check(ref.id, 'business_quantity', { factual_value_indexes: [8] })) }, refs, catalog)
    .every(row => row.code === 'numeric_binding_not_in_sentence'))
  assert.equal(numericCoverageIssues({ ...review, numeric_checks: [check('N1', 'business_quantity', { factual_value_indexes: [0, 0] }), review.numeric_checks[1]] }, refs, catalog)[0].code, 'invalid_numeric_bindings')
  const fullTextRef = { ...range, fragment: refs[0].sentence_text }
  assert.deepEqual(numericCoverageIssues({ ...review, factual_values: [fullTextRef] }, refs, catalog), [])
})

test('dimension-labelled conversions are exact and local to each occurrence', () => {
  for (const [phrase, value, dimension, measurement_unit] of [
    ['0,5 km', 500, 'distance', 'meter'], ['medio kilómetro', 500, 'distance', 'meter'],
    ['un kilómetro y medio', 1500, 'distance', 'meter'], ['treinta minutos', 0.5, 'duration', 'hour'],
    ['una hora y media', 1.5, 'duration', 'hour'],
  ] as const) {
    const refs = buildNumericReferences(sentences(phrase))
    assert.equal(refs.length, 1, phrase)
    const fact = { fragment: 'S1', value, dimension, measurement_unit }
    const review = { project_values: [fact], numeric_checks: [check('N1', 'business_quantity', { project_value_indexes: [0] })] }
    assert.deepEqual(numericCoverageIssues(review, refs, catalog), [], phrase)
    assert.equal(numericCoverageIssues({ ...review, project_values: [{ ...fact, value: value + 0.001 }] }, refs, catalog)[0].code, 'numeric_binding_value_mismatch', phrase)
  }
  const refs = buildNumericReferences(sentences('500 km y 500 metros.'))
  const review = { project_values: [{ fragment: 'S1', value: 500, dimension: 'distance', measurement_unit: 'meter' }],
    numeric_checks: refs.map(ref => check(ref.id, 'business_quantity', { project_value_indexes: [0] })) }
  assert.deepEqual(numericCoverageIssues(review, refs, catalog).map(row => row.numeric_id), ['N1'])
})

test('unit identifiers must resolve to a real individual unit and nonbusiness classifications cannot hide numeric links', () => {
  const refs = buildNumericReferences(sentences('Unidad 602.'))
  assert.deepEqual(numericCoverageIssues({ numeric_checks: [check('N1', 'unit_identifier', { unit_ids: ['u602'] })] }, refs, catalog), [])
  for (const unit_ids of [[], ['wrong'], ['group:min']])
    assert.equal(numericCoverageIssues({ numeric_checks: [check('N1', 'unit_identifier', { unit_ids })] }, refs, catalog)[0].code, 'numeric_unit_identifier_unverified')
  assert.equal(numericCoverageIssues({ numeric_checks: [check('N1', 'unit_identifier', { unit_ids: ['u602'] })] },
    buildNumericReferences(sentences('Unidad 603.')), catalog)[0].code, 'numeric_unit_identifier_unverified')
  for (const classification of ['lead_context', 'contextual_guidance', 'not_quantity']) {
    assert.deepEqual(numericCoverageIssues({ numeric_checks: [check('N1', classification)] }, refs, catalog), [])
    assert.equal(numericCoverageIssues({ numeric_checks: [check('N1', classification, { factual_value_indexes: [0] })] }, refs, catalog)[0].code, 'nonbusiness_numeric_has_business_binding')
  }
})

test('numeric coverage schema requires explicit checks without changing legacy schema and supports an empty catalogue', () => {
  const base: Row = { type: 'object', properties: {}, required: [], additionalProperties: false }
  const refs = buildNumericReferences(sentences('Una consulta.'))
  const schema = numericCoverageSchema(base, refs, [])
  const validate = new Ajv({ strict: false }).compile(schema)
  assert.equal(validate({ numeric_checks: [check('N1', 'not_quantity')] }), true, JSON.stringify(validate.errors))
  assert.equal(validate({ numeric_checks: [] }), false)
  assert.deepEqual(base.properties, {})
  assert.deepEqual(base.required, [])
})

test('classification-specific schema prevents incompatible numeric bindings and redundant unit identifiers', () => {
  const schema = numericCoverageSchema({ type: 'object', properties: {}, required: [], additionalProperties: false },
    buildNumericReferences(sentences('550000.')), catalog)
  const validate = new Ajv({ strict: false }).compile(schema)
  for (const row of [check('N1', 'business_quantity', { factual_value_indexes: [0] }),
    check('N1', 'business_quantity', { project_value_indexes: [0] }),
    check('N1', 'business_quantity', { factual_value_indexes: [0], project_value_indexes: [0] }),
    check('N1', 'not_quantity')])
    assert.equal(validate({ numeric_checks: [row] }), true, JSON.stringify(validate.errors))
  for (const row of [check('N1', 'business_quantity'),
    check('N1', 'unit_identifier', { unit_ids: ['u602'] }),
    check('N1', 'business_quantity', { factual_value_indexes: [0], unit_ids: ['u602'] }),
    check('N1', 'unit_identifier'), check('N1', 'unit_identifier', { unit_ids: ['u602'], factual_value_indexes: [0] }),
    check('N1', 'lead_context', { factual_value_indexes: [0] }), check('N1', 'not_quantity', { unit_ids: ['u602'] })])
    assert.equal(validate({ numeric_checks: [row] }), false, JSON.stringify(row))
})

test('compact lists retain their numeric ambiguity until the reviewer identifies every real unit', () => {
  const units = [...catalog, { id: 'u202', unit_number: '202' }, { id: 'u302', unit_number: '302' }]
  const refs = buildNumericReferences(sentences('202,302'))
  assert.equal(refs.length, 1)
  assert.equal(refs[0].value, 202302)
  assert.deepEqual(numericCoverageIssues({ numeric_checks: [check('N1', 'unit_identifier', { unit_ids: ['u202', 'u302'] })] }, refs, units), [])
  for (const unit_ids of [['u202'], ['u302'], ['u202', 'u602'], ['u202', 'u302', 'wrong']])
    assert.equal(numericCoverageIssues({ numeric_checks: [check('N1', 'unit_identifier', { unit_ids })] }, refs, units)[0].code, 'numeric_unit_identifier_unverified')
  assert.deepEqual(numericCoverageIssues({ factual_values: [{ ...price, value: 202302 }],
    numeric_checks: [check('N1', 'business_quantity', { factual_value_indexes: [0] })] }, refs, units), [])
})

test('common symbols, attached square units, abbreviations, compound ordinals and ranges retain their exact quantities', () => {
  for (const [phrase, expected] of [
    ['$250.000', [250000]], ['142,09m²', [142.09]], ['142,09m2', [142.09]], ['3er / 6.º / piso sexto', [3, 6, 6]],
    ['vigésimo sexto y décimo primero', [26, 11]], ['15% / 2 parqueos / 3 unidades', [15, 2, 3]],
    ['2–3 / 120,83-142,09 m² / $250.000 a $350.000', [2, 3, 120.83, 142.09, 250000, 350000]],
  ] as Array<[string, number[]]>) assert.deepEqual(buildNumericReferences(sentences(phrase)).map(ref => ref.value), expected, phrase)
})

test('repair check indexes rebase to merged facts and missing rows remain invalid instead of disappearing', () => {
  const source = { factual_values: [floor], project_values: [] }
  const target = { factual_values: [price, floor], project_values: [] }
  const checks = [check('N2', 'business_quantity', { factual_value_indexes: [0] })]
  assert.deepEqual(remapNumericChecks(checks, source, target)[0].factual_value_indexes, [1])
  const removed = remapNumericChecks(checks, source, { factual_values: [price] })
  assert.deepEqual(removed[0].factual_value_indexes, [-1])
  const refs = buildNumericReferences(sentences('Cuesta $550.000 en la sexta planta.'))
  assert.equal(numericCoverageIssues({ ...target, numeric_checks: [check('N1', 'business_quantity', { factual_value_indexes: [0] }), ...removed] }, refs, catalog)[0].code, 'invalid_numeric_bindings')
  const projectFact = { fragment: 'S1', value: 24, dimension: 'duration', measurement_unit: 'hour', source_id: 'project:1' }
  const projectCheck = [check('N1', 'business_quantity', { project_value_indexes: [0] })]
  assert.deepEqual(remapNumericChecks(projectCheck, { project_values: [projectFact] }, { project_values: [projectFact] })[0].project_value_indexes, [0])
  const text = 'Cuesta $550.000 en la sexta planta.'
  const textSource = { factual_values: [{ ...floor, fragment: text.replace('la ', 'la\n ') }] }
  assert.deepEqual(remapNumericChecks(checks, textSource, target, sentences(text))[0].factual_value_indexes, [1])
})

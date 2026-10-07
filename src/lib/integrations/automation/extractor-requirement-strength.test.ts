import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { normalizeTurnSemantics } from './turn-semantics'

function extraction(current: string, evidence = current, value = 5): Row {
  return { turn_semantics: {
    primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
    housing_quantities: [{ dimension: 'bedrooms', values: [value], role: 'requirement',
      count_basis: 'unspecified', evidence, confidence: 'high' }],
    property: { group: 'residential', category: null, operation: 'search', reference_kind: 'none',
      query_scope: 'catalog', unit_numbers: [], filters: { bedrooms: value, bedrooms_required: true },
      filter_evidence: { bedrooms: evidence, bedrooms_required: '' }, evidence: current, confidence: 'high' },
  }, catalog_request: { purpose: 'search', metric: null, requirements: [{ field: 'bedrooms', operator: 'eq',
    value, upper_value: null, strength: 'required', evidence }], semantic_preferences: [],
    evidence: current, confidence: 'high' } }
}
const filters = (raw: Row, current: string) => object(object(normalizeTurnSemantics(raw, current, {})).property).filters as Row

for (const current of [
  'Necesito cinco dormitorios obligatoriamente, tres no me sirven',
  'Necesito cinco dormitorios obligatorios',
  'Busco exactamente cinco dormitorios',
  'Busco cinco dormitorios, no acepto menos',
]) {
  test('missing duplicate rigidity evidence inherits only the same explicit current bedroom constraint: ' + current, () => {
    const raw = extraction(current), original = structuredClone(raw)
    const semantics = normalizeTurnSemantics(raw, current, {})
    assert.equal(object(object(semantics.property).filters).bedrooms, 5)
    assert.equal(object(object(semantics.property).filters).bedrooms_required, true)
    assert.equal(object(object(semantics.property).filter_evidence).bedrooms_required, current)
    assert.deepEqual(raw, original)
  })
}

test('sharing explicit rigidity preserves a minimum bedroom relation instead of creating equality', () => {
  const current = 'Es indispensable tener al menos tres dormitorios'
  const raw = extraction(current, current, 3)
  object((object(raw.catalog_request).requirements as Row[])[0]).operator = 'gte'
  const result = filters(raw, current)
  assert.equal(result.bedrooms, 3)
  assert.equal(result.bedrooms_operator, 'gte')
  assert.equal(result.bedrooms_required, true)
})

for (const current of [
  'Busco unos cinco dormitorios, pero estoy abierto a otras opciones',
  'Me gustan cinco dormitorios si es posible',
  'No necesito cinco dormitorios obligatoriamente',
]) {
  test('catalogue required strength alone never makes an explicitly flexible or negated count rigid: ' + current, () => {
    assert.notEqual(filters(extraction(current), current).bedrooms_required, true)
  })
}

test('a quoted requirement is not inherited as this lead current rigidity', () => {
  const evidence = 'Necesito cinco dormitorios obligatoriamente'
  const current = 'Mi amigo escribió «' + evidence + '». Yo todavía no decido.'
  assert.notEqual(filters(extraction(current, evidence), current).bedrooms_required, true)
})

test('a historical requirement cannot supply missing current rigidity evidence', () => {
  const current = '¿Qué precios tienen esas opciones?'
  const raw = extraction(current, 'Necesito cinco dormitorios obligatoriamente')
  assert.notEqual(filters(raw, current).bedrooms_required, true)
})

for (const invalid of ['people', 'evaluation', 'wrong_quantity', 'wrong_catalogue_value', 'preferred_strength', 'low_confidence']) {
  test('incompatible evidence never supplies rigidity: ' + invalid, () => {
    const current = 'Necesito cinco dormitorios obligatoriamente'
    const raw = extraction(current), semantics = object(raw.turn_semantics)
    const quantity = (semantics.housing_quantities as Row[])[0]
    const requirement = (object(raw.catalog_request).requirements as Row[])[0]
    if (invalid === 'people') quantity.dimension = 'people'
    if (invalid === 'evaluation') quantity.role = 'evaluation'
    if (invalid === 'wrong_quantity') quantity.values = [3]
    if (invalid === 'wrong_catalogue_value') requirement.value = 3
    if (invalid === 'preferred_strength') requirement.strength = 'preferred'
    if (invalid === 'low_confidence') quantity.confidence = 'low'
    assert.notEqual(filters(raw, current).bedrooms_required, true)
  })
}

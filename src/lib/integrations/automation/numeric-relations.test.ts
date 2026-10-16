import test from 'node:test'
import assert from 'node:assert/strict'
import { areaAssertions } from './numeric-relations'
import { validateCatalogReply } from './catalog-dialogue'

test('area labels bind singular and plural prefix and suffix descriptions to the correct field', () => {
  for (const [label, field] of [
    ['interior', 'area_internal_m2'], ['interiores', 'area_internal_m2'],
    ['exterior', 'area_exterior_m2'], ['exteriores', 'area_exterior_m2'],
  ]) {
    const plural = label.endsWith('es')
    for (const noun of plural ? ['areas', 'superficies', 'espacios'] : ['area', 'superficie', 'espacio']) {
      for (const clause of [`${noun} ${label} de 9,34 m2`, `9,34 m2 de ${noun} ${label}`]) {
        const [area] = areaAssertions(clause)
        assert.equal(area.field, field, clause)
        assert.equal(area.fieldExplicit, true, clause)
        assert.deepEqual(area.values, [9.34], clause)
      }
    }
  }
})

test('range labels retain their field and relation in prefix and suffix positions', () => {
  for (const clause of [
    'espacios exteriores de 9.34 a 22.14 m2',
    'superficies exteriores entre 9,34 y 22,14 m2',
    '9.34 a 22.14 m2 de areas exteriores',
    '9,34 a 22,14 m2 exteriores',
  ]) {
    const [area] = areaAssertions(clause)
    assert.equal(area.field, 'area_exterior_m2', clause)
    assert.equal(area.fieldExplicit, true, clause)
    assert.deepEqual(area.values, [9.34, 22.14], clause)
    assert.equal(area.operator, 'between', clause)
    assert.equal(area.exactRange, !clause.includes('entre'), clause)
  }
})

const suiteAudit = { verified_catalog: true, catalog_results: { units: [
  { id: 's1', unit_number: '101', category: 'suite', bedrooms: 1, area_internal_m2: 49.86, area_exterior_m2: 9.34 },
  { id: 's2', unit_number: '102', category: 'suite', bedrooms: 1, area_internal_m2: 73.86, area_exterior_m2: 22.14 },
] } }
const suiteReply = 'Las suites tienen 1 dormitorio y áreas interiores de 49.86 a 73.86 m², con espacios exteriores de 9.34 a 22.14 m².'

test('the suite reply that was rejected preserves distinct interior and exterior ranges', () => {
  assert.equal(validateCatalogReply(suiteReply, suiteAudit).valid, true)
})

test('plural labels still reject incorrect ranges and interior/exterior swaps', () => {
  for (const reply of [
    suiteReply.replace('9.34 a 22.14', '9.34 a 73.86'),
    suiteReply.replace('espacios exteriores', 'espacios interiores'),
    suiteReply.replace('áreas interiores', 'áreas exteriores'),
  ]) {
    assert.equal(validateCatalogReply(reply, suiteAudit).reason, 'catalog_area_mismatch', reply)
  }
})

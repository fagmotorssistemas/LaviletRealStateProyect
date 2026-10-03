import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDocument, canReuse, validateResponse, MODEL, DIMENSIONS } from './generate-unit-embeddings.mjs'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '../src/lib/integrations/lavilet.ts'

const project = { id: LAVILET_PROJECT_ID, tenant_id: LAVILET_TENANT_ID, name: 'La Vilet' }
const unit = { id: '7945f316-b72f-4b59-a15b-cf4241979f7f', project_id: project.id,
  tenant_id: project.tenant_id, status: 'disponible', is_published: true,
  category: 'suite', unit_number: '001', floor_number: 0, bedrooms: 1,
  area_internal_m2: 67.96, area_exterior_m2: 0, area_total_m2: null,
  published_commercial_price: 210000, spaces: ['Sala', 'Terraza'] }
const vector = () => Array(DIMENSIONS).fill(0.025)

test('physical dimensions remain exact; missing totals are not invented and zero is preserved', () => {
  const doc = buildDocument(unit, project)
  assert.match(doc.content, /Superficie interior \(m²\): 67.96/)
  assert.match(doc.content, /Superficie exterior \(m²\): 0/)
  assert.match(doc.content, /Número de planta: 0/)
  assert.doesNotMatch(doc.content, /Superficie total/)
  assert.doesNotMatch(doc.content, /210000/)
  assert.equal(doc.metadata.area_total_m2, null)
  assert.equal(doc.metadata.area_internal_m2, 67.96)
  assert.equal(doc.metadata.embedding_dimensions, 1536)
})

test('only authorized available and published project units may be indexed', () => {
  for (const change of [{ tenant_id: 'another' }, { project_id: 'another' }, { status: 'vendido' }, { is_published: false }]) {
    assert.throws(() => buildDocument({ ...unit, ...change }, project), /fuera del catálogo/)
  }
})

test('unchanged semantic content reuses its vector; physical edits regenerate using the same row id', () => {
  const doc = buildDocument(unit, project)
  const row = { ...doc, embedding: JSON.stringify(vector()) }
  assert.equal(canReuse(row, buildDocument({ ...unit, published_commercial_price: 220000 }, project)), true)
  const changed = buildDocument({ ...unit, bedrooms: 2 }, project)
  assert.equal(canReuse(row, changed), false)
  assert.equal(changed.id, doc.id)
  assert.equal(canReuse({ ...row, embedding: '[1,2]' }, doc), false)
})

test('batch mapping uses response indices instead of arrival order', () => {
  const first = vector(), second = Array(DIMENSIONS).fill(0.05)
  assert.deepEqual(validateResponse({ model: MODEL, data: [
    { index: 1, embedding: second }, { index: 0, embedding: first },
  ] }, 2), [first, second])
})

test('invalid, incomplete, nonfinite and duplicate vectors cannot be persisted', () => {
  for (const embedding of [[1, 2], Array(DIMENSIONS).fill(0), Array(DIMENSIONS).fill(NaN)]) {
    assert.throws(() => validateResponse({ model: MODEL, data: [{ index: 0, embedding }] }, 1))
  }
  assert.throws(() => validateResponse({ model: MODEL, data: [] }, 1))
  assert.throws(() => validateResponse({ model: MODEL, data: [
    { index: 0, embedding: vector() }, { index: 0, embedding: vector() },
  ] }, 2))
})

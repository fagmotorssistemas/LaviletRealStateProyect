import test from 'node:test'
import assert from 'node:assert/strict'
import { comparisonEvidence } from './comparison-evidence'
import { turnEvidence } from './turn-evidence'
import { buildNumericReferences, numericCoverageIssues } from './focused-numeric-coverage'
import { materializeNumericReview } from './atomic-numeric-review'
import { observedNumericIssues } from './focused-review'
import { structuredFactIssues } from './structured-facts'
import { reviewClaims } from './semantic-review'
import type { Row } from './data'

const p = { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, published_commercial_price: 550000 }
const a = { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, published_commercial_price: 250000 }
const b = { ...a, id: 'd502', unit_number: '502', published_commercial_price: 310000 }
const audit = { verified_catalog: true, catalog_query: { category: 'penthouse' }, catalog_results: { units: [p], unit_ids: [p.id] } }

test('fresh comparison inventory is shared without changing query results or granting missing prices', () => {
  const hidden = { ...a, id: 'hidden', is_published: false }
  const sold = { ...a, id: 'sold', status: 'vendido' }
  const evidence = turnEvidence({ catalogo: [p], catalogo_verificacion: [a, b, p, hidden, sold] }, audit)
  assert.deepEqual(evidence.query_result_ids, [p.id])
  assert.deepEqual(evidence.units.map(u => u.id), [p.id, a.id, b.id])
  assert.equal(evidence.groups.find(g => g.id === 'group:departamento:3:min')?.published_commercial_price, 250000)
  assert.equal(evidence.groups.find(g => g.id === 'group:departamento:3:max')?.published_commercial_price, 310000)
  assert.equal(evidence.groups.find(g => g.id === 'group:query:all:min')?.published_commercial_price, 550000)
  const noPrice = { ...a, published_commercial_price: undefined }
  assert.equal(turnEvidence({ catalogo_verificacion: [noPrice] }, audit).units.find(u => u.id === a.id)?.published_commercial_price, undefined)
  assert.deepEqual(comparisonEvidence({ catalogo_verificacion: [a], limite_alcance: { restricted: true } }, audit), [])
  assert.deepEqual(turnEvidence({ historial: [{ content: 'Departamentos desde 100000' }] }, audit).units.map(u => u.id), [p.id])
})

test('an article needs no numeric sheet; an explicit price still requires a check', () => {
  const sentences = [{ id: 'S1', text: 'Tiene un precio publicado de $550.000.' }]
  const refs = buildNumericReferences(sentences)
  const money = refs.find(r => r.value === 550000)!
  const review = materializeNumericReview({ numeric_contract: 'numeric-inline-v1', numeric_coverage: 'asserted-facts-v1',
    numeric_checks: [{ numeric_id: money.id, classification: 'business_quantity', reason: 'Precio de la unidad.', unit_ids: [],
      factual_values: [{ fragment: 'S1', unit_id: p.id, field: 'published_commercial_price', operator: 'eq', value: 550000 }], project_values: [] }] })
  assert.deepEqual(numericCoverageIssues(review, refs, [p]), [])
  assert.equal(numericCoverageIssues({ ...review, numeric_checks: [] }, refs, [p])[0].code, 'unreviewed_numeric_reference')
})

test('real quantities expressed in words stay subject to exact catalogue validation', () => {
  for (const [sentence, field, value, actual] of [['Tiene un dormitorio.', 'bedrooms', 1, 2],
    ['Está en la sexta planta.', 'floor_number', 6, 5], ['Mide ciento veinte coma ochenta y tres metros cuadrados.', 'area_internal_m2', 120.83, 121]] as const) {
    const fact = { fragment: sentence, unit_id: 'u', field, value, operator: 'eq', value_scope: 'individual' }
    const review: Row = { factual_values: [fact] }
    assert.deepEqual(observedNumericIssues(review, [{ id: 'S1', text: sentence }]), [])
    assert.ok(structuredFactIssues([fact], [{ id: 'u', [field]: actual }]).length)
  }
})

test('missing evidence stays blocking metadata; a contradiction remains a content failure', () => {
  const reply = 'Hay opciones en otra categoría.'
  const claim = { fragment: reply, subject: 'Opciones', polarity: 'affirmation', claim_kind: 'project_fact',
    verdict: 'needs_evidence', evidence_ids: [], evidence: 'Falta el inventario de esa categoría.', evidence_source: 'none' }
  const missing = reviewClaims([claim], reply, [], true)
  assert.equal(missing.valid, false)
  assert.deepEqual(missing.issues.map(i => [i.code, i.kind]), [['claim_evidence_missing', 'review_metadata']])
  const contradicted = reviewClaims([{ ...claim, verdict: 'contradicted', evidence_ids: ['E1'], evidence_source: 'verified_context' }], reply, [{ id: 'E1', kind: 'project_fact' }], true)
  assert.equal(contradicted.issues[0].kind, 'commercial_content')
})

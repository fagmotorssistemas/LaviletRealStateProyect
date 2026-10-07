import test from 'node:test'
import assert from 'node:assert/strict'
import { areaFactChange, emptyAreaFact, projectAreaFact, validateAreaFact } from './projectAreaFacts'
const id = '40b31a51-8c57-4b0b-8dc1-8e7548b3cb32', now = '2026-10-07T19:00:00.000Z'
const verified = () => ({ ...emptyAreaFact(), headline: 'Servicios del sector', fact_text: 'Existen servicios confirmados cerca del proyecto.', safe_sales_text: 'En el sector existen servicios cotidianos confirmados.', source_name: 'Responsable del proyecto', verified_on: '2026-10-06' })
const live = () => ({ id, ...verified(), review_status: 'verified', approved_for_bot: true, updated_at: now, draft_content: null })
test('draft editing never changes any already published content or approval', () => {
  const existing = live(), original = structuredClone(existing), draft = { ...verified(), safe_sales_text: 'Nueva descripción todavía pendiente de publicación.' }
  const change = areaFactChange({ id, action: 'draft', value: draft, expectedUpdatedAt: now }, existing, now)
  assert.deepEqual(Object.keys(change).sort(), ['draft_content', 'updated_at'])
  const view = projectAreaFact({ ...existing, ...change })
  assert.equal(view.published?.safe_sales_text, existing.safe_sales_text)
  assert.equal(view.draft.safe_sales_text, draft.safe_sales_text)
  assert.deepEqual(existing, original)
})
test('new drafts are not approved and publication requires a separate explicit confirmation', () => {
  const value = { ...verified(), approved_for_bot: true, review_status: 'verified' }
  const change = areaFactChange({ id, action: 'draft', value, expectedUpdatedAt: null }, null, now)
  assert.equal(change.approved_for_bot, false); assert.equal(change.review_status, 'draft')
  assert.throws(() => areaFactChange({ id, action: 'publish', value, expectedUpdatedAt: null }, null, now), /Confirme/)
  const published = areaFactChange({ id, action: 'publish', value, expectedUpdatedAt: null, confirmed: true }, null, now)
  assert.equal(published.approved_for_bot, true); assert.equal(published.review_status, 'verified')
})
test('pausing publication preserves content and draft while withdrawing bot approval', () => {
  const existing = live(), paused = areaFactChange({ id, action: 'pause', expectedUpdatedAt: now }, existing, now)
  assert.deepEqual(paused, { approved_for_bot: false, updated_at: now })
  assert.equal(projectAreaFact({ ...existing, ...paused }).published, null)
  assert.equal(projectAreaFact({ ...existing, ...paused }).status, 'paused')
  assert.throws(() => areaFactChange({ id, action: 'pause', expectedUpdatedAt: null }, null, now), /no disponible/)
})
test('publication requires a verifiable reference and a valid checked date but drafts may leave them pending', () => {
  const draft = { ...verified(), source_name: '', verified_on: '' }
  assert.doesNotThrow(() => validateAreaFact(draft, false, now.slice(0, 10)))
  assert.throws(() => validateAreaFact(draft, true, now.slice(0, 10)), /fuente/)
  assert.doesNotThrow(() => validateAreaFact({ ...draft, source_url: 'https://example.org/fuente', verified_on: '2026-10-06' }, true, now.slice(0, 10)))
  for (const date of ['2026-02-30', '2026-10-08', '2026-1-01', 'not a date'])
    assert.throws(() => validateAreaFact({ ...verified(), verified_on: date }, true, now.slice(0, 10)), /fecha/)
})
test('invalid URLs, audiences, modes, categories and unbounded text are rejected before writes', () => {
  for (const url of ['http://example.org', 'javascript:alert(1)', 'https://user:password@example.org', 'file:///source'])
    assert.throws(() => validateAreaFact({ ...verified(), source_url: url }), /HTTPS/)
  for (const fields of [{ audiences: [] }, { audiences: ['residential', 'residential'] }, { audiences: ['not_known'] },
    { commercial_modes: [] }, { commercial_modes: ['not_known'] }, { category: '__proto__' }, { headline: 'x'.repeat(121) }, { safe_sales_text: 'x'.repeat(701) }])
    assert.throws(() => validateAreaFact({ ...verified(), ...fields }))
})
test('existing legacy publications open as a draft without inventing facts or approval', () => {
  const existing = live(), view = projectAreaFact(existing)
  assert.equal(view.status, 'published'); assert.equal(view.draft.safe_sales_text, existing.safe_sales_text)
  assert.equal(emptyAreaFact().safe_sales_text, '')
  assert.equal(projectAreaFact({ ...existing, approved_for_bot: false, review_status: 'draft' }).published, null)
  assert.throws(() => areaFactChange({ id: '../another-project', action: 'publish', value: verified(), expectedUpdatedAt: null, confirmed: true }, null, now), /inválida/)
})

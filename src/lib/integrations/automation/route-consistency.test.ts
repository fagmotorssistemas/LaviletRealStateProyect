import test from 'node:test'
import assert from 'node:assert/strict'
import { visitRoutePermission } from './route-consistency'
import { normalizedVisitIntent } from './conversation-rules'

test('commercial requests suppress a stale visit even when normalized absence has no confidence', () => {
  for (const current of ['¿Tienen cinco dormitorios?', '¿Qué precios tienen?', 'Necesito una terraza']) {
    const visit = normalizedVisitIntent({ kind: 'none', evidence: '', confidence: 'high' }, current)
    assert.equal(visit, null)
    const decision = visitRoutePermission([{ domain: 'property', confidence: 'high', evidence: current }],
      { primary_intent: 'select_property', confidence: 'high', property: { operation: 'search', confidence: 'high' } }, visit)
    assert.equal(decision.allowed, false)
  }
})

test('actual visit requests and mixed commercial/visit turns remain permitted', () => {
  const property = [{ domain: 'property', confidence: 'high' }]
  assert.equal(visitRoutePermission(property, {}, {}, true).allowed, true)
  assert.equal(visitRoutePermission([...property, { domain: 'visit', confidence: 'high' }], {}, {}).allowed, true)
  assert.equal(visitRoutePermission(property, {}, { kind: 'accept_visit_preference', confidence: 'high' }).allowed, true)
  assert.equal(visitRoutePermission([], {}, {}).allowed, true, 'Legacy date replies remain available for independent visit parsing.')
})

test('asking availability or an unrelated appointment does not authorize project scheduling', () => {
  assert.equal(visitRoutePermission([{ domain: 'visit', confidence: 'high' }], {},
    { kind: 'visit_information', confidence: 'high' }).allowed, false)
  assert.equal(visitRoutePermission([], {}, { kind: 'request_visit', target: 'other', confidence: 'high' }, true).allowed, false)
})

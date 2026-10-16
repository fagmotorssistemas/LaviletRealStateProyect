import test from 'node:test'
import assert from 'node:assert/strict'
import { rememberPipelineAvailability } from './lead-pipeline-receipts'

const current = '¿Sigue disponible el 304?'
const request = { domain: 'property', confidence: 'medium', topics: ['availability'], evidence: current }
test('availability is preserved as a grounded milestone without choosing a unit or authorizing a process', () => {
  const result = rememberPipelineAvailability([], [request], current, 'm1', '2026-10-15T15:00:00Z')
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'commercial_interest')
  assert.equal(result[0].source_message_id, 'm1')
  assert.equal(result[0].unit_id, undefined)
  assert.equal(result[0].consent, undefined)
  assert.deepEqual(rememberPipelineAvailability(result, [request], current, 'm2', '2026-10-15T15:02:00Z'), result)
})
test('a pending, historical, ungrounded or unrelated request cannot establish current availability interest', () => {
  for (const patch of [{ source: 'pending' }, { confidence: 'low' }, { evidence: 'Texto anterior' },
    { topics: ['property_features'] }, { domain: 'other' }]) {
    assert.deepEqual(rememberPipelineAvailability([], [{ ...request, ...patch }], current, 'm1', '2026-10-15T15:00:00Z'), [])
  }
})

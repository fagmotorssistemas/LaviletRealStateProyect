import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { infoRequestKey, readInfoRequests } from './infoRequests'

test('information requests use one stable key per unit or area', () => {
  assert.equal(infoRequestKey('unit-205', '1G'), 'unit-205')
  assert.equal(infoRequestKey(null, 'DESCANSO'), 'DESCANSO')
  assert.equal(infoRequestKey(null, null), 'general')
})

test('malformed local request storage does not become a sent request', () => {
  assert.deepEqual(readInfoRequests('{broken'), [])
  assert.deepEqual(readInfoRequests(JSON.stringify([{ key: 'unit-205', unitNumber: '205', sentAt: '2026-10-12T00:00:00.000Z' }, { key: 'missing-date' }])), [
    { key: 'unit-205', unitNumber: '205', sentAt: '2026-10-12T00:00:00.000Z' },
  ])
})

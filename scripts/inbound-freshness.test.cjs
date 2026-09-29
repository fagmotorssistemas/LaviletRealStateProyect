const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { inboundFreshness } = require('../src/lib/integrations/automation/inbound-freshness.ts')

test('provider lag is measured independently of processing and invalid dates do not fabricate delay', () => {
  assert.deepEqual(inboundFreshness('2026-09-29T16:00:00Z', '2026-09-29T16:01:00Z'), { lagMinutes: 1, delayed: false })
  assert.deepEqual(inboundFreshness('2026-09-29T16:00:00Z', '2026-09-29T16:20:00Z'), { lagMinutes: 20, delayed: true })
  assert.equal(inboundFreshness('invalid', '2026-09-29T16:20:00Z').lagMinutes, null)
})

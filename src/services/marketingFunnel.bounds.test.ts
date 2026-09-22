import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ecuadorDayBoundsUtc } from '@/services/marketingFunnel.service'

describe('ecuadorDayBoundsUtc', () => {
  it('mapea día Ecuador a UTC 05:00 y exclusive +1d', () => {
    const b = ecuadorDayBoundsUtc('2026-09-21', '2026-09-21')
    assert.equal(b.fromIso, '2026-09-21T05:00:00.000Z')
    assert.equal(b.toExclusiveIso, '2026-09-22T05:00:00.000Z')
  })

  it('rechaza formato inválido', () => {
    assert.throws(() => ecuadorDayBoundsUtc('21-09-2026', '2026-09-21'))
  })
})

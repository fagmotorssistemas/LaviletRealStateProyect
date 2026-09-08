import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeSlaStatus, sanitizeSearch, toInclusiveRange } from './slaStatus.ts'

describe('computeSlaStatus', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z')

  it('no_aplica when there is no due date', () => {
    assert.equal(computeSlaStatus(null, null, now), 'no_aplica')
  })

  it('respondido when the seller already answered', () => {
    assert.equal(
      computeSlaStatus('2026-09-03T11:00:00.000Z', '2026-09-03T10:30:00.000Z', now),
      'respondido',
    )
  })

  it('vencido when the due date already passed', () => {
    assert.equal(computeSlaStatus('2026-09-03T11:00:00.000Z', null, now), 'vencido')
  })

  it('pendiente when the due date is still ahead', () => {
    assert.equal(computeSlaStatus('2026-09-03T18:00:00.000Z', null, now), 'pendiente')
  })
})

describe('sanitizeSearch', () => {
  it('strips PostgREST wildcard characters', () => {
    assert.equal(sanitizeSearch('  593%99(1)  '), '593991')
  })
})

describe('toInclusiveRange', () => {
  it('returns undefined bounds when dates are empty', () => {
    assert.deepEqual(toInclusiveRange('', ''), { from: undefined, to: undefined })
  })
})

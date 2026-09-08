import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickFairAdvisor, simulateFairRound } from './fairAssignment.ts'

describe('fair appointment assignment', () => {
  it('splits 20 visits between two eligible advisors 10 and 10', () => {
    const result = simulateFairRound(['a', 'b'], 20)
    assert.equal(result.counts.a, 10)
    assert.equal(result.counts.b, 10)
  })

  it('splits 30 visits between three eligible advisors 10 each', () => {
    const result = simulateFairRound(['a', 'b', 'c'], 30)
    assert.equal(result.counts.a, 10)
    assert.equal(result.counts.b, 10)
    assert.equal(result.counts.c, 10)
  })

  it('gives a new advisor the next turn when others are ahead', () => {
    const pick = pickFairAdvisor([
      { id: 'veteran-a', count: 8, lastAssignedAt: '000001' },
      { id: 'veteran-b', count: 8, lastAssignedAt: '000002' },
      { id: 'nuevo', count: 0, lastAssignedAt: null },
    ])
    assert.equal(pick, 'nuevo')
  })

  it('does not count a repeated appointment as another opportunity', () => {
    const first = pickFairAdvisor([
      { id: 'a', count: 1, lastAssignedAt: '1' },
      { id: 'b', count: 1, lastAssignedAt: '2' },
    ])
    assert.equal(first, 'a')
    const afterSameAppointmentKept = pickFairAdvisor([
      { id: 'a', count: 1, lastAssignedAt: '1' },
      { id: 'b', count: 1, lastAssignedAt: '2' },
    ])
    assert.equal(afterSameAppointmentKept, 'a')
  })
})

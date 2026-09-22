import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCommercialContextReadFailure, readCommercialContext } from './context-read'

describe('commercial context reads', () => {
  it('retries only a failed source and returns the complete context', async () => {
    let unitsCalls = 0
    let projectCalls = 0
    const result = await readCommercialContext({
      units: async () => ({ data: [{ id: '202' }], error: (++unitsCalls, null) }),
      project: async () => ++projectCalls === 1
        ? { data: null, error: new Error('temporary timeout') }
        : { data: { name: 'La Vilet' }, error: null },
    })

    assert.equal(unitsCalls, 1)
    assert.equal(projectCalls, 2)
    assert.deepEqual(result.units.data, [{ id: '202' }])
    assert.deepEqual(result.project.data, { name: 'La Vilet' })
  })

  it('identifies the source when both read attempts fail', async () => {
    await assert.rejects(
      readCommercialContext({ places: async () => ({ data: null, error: new Error('timeout') }) }),
      { message: 'COMMERCIAL_CONTEXT_PLACES_FAILED' },
    )
  })

  it('marks context failures as known pre-delivery read failures', () => {
    assert.equal(isCommercialContextReadFailure('COMMERCIAL_CONTEXT_FAILED'), true)
    assert.equal(isCommercialContextReadFailure('COMMERCIAL_CONTEXT_UNITS_FAILED'), true)
    assert.equal(isCommercialContextReadFailure('KOMMO_504'), false)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allowRateLimited,
  assertVisitKeyMatchesVisitor,
  buildUnitVisitKey,
  isAllowedEnqueueEventName,
  isUuid,
} from './enqueueGuards'

describe('metaVisitIdentity', () => {
  it('dos visitantes generan claves distintas para la misma unidad', () => {
    const unit = '11111111-1111-4111-8111-111111111111'
    const a = buildUnitVisitKey('visitor-a', unit)
    const b = buildUnitVisitKey('visitor-b', unit)
    assert.notEqual(a, b)
    assert.equal(a, `view:visitor-a:${unit}`)
    assert.equal(b, `view:visitor-b:${unit}`)
  })

  it('reintento de la misma visita conserva la clave', () => {
    const unit = '22222222-2222-4222-8222-222222222222'
    const first = buildUnitVisitKey('same-visitor', unit)
    const retry = buildUnitVisitKey('same-visitor', unit)
    assert.equal(first, retry)
  })
})

describe('enqueueGuards', () => {
  it('solo permite ViewContent (bloquea Lead/Schedule fabricados)', () => {
    assert.equal(isAllowedEnqueueEventName('ViewContent'), true)
    assert.equal(isAllowedEnqueueEventName('Lead'), false)
    assert.equal(isAllowedEnqueueEventName('Schedule'), false)
    assert.equal(isAllowedEnqueueEventName('Purchase'), false)
  })

  it('valida visit_key contra visitante + unidad', () => {
    const unit = '33333333-3333-4333-8333-333333333333'
    assert.equal(
      assertVisitKeyMatchesVisitor(`view:vid-1:${unit}`, 'vid-1', unit),
      true,
    )
    assert.equal(
      assertVisitKeyMatchesVisitor(`view:other:${unit}`, 'vid-1', unit),
      false,
    )
  })

  it('valida UUID y rate limit', () => {
    assert.equal(isUuid('44444444-4444-4444-8444-444444444444'), true)
    assert.equal(isUuid('not-a-uuid'), false)
    const bucket = new Map()
    const key = 'v:ip'
    for (let i = 0; i < 12; i += 1) {
      assert.equal(allowRateLimited(bucket, key, 1_000 + i, 60_000, 12), true)
    }
    assert.equal(allowRateLimited(bucket, key, 1_020, 60_000, 12), false)
  })
})

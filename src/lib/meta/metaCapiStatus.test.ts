import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyOutboxStatus } from './metaCapiStatus'

describe('classifyOutboxStatus', () => {
  it('forwarded = entregado al backend', () => {
    const c = classifyOutboxStatus('forwarded', null)
    assert.equal(c.bucket, 'delivered_backend')
    assert.match(c.label, /backend/i)
  })

  it('pending + not_configured = bloqueado config', () => {
    const c = classifyOutboxStatus('pending', 'not_configured')
    assert.equal(c.bucket, 'blocked_config')
  })

  it('needs_review / review_hold = retenido', () => {
    assert.equal(classifyOutboxStatus('needs_review', null).bucket, 'retained')
    assert.equal(classifyOutboxStatus('review_hold', null).bucket, 'retained')
  })
})

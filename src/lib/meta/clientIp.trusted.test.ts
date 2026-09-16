import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPrivateIp, pickTrustedClientIp } from './trustedClientIp'

describe('pickTrustedClientIp', () => {
  it('rechaza privadas y prioriza x-vercel-forwarded-for en Vercel', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true)
    assert.equal(isPrivateIp('10.0.0.5'), true)

    const headers: Record<string, string> = {
      'x-forwarded-for': '8.8.8.8',
      'x-vercel-forwarded-for': '203.0.113.10',
      'x-real-ip': '127.0.0.1',
    }
    assert.equal(
      pickTrustedClientIp((name) => headers[name] ?? null, { onVercel: true }),
      '203.0.113.10',
    )
    assert.equal(
      pickTrustedClientIp((name) => (name === 'x-forwarded-for' ? '8.8.8.8' : null), {
        onVercel: true,
      }),
      null,
    )
    assert.equal(
      pickTrustedClientIp((name) => (name === 'x-vercel-forwarded-for' ? '127.0.0.1' : null), {
        onVercel: true,
      }),
      null,
    )
  })
})

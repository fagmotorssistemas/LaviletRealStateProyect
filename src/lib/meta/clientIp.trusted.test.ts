import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPrivateIp,
  isPublicClientIp,
  pickTrustedClientIp,
} from './trustedClientIp'

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

  it('valida IPv4/IPv6 reales y rechaza privadas IPv6 / mapped', () => {
    assert.equal(isPublicClientIp('999.999.999.999'), false)
    assert.equal(isPublicClientIp('not:an:ip'), false)
    assert.equal(isPublicClientIp('hello:world'), false)
    assert.equal(isPublicClientIp('8.8.8.8'), true)
    assert.equal(isPublicClientIp('203.0.113.10'), true)

    assert.equal(isPrivateIp('fc00::1'), true)
    assert.equal(isPublicClientIp('fc00::1'), false)
    assert.equal(isPrivateIp('fe80::1'), true)
    assert.equal(isPublicClientIp('fe80::1'), false)
    assert.equal(isPrivateIp('::ffff:192.168.1.1'), true)
    assert.equal(isPublicClientIp('::ffff:192.168.1.1'), false)
    assert.equal(isPrivateIp('::1'), true)
    assert.equal(isPublicClientIp('::'), false)

    assert.equal(isPublicClientIp('2001:4860:4860::8888'), true)
    assert.equal(
      pickTrustedClientIp(
        (name) => (name === 'x-vercel-forwarded-for' ? 'fc00::1' : null),
        { onVercel: true },
      ),
      null,
    )
    assert.equal(
      pickTrustedClientIp(
        (name) => (name === 'x-vercel-forwarded-for' ? '::ffff:192.168.1.1' : null),
        { onVercel: true },
      ),
      null,
    )
    assert.equal(
      pickTrustedClientIp(
        (name) => (name === 'x-vercel-forwarded-for' ? '999.999.999.999' : null),
        { onVercel: true },
      ),
      null,
    )
  })
})

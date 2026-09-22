/**
 * Dedupe cliente wishlist: clave lead+unidad (no solo unidad).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

function clientDedupeKey(leadId: string | null | undefined, unitId: string): string {
  const lead = String(leadId || '').trim()
  return `${lead || '_anon'}:${unitId}`
}

describe('wishlist client dedupe key', () => {
  it('misma unidad + leads distintos no colisionan', () => {
    const u = 'unit-1'
    assert.notEqual(clientDedupeKey('lead-a', u), clientDedupeKey('lead-b', u))
  })

  it('mismo lead + unidad colisionan; anon separado', () => {
    const u = 'unit-1'
    assert.equal(clientDedupeKey('lead-a', u), clientDedupeKey('lead-a', u))
    assert.equal(clientDedupeKey(null, u), '_anon:unit-1')
    assert.notEqual(clientDedupeKey(null, u), clientDedupeKey('lead-a', u))
  })
})

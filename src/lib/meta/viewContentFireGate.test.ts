import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  claimViewContentSend,
  shouldSkipViewContent,
} from './viewContentFireGate'

describe('viewContentFireGate', () => {
  it('permite reintentar tras cancelar la espera sin marcar fired', () => {
    const visitKey = 'view:vid:unit-1'
    const fired = { current: null as string | null }

    assert.equal(shouldSkipViewContent(fired.current, visitKey), false)

    // Cerrar ficha durante la espera de _fbp ⇒ cancelled, no claim
    assert.equal(claimViewContentSend(fired, visitKey, true), false)
    assert.equal(fired.current, null)
    assert.equal(shouldSkipViewContent(fired.current, visitKey), false)

    // Reabrir: mismo visitKey / event_id puede enviarse una vez
    assert.equal(claimViewContentSend(fired, visitKey, false), true)
    assert.equal(fired.current, visitKey)
    assert.equal(shouldSkipViewContent(fired.current, visitKey), true)

    // Segundo intento no duplica
    assert.equal(claimViewContentSend(fired, visitKey, false), false)
  })
})

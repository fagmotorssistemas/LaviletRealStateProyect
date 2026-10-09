import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bedroomOptionsFromText } from './bedroom-options'
import { normalizeTurnSemantics } from './turn-semantics'

describe('bedroom alternatives use complete words for refusals', () => {
  it('preserves a positive disjunction after bueno through turn normalization', () => {
    for (const current of ['Bueno quiero 2 o 3 dormitorios', 'Bueno necesito dos o tres habitaciones']) {
      assert.deepEqual(bedroomOptionsFromText(current), [2, 3])
      const semantics = normalizeTurnSemantics({}, current, {})
      assert.deepEqual((semantics.property as { filters: { bedrooms_any: number[] } }).filters.bedrooms_any, [2, 3])
    }
  })

  it('does not turn genuine refusals or ranges into accepted alternatives', () => {
    for (const current of ['No quiero 2 o 3 dormitorios', 'Bueno, no necesito dos o tres habitaciones',
      'No acepto 2 o 3 cuartos', 'Entre 2 o 3 dormitorios', 'Hasta 2 o 3 dormitorios']) {
      assert.deepEqual(bedroomOptionsFromText(current), [], current)
    }
  })
})

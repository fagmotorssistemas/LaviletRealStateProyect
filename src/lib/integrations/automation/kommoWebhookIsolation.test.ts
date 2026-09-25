import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptsKommoTestContactBatch } from './kommoWebhookIsolation'

test('el aislamiento Kommo admite solo lotes completos del contacto de prueba', () => {
  assert.equal(acceptsKommoTestContactBatch('9432278', [9432278]), true)
  assert.equal(acceptsKommoTestContactBatch('9432278', [9432278, 9432278]), true)
  assert.equal(acceptsKommoTestContactBatch('9432278', [9432278, 100]), false)
  assert.equal(acceptsKommoTestContactBatch('9432278', []), false)
  assert.equal(acceptsKommoTestContactBatch(undefined, [100]), true)
})

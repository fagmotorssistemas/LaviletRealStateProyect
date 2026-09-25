import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateStoredCustomerMessages } from './isolated-interest-evaluator'

test('evalúa en orden, conserva identidad y acepta eventos vacíos', async () => {
  const calls: Array<{ id: string; events: string[] }> = []
  const result = await evaluateStoredCustomerMessages([
    { externalId: 'later', sentAt: '2026-09-22T00:27:00Z', role: 'cliente', content: 'Gracias' },
    { externalId: 'first', sentAt: '2026-09-22T00:26:00Z', role: 'cliente', content: 'Precio' },
  ], {
    classifyScope: async () => ({ kind: 'property', property_message: '', uncertain: false }),
    interpret: async input => ({ method: 'model', extracted: { events: input.mensaje_actual === 'Precio' ? ['asked_price'] : [] }, promptRevision: 'rules' }),
    evaluate: async (id, events) => { calls.push({ id, events }) },
  })
  assert.deepEqual(calls, [{ id: 'first', events: ['asked_price'] }, { id: 'later', events: [] }])
  assert.deepEqual(result.map(row => row.sourceSentAt), ['2026-09-22T00:26:00Z', '2026-09-22T00:27:00Z'])
})

test('no evalúa alcance ajeno o incierto', async () => {
  let writes = 0
  const result = await evaluateStoredCustomerMessages([
    { externalId: 'x', sentAt: '2026-09-22T00:26:00Z', role: 'cliente', content: 'Vuelo' },
  ], {
    classifyScope: async () => ({ kind: 'out_of_scope', property_message: '', uncertain: false }),
    interpret: async () => { throw new Error('unexpected') },
    evaluate: async () => { writes += 1 },
  })
  assert.equal(writes, 0)
  assert.equal(result[0].method, 'scope_rejected')
})

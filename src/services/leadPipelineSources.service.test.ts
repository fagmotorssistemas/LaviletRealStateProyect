import test from 'node:test'
import assert from 'node:assert/strict'
import { readPipelinePages, readPipelineRelated } from './leadPipelineSources.service'

test('PostgREST page caps do not truncate commercial totals', async () => {
  const rows = Array.from({ length: 1105 }, (_, id) => ({ id }))
  const ranges: number[][] = []
  const result = await readPipelinePages(async (from, to) => {
    ranges.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  })
  assert.equal(result.length, 1105)
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
})
test('a failed later page cannot masquerade as a complete pipeline', async () => {
  await assert.rejects(readPipelinePages(async from => from === 0
    ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
    : { data: null, error: { message: 'Read failed' } }), /Read failed/)
})
test('scoped relation queries retain all lead IDs across bounded batches and skip empty scopes', async () => {
  const ids = Array.from({ length: 301 }, (_, index) => `lead-${index}`), seen: string[] = []
  const result = await readPipelineRelated(ids, async chunk => {
    assert.ok(chunk.length <= 150)
    seen.push(...chunk)
    return { data: chunk.map(id => ({ id })), error: null }
  })
  assert.deepEqual(seen, ids)
  assert.equal(result.length, ids.length)
  await readPipelineRelated([], () => { throw new Error('An empty authorized scope must not query all rows') })
})

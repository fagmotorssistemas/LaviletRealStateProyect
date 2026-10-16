import test from 'node:test'
import assert from 'node:assert/strict'
import { pipelineIssue, coverageIncomplete } from './leadPipelineDiagnostics'

test('source diagnostics distinguish missing structure, permissions, temporary failure and configuration', () => {
  for (const [error, category] of [
    [{ code: '42P01' }, 'schema'], [{ code: 'PGRST205' }, 'schema'], [{ code: '42501' }, 'permission'],
    [{ status: 403 }, 'permission'], [{ status: 503 }, 'temporary'], [new TypeError('fetch failed'), 'temporary'],
    [{ code: 'SERVER_CONFIGURATION_MISSING' }, 'configuration'], [{ code: 'XX000' }, 'unknown'],
  ] as const) assert.equal(pipelineIssue('metadata', 'Ficha', error, 'reference').category, category)
  assert.doesNotMatch(pipelineIssue('metadata', 'Ficha', { code: '42501' }, 'ref').message, /migraci/i)
})

test('diagnostics never serialize raw SQL or credential-bearing messages and recover when coverage is complete', () => {
  const issue = pipelineIssue('history', 'Historial', { code: '42501', message: 'SECRET customer SQL', details: 'private', hint: 'token' }, 'ref-1')
  assert.doesNotMatch(JSON.stringify(issue), /SECRET|private|token|customer SQL/)
  assert.equal(issue.reference, 'ref-1')
  assert.equal(coverageIncomplete({ history: false, metadata: true }), true)
  assert.equal(coverageIncomplete({ history: true, metadata: true }), false)
})

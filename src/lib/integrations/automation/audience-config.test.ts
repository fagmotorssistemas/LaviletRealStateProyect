import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as boundary from './audience-boundary'

type Row = Record<string, unknown>
type ReadResult = { data: unknown; error: unknown }

/** Load the real config implementation with a local read-only database adapter. */
function harness(options: { testOnly?: boolean; policies?: unknown; projectError?: unknown; projectMissing?: boolean } = {}) {
  const calls: { table: string; operation: string; args: unknown[] }[] = []
  const scope = { tenant_id: 'tenant-under-test', project_id: 'project-under-test' }
  const config = { ...scope, enabled: true, dry_run: false, test_only: options.testOnly ?? false }
  const results: Record<string, ReadResult> = {
    lv_auto_config: { data: config, error: null },
    projects: { data: options.projectMissing ? null : { policies_json: options.policies ?? {} }, error: options.projectError ?? null },
    lv_test_contacts_state: { data: [{ lead_id: 'enrolled-test-lead' }], error: null },
  }
  const admin = {
    from(table: string) {
      assert.ok(table in results, `Unexpected table access: ${table}`)
      const record = (operation: string, ...args: unknown[]) => { calls.push({ table, operation, args }) }
      const chain = {
        select(...args: unknown[]) { record('select', ...args); return chain },
        match(...args: unknown[]) { record('match', ...args); return chain },
        eq(...args: unknown[]) { record('eq', ...args); return chain },
        abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); return chain },
        async maybeSingle() { return results[table] },
        then(onfulfilled: (value: ReadResult) => unknown, onrejected?: (reason: unknown) => unknown) {
          return Promise.resolve(results[table]).then(onfulfilled, onrejected)
        },
      }
      return chain
    },
  }
  const imports: Record<string, unknown> = {
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '../lavilet': { LAVILET_PROJECT_ID: scope.project_id, LAVILET_TENANT_ID: scope.tenant_id },
    './reset-protection': { assertProductionRpcAllowed: () => { throw Error('RPC_NOT_ALLOWED_IN_CONFIG_TEST') } },
    '@/lib/inmobiliaria/testResponseMode': { testLeadAllowed: () => { throw Error('LEAD_DECISION_NOT_EXPECTED_IN_CONFIG_TEST') } },
    './audience-boundary': boundary,
  }
  const code = transpileModule(readFileSync(resolve('src/lib/integrations/automation/data.ts'), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} as { autoConfig: () => Promise<Row> } }
  new Function('require', 'module', 'exports', code)((id: string) => {
    assert.ok(id in imports, `Unexpected import: ${id}`)
    return imports[id]
  }, loaded, loaded.exports)
  return { load: loaded.exports.autoConfig, calls, config, scope }
}

test('production config cannot admit all contacts without an explicit audience boundary', async () => {
  for (const policies of [{}, { automation_audience: null }]) {
    const h = harness({ testOnly: false, policies })
    await assert.rejects(h.load(), { message: 'AUTOMATION_AUDIENCE_REQUIRED' })
    assert.equal(h.calls.some(call => call.table === 'lv_test_contacts_state'), false)
  }
})

test('legacy test-only mode retains its current enrollment while no production boundary is configured', async () => {
  const h = harness({ testOnly: true })
  const result = await h.load()
  assert.equal(result.enabled, true)
  assert.equal(result.test_only, true)
  assert.equal(result._audience, null)
  assert.deepEqual(result.test_lead_ids, ['enrolled-test-lead'])
  assert.deepEqual(h.calls.find(call => call.table === 'lv_test_contacts_state' && call.operation === 'match')?.args, [h.scope])
  assert.deepEqual(h.calls.find(call => call.table === 'lv_test_contacts_state' && call.operation === 'eq')?.args, ['matches', 1])
})

test('production admits a valid scoped policy without consulting or inheriting test enrollments', async () => {
  const policy = { version: 1, mode: 'future_messages', activatedAt: '2026-10-16T15:00:00.000Z' }
  const h = harness({ testOnly: false, policies: { unrelated_policy: { keep: true }, automation_audience: policy } })
  const result = await h.load()
  assert.deepEqual(result, { ...h.config, _audience: policy })
  assert.equal(h.calls.some(call => call.table === 'lv_test_contacts_state'), false)
  assert.deepEqual(h.calls.filter(call => call.table === 'projects' && call.operation === 'eq').map(call => call.args), [
    ['id', h.scope.project_id], ['tenant_id', h.scope.tenant_id],
  ])
})

test('corrupted policies fail closed even while test-only mode is still selected', async () => {
  for (const testOnly of [false, true]) {
    const h = harness({ testOnly, policies: { automation_audience: { version: 1, mode: 'all_contacts', activatedAt: '2026-10-16T15:00:00Z' } } })
    await assert.rejects(h.load(), { message: 'AUDIENCE_BOUNDARY_INVALID' })
  }
})

test('failed or absent project reads cannot open production eligibility', async () => {
  await assert.rejects(harness({ projectError: { code: 'TIMEOUT' } }).load(), { message: 'AUTOMATION_AUDIENCE_READ_FAILED' })
  await assert.rejects(harness({ projectMissing: true }).load(), { message: 'AUTOMATION_AUDIENCE_REQUIRED' })
})

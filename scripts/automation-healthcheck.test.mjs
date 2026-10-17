import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inspectAutomationHealth } from './automation-healthcheck.mjs'

const now = Date.parse('2026-10-16T18:00:00Z')
function harness({ age = 2, missingTable = false, paused = false, unknown = false, noHeartbeat = false } = {}) {
  const calls = []
  return { calls, run: () => inspectAutomationHealth({ url: 'https://example.supabase.co', key: 'never-print-this-key', now }, async (url, init) => {
    calls.push({ url: String(url), method: init.method })
    const endpoint = url.pathname.split('/').at(-1)
    if (endpoint === 'lead_commercial_profiles' && missingTable) return Response.json({ code: 'PGRST205', message: 'ignored private body' }, { status: 404 })
    if (endpoint === 'lv_auto_config') return unknown ? Response.json({ code: 'FAILED' }, { status: 500 })
      : Response.json([{ enabled: !paused, dry_run: false, test_only: false }])
    if (endpoint === 'lv_integration_events') return Response.json(noHeartbeat ? [] : [{ status: 'completed',
      completed_at: new Date(now - age * 60_000).toISOString(), received_at: new Date(now - age * 60_000).toISOString() }])
    assert.equal(url.searchParams.has('project_id'), false, 'commercial profiles are tenant-scoped; these tables have no project_id')
    return Response.json([])
  }) }
}

test('a fresh heartbeat and empty existing tables are healthy; every request is GET-only', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.maintenance.state, 'healthy')
  assert.equal(result.maintenance.ageMinutes, 2)
  assert.ok(result.structures.every(item => item.available))
  assert.equal(result.readOnly, true); assert.equal(result.sends, false)
  assert.equal(h.calls.length, 5)
  assert.ok(h.calls.every(call => call.method === 'GET' && !call.url.includes('/rpc/') && !call.url.includes('/run')))
  assert.doesNotMatch(JSON.stringify(result), /never-print-this-key|private body/)
})

test('stale, missing, future-dated and unavailable maintenance cannot appear healthy', async () => {
  for (const [options, state] of [[{ age: 25 * 60 }, 'stale'], [{ noHeartbeat: true }, 'missing'], [{ age: -5 }, 'unknown'], [{ unknown: true }, 'unknown']]) {
    assert.equal((await harness(options).run()).maintenance.state, state)
  }
})

test('an intentionally paused configuration does not diagnose a disabled scheduler from old timestamps', async () => {
  assert.equal((await harness({ paused: true, age: 25 * 60 }).run()).maintenance.state, 'paused')
})

test('missing REST structures report their code without assuming whether migration or cache is responsible', async () => {
  const result = await harness({ missingTable: true }).run()
  assert.deepEqual(result.structures[0], { table: 'lead_commercial_profiles', available: false, code: 'PGRST205' })
  assert.equal(result.maintenance.schedulerConfiguration, 'requires_admin_sql_diagnostic')
})

test('admin diagnosis has a read-only transaction and never reads secrets or invokes worker functions', () => {
  const sql = fs.readFileSync(new URL('./automation-readonly-diagnostics.sql', import.meta.url), 'utf8')
    .split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
  assert.match(sql, /begin transaction read only/i)
  assert.match(sql, /rollback;/i)
  assert.doesNotMatch(sql, /\b(?:update|insert|delete|alter|create|grant|revoke|notify)\b|decrypted_secret|\bcommand\b|\.tick\s*\(|collect_results\s*\(/i)
  assert.match(sql, /vault\.secrets/)
  assert.match(sql, /cron\.job/)
})

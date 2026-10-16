import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launchSalesbot } from './kommo'
import * as admission from './kommo-admission'
import * as data from './data'
import { GET } from '@/app/api/integrations/automation/audience/route'

const policy = { version: 1, mode: 'future_messages', activatedAt: '2026-01-01T12:00:00Z' }

test('the shared Salesbot boundary rejects an old source without a provider call', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('UNEXPECTED_PROVIDER_CALL') })
  await assert.rejects(launchSalesbot(123, 15578, { audience: policy, sourceAt: '2025-12-31T12:00:00Z' }), /AUTOMATION_AUDIENCE_EXCLUDED/)
  await assert.rejects(launchSalesbot(123, 15578, { audience: policy }), /AUTOMATION_AUDIENCE_EXCLUDED/)
  assert.equal(calls, 0)
})

test('a fresh source can start a Salesbot through a simulated transport', async t => {
  const values = { AUTOMATION_MODE: 'live', AUTOMATION_N8N_DISABLED: 'true', AUTOMATION_ACTIVATED_AT: '2020-01-01T00:00:00Z', KOMMO_BASE_URL: 'https://lavilet.kommo.com', KOMMO_ACCESS_TOKEN: 'synthetic-test-token' }
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => { for (const key of Object.keys(values)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key] } })
  t.mock.method(admission, 'reserveKommoCall', async () => {})
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => { calls++; assert.deepEqual(JSON.parse(String(init?.body)), [{ bot_id: 15578, entity_id: 123, entity_type: 'leads' }]); return new Response('{}') })
  await launchSalesbot(123, 15578, { audience: policy, sourceAt: '2026-01-01T12:00:01Z' })
  assert.equal(calls, 1)
})

test('deployment preflight requires authentication and reveals no credentials', async t => {
  const secret = 'synthetic-operator-secret-for-auth-only', before = process.env.AUTOMATION_CRON_SECRET
  process.env.AUTOMATION_CRON_SECRET = secret
  t.after(() => { if (before === undefined) delete process.env.AUTOMATION_CRON_SECRET; else process.env.AUTOMATION_CRON_SECRET = before })
  let reads = 0
  t.mock.method(data, 'autoConfig', async () => { reads++; return { enabled: true, dry_run: false, test_only: false, _audience: policy } })
  assert.equal((await GET(new Request('https://localhost/api/integrations/automation/audience'))).status, 401)
  assert.equal(reads, 0)
  const response = await GET(new Request('https://localhost/api/integrations/automation/audience', { headers: { Authorization: 'Bearer ' + secret } }))
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.equal(body.includes(secret), false)
  assert.deepEqual(JSON.parse(body).audience, policy)
  assert.equal(reads, 1)
})

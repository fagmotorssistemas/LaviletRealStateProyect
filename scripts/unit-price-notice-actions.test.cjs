/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
require('./test-typescript.cjs')
const { createClient } = require('@supabase/supabase-js')
const prices = require('../src/lib/inmobiliaria/unitPrices.ts')
const services = require('../src/services/unitPrices.service.ts')
const version = '2026-10-12T12:00:00Z'
function harness(options = {}) {
  const requests = [], project = { id: 'project', tenant_id: 'tenant', updated_at: version,
    policies_json: { bot_pricing: { launch_prices_visible: true }, business_policies: { published: ['keep'] } } }
  const supabase = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push({ url, method: init?.method, body: init?.body })
      let data = null
      if (url.pathname.endsWith('/projects')) {
        if (init?.method === 'PATCH') {
          assert.equal(url.searchParams.get('tenant_id'), 'eq.tenant')
          assert.equal(url.searchParams.get('updated_at'), 'eq.' + version)
          if (!options.concurrent) { Object.assign(project, JSON.parse(String(init.body))); data = project }
        } else if (!options.inaccessible) data = project
      } else if (url.pathname.endsWith('/project_automation_config')) data = { mode: 'lanzamiento' }
      else if (url.pathname.endsWith('/units')) data = []
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const mocks = { '@/lib/auth/session': {
    assertAdmin: async () => { if (options.deniedAdmin) throw Error('Solo administrador') },
    getSessionUser: async () => ({ supabase }),
  }, '@/lib/inmobiliaria/unitPrices': prices, '@/services/unitPrices.service': services }
  const source = fs.readFileSync(path.join(__dirname, '../src/app/inmobiliaria/automatizacion/precios/actions.ts'), 'utf8')
  const fixture = { exports: {} }, js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', js)(key => { assert.ok(key in mocks, key); return mocks[key] }, fixture, fixture.exports)
  return { ...fixture.exports, requests, project }
}

test('notice action loads on by default and uses the authenticated project tenant without changing price visibility', async () => {
  const h = harness(), loaded = await h.loadUnitPricesAction('project')
  assert.equal(loaded.referentialNoticeEnabled, true)
  const saved = await h.saveReferentialPriceNoticeAction({ projectId: 'project', enabled: false, expectedUpdatedAt: version, tenantId: 'foreign' })
  assert.equal(saved.referentialNoticeEnabled, false)
  assert.equal(prices.launchPricesVisible(h.project.policies_json), true)
  assert.deepEqual(h.project.policies_json.business_policies, { published: ['keep'] })
  assert.equal(h.requests.filter(request => request.method === 'PATCH').length, 1)
})

test('notice actions reject denied administrator and inaccessible projects before any write', async () => {
  const denied = harness({ deniedAdmin: true })
  await assert.rejects(denied.saveReferentialPriceNoticeAction({ projectId: 'project', enabled: false, expectedUpdatedAt: version }), /administrador/)
  assert.equal(denied.requests.length, 0)
  const hidden = harness({ inaccessible: true })
  await assert.rejects(hidden.saveReferentialPriceNoticeAction({ projectId: 'project', enabled: false, expectedUpdatedAt: version }), /sin acceso/)
  assert.equal(hidden.requests.some(request => request.method === 'PATCH'), false)
})

test('notice action rejects a concurrent policy change instead of reporting a successful disable', async () => {
  const h = harness({ concurrent: true })
  await assert.rejects(h.saveReferentialPriceNoticeAction({ projectId: 'project', enabled: false, expectedUpdatedAt: version }), /cambió/)
  assert.equal(prices.referentialPriceNoticeEnabled(h.project.policies_json), true)
})

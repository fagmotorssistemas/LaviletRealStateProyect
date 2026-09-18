/**
 * Demo local aislada WhatsApp → CTWA → CRM (sin salidas externas).
 *
 * Casos:
 * 1) Mensaje sin CTWA → noop (no inventa Lead/Purchase/Schedule)
 * 2) Mensaje con CTWA sintético → insert
 * 3) Seguimiento que conserva atribución → preserved
 * 4) Reintento → duplicate_retry (sin duplicar)
 *
 * Bloquea Meta Graph, Kommo HTTP, WhatsApp Cloud y automatizaciones externas
 * mediante mocks. Todo marcado como PRUEBA — no es recepción real de Meta.
 *
 * Uso: npm run test:meta-whatsapp-demo
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('../test-typescript.cjs')

const {
  preserveCtwaCapture,
  META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE,
} = require(path.join(root, 'src/lib/integrations/automation/ctwa-from-kommo.ts'))

const DEMO_MARK = Object.freeze({
  kind: 'PRUEBA_LOCAL_AISLADA',
  blocks: ['meta_graph', 'kommo_http', 'whatsapp_cloud', 'n8n_automations'],
  note: 'No representa aceptación Meta ni envío CAPI real',
})

const SYNTHETIC_CTWA = Object.freeze({
  clid: 'Aff-ANON_CTWA_CLID_EXAMPLE_NOT_REAL',
  fieldPath: 'message[add][0][referral][ctwa_clid]',
  sourceId: '120000000000000000',
  sourceUrl: 'https://fb.me/anon',
  referralSourceType: 'ad',
})

const demoScope = {
  tenant_id: 'demo-tenant-0001-4000-8000-000000000001',
  project_id: 'demo-project-0001-4000-8000-000000000001',
}

function loadPreserveStore(rpcImpl) {
  const filename = path.join(root, 'src/lib/integrations/automation/ctwa-lead-store.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }
  const localRequire = Module.createRequire(filename)
  const mocks = {
    'server-only': {},
    './data': {
      scope: demoScope,
      text: (v) => (typeof v === 'string' && v.trim() ? v.trim() : ''),
      object: (v) => (v && typeof v === 'object' ? v : {}),
      rpc: rpcImpl,
    },
    './ctwa-from-kommo': {},
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', source)(
    (id) => (id in mocks ? mocks[id] : localRequire(id)),
    m,
    m.exports,
  )
  return m.exports
}

describe('demo WhatsApp CTWA aislada (PRUEBA)', () => {
  it('marca el harness como prueba sin salidas externas', () => {
    assert.equal(DEMO_MARK.kind, 'PRUEBA_LOCAL_AISLADA')
    assert.ok(DEMO_MARK.blocks.includes('meta_graph'))
    assert.match(DEMO_MARK.note, /No representa aceptación Meta/)
  })

  it('1) mensaje sin CTWA → noop (no inventa conversión CAPI)', async () => {
    const store = loadPreserveStore(async () => {
      throw new Error('no debe llamar RPC sin clid')
    })
    const result = await store.preserveCtwaForContact({
      contactId: 99,
      kommoId: 100,
      externalMessageId: 'ext-no-ctwa',
      ctwa: null,
    })
    assert.equal(result.code, 'CTWA_NOOP')
    assert.equal(result.ok, true)
  })

  it('2) mensaje con CTWA sintético → insert', async () => {
    assert.equal(META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE._fixture_kind, 'synthetic_meta_cloud_api_shape')
    const calls = []
    const store = loadPreserveStore(async (name, args) => {
      calls.push({ name, args })
      if (name === 'lv_app_preserve_ctwa') return { ok: true, action: 'inserted' }
      throw new Error(`RPC inesperada ${name}`)
    })
    const result = await store.preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'ext-ctwa-1',
      ctwa: SYNTHETIC_CTWA,
    })
    assert.equal(result.ok, true)
    assert.equal(result.code, 'CTWA_INSERTED')
    assert.equal(calls.length, 1)
  })

  it('3) seguimiento conserva atribución first-touch', () => {
    const kept = preserveCtwaCapture(SYNTHETIC_CTWA, null)
    assert.equal(kept?.clid, SYNTHETIC_CTWA.clid)
  })

  it('3b) preserve RPC → preserved_existing', async () => {
    const store = loadPreserveStore(async () => ({ ok: true, action: 'preserved_existing' }))
    const result = await store.preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'ext-followup',
      ctwa: SYNTHETIC_CTWA,
    })
    assert.equal(result.code, 'CTWA_PRESERVED')
  })

  it('4) reintento sin duplicados → duplicate_retry', async () => {
    const store = loadPreserveStore(async () => ({ ok: true, action: 'duplicate_retry' }))
    const result = await store.preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'ext-retry',
      ctwa: SYNTHETIC_CTWA,
    })
    assert.equal(result.code, 'CTWA_DUPLICATE_RETRY')
  })
})

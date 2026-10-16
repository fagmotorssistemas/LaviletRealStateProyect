/* eslint-disable @typescript-eslint/no-require-imports */
require('./test-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')
let access = true, write = true, visible = true, migrationMissing = false, sourceCalls = 0, rpcCalls = []
const id = '10000000-0000-4000-8000-000000000001'
const client = createClient('https://example.supabase.co', 'test', { auth: { persistSession: false, autoRefreshToken: false }, global: {
  fetch: async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/leads')) {
      assert.equal(init.method, 'GET')
      assert.equal(url.searchParams.get('id'), `eq.${id}`)
      return Response.json(visible ? [{ id }] : [])
    }
    assert.ok(url.pathname.endsWith('/rpc/save_lead_commercial_profile'), 'no outbound, reservation or appointment mutation is allowed')
    assert.equal(init.method, 'POST')
    const body = JSON.parse(init.body)
    rpcCalls.push(body)
    return migrationMissing ? Response.json({ code: 'PGRST202', message: 'Missing RPC' }, { status: 404 }) : Response.json({})
  },
} })
function sources() {
  return { leads: Array.from({ length: 35 }, (_, n) => ({ id: `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
    tenant_id: 'tenant', name: `Persona ${n + 1}`, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z',
    status: 'nuevo', temperature: 'frio', behavior_signals: { secret_financial_data: 'DO_NOT_SERIALIZE' } })),
    conversations: [], events: [], appointments: [], reservations: [], sales: [], metadata: [], units: [], profiles: [], projects: [], messages: [], history: [],
    warnings: [], coverage: { messages: true, metadata: true } }
}
const originalLoad = Module._load
Module._load = function(name, ...args) {
  if (name === '@/lib/auth/session') return {
    assertCanAccessCrmPath: async () => { if (!access) throw Error('Sin acceso'); return { user: { id: 'staff' }, profile: { role: 'admin' } } },
    assertCanWriteCrm: async () => { if (!write) throw Error('Solo consulta') },
    getSessionUser: async () => ({ supabase: client, user: { id: 'staff' } }),
  }
  if (name === '@/lib/supabase/admin') return { tryCreateAdminClient: () => null }
  if (name === 'next/cache') return { revalidatePath() {} }
  if (name === '@/services/leadPipelineSources.service') return {
    loadLeadPipelineSources: async () => { sourceCalls++; return sources() }, readPipelineRelated: async () => [],
  }
  return originalLoad.call(this, name, ...args)
}
const actions = require('../src/app/inmobiliaria/leads/pipeline-actions.ts')
Module._load = originalLoad
const input = { leadId: id, nutritionActive: true, nutritionReason: 'Compra futura', purchaseHorizon: 'Próximo año',
  nutritionEvidence: 'Compraría el próximo año y podemos seguir en contacto', contactConsent: true,
  resumeAt: null, nextAction: 'Consultar el avance con el asesor', nextActionAt: null, opportunityStatus: 'open', closureReason: '' }

test('pipeline actions require CRM authorization before reading or accepting metadata', async () => {
  access = false; sourceCalls = 0; rpcCalls = []
  assert.equal((await actions.listLeadPipelineAction()).ok, false)
  assert.equal((await actions.updateLeadPipelineMetadataAction(input)).ok, false)
  assert.equal(sourceCalls, 0); assert.equal(rpcCalls.length, 0)
  access = true
})

test('board counts include every authorized result, paginate within columns, and serialize no raw financial evidence', async () => {
  const result = await actions.listLeadPipelineAction({ view: 'board', pageSize: 12, pages: { nuevo: 3 }, outcome: 'all' })
  assert.equal(result.ok, true)
  assert.equal(result.data.total, 35)
  const column = result.data.columns.find(row => row.stage === 'nuevo')
  assert.equal(column.total, 35); assert.equal(column.page, 3); assert.equal(column.leads.length, 11)
  assert.equal(result.data.columns.reduce((sum, row) => sum + row.total, 0), 35)
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_SERIALIZE|behavior_signals/)
  assert.equal((await actions.listLeadPipelineAction({ stage: 'interes_comercial' })).data.total, 0)
})

test('metadata is validated and row-authorized before its one audited RPC, without sending messages or scheduling jobs', async () => {
  rpcCalls = []; write = false
  assert.equal((await actions.updateLeadPipelineMetadataAction(input)).ok, false)
  write = true
  for (const patch of [{ nutritionEvidence: '' }, { contactConsent: false }, { purchaseHorizon: '' },
    { opportunityStatus: 'lost', closureReason: '' }, { resumeAt: 'not-a-date' }]) {
    assert.equal((await actions.updateLeadPipelineMetadataAction({ ...input, ...patch })).ok, false)
  }
  assert.equal(rpcCalls.length, 0)
  visible = false
  assert.equal((await actions.updateLeadPipelineMetadataAction(input)).ok, false)
  assert.equal(rpcCalls.length, 0)
  visible = true
  assert.equal((await actions.updateLeadPipelineMetadataAction(input)).ok, true)
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].p_nutrition_active, true)
  assert.equal(rpcCalls[0].p_next_action, input.nextAction)
})

test('missing migration is reported as unavailable persistence instead of a successful save', async () => {
  migrationMissing = true
  const result = await actions.updateLeadPipelineMetadataAction(input)
  assert.equal(result.ok, false); assert.match(result.error, /migración/)
  migrationMissing = false
})

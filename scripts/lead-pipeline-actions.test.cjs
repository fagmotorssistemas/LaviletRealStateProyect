/* eslint-disable @typescript-eslint/no-require-imports */
require('./test-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')
let access = true, write = true, visible = true, migrationMissing = false, sourceCalls = 0, rpcCalls = []
let detailMode = false, onlyAutomation = false, role = 'admin', financeConsent = false, financeReads = []
const id = '10000000-0000-4000-8000-000000000001'
const client = createClient('https://example.supabase.co', 'test', { auth: { persistSession: false, autoRefreshToken: false }, global: {
  fetch: async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/financing_prequalifications')) {
      financeReads.push(url.searchParams.get('select'))
      const identity = url.searchParams.get('select').includes('monthly_income')
      return Response.json(identity ? [{ legal_name: 'IDENTIDAD_PROTEGIDA', national_id: '0102030405', monthly_income: 9000 }]
        : [{ explicit_consent: financeConsent, selected_partner_name: 'JEP', status: 'borrador' }])
    }
    if (url.pathname.endsWith('/lead_commercial_profile_history')) return Response.json([])
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
  const value = { leads: Array.from({ length: 35 }, (_, n) => ({ id: `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
    tenant_id: 'tenant', name: `Persona ${n + 1}`, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z',
    status: 'nuevo', temperature: 'frio', behavior_signals: { secret_financial_data: 'DO_NOT_SERIALIZE' } })),
    conversations: [], events: [], appointments: [], reservations: [], sales: [], metadata: [], units: [], profiles: [], projects: [], messages: [], history: [],
    warnings: [], coverage: { messages: true, metadata: true } }
  if (detailMode) {
    value.leads = [{ ...value.leads[0], project_id: 'project', assigned_to: 'other' }]
    value.conversations = [{ id: 'conv', lead_id: id, summary: { _property_context: { selected_ids: ['unit'] }, _financing_journey: { accepted: financeConsent } } }]
    value.units = [{ id: 'unit', project_id: 'project', unit_number: '304' }]
  }
  return value
}
const originalLoad = Module._load
Module._load = function(name, ...args) {
  if (name === '@/lib/auth/session') return {
    assertCanAccessCrmPath: async path => { if (!access || onlyAutomation && path !== '/inmobiliaria/automatizacion') throw Error('Sin acceso'); return { user: { id: 'staff' }, profile: { role } } },
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

test('the same server profile is available from Automation without exposing financial identity to an advisor', async () => {
  detailMode = true; onlyAutomation = true; role = 'asesor'; financeConsent = true; financeReads = []
  const result = await actions.getLeadPipelineDetailAction(id)
  assert.equal(result.ok, true)
  assert.equal(result.data.pipeline.selectedUnitNumber, '304')
  assert.equal(result.data.canEdit, false, 'A co-advisor may read but must not edit another responsible advisor\'s lead.')
  assert.equal(result.data.financialReview, undefined)
  assert.equal(financeReads.length, 1)
  assert.doesNotMatch(JSON.stringify(result), /IDENTIDAD_PROTEGIDA|0102030405|Ingreso mensual|Nombre legal/)
  onlyAutomation = false; role = 'admin'; detailMode = false
})

test('legal financial data requires accepted review plus financial access and remains masked', async () => {
  detailMode = true; role = 'admin'; financeConsent = false; financeReads = []
  const noConsent = await actions.getLeadPipelineDetailAction(id)
  assert.equal(noConsent.ok, true)
  assert.equal(financeReads.length, 1)
  assert.equal(noConsent.data.financialReview, undefined)
  financeConsent = true; financeReads = []
  const consented = await actions.getLeadPipelineDetailAction(id)
  assert.equal(consented.ok, true)
  assert.equal(financeReads.length, 2)
  assert.ok(consented.data.financialReview)
  assert.deepEqual(consented.data.financialReview.groups, [])
  assert.doesNotMatch(JSON.stringify(consented), /0102030405/)
  assert.match(JSON.stringify(consented), /0405/)
  detailMode = false; financeConsent = false
})

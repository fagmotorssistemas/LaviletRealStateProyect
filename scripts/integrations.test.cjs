const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename)
function load(relative, mocks) {
  const filename = path.join(root, relative)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }, localRequire = Module.createRequire(filename)
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : localRequire(id), m, m.exports)
  return m.exports
}
const { automationSettings, secretMatches } = require('../src/lib/integrations/automation/config.ts')
const { normalizeWebhook } = require('../src/lib/integrations/automation/webhook.ts')
const { validateVisit, routeSignature } = require('../src/lib/integrations/automation/visit-rules.ts')
const { normalizeEvents, validateIntent } = require('../src/lib/integrations/automation/conversation-rules.ts')
const data = require('../src/lib/integrations/automation/data.ts')
const scope = data.scope
const now = Date.parse('2026-09-09T18:00:00Z')
const later = offset => new Date(now + offset).toISOString()
function live(t) {
  for (const [key, value] of Object.entries({ AUTOMATION_MODE: 'live', AUTOMATION_N8N_DISABLED: 'true',
    AUTOMATION_ACTIVATED_AT: '2026-01-01T00:00:00Z', KOMMO_BASE_URL: 'https://lavilet.kommo.com', KOMMO_ACCESS_TOKEN: 'synthetic-token' })) {
    const previous = process.env[key]; process.env[key] = value
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous)
  }
}
function fixture() {
  return { job: { ...scope, id: 'job', lead_id: 'lead', appointment_id: 'appointment', kind: 'visit_2h',
    status: 'pending', revision: 'r1', scheduled_at: later(-1000), expires_at: later(1_800_000), payload: { detail: 'Visita de prueba' } },
    lead: { ...scope, id: 'lead', channel_origin: 'whatsapp', kommo_id: 123, bot_enabled: true },
    config: { ...scope, enabled: true, dry_run: false, test_only: false },
    appointment: { ...scope, id: 'appointment', lead_id: 'lead', status: 'aceptado', start_time: later(7_200_000) },
    route: { enabled: true, approved: true, bot_id: 18350, detail_field_id: 513120, link_field_id: 0, body_template: '{{detalle}}', template_name: 'reminder' },
    last_client_message_at: later(-60_000), revision: 'r1', event_current: true, reminders_paused: false, recent_jobs: [] }
}
test('activation requires explicit ownership and valid cutover date', t => {
  live(t); assert.equal(automationSettings().live, true)
  process.env.AUTOMATION_N8N_DISABLED = 'false'; assert.equal(automationSettings().live, false)
  process.env.AUTOMATION_N8N_DISABLED = 'true'; process.env.AUTOMATION_ACTIVATED_AT = 'invalid'; assert.equal(automationSettings().live, false)
  assert.equal(secretMatches('short', 'short'), false)
  assert.equal(secretMatches('x'.repeat(32), 'x'.repeat(32)), true)
  assert.equal(secretMatches('y'.repeat(32), 'x'.repeat(32)), false)
})
test('webhook handles all messages, rejects other accounts, ignores outgoing and unsupported channels', () => {
  const msg = { id: 'external-1', entity_id: 123, contact_id: 456, text: 'Hola', created_at: now / 1000,
    origin: 'waba', author: { type: 'external' }, type: 'incoming' }
  const input = { account: { id: 36919007 }, message: { add: [msg, { ...msg, id: 'external-2' },
    { ...msg, type: 'outgoing' }, { ...msg, origin: 'telegram' }] } }
  assert.equal(normalizeWebhook(JSON.stringify(input), 'application/json', now).length, 2)
  const form = new URLSearchParams({ 'account[id]': '36919007', 'message[add][0][id]': 'x',
    'message[add][0][entity_id]': '123', 'message[add][0][contact_id]': '456', 'message[add][0][created_at]': String(now / 1000),
    'message[add][0][origin]': 'whatsapp', 'message[add][0][author][type]': 'external' })
  assert.equal(normalizeWebhook(form.toString(), 'application/x-www-form-urlencoded', now)[0].kommoId, 123)
  input.account.id = 7
  assert.throws(() => normalizeWebhook(JSON.stringify(input), 'application/json', now), /WRONG_KOMMO_ACCOUNT/)
})
test('visits respect exact window boundary, changes, opt-out and unresolved sends', () => {
  const c = fixture(); assert.equal(validateVisit(c, now).action, 'send')
  c.last_client_message_at = later(-24 * 3_600_000); assert.equal(validateVisit(c, now).action, 'defer')
  c.last_client_message_at = later(-60_000); c.revision = 'r2'; assert.equal(validateVisit(c, now).action, 'cancel')
  c.revision = 'r1'; c.lead.tracking_opt_out_at = later(-1000); assert.equal(validateVisit(c, now).action, 'cancel')
  delete c.lead.tracking_opt_out_at; c.recent_jobs = [{ id: 'other', status: 'uncertain' }]
  assert.equal(validateVisit(c, now).action, 'defer')
})
test('route IDs and tenant changes fail closed', () => {
  const c = fixture(); c.route.detail_field_id = 0; assert.equal(validateVisit(c, now).action, 'defer')
  c.lead.tenant_id = 'other'; assert.equal(validateVisit(c, now).action, 'cancel')
})
test('accepting a visit requires a sent proposal and a later source timestamp', () => {
  const p = { status: 'awaiting_client', advisor_accepted_at: later(-3000), propuesta_enviada_at: later(-2000) }
  assert.equal(validateIntent({ intent: 'accept' }, p, later(-1000), later(0)), 'accept')
  assert.equal(validateIntent({ intent: 'accept' }, p, later(-4000), later(0)), 'unclear')
  assert.equal(validateIntent({ intent: 'accept' }, null, later(0), later(0)), 'unclear')
})
test('extraction rejects truthy strings, unapproved actions and invented identity numbers', () => {
  const r = normalizeEvents({ opt_out: 'true', consent_granted: 'true', events: ['delete_lead', 'asked_price'], national_id: '1234567890' }, 'Precio')
  assert.equal(r.opt_out, false); assert.equal(r.tracking_consent, false); assert.equal(r.national_id, null)
  assert.deepEqual(r.events, ['first_response', 'asked_price'])
})
test('a changed appointment after PATCH prevents Salesbot launch', async t => {
  live(t)
  const c = fixture(); c.job.scheduled_at = new Date(Date.now() - 1000).toISOString()
  c.job.expires_at = new Date(Date.now() + 100_000).toISOString(); c.appointment.start_time = new Date(Date.now() + 7_200_000).toISOString()
  c.last_client_message_at = new Date(Date.now() - 60_000).toISOString()
  let reads = 0, patches = 0, launches = 0; const finishes = []
  const claimed = () => ({ ...c, job: { ...c.job, status: 'claimed', claim_token: 'token',
    payload: { ...c.job.payload, _kommo_id: 123, _route: routeSignature(c.route) } } })
  const query = { select() { return this }, match() { return this }, eq() { return this }, like() { return Promise.resolve({ count: 0, error: null }) } }
  const mockRpc = async (name, args) => {
    if (name === 'lv_app_visit_context') { reads++; return reads === 1 ? c : reads === 2 ? claimed() : { ...claimed(), event_current: false } }
    if (name === 'lv3_reserve') return { reserved: true, job_id: 'job' }
    if (name === 'lv3_finish') { finishes.push(args); return {} }
    throw Error(name)
  }
  const { sendVisit } = load('src/lib/integrations/automation/visits.ts', {
    './data': { ...data, rpc: mockRpc, db: () => ({ from: () => query }) },
    './kommo': { getKommoLead: async () => ({}), setKommoField: async () => { patches++ }, launchSalesbot: async () => { launches++ } },
  })
  await sendVisit('job', async () => {})
  assert.equal(patches, 1); assert.equal(launches, 0); assert.equal(finishes[0].p_status, 'failed')
})
test('Kommo launch accepts an empty 202 response and never retries a network failure', async t => {
  live(t); const { launchSalesbot } = require('../src/lib/integrations/automation/kommo.ts')
  let calls = 0
  t.mock.method(global, 'fetch', async () => { calls++; return new Response(null, { status: 202 }) })
  await launchSalesbot(123, 15578); assert.equal(calls, 1)
  global.fetch = async () => { calls++; throw Error('network failure') }
  await assert.rejects(() => launchSalesbot(123, 15578), error => error.uncertain === true)
  assert.equal(calls, 2)
})
test('cron and webhook refuse missing credentials without doing work', async () => {
  const run = require('../src/app/api/integrations/automation/run/route.ts')
  const hook = require('../src/app/api/integrations/kommo/webhook/route.ts')
  assert.equal((await run.POST(new Request('https://example.test/api'))).status, 401)
  assert.equal((await hook.POST(new Request('https://example.test/hook', { method: 'POST', body: '{}' }))).status, 401)
})

function conversationHarness(options = {}) {
  const calls = [], lead = { ...scope, id: 'lead', kommo_id: 123, bot_enabled: true }, config = { ...scope, enabled: true, dry_run: false, test_only: false }
  const query = () => {
    const q = { then(resolve) { return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve) } }
    for (const name of ['update', 'select', 'eq', 'match', 'gt', 'in', 'limit', 'abortSignal']) q[name] = () => q
    return q
  }
  const mod = load('src/lib/integrations/automation/conversation.ts', {
    './data': { ...data, db: () => ({ from: () => query() }), autoConfig: async () => config,
      one: async table => table === 'conversations' ? { ...scope, lead_id: 'lead' } : lead,
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'register_inbound_message') return { lead_id: 'lead', conversation_id: 'conv', is_duplicate: options.duplicate === true }
        if (name === 'lv_app_conversation_context') return { propuestas: [], historial: [] }
        if (name === 'process_financing_message_v2') return { active: false }
        return {}
      },
    },
    './ai': { activePrompt: async name => name === 'saludo_inicial' ? 'Hola, bienvenido a La Vilet. ?En qu? podemos ayudarle?' : name, draftReply: async () => 'Hola, ¿en qué puedo ayudarle?', mediaText: async event => event.text,
      aiJson: async prompt => prompt === 'extractor_eventos' ? { events: [], opt_out: options.optOut === true }
        : prompt === 'revisor_respuesta' ? { aprobada: true } : {} },
    './kommo': {
      getKommoLead: async () => ({ id: 123, _embedded: { contacts: [{ id: 456 }] } }),
      getKommoContact: async () => ({ id: 456, custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+593000000000' }] }] }),
      botStopped: () => false, setKommoField: async (...args) => calls.push({ name: 'patch', args }),
      launchSalesbot: async (...args) => { calls.push({ name: 'launch', args }); if (options.sendFails) throw Error('KOMMO_UNAVAILABLE') },
    },
  })
  const rows = ['one', 'two'].map(externalId => ({ payload: { externalId, kommoId: 123, contactId: 456, chatId: 'chat', text: 'Hola',
    name: 'Cliente de prueba', sentAt: new Date(Date.now() - 1000).toISOString(), origin: 'waba', media: null } }))
  return { calls, rows, process: mod.processConversation }
}
test('conversation groups two inputs into one reply and records outbound only after acceptance', async t => {
  live(t); const h = conversationHarness()
  const result = await h.process(h.rows, async () => {})
  assert.equal(result.action, 'accepted')
  assert.equal(h.calls.filter(c => c.name === 'register_inbound_message').length, 2)
  assert.equal(h.calls.filter(c => c.name === 'launch').length, 1)
  assert.ok(h.calls.findIndex(c => c.name === 'register_outbound_message') > h.calls.findIndex(c => c.name === 'launch'))
})
test('duplicate inbound messages never produce another reply', async t => {
  live(t); const h = conversationHarness({ duplicate: true })
  assert.equal((await h.process(h.rows, async () => {})).action, 'duplicate')
  assert.equal(h.calls.filter(c => c.name === 'launch').length, 0)
})
test('opt-out is persisted before its final notice and avoids scoring or financing', async t => {
  live(t); const h = conversationHarness({ optOut: true })
  await h.process(h.rows, async () => {})
  const preference = h.calls.find(c => c.name === 'set_tracking_preference')
  assert.equal(preference.args.p_consent, false)
  assert.equal(h.calls.filter(c => c.name === 'apply_lead_events').length, 0)
  assert.equal(h.calls.filter(c => c.name === 'process_financing_message_v2').length, 0)
})
test('a failed conversation send is not recorded as accepted', async t => {
  live(t); const h = conversationHarness({ sendFails: true })
  await assert.rejects(() => h.process(h.rows, async () => {}), /KOMMO_UNAVAILABLE/)
  assert.equal(h.calls.filter(c => c.name === 'launch').length, 1)
  assert.equal(h.calls.filter(c => c.name === 'register_outbound_message').length, 0)
})

test('isolated greeting uses editable welcome without scoring or financing', async t => {
  live(t); const h = conversationHarness();
  await h.process([h.rows[0]], async () => {});
  assert.equal(h.calls.filter(c => c.name === 'apply_lead_events').length, 0);
  assert.equal(h.calls.filter(c => c.name === 'process_financing_message_v2').length, 0);
  assert.ok(JSON.stringify(h.calls.find(c => c.name === 'patch')).includes('bienvenido a La Vilet'));
});

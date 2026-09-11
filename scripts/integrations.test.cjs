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

test('OpenAI billing errors retain a safe diagnostic code that the worker can record', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL']) {
    const previous = process.env[key]; process.env[key] = 'synthetic'
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous)
  }
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'Provider details must not be copied' } }), { status: 429 }))
  const { aiJson } = require('../src/lib/integrations/automation/ai.ts')
  await assert.rejects(() => aiJson('Return JSON', {}), error => error.message === 'OPENAI_HTTP_429_CREDIT_BALANCE_EXHAUSTED')
})

function conversationHarness(options = {}) {
  const calls = [], lead = { ...scope, id: 'lead', kommo_id: 123, bot_enabled: true, ...options.lead }, config = { ...scope, enabled: true, dry_run: false, test_only: false }
  const query = table => {
    const q = { then(resolve) { return Promise.resolve({ data: table === 'lv_visit_intakes' ? options.visitDraft || null : table === 'appointment_reschedule_requests' ? options.requests || [{ id: 'request', source_message_id: 'one' }] : [], error: null, count: 0 }).then(resolve) } }
    for (const name of ['update', 'select', 'eq', 'match', 'gt', 'in', 'limit', 'abortSignal', 'maybeSingle']) q[name] = () => q
    q.update = values => { calls.push({ name: 'update:' + table, args: values }); return q }
    return q
  }
  const mod = load('src/lib/integrations/automation/conversation.ts', {
    './data': { ...data, db: () => ({ from: table => query(table) }), autoConfig: async () => config,
      one: async table => table === 'conversations' ? { ...scope, lead_id: 'lead' } : lead,
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'register_inbound_message') return { lead_id: 'lead', conversation_id: 'conv', is_duplicate: options.duplicate === true }
        if (name === 'lv_app_conversation_context') return { propuestas: options.proposals || [], historial: options.history || [], mensaje_actual_at: new Date().toISOString() }
        if (name === 'lv_app_visit_preference') return options.slot || {}
        if (name === 'lv_apply_client_visit_intent') return options.applied || { action: 'reply', request_id: 'request', mensaje: 'Texto anterior que debe sustituirse' }
        if (name === 'save_lead_declarations') { Object.assign(lead, Object.fromEntries(Object.entries({ preferred_category: args.p_preferred_category, purchase_purpose: args.p_purchase_purpose }).filter(([, v]) => v != null))); return lead }
        if (name === 'lv_collect_visit_intake') return options.intake || { action: options.slot?.confidence === 'exact' ? 'submitted' : 'collecting', slot: options.slot || {} };
        if (name === 'lv_intake_visit_once') return 'appointment'
        if (name === 'process_financing_message_v2') return typeof options.financing === 'function' ? options.financing(args) : options.financing || { active: false }
        return {}
      },
    },
    './financing': { ...require('../src/lib/integrations/automation/financing.ts'), financingContext: async () => options.financeContext || ({ partners: ['Banco Pichincha'], current: {} }) },
    './sdr': { commercialContext: async lead => { calls.push({ name: 'commercialContext', args: structuredClone(lead) }); return {} },
      commercialReply: async () => ({ reply: 'Cuénteme, ¿lo busca para su negocio o para invertir?', audit: { fallback: false } }) },
    './ai': { activePrompt: async name => name === 'saludo_inicial' ? 'Hola, bienvenido a La Vilet. ¿Está buscando una vivienda o un local comercial?' : name, mediaText: async event => event.text,
      aiJson: async (prompt, input) => {
        calls.push({ name: 'ai', args: { prompt, input } })
        return prompt.startsWith('extractor_eventos') ? { events: [], opt_out: options.optOut === true, ...options.extracted }
          : prompt.startsWith('Clasifique') ? { intent: options.intent || 'question' }
            : prompt === 'revisor_respuesta' ? { aprobada: true } : {}
      } },
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

test('isolated greeting offers help without inventing commercial interest', async t => {
  live(t); const h = conversationHarness();
  await h.process([h.rows[0]], async () => {});
  assert.equal(h.calls.filter(c => c.name === 'apply_lead_events').length, 0);
  assert.equal(h.calls.filter(c => c.name === 'process_financing_message_v2').length, 0);
  assert.ok(JSON.stringify(h.calls.find(c => c.name === 'patch')).includes('En qué podemos ayudarle'));
});

test('a second greeting stays generic without scoring or assuming a category', async t => {
  live(t)
  const h = conversationHarness({ history: [{ role: 'bot', content: 'Hola, bienvenido a La Vilet.', sent_at: new Date(Date.now() - 60_000).toISOString() }] })
  h.rows[0].payload.text = 'Buenas tardes'
  await h.process([h.rows[0]], async () => {})
  const sent = h.calls.find(c => c.name === 'patch').args[2]
  assert.doesNotMatch(sent, /La Vilet|vivienda|local comercial/i)
  assert.equal(h.calls.filter(c => c.name === 'apply_lead_events').length, 0)
})

test('commercial reply receives the category and qualification declared in this same turn', async t => {
  live(t)
  const h = conversationHarness({ extracted: { preferred_category: 'local', purchase_purpose: 'negocio', declaration_evidence: { preferred_category: 'local', purchase_purpose: 'para una cafetería' }, qualification: { actividad_comercial: 'cafetería', area_buscada: '90 metros' } } })
  h.rows[0].payload.text = 'Quiero un local para una cafetería'
  await h.process([h.rows[0]], async () => {})
  const known = h.calls.find(c => c.name === 'commercialContext').args
  assert.equal(known.preferred_category, 'local')
  assert.deepEqual(known.behavior_signals.sdr, { actividad_comercial: 'cafetería' })
  assert.equal(h.calls.filter(c => c.name === 'handoff_lead').length, 0)
})

test('requesting a visit collects preferences before advisor notification', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'] } })
  h.rows[0].payload.text = 'Quiero ir a verlo'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.filter(c => c.name === 'lv_intake_visit_once').length, 0)
  assert.equal(h.calls.find(c => c.name === 'lv_collect_visit_intake').args.p_needs_help, false)
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /día y a qué hora/)
})

test('switching from a home to a local does not keep asking about bedrooms or assume residential use', async t => {
  live(t)
  const h = conversationHarness({ lead: { preferred_category: 'departamento', purchase_purpose: 'vivir', preferred_bedrooms: 2, behavior_signals: { sdr: { prioridad: 'terraza' } } },
    extracted: { preferred_category: 'local', declaration_evidence: { preferred_category: 'local' } } })
  h.rows[0].payload.text = 'Ahora prefiero un local'
  await h.process([h.rows[0]], async () => {})
  const known = h.calls.find(c => c.name === 'commercialContext').args
  assert.equal(known.preferred_category, 'local')
  assert.equal(known.purchase_purpose, null)
  assert.equal(known.preferred_bedrooms, null)
  assert.deepEqual(known.behavior_signals.sdr, {})
})

test('a preferred visit time records a request but never claims the appointment is confirmed', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'], preferred_visit_time_text: 'mañana a las diez' }, requests: [{ id: 'request', source_message_id: 'one' }], slot: { confidence: 'exact', start_time: '2026-09-11T15:00:00Z' } })
  h.rows[0].payload.text = 'Mañana a las diez'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.find(c => c.name === 'lv_collect_visit_intake').args.p_message, 'one')
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /revisaremos la disponibilidad.*a las 10 a\. m\./)
  assert.doesNotMatch(h.calls.find(c => c.name === 'patch').args[2], /agendad[oa]|confirmad[oa]/)
})

test('an existing visit cannot be described as a newly recorded preference', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'], preferred_visit_time_text: 'mañana a las diez' }, intake: { action: 'collecting', slot: { requested_date: '2026-09-11', has_time: false } } })
  h.rows[0].payload.text = 'Mañana a las diez'
  await h.process([h.rows[0]], async () => {})
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /A qué hora/i)
})

const sdrRules = require('../src/lib/integrations/automation/sdr-rules.ts')
const natural = require('../src/lib/integrations/automation/conversation-style.ts')
const intakeRules = require('../src/lib/integrations/automation/visit-intake.ts')
const financeRules = require('../src/lib/integrations/automation/financing.ts')

test('punctuation alone is an invitation to talk, never a product pitch', async t => {
  live(t)
  const h = conversationHarness()
  h.rows[0].payload.text = '.'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.find(c => c.name === 'patch').args[2], 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?')
  assert.equal(h.calls.some(c => c.name === 'ai'), false)
})

test('uncertainty requests advisor help once instead of another scheduling question', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'] }, intake: { action: 'submitted', needs_help: true, preferred_period: 'afternoon', slot: { requested_date: '2026-09-11' } } })
  h.rows[0].payload.text = 'No estoy seguro, pero mañana por la tarde'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.find(c => c.name === 'lv_collect_visit_intake').args.p_needs_help, true)
  const reply = h.calls.find(c => c.name === 'patch').args[2]
  assert.match(reply, /viernes 11.*tarde/)
  assert.doesNotMatch(reply, /\?|confirmamos|a las/)
})

test('closed days and partial dates never claim a registered appointment', () => {
  const closed = intakeRules.intakeReply({ action: 'closed_day', slot: { requested_date: '2026-09-13' } })
  assert.match(closed, /domingo.*no atendemos/)
  assert.doesNotMatch(closed, /registrad|confirmad/)
  assert.match(intakeRules.intakeReply({ action: 'collecting', slot: { requested_date: '2026-09-11' } }), /viernes.*A qué hora/)
})

test('financing interprets consent using the real last question and explains unsupported lenders', () => {
  const context = { partners: ['Banco Pichincha'], current: {} }
  assert.equal(financeRules.financingInputs({}, 'si claro', '¿Le gustaría que iniciemos una revisión de su caso?', context).consent, true)
  assert.notEqual(financeRules.financingInputs({}, 'si claro', '¿Le interesa un departamento?', context).consent, true)
  const answer = financeRules.financingInputs({}, 'con jardin zauayo', '¿Qué entidad prefiere?', context)
  assert.equal(answer.unsupported, 'Jardín Azuayo')
  assert.equal(answer.partner, null)
  const reply = financeRules.financingReply({ state: 'entidad_pendiente' }, context.partners, answer.unsupported)
  assert.match(reply, /no tenemos.*Jardín Azuayo.*Banco Pichincha/)
  assert.doesNotMatch(reply, /Con cuál entidad/)
  const twoPartners = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
  assert.equal(financeRules.financingInputs({}, 'con Pichincha', '', twoPartners).partner, 'Banco Pichincha')
  assert.equal(financeRules.financingInputs({ financing_partner: 'JEP' }, 'Pichincha no, prefiero JEP', '', twoPartners).partner, 'Cooperativa JEP')
  assert.equal(financeRules.financingInputs({ financing_partner: 'Jardín Azuayo' }, 'No con Pichincha, con Jardín Azuayo', '', twoPartners).unsupported, 'Jardín Azuayo')
})

test('financing only offers project agreements enabled for the current lead', async () => {
  const partners = [
    { test_only: true, test_phone: '+593987110032', financing_options: [{ name: 'Banco Pichincha' }, { name: 'Cooperativa JEP' }] },
    { test_only: false, financing_options: [{ name: 'Otra entidad' }] },
  ]
  const { financingContext } = load('src/lib/integrations/automation/financing.ts', {
    './data': { ...data, db: () => ({ from: table => {
      const query = { then: resolve => Promise.resolve({ data: table === 'project_financing_partners' ? partners : [], error: null }).then(resolve) }
      for (const method of ['select', 'match', 'eq', 'order', 'limit']) query[method] = () => query
      return query
    } }) },
  })
  assert.deepEqual((await financingContext({ id: 'one', phone: '+593 987110032' })).partners, ['Banco Pichincha', 'Cooperativa JEP', 'Otra entidad'])
  assert.deepEqual((await financingContext({ id: 'two', phone: '+593999999999' })).partners, ['Otra entidad'])
})

test('a request for scheduling help cannot pause the bot as a general advisor handoff', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'], requested_advisor: true, visit_needs_help: true },
    intake: { action: 'submitted', needs_help: true, slot: { requested_date: '2026-09-11' } } })
  h.rows[0].payload.text = 'Quiero visitar mañana, que el asesor me sugiera una hora'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.filter(c => c.name === 'handoff_lead').length, 0)
  assert.equal(h.calls.filter(c => c.name === 'lv_collect_visit_intake').length, 1)
})

test('Ecuador 17:45 is afternoon, not night, and names remain conversational', () => {
  assert.equal(natural.localGreeting('2026-09-10T22:45:00Z'), 'Buenas tardes')
  assert.match(natural.naturalConversationReply('Hola, buenas noches, Carlos Fabián.', 'Carlos Fabián', '', '2026-09-10T22:45:00Z'), /^Hola, Buenas tardes, Carlos\./)
})

test('courtesy after confirmation welcomes the visitor without restating the schedule', async t => {
  live(t)
  const h = conversationHarness({ proposals: [{ status: 'confirmed' }] })
  h.rows[0].payload.text = 'gracias'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.find(c => c.name === 'patch').args[2], 'Con mucho gusto, ¡le esperamos!')
  const changing = conversationHarness({ proposals: [{ status: 'confirmed' }], visitDraft: { status: 'collecting' } })
  changing.rows[0].payload.text = 'gracias'
  await changing.process([changing.rows[0]], async () => {})
  assert.equal(changing.calls.find(c => c.name === 'patch').args[2], 'Con mucho gusto.')
})

test('ambiguous input during a change asks the missing detail without offering the old proposal again', async t => {
  live(t)
  const h = conversationHarness({ proposals: [{ id: 'old', status: 'superseded' }], visitDraft: { status: 'collecting' }, intent: 'unclear',
    intake: { action: 'collecting', slot: { requested_date: '2026-09-11', has_time: false } } })
  h.rows[0].payload.text = 'sí'
  await h.process([h.rows[0]], async () => {})
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /viernes.*A qué hora/)
  assert.equal(h.calls.filter(c => c.name === 'lv_apply_client_visit_intent').length, 0)
})
test('thanks after a recorded preference closes briefly without scoring, repeating or asking again', async t => {
  live(t)
  const h = conversationHarness({ lead: { name: 'Carlos Fabián' }, proposals: [{ id: 'request', status: 'awaiting_advisor' }],
    history: [{ role: 'bot', content: 'Revisaremos el horario para mañana a las 10.', sent_at: new Date().toISOString() }] })
  h.rows[0].payload.text = 'Perfecto, muchas gracias'
  await h.process([h.rows[0]], async () => {})
  assert.equal(h.calls.find(c => c.name === 'patch').args[2], 'Con mucho gusto.')
  assert.equal(h.calls.filter(c => ['ai', 'lv_intake_visit_once', 'apply_lead_events'].includes(c.name)).length, 0)
})
test('a second courtesy cannot generate an endless acknowledgement loop', async t => {
  live(t)
  const h = conversationHarness({ history: [{ role: 'bot', content: 'Con mucho gusto.' }] })
  h.rows[0].payload.text = 'Gracias'
  assert.equal((await h.process([h.rows[0]], async () => {})).action, 'courtesy_already_acknowledged')
  assert.equal(h.calls.filter(c => c.name === 'launch').length, 0)
  const welcomed = conversationHarness({ history: [{ role: 'bot', content: 'Con mucho gusto, ¡le esperamos!' }] })
  welcomed.rows[0].payload.text = 'Gracias'
  assert.equal((await welcomed.process([welcomed.rows[0]], async () => {})).action, 'courtesy_already_acknowledged')
  assert.equal(welcomed.calls.filter(c => c.name === 'launch').length, 0)
})
test('thanks with a pending decision is classified rather than swallowed as a closing', async t => {
  live(t)
  const h = conversationHarness({ proposals: [{ id: 'request', status: 'awaiting_client', advisor_accepted_at: new Date(Date.now() - 120000).toISOString(), propuesta_enviada_at: new Date(Date.now() - 60000).toISOString() }],
    intent: 'accept', applied: { action: 'confirmed' } })
  h.rows[0].payload.text = 'Perfecto, gracias'
  assert.equal((await h.process([h.rows[0]], async () => {})).action, 'confirmed')
  assert.equal(h.calls.filter(c => c.name === 'launch').length, 0, 'Only the transactional visit outbox sends confirmation')
})
test('a new-day greeting with visit intent is returned before the coordination question', async t => {
  live(t)
  const h = conversationHarness({ extracted: { events: ['requested_visit'] }, history: [{ role: 'bot', content: 'Hasta pronto.', sent_at: new Date(Date.now() - 86_400_000).toISOString() }] })
  h.rows[0].payload.text = 'Buenos días, quiero agendar una cita'
  await h.process([h.rows[0]], async () => {})
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /^(?:Buenos días|Buenas tardes|Buenas noches)\. Con gusto/)
})
test('a counterproposal uses the resolved day and time instead of a generic registered-preference reply', async t => {
  live(t)
  const h = conversationHarness({ proposals: [{ id: 'request', status: 'awaiting_client' }], intent: 'counterproposal',
    slot: { confidence: 'exact', start_time: '2026-09-10T20:00:00Z', requested_date: '2026-09-10', has_time: true } })
  h.rows[0].payload.text = 'no puedo a esa hora, mejor a las 3'
  await h.process([h.rows[0]], async () => {})
  const reply = h.calls.find(c => c.name === 'patch').args[2]
  assert.match(reply, /jueves 10 de septiembre a las 3 p\. m\./)
  assert.doesNotMatch(reply, /\?|registramos|Texto anterior/)
})
test('cancel followed by reschedule in the same turn is classified using both messages and only asks the missing hour', async t => {
  live(t)
  const h = conversationHarness({ proposals: [{ id: 'request', status: 'awaiting_advisor' }], intent: 'counterproposal',
    slot: { confidence: 'date_only', requested_date: '2026-09-10', has_time: false } })
  h.rows[0].payload.text = 'Quiero cancelar mi cita'
  h.rows[1].payload.text = 'Bueno mejor quiero reagendar para hoy'
  await h.process(h.rows, async () => {})
  const classification = h.calls.find(c => c.name === 'ai' && c.args.prompt.startsWith('Clasifique'))
  assert.equal(classification.args.input.mensaje_cliente, 'Quiero cancelar mi cita\nBueno mejor quiero reagendar para hoy')
  const reply = h.calls.find(c => c.name === 'patch').args[2]
  assert.match(reply, /A qué hora/i)
  assert.doesNotMatch(reply, /Qué día|registramos|cancelad/)
})
test('style preserves decisions, answers and only the first name', () => {
  assert.equal(natural.isCourtesyOnly('De acuerdo'), false)
  assert.equal(natural.isCourtesyOnly('Gracias, pero mejor a las 4'), false)
  assert.equal(natural.naturalConversationReply('Claro, Carlos Fabián. ¿Qué día le queda bien?', 'Carlos Fabián', ''), 'Claro, Carlos. ¿Qué día le queda bien?')
  assert.match(natural.visitCoordinationReply({ has_time: true }), /Qué día/)
  assert.doesNotMatch(natural.visitCoordinationReply({ has_time: true }), /qué hora/)
})
test('prepared visits use the current project location, not a stale queued link', () => {
  const { prepareVisit } = require('../src/lib/integrations/automation/visit-rules.ts')
  const c = fixture()
  c.location = 'https://www.google.com/maps/search/?api=1&query=-2.892340%2C-79.030352'
  c.job.payload.location = 'https://kommo.cc/stale'
  const prepared = prepareVisit(c).job.payload.detail
  assert.ok(prepared.endsWith(c.location))
  assert.doesNotMatch(prepared, /kommo\.cc/)
})
test('an office visit keeps its meeting point when the project map changes', () => {
  const { prepareVisit } = require('../src/lib/integrations/automation/visit-rules.ts')
  const c = fixture()
  c.appointment.location_type = 'oficina'
  c.job.payload.location = 'https://www.google.com/maps/search/?api=1&query=-2.91%2C-79.02'
  c.location = 'https://www.google.com/maps/search/?api=1&query=-2.892340%2C-79.030352'
  assert.ok(prepareVisit(c).job.payload.detail.endsWith(c.job.payload.location))
})
test('old summary declarations cannot overwrite a new search without current text evidence', () => {
  const events = normalizeEvents({ preferred_category: 'suite', purchase_purpose: 'vivir', events: ['declared_unit_type'], declaration_evidence: { preferred_category: 'suite', purchase_purpose: 'vivir' } }, 'Unos 60 metros')
  assert.equal(events.preferred_category, null)
  assert.equal(events.purchase_purpose, null)
  assert.equal(events.events.includes('declared_unit_type'), false)
})
test('discovery uses known facts and never asks bedroom count for commercial property', () => {
  const lead = { preferred_category: 'local', purchase_purpose: 'negocio', behavior_signals: { sdr: { actividad_comercial: 'cafetería' } } }
  assert.equal(sdrRules.nextDiscoveryQuestion(lead).key, 'area_buscada')
  assert.equal(sdrRules.sdrState({ last_bot_message_at: new Date(Date.now() - 60_000).toISOString() }, []).ya_saludamos, true)
  assert.equal(sdrRules.sdrState({ last_bot_message_at: new Date(Date.now() - 86_400_000).toISOString() }, []).ya_saludamos, false)
  assert.equal(sdrRules.isGreetingOnly('¡Buenas tardes!'), true)
  assert.equal(sdrRules.isGreetingOnly('Hola, quiero saber el precio'), false)
})

test('a rejected draft is rewritten and reviewed before it can be sent', async () => {
  let drafts = 0, reviews = 0
  const { commercialReply } = load('src/lib/integrations/automation/sdr.ts', { './ai': {
    activePrompt: async name => name,
    draftReply: async () => ++drafts === 1 ? 'Hola de nuevo, somos La Vilet.' : 'Claro, ¿lo busca para su negocio o como inversión?',
    aiJson: async () => ({ aprobada: ++reviews > 1, motivos: reviews === 1 ? ['repeated_greeting'] : [] }),
  } })
  const result = await commercialReply({ conversacion: { ya_saludamos: true } }, 'Quiero algo comercial', {}, async () => {})
  assert.equal(drafts, 2); assert.equal(reviews, 2)
  assert.equal(result.audit.fallback, false)
  assert.doesNotMatch(result.reply, /Hola/)
})

test('two rejected drafts fall back to the relevant discovery question without copying claims', async () => {
  const { commercialReply } = load('src/lib/integrations/automation/sdr.ts', { './ai': {
    activePrompt: async name => name, draftReply: async () => 'Su cafetería tendrá rentabilidad garantizada.',
    aiJson: async () => ({ aprobada: false, motivos: ['unsupported_fact'] }),
  } })
  const result = await commercialReply({ siguiente_pregunta: { question: '¿Qué tamaño aproximado busca?' } }, 'Una cafetería', {}, async () => {})
  assert.equal(result.audit.fallback, true)
  assert.equal(result.reply, '¿Qué tamaño aproximado busca?')
})


test('confirmed appointment thanks and status questions cannot restart intake, even with a wrong extractor', async t => {
  live(t)
  for (const message of ['Muchas gracias, estaré puntual', 'Gracias, allí estaré', 'Ya quedamos en una cita o no?', 'Pero si ya dije\nYa quedamos en una cita o no?']) {
    const h = conversationHarness({ proposals: [{ status: 'confirmed', appointment_start_time: '2026-09-12T16:00:00Z' }],
      history: [{ role: 'bot', content: 'Su cita está confirmada.' }],
      extracted: { events: ['requested_visit', 'asked_financing'] }, financing: { active: true, state: 'continuacion_pendiente' } })
    h.rows[0].payload.text = message
    await h.process([h.rows[0]], async () => {})
    assert.equal(h.calls.filter(c => ['lv_collect_visit_intake','process_financing_message_v2','lv_apply_client_visit_intent'].includes(c.name)).length, 0, message)
    assert.match(h.calls.find(c => c.name === 'patch').args[2], /le esperamos|Le esperamos/)
  }
  assert.equal(natural.isCourtesyOnly('Muchas gracias, pero no podré asistir'), false)
  assert.equal(natural.isCourtesyOnly('Estaré puntual, ¿dónde queda?'), false)
})

test('No after cancellation closes the visit and never resumes saved financing', async t => {
  live(t)
  const h = conversationHarness({ history: [{ role: 'bot', content: 'No se preocupe, hemos cancelado la cita. ¿Le gustaría visitarnos más tarde o prefiere otro día?' }],
    financing: { active: true, state: 'continuacion_pendiente' }, extracted: { events: ['asked_financing', 'requested_visit'], financing_consent: false } })
  h.rows[0].payload.text = 'No'
  await h.process([h.rows[0]], async () => {})
  assert.match(h.calls.find(c => c.name === 'patch').args[2], /dejamos la cita cancelada/)
  assert.equal(h.calls.filter(c => ['lv_collect_visit_intake','process_financing_message_v2','set_tracking_preference'].includes(c.name)).length,0)
})

test('a saved financial form does not intercept commercial questions or unrelated No', async t => {
  live(t)
  for (const message of ['¿Dónde está el edificio?', 'No']) {
    const h = conversationHarness({ financing: { active: true, state: 'continuacion_pendiente' },
      history: [{ role: 'bot', content: '¿Desea conocer el departamento?' }], extracted: { events: ['asked_financing'], financing_consent: true } })
    h.rows[0].payload.text = message
    await h.process([h.rows[0]], async () => {})
    assert.equal(h.calls.filter(c => c.name === 'process_financing_message_v2').length,0)
    assert.equal(h.calls.filter(c => c.name === 'commercialContext').length,1)
  }
})

test('JEP choice is acknowledged and next consent advances the saved form', async t => {
  live(t)
  const context = { partners: ['Banco Pichincha','Cooperativa JEP'], current: { explicit_consent: false } }
  const history = [{ role:'bot', content:'Por el momento no tenemos una alianza registrada con Jardín Azuayo. ¿Le gustaría revisar esa opción?' }]
  const options = { financeContext: context, history, extracted: {}, financing(args) {
    if(args.p_financing_partner) context.current.selected_partner_name=args.p_financing_partner
    if(args.p_financing_consent === true) context.current.explicit_consent=true
    return { active:true, state: context.current.explicit_consent ? 'cedula_pendiente' : 'continuacion_pendiente', selected_partner_name:context.current.selected_partner_name }
  } }
  const h=conversationHarness(options)
  h.rows[0].payload.text='Con la jep'
  await h.process([h.rows[0]],async()=>{})
  let reply=h.calls.filter(c=>c.name==='patch').at(-1).args[2]
  assert.match(reply,/continuar con Cooperativa JEP/)
  assert.doesNotMatch(reply,/Pichincha/)
  assert.equal(context.current.explicit_consent,false,'Choosing a bank alone is not blanket consent')
  history.push({role:'cliente',content:'Con la jep'},{role:'bot',content:reply})
  h.rows[1].payload.text='Sí claro'
  await h.process([h.rows[1]],async()=>{})
  reply=h.calls.filter(c=>c.name==='patch').at(-1).args[2]
  assert.match(reply,/cédula/)
  assert.equal(context.current.explicit_consent,true)
})

test('asking whether only those banks are offered answers the question without repeating consent', async t => {
  live(t)
  const h=conversationHarness({ financeContext:{partners:['Banco Pichincha','Cooperativa JEP'],current:{}}, financing:{active:true,state:'continuacion_pendiente'}, extracted:{events:['asked_financing']} })
  h.rows[0].payload.text='Si está bien, pero sólo con esas entidades?'
  await h.process([h.rows[0]],async()=>{})
  assert.match(h.calls.find(c=>c.name==='patch').args[2],/alianzas registradas/)
  assert.doesNotMatch(h.calls.find(c=>c.name==='patch').args[2],/iniciemos/)
})

test('complaints and question marks recover the selected bank without reopening the form or greeting', async t => {
  live(t)
  for(const message of ['??','Ya te dije','Por qué repites?','pero eso no fue lo que yo pregunte']) {
    const h=conversationHarness({financeContext:{partners:['Banco Pichincha','Cooperativa JEP'],current:{selected_partner_name:'Cooperativa JEP',explicit_consent:false}},
      history:[{role:'bot',content:'¿Le gustaría que iniciemos una revisión de su caso?'}], extracted:{events:['asked_financing','requested_visit']} })
    h.rows[0].payload.text=message
    await h.process([h.rows[0]],async()=>{})
    assert.match(h.calls.find(c=>c.name==='patch').args[2],/Ya tengo registrada su elección de Cooperativa JEP/)
    assert.equal(h.calls.filter(c=>['process_financing_message_v2','lv_collect_visit_intake'].includes(c.name)).length,0)
  }
})

test('a stale extracted lender is not accepted as a new choice',()=>{
  const context={partners:['Banco Pichincha','Cooperativa JEP'],current:{}}
  assert.equal(financeRules.financingInputs({financing_partner:'Cooperativa JEP'},'quiero una cita','',context).partner,null)
  assert.equal(financeRules.financingInputs({financing_partner:'Banco Pichincha'},'con la JEP','',context).partner,'Cooperativa JEP')
})

test('advisor handoff stays paused and never sends an automatic thanks afterwards',async t=>{
  live(t)
  const h=conversationHarness({lead:{bot_enabled:false,handoff_status:'assigned'}})
  h.rows[0].payload.text='muchas gracias'
  assert.equal((await h.process([h.rows[0]],async()=>{})).action,'bot_paused')
  assert.equal(h.calls.filter(c=>c.name==='launch').length,0)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), originalLoad = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText, filename)
function load(relative, mocks) {
  const file = path.join(root, relative), m = { exports: {} }, req = Module.createRequire(file)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : req(id), m, m.exports)
  return m.exports
}
const rules = require('../src/lib/integrations/automation/nutrition-week-one-rules.ts')
const config = require('../src/lib/inmobiliaria/nutritionWeekOne.ts')
const laterConfig = require('../src/lib/inmobiliaria/nutritionLater.ts')
const laterRules = require('../src/lib/integrations/automation/nutrition-later-rules.ts')
const data = require('../src/lib/integrations/automation/data.ts')
const c = { ...config.nutritionWeekOneConfig(null), enabled: true, activatedAt: '2026-09-01T00:00:00Z' }
const catalog = [{ id: 'unit', unit_number: '202', category: 'departamento' }, { id: 'unit2', unit_number: '203', category: 'departamento' }, { id: 'local', unit_number: 'LC-11', category: 'local' }]
const history = content => [{ role: 'cliente', content }]
const choose = (input, h, shared, overrides = {}) => rules.weekOneChoice({ ...c, ...input }, overrides.lead || {}, h, overrides.outbound || [], overrides.catalog || catalog, shared, { financing: true, visits: true })
test('brochure is preferred once, sent evidence ignores inbound promises and rejects failed sends', () => {
  assert.equal(choose({}, history('Quiero financiamiento'), false).kind, 'brochure')
  assert.equal(rules.sharedBrochure(history(config.WEEK_ONE_BROCHURE_URL)), false)
  assert.equal(rules.sharedBrochure([{ role: 'bot', content: 'Podemos enviarle el brochure' }]), false)
  assert.equal(rules.sharedBrochure([{ role: 'asesor', media_url: 'https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf' }]), true)
  assert.equal(rules.sharedBrochure([{ role: 'bot', content: config.WEEK_ONE_BROCHURE_BODY, tool_calls: { provider_status: 'rejected' } }]), false)
  assert.equal(rules.sharedBrochure([], [{ behavior_signals: { _nutrition_resources: { brochure: true } } }]), true)
})
test('followup is short and relevant, never a second brochure or an unsupported invented option', () => {
  const chosen = choose({}, history('Me interesa el departamento 202'), true)
  assert.equal(chosen.topic, 'conocer la distribución del departamento 202')
  assert.equal(chosen.body, config.WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', chosen.topic))
  assert.doesNotMatch(chosen.body, /https:|brochure/)
  assert.equal(choose({ alreadyShared: 'skip' }, history('202'), true), null)
  assert.equal(choose({}, history('Gracias'), true), null)
  assert.equal(choose({ comparison: false }, history('Quiero el departamento 999'), true), null)
  assert.equal(choose({ financing: false }, history('Crédito por favor'), true), null)
  assert.equal(choose({}, history('No necesito financiamiento, pago de contado'), true), null)
  const changed = choose({}, [...history('Quiero financiamiento para el departamento 202'), ...history('Mejor quiero la suite 210')], true, { lead: { unit_id: 'unit', preferred_category: 'departamento' }, catalog: [...catalog, { id: 'suite', unit_number: '210', category: 'suite' }] })
  assert.equal(changed.topic, 'conocer la distribución de la suite 210')
})
test('acceptance follows the actual offer; questions, rejection and mixed replies remain intact', () => {
  for (const topic of ['conocer la distribución del departamento 202', 'comparar las opciones de departamentos disponibles', 'coordinar una visita a nuestra oficina', 'revisar las opciones de financiamiento disponibles']) {
    const h = [{ id: 'offer', role: 'bot', content: config.WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', topic) }]
    for (const yes of ['Sí', 'Sí, por favor', 'Hola, sí gracias', 'Perfecto', 'Me interesa']) assert.equal(rules.nutritionContinuation(yes, h).topic, topic)
    for (const reply of ['No', 'No gracias', 'Sí, pero cuánto cuesta y tiene parqueadero?', 'Mejor quiero una suite', 'Solo si me aprueban', 'Para mañana a las 11', 'Y el local?']) assert.equal(rules.nutritionContinuation(reply, h), null)
    assert.equal(rules.nutritionContinuation('Sí', [...h, { role: 'asesor', content: '¿Le llamo?' }]), null)
  }
  assert.equal(rules.nutritionContinuation('Sí', [{ role: 'bot', content: config.WEEK_ONE_BROCHURE_BODY }]), null)
})
test('accepting financial information never initiates a credit application', () => {
  const { financingInputs } = require('../src/lib/integrations/automation/financing.ts')
  const offer = config.WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', 'revisar las opciones de financiamiento disponibles')
  const result = rules.nutritionContinuation('Sí por favor', [{ role: 'bot', content: offer }])
  assert.equal(financingInputs({ financing_consent: true }, result.message, offer, { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }).consent, null)
})
test('template and field identity survive a rename, but changed content or review fails closed', () => {
  const { approvedWeekOneTemplate } = require('../src/lib/integrations/automation/kommo.ts')
  for (const kind of ['brochure', 'followup']) {
    const template = { id: config.WEEK_ONE_ROUTES[kind].templateId, name: 'Renombrada', type: 'waba', content: kind === 'brochure' ? config.WEEK_ONE_BROCHURE_BODY : config.WEEK_ONE_FOLLOWUP_BODY.replace('{{1}}', '{{lead.cf.530950}}'), _embedded: { reviews: [{ status: 'approved' }] } }
    assert.equal(approvedWeekOneTemplate(template, kind), true)
    for (const bad of [{ ...template, id: 8 }, { ...template, type: 'amocrm' }, { ...template, content: 'otro' }, { ...template, attachment: {} }, { ...template, _embedded: { reviews: [{ status: 'pending' }] } }]) assert.equal(approvedWeekOneTemplate(bad, kind), false)
  }
})
function harness(options = {}) {
  const calls = [], queries = [], jobs = new Map(); let patched = false
  const lead = { ...data.scope, id: 'lead', kommo_id: 123, contact_id: '456', bot_enabled: true, tracking_consent: true, handoff_status: 'none', channel_origin: 'whatsapp', ...options.lead }
  const policy = { ...c, ...options.config }
  const week = options.week || 1
  const laterPolicy = { 2: { enabled: true, activatedAt: '2026-08-01T00:00:00Z' }, 3: { enabled: true, activatedAt: '2026-08-01T00:00:00Z' }, ...options.laterPolicy }
  const payload = { task: week === 1 ? 'nutrition_week_one' : laterConfig.LATER_ROUTES[week].task, leadId: 'lead', conversationId: 'conv', kommoId: 123, anchorId: 'client', anchorAt: new Date(Date.parse('2026-09-15T15:00:00Z') - week * 7 * 86400000).toISOString(), activatedAt: week === 1 ? policy.activatedAt : laterPolicy[week].activatedAt }
  const bot = { id: 'answer', role: 'bot', content: options.shared ? config.WEEK_ONE_BROCHURE_BODY : 'Tenemos varias opciones.', sent_at: '2026-09-08T15:01:00Z' }
  const h = [{ id: 'client', role: 'cliente', external_message_id: 'external', content: options.clientText || 'Me interesa el departamento 202', sent_at: payload.anchorAt }, bot]
  const outbound = [bot, ...(options.outbound || [])]
  const query = table => {
    const filters = [], q = {}; let operation = 'read', value
    for (const method of ['select', 'match', 'eq', 'in', 'order', 'limit', 'not', 'or', 'range', 'contains', 'maybeSingle']) q[method] = (...args) => { filters.push([method, ...args]); return q }
    q.upsert = v => { operation = 'upsert'; value = v; for (const row of Array.isArray(v) ? v : [v]) if (!jobs.has(row.event_key)) jobs.set(row.event_key, row); return q }
    q.update = v => { operation = 'update'; value = v; return q }
    q.then = (resolve, reject) => {
      queries.push({ table, filters, operation, value })
      const eq = key => filters.find(f => f[0] === 'eq' && f[1] === key)?.[2]
      let result = []
      if (table === 'projects') result = { policies_json: { nutrition_week_one: patched && options.disableAfterPatch ? { ...policy, enabled: false } : policy,
        nutrition_later: patched && options.disableAfterPatch ? { 2: { ...laterPolicy[2], enabled: false }, 3: { ...laterPolicy[3], enabled: false } } : laterPolicy } }
      if (table === 'project_automation_config') result = { business_hours: { '1': { open: '09:00', close: '18:00' }, '2': { open: '09:00', close: '18:00' } }, mode: 'lanzamiento' }
      if (table === 'leads') result = [lead, ...(options.related || [])]
      if (table === 'conversations') result = [{ id: options.newConversation && eq('lead_id') ? 'new' : 'conv' }]
      if (table === 'messages') result = filters.some(f => f[0] === 'range') ? outbound : eq('role') === 'cliente' ? [options.otherContactInput && filters.some(f => f[0] === 'in' && f[1] === 'conversation_id') ? { id: 'other-input' } : h[0]] : [...h, ...(patched && options.inputAfterPatch ? [{ id: 'new', role: 'cliente' }] : [])].reverse()
      if (table === 'appointments') result = options.visit ? [{ id: 'visit' }] : []
      if (table === 'lv_visit_intakes') { assert.equal(filters.find(f => f[0] === 'select')[1], 'conversation_id'); result = options.draft ? [{ conversation_id: 'conv' }] : [] }
      if (table === 'lv_outbox') result = options.visitJob ? [{ id: 'job' }] : []
      if (table === 'financing_prequalifications') result = options.financeConsent ? [{ id: 'finance' }] : []
      if (table === 'units') result = catalog
      if (table === 'lv_integration_events') result = eq('kind') === 'inbound' ? options.pendingInput ? [{ id: 'input' }] : [] : filters.some(f => f[0] === 'select' && f[1] === 'available_at') ? options.earlier || [] : options.attempts || []
      return Promise.resolve({ data: result, error: null }).then(resolve, reject)
    }
    return q
  }
  const mod = load('src/lib/integrations/automation/nutrition-week-one.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ testLeadId: null }) },
    './financing': { financingContext: async () => ({ partners: ['Banco Pichincha'], current: {} }) },
    './data': { ...data, db: () => ({ from: query }), autoConfig: async () => ({ enabled: true, dry_run: false, test_only: false }), one: async table => table === 'leads' ? lead : { ...data.scope, id: 'conv', lead_id: lead.id }, rpc: async (name, args) => { calls.push({ name, args }); if (options.receiptFails) throw Error('RECEIPT_FAILED'); return {} } },
    './kommo': { getKommoLead: async () => ({}), botStopped: () => !!options.remoteStopped, verifyWeekOneTemplates: async () => ({ brochure: options.approved !== false, followup: options.approved !== false }), setKommoField: async (...args) => { calls.push({ name: 'patch', args }); patched = true }, launchSalesbot: async (...args) => { calls.push({ name: 'launch', args }); if (options.timeout) throw Error('TIMEOUT') } },
  })
  const later = load('src/lib/integrations/automation/nutrition-later.ts', {
    './config': { assertLive() {} }, './nutrition-week-one': mod,
    './data': { ...data, db: () => ({ from: query }), one: async table => table === 'leads' ? lead : { ...data.scope, id: 'conv', lead_id: lead.id }, rpc: async (name, args) => { calls.push({ name, args }); if (options.receiptFails) throw Error('RECEIPT_FAILED'); return {} } },
    './kommo': { getKommoLead: async () => ({}), botStopped: () => !!options.remoteStopped, verifyLaterTemplates: async () => ({ 2: options.approved !== false, 3: options.approved !== false }), setKommoField: async (...args) => { calls.push({ name: 'patch', args }); patched = true }, launchSalesbot: async (...args) => { calls.push({ name: 'launch', args }); if (options.timeout) throw Error('TIMEOUT') } },
  })
  return { ...mod, ...later, calls, queries, jobs, payload }
}
const fixedClock = t => t.mock.method(Date, 'now', () => Date.parse('2026-09-15T15:00:00Z'))
const readyLink = t => t.mock.method(global, 'fetch', async () => ({ ok: true, url: 'https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf', headers: new Headers({ 'content-type': 'application/pdf' }) }))
test('new turn schedules once at seven days, no launch or old-input backfill; cancellation targets pending week1 only', async t => {
  fixedClock(t)
  const h = harness()
  for (let i = 0; i < 2; i++) await h.scheduleNutritionWeekOne('lead', 'conv', 'external')
  assert.equal(h.jobs.size, 1)
  assert.equal([...h.jobs.values()][0].available_at, '2026-09-15T15:00:00.000Z')
  assert.equal([...h.jobs.values()][0].contact_key, null)
  assert.equal((await h.scheduleNutritionWeekOne('lead', 'conv', 'old')).scheduled, false)
  assert.equal((await harness({ config: { activatedAt: '2026-09-10T00:00:00Z' } }).scheduleNutritionWeekOne('lead', 'conv', 'external')).scheduled, false)
  await h.cancelNutritionWeekOne(123)
  const cancel = h.queries.find(q => q.operation === 'update')
  assert.ok(cancel.filters.some(f => f[0] === 'contains' && f[2].task === 'nutrition_week_one'))
  assert.ok(cancel.filters.some(f => f[1] === 'status' && f[2] === 'pending'))
  assert.equal(h.calls.length, 0)
})
test('exactly one Salesbot runs, followup field precedes send, actual copy and purpose are saved', async t => {
  fixedClock(t); readyLink(t)
  for (const shared of [false, true]) {
    const h = harness({ shared }), result = await h.sendNutritionWeekOne({ payload: h.payload }, async () => {})
    assert.equal(result.action, 'accepted')
    assert.deepEqual(h.calls.filter(c => c.name === 'launch').map(c => c.args), [[123, shared ? 21394 : 21392]])
    const receipt = h.calls.find(c => c.name === 'register_outbound_message').args
    assert.equal(receipt.p_model, 'template:nutrition_week_one')
    assert.equal(receipt.p_tool_calls.nutrition_week_one.kind, shared ? 'followup' : 'brochure')
    if (shared) { assert.deepEqual(h.calls[0].args, [123, 530950, 'conocer la distribución del departamento 202']); assert.match(receipt.p_content, /Podemos ayudarle a conocer la distribución/); assert.doesNotMatch(receipt.p_content, /brochure/) }
    else { assert.equal(h.calls.some(c => c.name === 'patch'), false); assert.equal(receipt.p_content, config.WEEK_ONE_BROCHURE_BODY) }
  }
})
test('pauses, no consent, visits, evaluation, pending input and uncertain sends block nutrition', async t => {
  fixedClock(t); readyLink(t)
  for (const options of [{ lead: { tracking_consent: false } }, { lead: { tracking_opt_out_at: 'now' } }, { lead: { bot_enabled: false } }, { lead: { handoff_status: 'assigned' } }, { related: [{ id: 'other', kommo_id: 2, bot_enabled: false }] }, { draft: true }, { visit: true }, { visitJob: true }, { financeConsent: true }, { pendingInput: true }, { newConversation: true }, { remoteStopped: true }, { approved: false }, { attempts: [{ status: 'uncertain' }] }, { outbound: [{ role: 'bot', tool_calls: { nutrition_week_one: { kind: 'followup' } } }] }]) {
    const h = harness(options)
    assert.equal((await h.sendNutritionWeekOne({ payload: h.payload }, async () => {})).action, 'cancelled', JSON.stringify(options))
    assert.equal(h.calls.some(c => c.name === 'launch'), false)
  }
})
test('brochure from another conversation is remembered and frequency is shared with 24h', async t => {
  fixedClock(t); readyLink(t)
  const h = harness({ outbound: [{ role: 'asesor', content: config.WEEK_ONE_BROCHURE_URL, sent_at: '2026-08-01T15:00:00Z' }] })
  assert.equal((await h.sendNutritionWeekOne({ payload: h.payload }, async () => {})).kind, 'followup')
  const recent = harness({ attempts: [{ status: 'completed', result: { action: 'accepted' }, completed_at: '2026-09-09T15:00:00Z' }] })
  const result = await recent.sendNutritionWeekOne({ payload: recent.payload }, async () => {})
  assert.equal(result.action, 'deferred')
  assert.ok(Date.parse(result.nextAt) >= Date.parse('2026-09-16T15:00:00Z'))
  assert.equal(recent.calls.length, 0)
  const changed = harness({ otherContactInput: true })
  assert.equal((await changed.sendNutritionWeekOne({ payload: changed.payload }, async () => {})).reason, 'new_context')
  assert.equal(changed.calls.length, 0)
})
test('context changed during field write prevents send; unacknowledged delivery never retries', async t => {
  fixedClock(t)
  for (const options of [{ inputAfterPatch: true }, { disableAfterPatch: true }]) {
    const h = harness({ shared: true, ...options })
    assert.equal((await h.sendNutritionWeekOne({ payload: h.payload }, async () => {})).action, 'cancelled')
    assert.equal(h.calls.filter(c => c.name === 'patch').length, 1)
    assert.equal(h.calls.some(c => c.name === 'launch'), false)
  }
  for (const options of [{ timeout: true }, { receiptFails: true }]) {
    const h = harness({ shared: true, ...options })
    await assert.rejects(h.sendNutritionWeekOne({ payload: h.payload }, async () => {}))
    assert.equal(h.calls.filter(c => c.name === 'launch').length, 1)
  }
})
test('a missing or private brochure link blocks its campaign instead of sending a broken link', async t => {
  fixedClock(t)
  t.mock.method(global, 'fetch', async () => ({ ok: true, url: 'https://www.lavilett.com/login', headers: new Headers({ 'content-type': 'text/html' }) }))
  const h = harness()
  assert.equal((await h.sendNutritionWeekOne({ payload: h.payload }, async () => {})).reason, 'brochure_link_unavailable')
  assert.equal(h.calls.length, 0)
})

test('week two variable describes purpose without old action verbs or inventing a purpose', () => {
  assert.equal(laterRules.laterChoice(2, {}, history('No es para vivir, es para invertir'), [], []).topic, 'una propiedad para invertir')
  assert.equal(laterRules.laterChoice(2, {}, history('Para invertir, no para vivir'), [], []).topic, 'una propiedad para invertir')
  for (const [lead, input, expected] of [[{}, 'Quiero algo para vivir', 'un nuevo hogar'], [{}, 'Busco un local para mi negocio', 'un local para su negocio'], [{}, 'Para invertir y arrendar', 'una propiedad para invertir'], [{}, 'Busco un local', 'un local comercial'], [{}, 'Gracias', 'el espacio adecuado para usted'], [{ purchase_purpose: 'invertir' }, 'Ahora quiero algo para vivir', 'un nuevo hogar']]) {
    const choice = laterRules.laterChoice(2, lead, history(input), [], [])
    assert.equal(choice.topic, expected)
    assert.match(choice.body, new RegExp('Sabemos que elegir ' + expected))
  }
})
test('week three chooses a new next step, avoids repeating financing and skips exhausted offers', () => {
  const h = history('Me interesa comprar un departamento pero no sé si me alcanza')
  assert.equal(laterRules.laterChoice(3, {}, h, [], ['JEP']).action, 'financing_options')
  const finance = [{ role: 'bot', content: 'Puede revisar financiamiento con JEP.' }]
  assert.equal(laterRules.laterChoice(3, {}, h, finance, ['JEP']).action, 'purchase_process')
  const steps = [...finance, { role: 'bot', content: 'Le explico el proceso de compra.' }]
  assert.equal(laterRules.laterChoice(3, {}, h, steps, ['JEP']).action, 'advisor_conversation')
  assert.equal(laterRules.laterChoice(3, {}, h, [...steps, { role: 'bot', content: 'Podemos coordinar una conversación con un asesor.' }], ['JEP']), null)
})
test('week two and three accepted templates require exact bodies, fields and the known image only', () => {
  const { approvedLaterTemplate } = require('../src/lib/integrations/automation/kommo.ts')
  for (const week of [2, 3]) {
    const route = laterConfig.LATER_ROUTES[week]
    const template = { id: route.templateId, type: 'waba', content: route.body.replace('{{1}}', `{{lead.cf.${route.fieldId}}}`), attachment: route.attachmentId ? { id: route.attachmentId, type: 'picture' } : null, _embedded: { reviews: [{ status: 'approved' }] } }
    assert.equal(approvedLaterTemplate(template, week), true)
    for (const bad of [{ ...template, content: '{{lead.cf.530952}}' }, { ...template, attachment: { id: 'different', type: 'picture' } }, { ...template, _embedded: { reviews: [] } }, { ...template, type: 'amocrm' }]) assert.equal(approvedLaterTemplate(bad, week), false)
  }
})
test('new stages schedule 14 and 21 days, cancel only their pending jobs, never week four', async t => {
  fixedClock(t)
  const h = harness({ week: 2 })
  await h.scheduleNutritionLater('lead', 'conv', 'external'); await h.scheduleNutritionLater('lead', 'conv', 'external')
  assert.equal(h.jobs.size, 2)
  assert.deepEqual([...h.jobs.values()].map(j => j.available_at), ['2026-09-15T15:00:00.000Z', '2026-09-22T15:00:00.000Z'])
  assert.ok([...h.jobs.values()].every(j => j.contact_key === null && !j.payload.task.includes('four')))
  await h.cancelNutritionLater(123)
  const cancel = h.queries.find(q => q.operation === 'update')
  assert.deepEqual(cancel.filters.find(f => f[0] === 'in' && f[1] === 'payload->>task')[2], ['nutrition_week_two', 'nutrition_week_three'])
  const disabled = harness({ laterPolicy: { 2: { enabled: false }, 3: { enabled: false } } })
  assert.equal((await disabled.scheduleNutritionLater('lead', 'conv', 'external')).scheduled, false)
  assert.equal(h.calls.length, 0)
})
test('each later week patches its own field and launches only its corresponding bot', async t => {
  fixedClock(t)
  for (const week of [2, 3]) {
    const h = harness({ week, lead: { purchase_purpose: 'vivir' } })
    const result = await h.sendNutritionLater({ payload: h.payload }, async () => {})
    assert.equal(result.action, 'accepted')
    assert.deepEqual(h.calls.find(c => c.name === 'launch').args, [123, week === 2 ? 21446 : 21452])
    assert.equal(h.calls.find(c => c.name === 'patch').args[1], week === 2 ? 530952 : 530954)
    const receipt = h.calls.find(c => c.name === 'register_outbound_message').args
    assert.equal(receipt.p_content, result.body)
    assert.equal(receipt.p_tool_calls[laterConfig.LATER_ROUTES[week].task].week, week)
    assert.equal(h.calls.filter(c => c.name === 'launch').length, 1)
  }
})
test('later weeks respect pauses, previous sends, context changes, approval and uncertainty', async t => {
  fixedClock(t)
  for (const week of [2, 3]) for (const options of [{ remoteStopped: true }, { approved: false }, { pendingInput: true }, { visit: true }, { financeConsent: true }, { lead: { tracking_consent: false } }, { inputAfterPatch: true }, { disableAfterPatch: true }, { attempts: [{ status: 'uncertain' }] }, { outbound: [{ role: 'bot', tool_calls: { [laterConfig.LATER_ROUTES[week].task]: { week } } }] }]) {
    const h = harness({ week, ...options })
    assert.equal((await h.sendNutritionLater({ payload: h.payload }, async () => {})).action, 'cancelled', JSON.stringify({ week, options }))
    assert.equal(h.calls.some(c => c.name === 'launch'), false)
  }
  const uncertain = harness({ week: 3, timeout: true })
  await assert.rejects(uncertain.sendNutritionLater({ payload: uncertain.payload }, async () => {}), /TIMEOUT/)
  assert.equal(uncertain.calls.filter(c => c.name === 'launch').length, 1)
})
test('week three waits for deferred earlier weeks and shares a seven-day frequency cap', async t => {
  fixedClock(t)
  for (const options of [{ earlier: [{ available_at: '2026-09-17T15:00:00Z' }] }, { attempts: [{ status: 'completed', result: { action: 'accepted' }, completed_at: '2026-09-14T15:00:00Z' }] }]) {
    const h = harness({ week: 3, ...options })
    const result = await h.sendNutritionLater({ payload: h.payload }, async () => {})
    assert.equal(result.action, 'deferred')
    assert.ok(Date.parse(result.nextAt) >= Date.parse('2026-09-21T15:00:00Z'))
    assert.equal(h.calls.length, 0)
  }
})
test('answers follow later offers without turning yes into credit consent or overriding new questions', () => {
  const { financingInputs } = require('../src/lib/integrations/automation/financing.ts')
  for (const [week, topic] of [[2, 'un nuevo hogar'], [3, 'conocer las alternativas de financiamiento'], [3, 'revisar el proceso de compra del inmueble que le interesa'], [3, 'coordinar una conversación con un asesor']]) {
    const body = laterConfig.LATER_ROUTES[week].body.replace('{{1}}', topic)
    const h = [{ id: 'offer', role: 'bot', content: body }]
    const continuation = rules.nutritionContinuation('Sí, por favor', h)
    assert.equal(continuation.topic, topic)
    assert.equal(financingInputs({ financing_consent: true }, continuation.message, body, { partners: ['JEP'], current: {} }).consent, null)
    assert.equal(financingInputs({ financing_consent: true, financing_partner: 'JEP' }, 'Sí, con JEP', body, { partners: ['JEP'], current: {} }).consent, null)
    for (const reply of ['No gracias', 'Sí, pero cuánto cuesta y tiene parqueadero?', 'Mañana a las 8', 'Quiero un local']) assert.equal(rules.nutritionContinuation(reply, h), null)
  }
})

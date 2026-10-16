/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
require('./test-typescript.cjs')
const root = path.resolve(__dirname, '..')
function load(relative, mocks = {}) {
  const filename = path.join(root, relative), m = { exports: {} }, req = Module.createRequire(filename)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : req(id), m, m.exports)
  return m.exports
}
const data = require('../src/lib/integrations/automation/data.ts')

test('wakeup uses committed receiver keys, ignores unresolved invalid keys and surfaces read failures', async () => {
  const calls = [], q = {}, result = { error: null, data: [{ contact_key: '42:100' }, { contact_key: '42:100' }, { contact_key: 'contact:101' }, { contact_key: '0:100' }] }
  for (const method of ['select', 'match', 'eq', 'abortSignal']) q[method] = () => q
  q.in = (field, values) => { calls.push([field, values]); return q }
  q.then = resolve => Promise.resolve(result).then(resolve)
  const { persistedWakeupContacts } = load('src/lib/integrations/automation/persisted-wakeup.ts', { './data': { ...data, db: () => ({ from: () => q }) } })
  assert.deepEqual(await persistedWakeupContacts(['client'], ['manual']), ['42:100', 'contact:101'])
  assert.deepEqual(calls[0], ['event_key', ['inbound:client', 'advisor_outbound:manual']])
  result.error = { code: '503' }
  await assert.rejects(persistedWakeupContacts([], ['manual']), /PERSISTED_WAKEUP_READ_FAILED/)
})

test('admission rejects missing, excessive, negative and fractional slots without a provider call', async () => {
  for (const delay of [undefined, null, -1, 1.5, 10_001]) {
    const { reserveKommoCall } = load('src/lib/integrations/automation/kommo-admission.ts', { './data': { rpc: async () => delay } })
    await assert.rejects(reserveKommoCall(), /KOMMO_ADMISSION_FAILED/)
  }
  const { reserveKommoCall } = load('src/lib/integrations/automation/kommo-admission.ts', { './data': { rpc: async () => 0 } })
  await reserveKommoCall()
})

test('SQL admission failure before POST is a known local rejection, with no bot launch or retry', async t => {
  const previousUrl = process.env.KOMMO_BASE_URL, previousToken = process.env.KOMMO_ACCESS_TOKEN
  process.env.KOMMO_BASE_URL = 'https://lavilet.kommo.com'; process.env.KOMMO_ACCESS_TOKEN = 'synthetic'
  t.after(() => { if (previousUrl === undefined) delete process.env.KOMMO_BASE_URL; else process.env.KOMMO_BASE_URL = previousUrl; if (previousToken === undefined) delete process.env.KOMMO_ACCESS_TOKEN; else process.env.KOMMO_ACCESS_TOKEN = previousToken })
  let calls = 0
  t.mock.method(global, 'fetch', async () => { calls++; throw Error('UNEXPECTED_PROVIDER_CALL') })
  const p = load('src/lib/integrations/automation/kommo.ts', { './config': { assertLive() {} },
    './kommo-admission': { reserveKommoCall: async () => { throw Error('RPC_LV_APP_RESERVE_KOMMO_CALL_PGRST202') } } })
  await assert.rejects(p.launchSalesbot(42, 15578), error => error.message === 'KOMMO_ADMISSION_FAILED' && error.uncertain === false && error.operation === 'launch_bot')
  assert.equal(calls, 0)
})

test('temporary field updates are retried before launch; Salesbot retries only an explicit 429 rejection', async t => {
  const previousUrl = process.env.KOMMO_BASE_URL, previousToken = process.env.KOMMO_ACCESS_TOKEN
  process.env.KOMMO_BASE_URL = 'https://lavilet.kommo.com'; process.env.KOMMO_ACCESS_TOKEN = 'synthetic'
  t.after(() => { if (previousUrl === undefined) delete process.env.KOMMO_BASE_URL; else process.env.KOMMO_BASE_URL = previousUrl; if (previousToken === undefined) delete process.env.KOMMO_ACCESS_TOKEN; else process.env.KOMMO_ACCESS_TOKEN = previousToken })
  const provider = load('src/lib/integrations/automation/kommo.ts', { './config': { assertLive() {} }, './kommo-admission': { reserveKommoCall: async () => {} } })
  const calls = []
  let patches = 0, launches = 0
  t.mock.method(global, 'fetch', async (_url, options) => {
    calls.push([options.method, options.body])
    if (options.method === 'PATCH' && ++patches === 1) throw new TypeError('fetch failed')
    if (options.method === 'POST' && ++launches === 1) return new Response('', { status: 429 })
    return new Response('{}')
  })
  await provider.setKommoField(42, 457014, 'Una respuesta')
  await provider.launchSalesbot(42, 15578)
  assert.deepEqual(calls.map(call => call[0]), ['PATCH', 'PATCH', 'POST', 'POST'])
  assert.equal(calls[0][1], calls[1][1])
  assert.equal(calls[2][1], calls[3][1])
})

test('Kommo launch records connection causes and never repeats an uncertain POST', async t => {
  const previousUrl=process.env.KOMMO_BASE_URL,previousToken=process.env.KOMMO_ACCESS_TOKEN
  process.env.KOMMO_BASE_URL='https://lavilet.kommo.com';process.env.KOMMO_ACCESS_TOKEN='synthetic'
  t.after(()=>{if(previousUrl===undefined)delete process.env.KOMMO_BASE_URL;else process.env.KOMMO_BASE_URL=previousUrl;if(previousToken===undefined)delete process.env.KOMMO_ACCESS_TOKEN;else process.env.KOMMO_ACCESS_TOKEN=previousToken})
  for(const kind of ['network','timeout','response_body']) {
    let calls=0
    const fetcher=t.mock.method(global,'fetch',async()=>{
      calls++
      if(kind==='timeout')throw new DOMException('private URL','TimeoutError')
      if(kind==='network')throw Object.assign(Error('private provider details'),{cause:{code:'ECONNRESET'}})
      return {ok:true,status:200,text:async()=>{throw Error('private response body')}}
    })
    const provider=load('src/lib/integrations/automation/kommo.ts',{'./config':{assertLive(){}},'./kommo-admission':{reserveKommoCall:async()=>{}}})
    await assert.rejects(provider.launchSalesbot(42,15578),error=>{
      assert.equal(error.message,'KOMMO_UNAVAILABLE');assert.equal(error.uncertain,true)
      assert.equal(error.operation,'launch_bot');assert.equal(error.diagnostic.failure_kind,kind)
      if(kind==='network')assert.equal(error.diagnostic.network_code,'ECONNRESET')
      assert.doesNotMatch(JSON.stringify(error.diagnostic),/private/)
      return true
    })
    assert.equal(calls,1)
    fetcher.mock.restore()
  }
})

test('database maintenance completes even when the global send worker cannot acquire its lease', async () => {
  const calls = [], q = { then: resolve => Promise.resolve({ error: null }).then(resolve) }
  for (const method of ['upsert', 'update', 'match', 'eq', 'contains', 'lt']) q[method] = () => q
  let maintenanceClaimed = false
  const { runAutomation } = load('src/lib/integrations/automation/worker.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live', globalMaintenance: false }) },
    './data': { ...data, autoConfig: async () => ({ enabled: true, dry_run: false }), db: () => ({ from: () => q }), rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'lv_app_claim_maintenance') { if (maintenanceClaimed) return []; maintenanceClaimed = true; return [{ id: 'maintenance', kind: 'maintenance' }] }
      if (name === 'lv_app_worker_lock' && args.p_action === 'acquire') return false
      return true
    } },
    './delivery-state': { ...require('../src/lib/integrations/automation/delivery-state.ts'), kommoDeliveryBlock: async () => null },
    './visits': { planVisits: async () => { calls.push(['plan']); return 2 }, pendingVisits: async () => { throw Error('SEND_WORKER_NOT_ACQUIRED') } },
    './transport-monitor': { syncTransportIncidents: async () => ({ missing: 0 }) },
    './conversation-analysis': { analyzeIdleConversation: async () => ({ reason: 'no_idle_candidate' }) },
    './reply-registration': { ...require('../src/lib/integrations/automation/reply-registration.ts'),
      recoverAcceptedReplyRegistrations: async guard => { await guard(); calls.push(['reply_registration_recovery']); return { repaired: 0, unresolved: 0 } } },
  })
  const result = await runAutomation()
  assert.equal(result.reason, 'worker_busy')
  assert.equal(result.maintenance[0].enqueued, 2)
  assert.deepEqual(result.maintenance[0].reply_registrations, { repaired: 0, unresolved: 0 })
  assert.equal(calls.filter(([name]) => name === 'reply_registration_recovery').length, 1)
  assert.ok(calls.findIndex(([name]) => name === 'reply_registration_recovery')
    < calls.findIndex(([name, args]) => name === 'lv_app_worker_lock' && args.p_action === 'acquire'))
  assert.equal(calls.find(([name]) => name === 'lv_app_finish')[1].p_status, 'completed')
  assert.equal(calls.some(([name]) => name === 'lv_app_claim'), false)
})

function registrationWorker({ failure, acceptedResult, finishFails = false, resetCancelled = false, audience, batch } = {}) {
  const calls = []
  let claimed = false, finishFailurePending = finishFails
  const registration = require('../src/lib/integrations/automation/reply-registration.ts')
  const provider = require('../src/lib/integrations/automation/kommo.ts')
  const { runAutomation } = load('src/lib/integrations/automation/worker.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live', globalMaintenance: false }) },
    './data': { ...data, autoConfig: async () => ({ enabled: true, dry_run: false, _audience: audience }),
      db: () => {
        if(!resetCancelled)throw Error('UNEXPECTED_DIRECT_DATABASE_ACCESS')
        const q={then:resolve=>Promise.resolve({error:null,data:[{id:'input-1'}]}).then(resolve)}
        for(const method of ['select','match','in','eq','limit','abortSignal'])q[method]=()=>q
        return {from:()=>q}
      },
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'lv_app_claim_contact') {
          if (claimed) return []
          claimed = true
          return batch || [{ id: 'input-1', kind: 'inbound', contact_key: '42:100', payload: { kommoId: 42 } }]
        }
        if (name === 'lv_app_finish' && finishFailurePending) {
          finishFailurePending = false
          throw Error('RPC_LV_APP_FINISH_FAILED')
        }
        return true
      } },
    './conversation': { processConversation: async rows => {
      calls.push({ name: 'process_conversation', ids: rows.map(row => row.id) })
      if (failure) throw failure
      return acceptedResult
    } },
    './generation-recovery': { ...require('../src/lib/integrations/automation/generation-recovery.ts'),
      recoverGenerationFailure: async () => { calls.push({ name: 'generation_recovery' }); throw Error('UNEXPECTED_RECOVERY_SEND') } },
    './reply-registration': { ...registration,
      preserveAcceptedReply: async checkpoint => { calls.push({ name: 'preserve_acceptance', checkpoint }) },
      recoverAcceptedReplyRegistrations: async () => { throw Error('UNEXPECTED_CONTACT_MAINTENANCE') } },
    './kommo': { ...provider,
      launchSalesbot: async () => { calls.push({ name: 'publish' }); throw Error('UNEXPECTED_PROVIDER_PUBLICATION') },
      setKommoField: async () => { calls.push({ name: 'provider_write' }); throw Error('UNEXPECTED_PROVIDER_WRITE') } },
    './delivery-state': { ...require('../src/lib/integrations/automation/delivery-state.ts'), kommoDeliveryBlock: async () => null },
    './nutrition': { cancelNutrition24h: async () => {} },
    './nutrition-week-one': { cancelNutritionWeekOne: async () => {} },
    './nutrition-later': { cancelNutritionLater: async () => {} },
    './visits': { pendingVisits: async () => { throw Error('UNEXPECTED_GLOBAL_VISIT_WORKER') } },
  })
  return { calls, run: () => runAutomation('42:100'), registration }
}

test('production cutover retires old inbound work without processing or sending', async () => {
  const audience = { version: 1, mode: 'future_messages', activatedAt: '2026-01-02T00:00:00Z' }
  const h = registrationWorker({ audience, batch: [{ id: 'old', kind: 'inbound', contact_key: '42:100',
    received_at: '2026-01-01T23:59:00Z', payload: { kommoId: 42, sentAt: '2026-01-01T23:58:00Z' } }] })
  await h.run()
  const finish = h.calls.find(call => call.name === 'lv_app_finish').args
  assert.equal(finish.p_status, 'cancelled')
  assert.equal(finish.p_result.reason, 'BEFORE_PRODUCTION_ACTIVATION')
  assert.equal(h.calls.some(call => ['process_conversation', 'generation_recovery', 'publish', 'provider_write'].includes(call.name)), false)
})

test('mixed inbound batch only processes fresh messages from an existing contact', async () => {
  const audience = { version: 1, mode: 'future_messages', activatedAt: '2026-01-02T00:00:00Z' }
  const batch = [
    { id: 'old', kind: 'inbound', contact_key: '42:100', received_at: '2026-01-02T00:02:00Z',
      payload: { kommoId: 42, sentAt: '2026-01-01T23:58:00Z' } },
    { id: 'new', kind: 'inbound', contact_key: '42:100', received_at: '2026-01-02T00:03:00Z',
      payload: { kommoId: 42, sentAt: '2026-01-02T00:02:00Z' } },
  ]
  const h = registrationWorker({ audience, batch, acceptedResult: { action: 'reply' } })
  await h.run()
  assert.deepEqual(h.calls.find(call => call.name === 'process_conversation').ids, ['new'])
  const finishes = h.calls.filter(call => call.name === 'lv_app_finish').map(call => call.args)
  assert.deepEqual(finishes.map(call => call.p_status), ['cancelled', 'completed'])
  assert.deepEqual(finishes[0].p_ids, ['old'])
  assert.deepEqual(finishes[1].p_ids, ['new'])
  assert.equal(h.calls.some(call => ['generation_recovery', 'publish', 'provider_write'].includes(call.name)), false)
})

test('a full test reset retires late worker failures without recovery, incidents or provider calls', async () => {
  const { AcceptedReplyRegistrationError } = require('../src/lib/integrations/automation/reply-registration.ts')
  const { PreReplySendError } = require('../src/lib/integrations/automation/delivery-phase.ts')
  const checkpoint = { id: 'journal-1', key: '__reply_registration__:reset', contact: '42:100', data: { delivery_state: 'accepted' } }
  for (const failure of [Error('WORKER_LEASE_LOST'), new PreReplySendError(Error('READ_CONVERSATIONS_FAILED')),
    new AcceptedReplyRegistrationError(checkpoint, Error('RPC_REGISTER_OUTBOUND_MESSAGE_23503'))]) {
    const h = registrationWorker({ failure, resetCancelled: true })
    const result = await h.run()
    assert.equal(result.reason, 'test_contact_reset')
    assert.equal(result.results[0].reason, 'TEST_CONTACT_RESET')
    assert.equal(h.calls.some(call => ['lv_app_finish', 'preserve_acceptance', 'generation_recovery', 'publish', 'provider_write'].includes(call.name)), false)
    assert.equal(h.calls.at(-1).args.p_action, 'release')
  }
})

test('known accepted registration failure keeps its checkpoint and never triggers generation recovery or a provider resend', async () => {
  const { AcceptedReplyRegistrationError } = require('../src/lib/integrations/automation/reply-registration.ts')
  const { OpenAIRequestError } = require('../src/lib/integrations/automation/openai-request.ts')
  for (const original of [Error('RPC_REGISTER_OUTBOUND_MESSAGE_22P05'), new OpenAIRequestError(503, true, 3)]) {
    const checkpoint = { id: 'journal-1', key: '__reply_registration__:verified', contact: '42:100',
      data: { delivery_state: 'accepted', registration_state: 'failed' } }
    const h = registrationWorker({ failure: new AcceptedReplyRegistrationError(checkpoint, original) })
    const result = await h.run()
    const finish = h.calls.find(call => call.name === 'lv_app_finish').args
    assert.equal(finish.p_status, 'uncertain')
    assert.equal(finish.p_result.delivery_status, 'accepted')
    assert.equal(finish.p_result.delivery_uncertain, false)
    assert.equal(finish.p_result.registration_status, 'pending')
    assert.equal(finish.p_result.reply_registration_checkpoint, checkpoint.key)
    assert.equal(finish.p_result.recovery, 'registration_only')
    assert.equal(finish.p_result.requires_review, true)
    assert.equal(h.calls.filter(call => call.name === 'preserve_acceptance').length, 1)
    assert.equal(h.calls.filter(call => call.name === 'process_conversation').length, 1)
    assert.equal(h.calls.some(call => ['generation_recovery', 'publish', 'provider_write'].includes(call.name)), false)
    assert.equal(result.results[0].delivery_status, 'accepted')
    assert.equal(h.calls.at(-1).args.p_action, 'release')
  }
})

test('a worker-finish failure after a normal accepted result retains registered delivery proof and its matching checkpoint', async () => {
  const accepted = { action: 'accepted', delivery_status: 'accepted', registration_status: 'registered',
    reply_registration_checkpoint: '__reply_registration__:normal-accepted' }
  const h = registrationWorker({ acceptedResult: accepted, finishFails: true })
  await h.run()
  const finishes = h.calls.filter(call => call.name === 'lv_app_finish').map(call => call.args)
  assert.equal(finishes.length, 2)
  assert.equal(finishes[0].p_status, 'completed')
  assert.equal(finishes[1].p_status, 'uncertain')
  assert.equal(finishes[1].p_result.reason, 'RPC_LV_APP_FINISH_FAILED')
  assert.equal(finishes[1].p_result.delivery_status, 'accepted')
  assert.equal(finishes[1].p_result.delivery_uncertain, false)
  assert.equal(finishes[1].p_result.registration_status, 'registered')
  assert.equal(finishes[1].p_result.reply_registration_checkpoint, accepted.reply_registration_checkpoint)
  assert.equal(finishes[1].p_result.recovery, 'registration_only')
  assert.equal(h.calls.filter(call => call.name === 'process_conversation').length, 1)
  assert.equal(h.calls.some(call => ['generation_recovery', 'publish', 'provider_write'].includes(call.name)), false)
})

test('reconciliation requires explicit review and provider evidence, invokes no send helper', async () => {
  const calls = []
  const { reconcileDeliveryIncident } = load('src/lib/integrations/automation/delivery-state.ts', { './data': { ...data, db: () => ({ rpc: (name, args) => ({ abortSignal: async () => {
    calls.push([name, args]); return { data: { reconciled: true, contact_key: '' }, error: null }
  } }) }) } })
  const base = { outcome: 'not_sent', reviewed: true, reviewReference: 'Historial revisado' }
  for (const bad of [{ ...base, reviewed: false }, { ...base, reviewReference: '' }, { ...base, outcome: 'sent' }, { ...base, providerMessageId: 'contradiction' }]) {
    await assert.rejects(reconcileDeliveryIncident('event', 'admin', bad), /DELIVERY_REVIEW_REQUIRED/)
  }
  assert.equal(calls.length, 0)
  await reconcileDeliveryIncident('event', 'admin', base)
  assert.equal(calls[0][0], 'lv_app_reconcile_delivery_v2')
  assert.equal(calls[0][1].p_outcome, 'not_sent')
  assert.equal(calls.length, 1)
})

test('reconciliation endpoint rejects unreviewed requests and admits reviewed administrator actions only', async () => {
  const calls = []
  let role = 'asesor'
  const { POST } = load('src/app/api/integrations/delivery/route.ts', {
    '@/lib/auth/session': { getSessionProfile: async () => ({ profile: { role, id: 'actor' } }) },
    '@/lib/integrations/automation/delivery-state': { deliveryHealth: async () => ({}), reconcileDeliveryIncident: async (...args) => calls.push(args) },
  })
  const body = { action: 'reconcile_incident', id: '00000000-0000-4000-8000-000000000001', outcome: 'not_sent', reviewed: true, reviewReference: 'Historial revisado' }
  const request = value => new Request('https://example.test/api/integrations/delivery', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal((await POST(request(body))).status, 403)
  role = 'admin'
  assert.equal((await POST(request({ ...body, reviewed: false }))).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await POST(request(body))).status, 200)
  assert.equal(calls.length, 1)
})

test('sent reconciliation restores missing registration before releasing the contact; a repair failure cannot unlock', async () => {
  const calls = []
  let fail = true
  const { reconcileDeliveryIncident } = load('src/lib/integrations/automation/delivery-state.ts', {
    './historical-delivery-registration': { repairReviewedDeliveryRegistration: async input => {
      calls.push(['repair', input])
      if (fail) throw Error('DELIVERY_REGISTRATION_FULL_TRACE_REQUIRED')
      return { repaired: true }
    } },
    './data': { ...data, db: () => ({ rpc: (name, args) => ({ abortSignal: async () => { calls.push([name, args]); return { data: { reconciled: true, contact_key: '' }, error: null } } }) }) },
  })
  const review = { outcome: 'sent', reviewed: true, providerMessageId: 'observed-1', reviewReference: 'Mensaje observado y revisado' }
  await assert.rejects(reconcileDeliveryIncident('event-1', 'admin-1', review), /FULL_TRACE_REQUIRED/)
  assert.deepEqual(calls.map(([name]) => name), ['repair'])
  fail = false
  await reconcileDeliveryIncident('event-1', 'admin-1', review)
  assert.deepEqual(calls.map(([name]) => name), ['repair', 'repair', 'lv_app_reconcile_delivery_v2'])
})

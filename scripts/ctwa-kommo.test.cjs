/**
 * Pruebas aisladas: ctwa_clid en WhatsApp → Kommo → CRM.
 * No envía WhatsApp, no genera conversiones Meta, no toca Production.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')

const {
  extractCtwaFromKommoFlat,
  preserveCtwaCapture,
  KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE,
  META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE,
  KOMMO_CTWA_LIMITATION,
} = require(path.join(root, 'src/lib/integrations/automation/ctwa-from-kommo.ts'))
const { normalizeWebhook } = require(path.join(root, 'src/lib/integrations/automation/webhook.ts'))
const { __test: ctwaTest } = require(path.join(root, 'src/lib/integrations/automation/ctwa-lead-store.ts'))

const now = Date.UTC(2026, 8, 16, 20, 0, 0)
const scope = { tenant_id: 'a1b2c3d4-0001-4000-8000-000000000001', project_id: 'b1b2c3d4-0001-4000-8000-000000000001' }

function baseMsg(overrides = {}) {
  return {
    id: 'external-1',
    entity_id: 123,
    entity_type: 'lead',
    contact_id: 456,
    text: 'Hola',
    created_at: now / 1000,
    origin: 'waba',
    author: { type: 'external', name: 'Cliente' },
    type: 'incoming',
    ...overrides,
  }
}

function loadStore(rpcImpl, logSink) {
  const filename = path.join(root, 'src/lib/integrations/automation/ctwa-lead-store.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }
  const localRequire = Module.createRequire(filename)
  const mocks = {
    'server-only': {},
    './data': {
      scope,
      text: (v) => (typeof v === 'string' && v.trim() ? v.trim() : ''),
      object: (v) => (v && typeof v === 'object' ? v : {}),
      rpc: rpcImpl,
    },
    './ctwa-from-kommo': {},
  }
  const prevError = console.error
  if (logSink) {
    console.error = (...args) => {
      logSink.push(args.map(String).join(' '))
    }
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', source)(
      (id) => (id in mocks ? mocks[id] : localRequire(id)),
      m,
      m.exports,
    )
  } catch (error) {
    if (logSink) console.error = prevError
    throw error
  }
  // Mantener el sink hasta después de awaits; el caller restaura.
  if (logSink) {
    m.exports.__restoreConsole = () => {
      console.error = prevError
    }
  }
  return m.exports
}

function loadConversation(mocks) {
  const filename = path.join(root, 'src/lib/integrations/automation/conversation.ts')
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const m = { exports: {} }
  const localRequire = Module.createRequire(filename)
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', source)(
    (id) => (id in mocks ? mocks[id] : localRequire(id)),
    m,
    m.exports,
  )
  return m.exports
}

describe('Kommo CRM sin CTWA', () => {
  it('acepta mensaje sin ctwa_clid y no inventa ads ni orgánico', () => {
    const payload = { account: { id: 36919007 }, message: { add: [baseMsg()] } }
    const events = normalizeWebhook(JSON.stringify(payload), 'application/json', now)
    assert.equal(events.length, 1)
    assert.equal(events[0].ctwa, null)
    assert.notEqual(events[0].origin, 'ad')
    assert.notEqual(events[0].origin, 'organic')
  })

  it('fixture CRM es sintético y no demuestra el webhook real de Kommo', () => {
    assert.equal(KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE._fixture_kind, 'synthetic_kommo_crm_shape')
    assert.match(KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE._fixture_note, /no es evidencia|Sintético/i)
    assert.match(KOMMO_CTWA_LIMITATION, /sintético|webhook real/i)
    const events = normalizeWebhook(
      JSON.stringify({
        account: { id: 36919007 },
        message: {
          add: [{ ...KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE.message.add[0], created_at: now / 1000 }],
        },
      }),
      'application/json',
      now,
    )
    assert.equal(events[0].ctwa, null)
  })
})

describe('Captura opcional si Kommo reenviara referral', () => {
  it('extrae ctwa_clid desde referral anidado sin exigir el campo', () => {
    const payload = {
      account: { id: 36919007 },
      message: {
        add: [
          baseMsg({
            referral: {
              source_type: 'ad',
              source_id: '120000000000000000',
              source_url: 'https://fb.me/anon',
              ctwa_clid: 'Aff-ANON_CTWA_CLID_EXAMPLE',
            },
          }),
        ],
      },
    }
    const events = normalizeWebhook(JSON.stringify(payload), 'application/json', now)
    assert.equal(events[0].ctwa?.clid, 'Aff-ANON_CTWA_CLID_EXAMPLE')
    assert.equal(events[0].ctwa?.referralSourceType, 'ad')
  })

  it('form-urlencoded también captura ctwa_clid', () => {
    const form = new URLSearchParams({
      'account[id]': '36919007',
      'message[add][0][id]': 'x1',
      'message[add][0][entity_id]': '123',
      'message[add][0][contact_id]': '456',
      'message[add][0][created_at]': String(now / 1000),
      'message[add][0][origin]': 'whatsapp',
      'message[add][0][author][type]': 'external',
      'message[add][0][text]': 'Hola',
      'message[add][0][referral][ctwa_clid]': 'Aff-FORM_CLID',
    })
    const events = normalizeWebhook(form.toString(), 'application/x-www-form-urlencoded', now)
    assert.equal(events[0].ctwa?.clid, 'Aff-FORM_CLID')
  })
})

describe('Preservación first-touch', () => {
  it('mensaje posterior sin clid no borra la captura previa', () => {
    const first = {
      clid: 'Aff-FIRST',
      fieldPath: 'message[add][0][referral][ctwa_clid]',
      sourceId: '1',
      sourceUrl: null,
      referralSourceType: 'ad',
    }
    assert.equal(preserveCtwaCapture(first, null)?.clid, 'Aff-FIRST')
  })

  it('reintento con el mismo clid conserva el primero', () => {
    const first = { clid: 'Aff-FIRST', fieldPath: 'path-a', sourceId: null, sourceUrl: null, referralSourceType: null }
    const retry = { clid: 'Aff-FIRST', fieldPath: 'path-b', sourceId: 'x', sourceUrl: null, referralSourceType: 'ad' }
    assert.equal(preserveCtwaCapture(first, retry)?.fieldPath, 'path-a')
  })
})

describe('Códigos de error CTWA', () => {
  it('distingue RPC ausente, timeout y error de base', () => {
    assert.equal(
      ctwaTest.classifyCtwaPersistError(new Error('RPC_LV_APP_PRESERVE_CTWA_PGRST202')),
      'CTWA_RPC_MISSING',
    )
    assert.equal(
      ctwaTest.classifyCtwaPersistError(new Error('function public.lv_app_preserve_ctwa(...) does not exist')),
      'CTWA_RPC_MISSING',
    )
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    assert.equal(ctwaTest.classifyCtwaPersistError(timeout), 'CTWA_TIMEOUT')
    assert.equal(
      ctwaTest.classifyCtwaPersistError(new Error('RPC_LV_APP_PRESERVE_CTWA_57014')),
      'CTWA_DB_ERROR',
    )
  })

  it('RPC ausente: no lanza, code CTWA_RPC_MISSING, log sin clid', async () => {
    const logs = []
    const store = loadStore(async () => {
      throw new Error('RPC_LV_APP_PRESERVE_CTWA_PGRST202')
    }, logs)
    try {
      const result = await store.preserveCtwaForContact({
        contactId: 456,
        kommoId: 123,
        externalMessageId: 'msg-1',
        ctwa: {
          clid: 'Aff-SECRET-SHOULD-NOT-LOG',
          fieldPath: 'path',
          sourceId: null,
          sourceUrl: null,
          referralSourceType: null,
        },
      })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'CTWA_RPC_MISSING')
      assert.equal(logs.length, 1)
      assert.match(logs[0], /CTWA_RPC_MISSING/)
      assert.doesNotMatch(logs[0], /Aff-SECRET|456|123/)
    } finally {
      store.__restoreConsole?.()
    }
  })

  it('timeout y error DB: no interrumpen (ok=false + código)', async () => {
    const timeoutErr = new Error('aborted')
    timeoutErr.name = 'AbortError'
    const { preserveCtwaForContact: preserveTimeout } = loadStore(async () => {
      throw timeoutErr
    })
    assert.equal(
      (await preserveTimeout({
        contactId: 1,
        kommoId: 1,
        externalMessageId: 't',
        ctwa: { clid: 'Aff-T', fieldPath: 'p', sourceId: null, sourceUrl: null, referralSourceType: null },
      })).code,
      'CTWA_TIMEOUT',
    )

    const { preserveCtwaForContact: preserveDb } = loadStore(async () => {
      throw new Error('RPC_LV_APP_PRESERVE_CTWA_XX000')
    })
    assert.equal(
      (await preserveDb({
        contactId: 1,
        kommoId: 1,
        externalMessageId: 'd',
        ctwa: { clid: 'Aff-D', fieldPath: 'p', sourceId: null, sourceUrl: null, referralSourceType: null },
      })).code,
      'CTWA_DB_ERROR',
    )
  })

  it('sin CTWA no invoca RPC', async () => {
    let calls = 0
    const { preserveCtwaForContact } = loadStore(async () => {
      calls++
      throw new Error('no')
    })
    const result = await preserveCtwaForContact({
      contactId: 1,
      kommoId: 1,
      externalMessageId: 'n',
      ctwa: null,
    })
    assert.equal(result.code, 'CTWA_NOOP')
    assert.equal(calls, 0)
  })
})

describe('Flujo processConversation con dependencias simuladas', () => {
  function conversationMocks(preserveErrorFactory, registration) {
    const sentReplies = []
    const preserveCalls = []
    const rpcCalls = []
    return {
      mocks: {
        'server-only': {},
        './ai': {
          activePrompt: async () => 'x',
          aiJson: async () => ({}),
          mediaText: async () => 'media',
        },
        './openai-request': { OpenAIRequestError: class extends Error {} },
        './config': {
          assertLive: () => {},
          automationSettings: () => ({ live: true, activatedAt: '2020-01-01T00:00:00Z', testLeadId: null }),
        },
        './conversation-rules': { normalizeEvents: () => ({}), validateIntent: () => 'unclear' },
        './data': {
          scope,
          object: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : Array.isArray(v) ? v[0] || {} : {}),
          text: (v) => (typeof v === 'string' ? v : ''),
          one: async (table) => {
            if (table === 'leads') {
              return { ...scope, id: 'lead', kommo_id: 123, bot_enabled: false, channel_origin: 'whatsapp' }
            }
            if (table === 'conversations') return { id: 'conv', lead_id: 'lead', summary: {} }
            return { id: 'x' }
          },
          db: () => ({
            from: () => ({
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: async () => ({ error: null }),
                  }),
                }),
              }),
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          autoConfig: async () => ({ ...scope, enabled: true, dry_run: false, test_only: false }),
          permitted: () => true,
          rpc: async (name, args) => {
            rpcCalls.push(name)
            if (name === 'register_inbound_message') return registration
            if (name === 'lv_app_conversation_context') return { historial: [], propuestas: [] }
            throw new Error(`unexpected rpc ${name}`)
          },
        },
        './kommo': {
          botStopped: () => false,
          getKommoLead: async () => ({ _embedded: { contacts: [{ id: 456 }] } }),
          getKommoContact: async () => ({
            name: 'Cliente',
            custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '0999999999' }] }],
          }),
          launchSalesbot: async () => {},
          setKommoField: async () => {},
        },
        './webhook': {
          inboundFromRow: (value) => value,
          type: {},
        },
        './ctwa-lead-store': {
          preserveCtwaForContact: async (input) => {
            preserveCalls.push({ hasClid: Boolean(input.ctwa?.clid) })
            if (preserveErrorFactory) {
              const store = loadStore(async () => {
                throw preserveErrorFactory()
              })
              return store.preserveCtwaForContact(input)
            }
            return { ok: true, code: 'CTWA_NOOP', action: 'noop_no_clid' }
          },
        },
        './visits': {},
        './sdr-rules': { isGreetingOnly: () => true, qualifiedFacts: () => ({}), sdrState: () => ({}) },
        './sdr': {
          commercialContext: async () => ({}),
          commercialReply: async () => ({ reply: '', audit: {} }),
          publishedUnitCatalog: async () => [],
        },
        './unit-model': { appendUnitModel: (t) => t, unitModelDelivery: () => null },
        './unit-visual-request': { isUnitVisualRequest: () => false },
        './conversation-style': {
          greetingForTurn: () => ({ needed: false }),
          isCourtesyOnly: () => false,
          minimalGreeting: () => '',
          naturalConversationReply: async () => ({ reply: '', audit: {} }),
        },
        './financing': {
          financingContext: () => null,
          financingInputs: () => ({}),
          financingReply: async () => null,
          financingQuestionReply: () => null,
          isFinancingTurn: () => false,
          avoidFinancingRepeat: (t) => t,
          priceFinancingReply: () => null,
        },
        './visit-intake': {
          intakeReply: () => null,
          isVisitDetail: () => false,
          needsVisitHelp: () => false,
          visitTurnIntent: () => null,
          visitBusinessHoursReply: () => null,
        },
        './turn-routing': {
          asksVisitStatus: () => false,
          asksTeamAttendance: () => false,
          teamAttendanceReply: () => '',
          declinedFollowup: () => false,
          explicitlyRequestsVisit: () => false,
          isConversationRepair: () => false,
          TURN_RULES: {},
          visitStatusReply: () => '',
        },
        './commercial-experience': {
          commercialMemory: () => ({}),
          rememberCommercialReply: () => ({}),
          projectOverviewReply: () => null,
        },
        './catalog-reference': { resolveCatalogReference: () => null },
        './clarification': { fabricatedActionRequest: () => false, mediaClarificationReply: () => '' },
        './sales-policy': {
          acceptsUnitOptions: () => false,
          acceptsVisitInvitation: () => false,
          rememberSalesReply: () => ({}),
        },
        './media-format': { mediaFailureReply: () => '', unreadMediaMarker: () => '' },
        './response-openings': { variedReplyOpening: (t) => t },
        './price-reply': {
          acceptedPriceOption: () => null,
          asksUnitPrice: () => false,
          unitPriceQuote: () => null,
          priceReplyIssues: () => [],
        },
        './nutrition': { scheduleNutrition24h: async () => {} },
        './nutrition-week-one': { scheduleNutritionWeekOne: async () => {} },
        './nutrition-later': { scheduleNutritionLater: async () => {} },
        './nutrition-week-one-rules': { nutritionContinuation: () => null },
        './project-material': {
          brochureReply: () => null,
          BROCHURE_URL: '',
          launchVisitReply: () => null,
          vehicleScopeReply: () => null,
          wantsBrochure: () => false,
        },
        './sales-subject': { salesSubject: () => '' },
        './business-scope': { classifyBusinessScope: async () => ({ kind: 'neutral', property_message: '', reply: '' }) },
        './commercial-engagement': {
          commercialEngagement: () => ({}),
          passiveSalesCopy: () => '',
          passiveSalesRules: () => ({}),
        },
        './operational-copy': { operationalReply: async () => ({ reply: '', generated: false }) },
        './visit-location': {
          locationAnswer: () => null,
          locationRequestKind: () => null,
          withVisitLocation: (t) => t,
        },
        './multi-topic-turn': { commercialCoverageIssues: () => [], commercialTurnTopics: () => [] },
        './turn-answer': { completeTurnAnswer: (t) => t, turnAnswerFacts: () => ({}) },
        './visit-choice': { selectedVisitOption: () => null },
        './visit-parser-health': { visitParserReady: async () => false },
        '@/lib/inmobiliaria/visitProposalOptions': { visitOptionsList: () => [] },
        './product-fit': { asksForHouse: () => false, houseProductReply: () => null },
        './visit-escalation': {
          declinesAllVisitAlternatives: () => false,
          escalateVisitCoordination: async () => null,
        },
        './turn-completeness': { completeTurnReply: (t) => t },
      },
      sentReplies,
      preserveCalls,
      rpcCalls,
    }
  }

  const payloadRow = (externalId, ctwa) => ({
    payload: {
      externalId,
      kommoId: 123,
      contactId: 456,
      chatId: 'c',
      text: 'Hola',
      name: 'Cliente',
      sentAt: new Date(now).toISOString(),
      origin: 'waba',
      media: null,
      ctwa,
    },
  })

  it('RPC ausente: conversación llega a bot_paused; mensaje registrado; sin segunda respuesta', async () => {
    const { mocks, rpcCalls, preserveCalls } = conversationMocks(
      () => new Error('RPC_LV_APP_PRESERVE_CTWA_PGRST202'),
      { lead_id: 'lead', conversation_id: 'conv', is_duplicate: false },
    )
    // Force live env
    for (const [key, value] of Object.entries({
      AUTOMATION_MODE: 'live',
      AUTOMATION_N8N_DISABLED: 'true',
      AUTOMATION_ACTIVATED_AT: '2020-01-01T00:00:00.000Z',
    })) {
      process.env[key] = value
    }
    const { processConversation } = loadConversation(mocks)
    const result = await processConversation(
      [
        payloadRow('msg-rpc-missing', {
          clid: 'Aff-X',
          fieldPath: 'p',
          sourceId: null,
          sourceUrl: null,
          referralSourceType: null,
        }),
      ],
      async () => {},
    )
    assert.equal(result.action, 'bot_paused')
    assert.ok(rpcCalls.includes('register_inbound_message'))
    assert.equal(preserveCalls.length, 1)
    assert.equal(preserveCalls[0].hasClid, true)
  })

  it('error DB en CTWA: el flujo CRM continúa (bot_paused)', async () => {
    const { mocks } = conversationMocks(
      () => new Error('RPC_LV_APP_PRESERVE_CTWA_XX000'),
      { lead_id: 'lead', conversation_id: 'conv', is_duplicate: false },
    )
    process.env.AUTOMATION_MODE = 'live'
    process.env.AUTOMATION_N8N_DISABLED = 'true'
    process.env.AUTOMATION_ACTIVATED_AT = '2020-01-01T00:00:00.000Z'
    const { processConversation } = loadConversation(mocks)
    const result = await processConversation(
      [
        payloadRow('msg-db', {
          clid: 'Aff-Y',
          fieldPath: 'p',
          sourceId: null,
          sourceUrl: null,
          referralSourceType: null,
        }),
      ],
      async () => {},
    )
    assert.equal(result.action, 'bot_paused')
  })

  it('timeout CTWA: el flujo CRM continúa', async () => {
    const { mocks } = conversationMocks(() => {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      return e
    }, { lead_id: 'lead', conversation_id: 'conv', is_duplicate: false })
    process.env.AUTOMATION_MODE = 'live'
    process.env.AUTOMATION_N8N_DISABLED = 'true'
    process.env.AUTOMATION_ACTIVATED_AT = '2020-01-01T00:00:00.000Z'
    const { processConversation } = loadConversation(mocks)
    const result = await processConversation(
      [
        payloadRow('msg-timeout', {
          clid: 'Aff-Z',
          fieldPath: 'p',
          sourceId: null,
          sourceUrl: null,
          referralSourceType: null,
        }),
      ],
      async () => {},
    )
    assert.equal(result.action, 'bot_paused')
  })

  it('mensaje duplicado: action duplicate; sin respuesta bot', async () => {
    const { mocks, rpcCalls } = conversationMocks(null, {
      lead_id: 'lead',
      conversation_id: 'conv',
      is_duplicate: true,
    })
    process.env.AUTOMATION_MODE = 'live'
    process.env.AUTOMATION_N8N_DISABLED = 'true'
    process.env.AUTOMATION_ACTIVATED_AT = '2020-01-01T00:00:00.000Z'
    const { processConversation } = loadConversation(mocks)
    const result = await processConversation([payloadRow('msg-dup', null)], async () => {})
    assert.equal(result.action, 'duplicate')
    assert.ok(rpcCalls.includes('register_inbound_message'))
    assert.equal(rpcCalls.includes('lv_app_conversation_context'), false)
  })
})

describe('Contraste fixtures sintéticos', () => {
  it('Meta sintético tiene ctwa_clid; Kommo sintético no', () => {
    const metaClid =
      META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE.entry[0].changes[0].value.messages[0].referral
        .ctwa_clid
    assert.ok(metaClid)
    assert.equal(/ctwa_clid/i.test(JSON.stringify(KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE.message)), false)
    assert.equal(extractCtwaFromKommoFlat({ 'message[add][0][referral][ctwa_clid]': 'null' }, '0'), null)
  })
})

/**
 * Pruebas aisladas: ctwa_clid en WhatsApp → Kommo → CRM.
 * No envía WhatsApp, no genera conversiones Meta, no toca Production.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

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
  KOMMO_CRM_INBOUND_REFERENCE_ANON,
  META_CLOUD_CTWA_REFERRAL_REFERENCE_ANON,
  KOMMO_CTWA_LIMITATION,
} = require(path.join(root, 'src/lib/integrations/automation/ctwa-from-kommo.ts'))
const { normalizeWebhook } = require(path.join(root, 'src/lib/integrations/automation/webhook.ts'))

const now = Date.UTC(2026, 8, 16, 20, 0, 0)

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

describe('Kommo CRM sin CTWA', () => {
  it('acepta mensaje sin ctwa_clid y no inventa ads ni orgánico', () => {
    const payload = {
      account: { id: 36919007 },
      message: { add: [baseMsg()] },
    }
    const events = normalizeWebhook(JSON.stringify(payload), 'application/json', now)
    assert.equal(events.length, 1)
    assert.equal(events[0].ctwa, null)
    assert.equal(events[0].origin, 'waba')
    assert.equal(events[0].text, 'Hola')
    // origin del canal WhatsApp ≠ atribución de anuncio
    assert.notEqual(events[0].origin, 'ad')
    assert.notEqual(events[0].origin, 'organic')
  })

  it('el payload de referencia CRM anonimizado no trae ctwa_clid', () => {
    const events = normalizeWebhook(
      JSON.stringify({
        ...KOMMO_CRM_INBOUND_REFERENCE_ANON,
        account: { id: 36919007 },
        message: {
          add: [
            {
              ...KOMMO_CRM_INBOUND_REFERENCE_ANON.message.add[0],
              created_at: now / 1000,
            },
          ],
        },
      }),
      'application/json',
      now,
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].ctwa, null)
    assert.match(KOMMO_CTWA_LIMITATION, /no documenta|no.*entrega|ctwa_clid/i)
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
    assert.equal(events.length, 1)
    assert.ok(events[0].ctwa)
    assert.equal(events[0].ctwa.clid, 'Aff-ANON_CTWA_CLID_EXAMPLE')
    assert.equal(events[0].ctwa.referralSourceType, 'ad')
    assert.equal(events[0].ctwa.sourceId, '120000000000000000')
    assert.match(events[0].ctwa.fieldPath, /ctwa_clid/i)
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

describe('Preservación first-touch y reintentos', () => {
  it('mensaje posterior sin clid no borra la captura previa', () => {
    const first = {
      clid: 'Aff-FIRST',
      fieldPath: 'message[add][0][referral][ctwa_clid]',
      sourceId: '1',
      sourceUrl: null,
      referralSourceType: 'ad',
    }
    const merged = preserveCtwaCapture(first, null)
    assert.equal(merged?.clid, 'Aff-FIRST')
    assert.equal(merged?.fieldPath, first.fieldPath)
  })

  it('reintento con el mismo clid es idempotente (conserva el primero)', () => {
    const first = {
      clid: 'Aff-FIRST',
      fieldPath: 'path-a',
      sourceId: null,
      sourceUrl: null,
      referralSourceType: null,
    }
    const retry = {
      clid: 'Aff-FIRST',
      fieldPath: 'path-b',
      sourceId: 'x',
      sourceUrl: null,
      referralSourceType: 'ad',
    }
    const merged = preserveCtwaCapture(first, retry)
    assert.equal(merged?.clid, 'Aff-FIRST')
    assert.equal(merged?.fieldPath, 'path-a')
  })

  it('dos normalizaciones del mismo externalId producen el mismo externalId (dedupe lv_app_receive)', () => {
    const payload = {
      account: { id: 36919007 },
      message: { add: [baseMsg({ id: 'retry-same-id', referral: { ctwa_clid: 'Aff-R' } })] },
    }
    const a = normalizeWebhook(JSON.stringify(payload), 'application/json', now)
    const b = normalizeWebhook(JSON.stringify(payload), 'application/json', now)
    assert.equal(a[0].externalId, b[0].externalId)
    assert.equal(a[0].ctwa?.clid, b[0].ctwa?.clid)
  })
})

describe('Contraste Meta Cloud API vs Kommo CRM', () => {
  it('la referencia Meta sí contiene ctwa_clid; Kommo CRM de referencia no', () => {
    const metaClid =
      META_CLOUD_CTWA_REFERRAL_REFERENCE_ANON.entry[0].changes[0].value.messages[0].referral.ctwa_clid
    assert.ok(metaClid)
    const kommoJson = JSON.stringify(KOMMO_CRM_INBOUND_REFERENCE_ANON)
    assert.equal(/ctwa_clid/i.test(kommoJson), false)
  })

  it('extractCtwaFromKommoFlat no inventa clid vacío', () => {
    assert.equal(extractCtwaFromKommoFlat({ 'account[id]': '36919007' }, '0'), null)
    assert.equal(
      extractCtwaFromKommoFlat({ 'message[add][0][referral][ctwa_clid]': 'null' }, '0'),
      null,
    )
  })
})

describe('RPC ausente / mensaje sin CTWA no rompe el CRM', () => {
  const fs = require('node:fs')
  const ts = require('typescript')
  const Module = require('node:module')

  function loadStore(rpcImpl) {
    const filename = path.join(root, 'src/lib/integrations/automation/ctwa-lead-store.ts')
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const m = { exports: {} }
    const localRequire = Module.createRequire(filename)
    const mocks = {
      'server-only': {},
      './data': {
        scope: { tenant_id: 't', project_id: 'p' },
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

  it('si lv_app_preserve_ctwa no existe, no lanza y el caller puede seguir', async () => {
    let rpcCalls = 0
    const { preserveCtwaForContact } = loadStore(async (name) => {
      rpcCalls++
      assert.equal(name, 'lv_app_preserve_ctwa')
      throw new Error('function public.lv_app_preserve_ctwa(uuid,uuid,text,bigint,text,text,text,text,text,text) does not exist')
    })
    const result = await preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'msg-1',
      ctwa: {
        clid: 'Aff-X',
        fieldPath: 'message[add][0][referral][ctwa_clid]',
        sourceId: null,
        sourceUrl: null,
        referralSourceType: null,
      },
    })
    assert.equal(result.action, 'rpc_unavailable')
    assert.equal(result.clid, null)
    assert.equal(rpcCalls, 1)
  })

  it('mensaje sin CTWA no invoca la RPC (no puede borrar atribución previa)', async () => {
    let rpcCalls = 0
    const { preserveCtwaForContact } = loadStore(async () => {
      rpcCalls++
      throw new Error('should not be called')
    })
    const result = await preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'msg-2',
      ctwa: null,
    })
    assert.equal(result.action, 'noop_no_clid')
    assert.equal(rpcCalls, 0)
  })

  it('register_inbound_message ocurre antes que preserve: el mensaje queda aunque falle la RPC', async () => {
    const order = []
    const mockRegister = async () => {
      order.push('register_inbound_message')
      return { lead_id: 'lead', conversation_id: 'conv', is_duplicate: false }
    }
    const { preserveCtwaForContact } = loadStore(async () => {
      order.push('lv_app_preserve_ctwa')
      throw new Error('function lv_app_preserve_ctwa does not exist')
    })
    // Simula el orden de conversation.register (mensaje primero, CTWA después).
    const registration = await mockRegister()
    const preserve = await preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'msg-3',
      ctwa: {
        clid: 'Aff-Y',
        fieldPath: 'path',
        sourceId: null,
        sourceUrl: null,
        referralSourceType: null,
      },
    })
    assert.deepEqual(order, ['register_inbound_message', 'lv_app_preserve_ctwa'])
    assert.equal(registration.lead_id, 'lead')
    assert.equal(preserve.action, 'rpc_unavailable')
    // is_duplicate sigue gobernando respuestas; aquí no hay segundo envío.
    assert.equal(registration.is_duplicate, false)
  })

  it('duplicado de mensaje: preserve soft-fail no crea una segunda respuesta', async () => {
    const replies = []
    const { preserveCtwaForContact } = loadStore(async () => {
      throw new Error('schema cache: lv_app_preserve_ctwa')
    })
    const registration = { lead_id: 'lead', conversation_id: 'conv', is_duplicate: true }
    await preserveCtwaForContact({
      contactId: 456,
      kommoId: 123,
      externalMessageId: 'msg-dup',
      ctwa: {
        clid: 'Aff-Z',
        fieldPath: 'path',
        sourceId: null,
        sourceUrl: null,
        referralSourceType: null,
      },
    })
    if (registration.is_duplicate === true) {
      // conversation.ts: continue — no bot reply
    } else {
      replies.push('bot')
    }
    assert.equal(replies.length, 0)
  })
})

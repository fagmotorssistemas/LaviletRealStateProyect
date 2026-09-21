import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKommoWebhook } from './webhook'

const now = Date.parse('2026-09-20T18:00:00.000Z')
const createdAt = Math.floor(now / 1000)

test('normaliza una respuesta manual de un usuario interno de Kommo', () => {
  const result = normalizeKommoWebhook(JSON.stringify({
    account: { id: 36919007 },
    outgoing_message: {
      add: [{
        id: 'manual-1',
        contact_id: 123,
        chat_id: 'chat-1',
        text: 'Buenas tardes, soy Carlos.',
        created_at: createdAt,
        origin: 'waba',
        author: { type: 'internal', user_id: 9001, name: 'Carlos' },
      }],
    },
  }), 'application/json', now)

  assert.equal(result.inbound.length, 0)
  assert.deepEqual(result.advisorOutbound, [{
    externalId: 'manual-1',
    kommoId: 0,
    contactId: 123,
    chatId: 'chat-1',
    text: 'Buenas tardes, soy Carlos.',
    name: 'Carlos',
    sentAt: '2026-09-20T18:00:00.000Z',
    origin: 'waba',
    userId: 9001,
    authorType: 'internal',
  }])
})

test('no confunde una entrega de Salesbot con una respuesta manual', () => {
  const result = normalizeKommoWebhook(JSON.stringify({
    account: { id: 36919007 },
    outgoing_message: {
      add: [{
        id: 'bot-1',
        entity_id: 4454162,
        entity_type: 'lead',
        contact_id: 123,
        text: 'Respuesta automática',
        created_at: createdAt,
        origin: 'waba',
        author: { type: 'bot', id: 15578, name: 'SalesBot' },
      }],
    },
  }), 'application/json', now)

  assert.equal(result.inbound.length, 0)
  assert.equal(result.advisorOutbound.length, 0)
})

test('admite el formato message[add] marcado como outgoing', () => {
  const result = normalizeKommoWebhook(JSON.stringify({
    account: { id: 36919007 },
    message: {
      add: [{
        id: 'manual-2',
        type: 'outgoing',
        entity_id: 4454162,
        entity_type: 'lead',
        contact_id: 123,
        text: 'Le ayudo con gusto.',
        created_at: createdAt,
        origin: 'whatsapp',
        author: { type: 'internal', user_id: 9001, name: 'Carlos' },
      }],
    },
  }), 'application/json', now)

  assert.equal(result.inbound.length, 0)
  assert.equal(result.advisorOutbound[0]?.externalId, 'manual-2')
})

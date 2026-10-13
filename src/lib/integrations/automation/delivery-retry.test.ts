import test from 'node:test'
import assert from 'node:assert/strict'
import { sendConfirmedDeliveryRetry, type DeliveryRetryStore } from './delivery-retry'
import { PreReplySendError } from './delivery-phase'
import { ProviderError } from './kommo'
import type { Row } from './data'

function fixture() {
  const calls: string[] = [], key = '__reply_registration__:test:confirmed-retry:1'
  const event: Row = { id: 'retry', contact_key: '42:100', payload: { checkpoint_key: key, kommoId: 42, sentAt: new Date().toISOString() } }
  const checkpoint = { id: 'journal', key, contact: '42:100', data: { reviewed_by: 'admin', delivery_state: 'prepared',
    event_ids: ['retry'], args: { p_content: 'La respuesta ya revisada.' } } as Row }
  const store: DeliveryRetryStore = {
    checkpoint: async () => checkpoint, allowed: async () => true,
    start: async () => { calls.push('start'); checkpoint.data.delivery_state = 'attempted' },
    field: async (lead, content) => { assert.equal(lead, 42); assert.equal(content, 'La respuesta ya revisada.'); calls.push('field') },
    launch: async () => { calls.push('launch') }, register: async () => { calls.push('register'); checkpoint.data.delivery_state = 'accepted' },
    memory: async () => { calls.push('memory'); return true },
  }
  return { event, checkpoint, store, calls, guard: async () => {} }
}

test('a checked non-delivery sends the saved draft once, registers it and restores its memory without another AI call', async () => {
  const f = fixture(), result = await sendConfirmedDeliveryRetry(f.event, f.guard, f.store)
  assert.deepEqual(f.calls, ['field', 'start', 'launch', 'register', 'memory'])
  assert.equal(result.delivery_status, 'accepted')
  assert.equal(result.delivery_confirmed, false)
  assert.equal(result.memory_saved, true)
  await assert.rejects(sendConfirmedDeliveryRetry(f.event, f.guard, f.store), PreReplySendError)
  assert.equal(f.calls.filter(call => call === 'launch').length, 1)
})

test('expiry, changed permissions or changed conversation never launch the saved draft', async () => {
  for (const expired of [false, true]) {
    const f = fixture()
    if (expired) (f.event.payload as Row).sentAt = new Date(Date.now() - 25 * 3_600_000).toISOString()
    else f.store.allowed = async () => false
    const result = await sendConfirmedDeliveryRetry(f.event, f.guard, f.store)
    assert.equal(result.delivery_status, 'not_sent')
    assert.deepEqual(f.calls, [])
  }
})

test('loss of authority after field update cancels without a Salesbot launch', async () => {
  const f = fixture(); let checks = 0
  f.store.allowed = async () => ++checks === 1
  assert.equal((await sendConfirmedDeliveryRetry(f.event, f.guard, f.store)).delivery_status, 'not_sent')
  assert.deepEqual(f.calls, ['field'])
})

test('a second ambiguous launch is left attempted for review and is never automatically replayed', async () => {
  const f = fixture()
  f.store.launch = async () => { f.calls.push('launch'); throw new ProviderError(0, true, 'launch_bot') }
  await assert.rejects(sendConfirmedDeliveryRetry(f.event, f.guard, f.store), ProviderError)
  assert.equal(f.checkpoint.data.delivery_state, 'attempted')
  await assert.rejects(sendConfirmedDeliveryRetry(f.event, f.guard, f.store), PreReplySendError)
  assert.deepEqual(f.calls, ['field', 'start', 'launch'])
})

test('a field failure before launching the bot is classified as not sent; memory failure after acceptance does not resend', async () => {
  const f = fixture()
  f.store.field = async () => { throw new ProviderError(0, true, 'update_field') }
  await assert.rejects(sendConfirmedDeliveryRetry(f.event, f.guard, f.store), PreReplySendError)
  assert.equal(f.checkpoint.data.delivery_state, 'prepared')
  const accepted = fixture()
  accepted.store.memory = async () => { throw Error('DB_UNAVAILABLE') }
  const result = await sendConfirmedDeliveryRetry(accepted.event, accepted.guard, accepted.store)
  assert.equal(result.delivery_status, 'accepted')
  assert.equal(result.memory_saved, false)
  assert.equal(accepted.calls.filter(call => call === 'launch').length, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { repairReviewedDeliveryRegistration, type DeliveryRegistrationRepairStore } from './historical-delivery-registration'

const reply = 'El departamento tiene 3 dormitorios.\n\n¿Podría indicarme cuál es el presupuesto total aproximado para la compra?'
function fixture() {
  const input = { eventId: 'event-1', actorId: 'admin-1', providerMessageId: 'provider-1', reviewReference: 'Historial y mensaje revisados' }
  const actor: Row = { id: 'admin-1', role: 'admin', is_active: true }
  const event: Row = { id: 'event-1', kind: 'inbound', status: 'uncertain', contact_key: '4469212:945233',
    payload: { externalId: 'inbound-1', kommoId: 4469212, contactId: 945233 },
    result: { reason: 'RPC_REGISTER_OUTBOUND_MESSAGE_22P05' },
    received_at: '2026-10-12T19:05:13Z', claimed_at: '2026-10-12T19:05:46Z', completed_at: '2026-10-12T19:06:15Z' }
  const evidence: Row = { external_message_id: 'provider-1', content: reply, direction: 'outgoing', delivery_status: 'sent',
    contact_id: '945233', kommo_lead_id: 4469212, lead_id: 'lead-1', author_type: 'bot',
    sent_at: '2026-10-12T19:06:14Z', observed_at: '2026-10-12T19:06:15Z', source: 'history' }
  const validation: Row = { event_id: 'event-1', lead_id: 'lead-1', conversation_id: 'conversation-1',
    step_key: 'response_validation', status: 'succeeded', output_summary: {
      final_preview: reply.replace(/\s+/g, ' ').trim(), response_length: reply.length } }
  const version: Row = { event_id: 'event-1', step_key: 'execution_version', output_summary: { batch_event_ids: ['event-1'] } }
  const conversation: Row = { id: 'conversation-1', lead_id: 'lead-1', last_message_at: '2026-10-12T19:05:13Z',
    summary: JSON.stringify({ _lead_profile: { full_name: 'Nathaly' }, _property_context: { selected_ids: [] } }) }
  const messages: Row[] = [], calls: string[] = [], registrationArgs: Row[] = [], savedQuestions: Row[] = []
  let failRegistration = false, failMemory = false, checkpointResult = true
  const store: DeliveryRegistrationRepairStore = {
    async actor() { return structuredClone(actor) },
    async event() { return structuredClone(event) },
    async evidence() { return [structuredClone(evidence)] },
    async traces() { return [structuredClone(version), structuredClone(validation)] },
    async conversation() { return structuredClone(conversation) },
    async exclusive(action) { calls.push('lock'); try { return await action() } finally { calls.push('release') } },
    async existing() { return structuredClone(messages) },
    async register(args) {
      calls.push('register'); registrationArgs.push(structuredClone(args))
      if (failRegistration) throw Error('RPC_REGISTER_OUTBOUND_MESSAGE_22P05')
      messages.push({ id: 'outbound-1', role: 'bot', content: args.p_content, conversation_id: args.p_conversation_id,
        tool_calls: args.p_tool_calls })
    },
    async stamp(message, observation) { calls.push('stamp'); Object.assign(messages.find(row => row.id === message.id)!, {
      external_message_id: observation.external_message_id, sent_at: observation.sent_at }) },
    async savePending(snapshot, pending) {
      calls.push('question'); savedQuestions.push(pending)
      if (failMemory || snapshot.summary !== conversation.summary) throw Error('DELIVERY_REGISTRATION_MEMORY_CONFLICT')
      conversation.summary = JSON.stringify({ ...object(conversation.summary), _pending_question: pending })
    },
    async finishCheckpoint() { calls.push('checkpoint'); return checkpointResult },
  }
  return { input, actor, event, evidence, validation, version, conversation, messages, calls, registrationArgs, savedQuestions, store,
    failRegistration: () => { failRegistration = true }, failMemory: () => { failMemory = true },
    rejectCheckpoint: () => { checkpointResult = false } }
}

test('an old accepted-send registration failure restores exact history and its actual budget question before any unlock', async () => {
  const f = fixture(), result = await repairReviewedDeliveryRegistration(f.input, f.store)
  assert.equal(result.repaired, true)
  assert.equal(result.continuity, 'budget_amount')
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0].content, reply)
  assert.equal(f.messages[0].sent_at, f.evidence.sent_at)
  assert.equal(f.messages[0].external_message_id, 'provider-1')
  assert.equal(object(f.registrationArgs[0].p_tool_calls).source_message_id, 'inbound-1')
  assert.deepEqual(object(f.registrationArgs[0].p_tool_calls).answered_message_ids, ['inbound-1'])
  const restored = object(f.conversation.summary)
  assert.deepEqual(restored._lead_profile, { full_name: 'Nathaly' })
  assert.deepEqual(restored._property_context, { selected_ids: [] })
  assert.equal(object(restored._pending_question).id, 'budget_amount')
  assert.match(String(object(restored._pending_question).question), /presupuesto total aproximado/)
  assert.equal(f.event.status, 'uncertain', 'Only the caller may reconcile and unlock after internal repair')
  assert.deepEqual(f.calls, ['lock', 'register', 'stamp', 'question', 'release'])
})

test('a second administrator attempt deduplicates source and provider identity instead of registering a second reply', async () => {
  const f = fixture()
  await repairReviewedDeliveryRegistration(f.input, f.store)
  await repairReviewedDeliveryRegistration(f.input, f.store)
  assert.equal(f.messages.length, 1)
  assert.equal(f.calls.filter(call => call === 'register').length, 1)
})

for (const [label, change] of [
  ['non-admin', (f: ReturnType<typeof fixture>) => { f.actor.role = 'asesor' }],
  ['inactive admin', (f: ReturnType<typeof fixture>) => { f.actor.is_active = false }],
  ['unconfirmed provider acceptance', (f: ReturnType<typeof fixture>) => { f.evidence.delivery_status = 'accepted' }],
  ['different lead', (f: ReturnType<typeof fixture>) => { f.evidence.kommo_lead_id = 123 }],
  ['different contact', (f: ReturnType<typeof fixture>) => { f.evidence.contact_id = '123' }],
  ['wrong provider id', (f: ReturnType<typeof fixture>) => { f.evidence.external_message_id = 'other' }],
  ['later human response', (f: ReturnType<typeof fixture>) => { f.evidence.content = 'Un asesor le atenderá mañana'; f.evidence.author_type = 'internal' }],
  ['a reply from another turn', (f: ReturnType<typeof fixture>) => { f.evidence.sent_at = '2026-10-12T19:10:00Z' }],
  ['truncated trace', (f: ReturnType<typeof fixture>) => { object(f.validation.output_summary).final_preview = reply.slice(0, 50) }],
  ['privacy-rewritten trace', (f: ReturnType<typeof fixture>) => { object(f.validation.output_summary).final_preview = '[Información privada]' }],
  ['wrong length', (f: ReturnType<typeof fixture>) => { object(f.validation.output_summary).response_length = reply.length - 1 }],
  ['incomplete validation', (f: ReturnType<typeof fixture>) => { f.validation.status = 'failed' }],
  ['different conversation lead', (f: ReturnType<typeof fixture>) => { f.conversation.lead_id = 'another-lead' }],
  ['unreviewed multi-message legacy batch', (f: ReturnType<typeof fixture>) => { object(f.version.output_summary).batch_event_ids = ['event-1', 'event-2'] }],
] as const) test(`historical registration rejects ${label} without writing or unlocking`, async () => {
  const f = fixture(); change(f)
  await assert.rejects(repairReviewedDeliveryRegistration(f.input, f.store))
  assert.equal(f.messages.length, 0)
  assert.equal(f.event.status, 'uncertain')
})

test('registration and memory failures keep the event blocked and release the internal lease', async () => {
  for (const fail of ['registration', 'memory']) {
    const f = fixture()
    if (fail === 'registration') f.failRegistration(); else f.failMemory()
    await assert.rejects(repairReviewedDeliveryRegistration(f.input, f.store))
    assert.equal(f.event.status, 'uncertain')
    assert.equal(f.calls.at(-1), 'release')
  }
})

test('an existing inconsistent history record is never replaced or duplicated', async () => {
  const f = fixture()
  f.messages.push({ id: 'wrong', role: 'bot', content: 'Otro mensaje', conversation_id: 'conversation-1' })
  await assert.rejects(repairReviewedDeliveryRegistration(f.input, f.store), /CONTENT_CONFLICT/)
  assert.equal(f.messages.length, 1)
  assert.equal(f.calls.includes('register'), false)
})

test('a later conversation state keeps its question and facts while old reply history is repaired', async () => {
  const f = fixture(), before = f.conversation.summary
  f.conversation.last_message_at = '2026-10-12T19:09:00Z'
  await repairReviewedDeliveryRegistration(f.input, f.store)
  assert.equal(f.conversation.summary, before)
  assert.equal(f.savedQuestions.length, 0)
})

test('a prepared checkpoint is repaired by its original journal without reconstructing historical metadata', async () => {
  const f = fixture(); object(f.event.result).reply_registration_checkpoint = '__reply_registration__:verified'
  const result = await repairReviewedDeliveryRegistration(f.input, f.store)
  assert.equal(result.recovery, 'reviewed_checkpoint_registration_only')
  assert.deepEqual(f.calls, ['lock', 'checkpoint', 'release'])
  assert.equal(f.registrationArgs.length, 0)
})

test('a missing or conflicting checkpoint cannot unlock the original incident', async () => {
  const f = fixture(); object(f.event.result).reply_registration_checkpoint = '__reply_registration__:missing'; f.rejectCheckpoint()
  await assert.rejects(repairReviewedDeliveryRegistration(f.input, f.store), /CHECKPOINT_REQUIRED/)
  assert.equal(f.event.status, 'uncertain')
})

test('an unknown registration outcome does not authorize retry from an empty local history', async () => {
  const f = fixture(); object(f.event.result).reason = 'RPC_REGISTER_OUTBOUND_MESSAGE_FAILED'
  await assert.rejects(repairReviewedDeliveryRegistration(f.input, f.store), /OUTCOME_UNKNOWN/)
  assert.equal(f.calls.includes('register'), false)
  assert.equal(f.event.status, 'uncertain')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import * as dataModule from './data'
import { AcceptedReplyRegistrationError, finishReplyRegistration, markReplyDispatchStarted,
  prepareReplyRegistration, registerAcceptedReply, type ReplyCheckpoint, type ReplyRegistrationStore } from './reply-registration'
import { recoverAcceptedReplyRegistrations } from './reply-registration'
import { markReplyMemorySaved } from './reply-registration'
import { finishReviewedReplyCheckpoint } from './reply-registration'

type RegisterOutcome = 'success' | 'rejected' | 'lost_after_commit' | 'lost_before_commit'
function mockStore() {
  let journal: Row | null = null
  let outcome: RegisterOutcome = 'success'
  let failSave: ((data: Row) => boolean) | null = null
  const messages: Row[] = []
  const calls = { prepare: 0, save: 0, existing: 0, register: 0, publish: 0 }
  const store: ReplyRegistrationStore = {
    async prepare(key, contact, data) {
      calls.prepare++
      journal ||= structuredClone(data)
      return { id: 'journal', key, contact, data: structuredClone(journal) }
    },
    async save(checkpoint, data) {
      calls.save++
      if (failSave?.(data)) throw Error('REPLY_CHECKPOINT_SAVE_FAILED')
      if (!journal || journal.delivery_state !== checkpoint.data.delivery_state
        || journal.registration_state !== checkpoint.data.registration_state) throw Error('REPLY_CHECKPOINT_SAVE_FAILED')
      journal = structuredClone(data)
      checkpoint.data = structuredClone(data)
    },
    async existing(args) {
      calls.existing++
      const matching = messages.filter(message => message.p_conversation_id === args.p_conversation_id
        && object(message.p_tool_calls).source_message_id === object(args.p_tool_calls).source_message_id)
      return !matching.length ? 'absent' : matching.length === 1 && matching[0].p_content === args.p_content ? 'matching' : 'conflicting'
    },
    async register(args) {
      calls.register++
      if (outcome === 'rejected') throw Error('RPC_REGISTER_OUTBOUND_MESSAGE_22P05')
      if (outcome !== 'lost_before_commit') messages.push(structuredClone(args))
      if (outcome === 'lost_before_commit' || outcome === 'lost_after_commit') throw Error('RPC_REGISTER_OUTBOUND_MESSAGE_FAILED')
      return { registered: true }
    },
  }
  return { store, calls, messages, setOutcome: (value: RegisterOutcome) => { outcome = value },
    setSaveFailure: (failure: (data: Row) => boolean) => { failSave = failure },
    reload: (checkpoint: ReplyCheckpoint) => ({ ...checkpoint, data: structuredClone(journal!) }),
    journal: () => structuredClone(journal) }
}

const input = (): Parameters<typeof prepareReplyRegistration>[0] => ({ args: { p_content: 'Perfecto, podemos continuar.', p_conversation_id: 'conversation', p_model: 'writer',
  p_tool_calls: { source_message_id: 'incoming-1', provider_status: 'accepted' } },
  summaryBefore: null, summaryAfter: { _pending_question: { id: 'property_bedrooms' } }, eventIds: ['incoming-event-1'], contact: 'contact-1' })

async function dispatch(mock: ReturnType<typeof mockStore>) {
  const checkpoint = await prepareReplyRegistration(input(), mock.store)
  await markReplyDispatchStarted(checkpoint, mock.store)
  mock.calls.publish++ // Stand-in for one successful Kommo launch, outside the registration-only module.
  return checkpoint
}

test('Unicode is prepared before external effects, preserving valid content and escaping metadata values and keys', async () => {
  const mock = mockStore()
  const candidate = input()
  candidate.args.p_content = 'Hola, recorrido 360° 🏠'
  candidate.args.p_tool_calls = { ...candidate.args.p_tool_calls, ['sensitive\u0000key']: '100\u0000000', isolated: '\ud800' }
  const checkpoint = await prepareReplyRegistration(candidate, mock.store)
  const args = object(checkpoint.data.args), metadata = object(args.p_tool_calls)
  assert.equal(args.p_content, candidate.args.p_content)
  assert.equal(metadata['sensitive\\u0000key'], '100\\u0000000')
  assert.equal(metadata.isolated, '\\ud800')
  const diagnostics = object(object(checkpoint.data.unicode_preflight).arguments)
  assert.equal(diagnostics.sanitized_keys, 1)
  assert.equal(diagnostics.sanitized_strings, 2)
  assert.equal(diagnostics.invalid_codepoints, 3)
  assert.equal(JSON.stringify(diagnostics).includes('sensitive'), false, 'Diagnostics must not expose arbitrary original keys')
  assert.equal(mock.calls.publish, 0)
  assert.equal(mock.calls.register, 0)
})

test('invalid customer content and colliding escaped keys fail before preparing or dispatching a message', async () => {
  for (const content of ['100\u0000000', 'Hola \ud800', 'Hola \udc00']) {
    const mock = mockStore(), candidate = input()
    candidate.args.p_content = content
    await assert.rejects(prepareReplyRegistration(candidate, mock.store), { message: 'POSTGRES_INVALID_TEXT' })
    assert.equal(mock.calls.prepare, 0)
    assert.equal(mock.calls.publish, 0)
  }
  const mock = mockStore(), candidate = input()
  candidate.args.p_tool_calls = { ...candidate.args.p_tool_calls, ['key\u0000']: 1, ['key\\u0000']: 2 }
  await assert.rejects(prepareReplyRegistration(candidate, mock.store), { message: 'POSTGRES_JSON_KEY_COLLISION' })
  assert.equal(mock.calls.prepare, 0)
  assert.equal(mock.calls.register, 0)
})

test('a PostgreSQL rollback permits registration-only recovery without another external publication', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  mock.setOutcome('rejected')
  await assert.rejects(registerAcceptedReply(checkpoint, mock.store), (error: unknown) =>
    error instanceof AcceptedReplyRegistrationError && error.original instanceof Error
      && error.original.message === 'RPC_REGISTER_OUTBOUND_MESSAGE_22P05')
  assert.equal(mock.journal()?.delivery_state, 'accepted')
  assert.equal(mock.journal()?.registration_state, 'failed')
  assert.equal(mock.journal()?.retry_safe, true)
  mock.setOutcome('success')
  await finishReplyRegistration(mock.reload(checkpoint), mock.store)
  assert.equal(mock.messages.length, 1)
  assert.equal(mock.calls.register, 2)
  assert.equal(mock.calls.publish, 1)
  assert.equal(mock.journal()?.registration_state, 'registered')
})

test('a lost response after commit is reconciled by read-only lookup, never by repeating registration or publication', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  mock.setOutcome('lost_after_commit')
  await assert.rejects(registerAcceptedReply(checkpoint, mock.store), AcceptedReplyRegistrationError)
  assert.equal(mock.messages.length, 1)
  assert.equal(mock.journal()?.retry_safe, false)
  await finishReplyRegistration(mock.reload(checkpoint), mock.store)
  assert.equal(mock.calls.register, 1)
  assert.equal(mock.calls.publish, 1)
  assert.equal(mock.journal()?.registration_state, 'registered')
})

test('a lost response before commit remains uncertain and cannot authorize a blind registration retry', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  mock.setOutcome('lost_before_commit')
  await assert.rejects(registerAcceptedReply(checkpoint, mock.store), AcceptedReplyRegistrationError)
  mock.setOutcome('success')
  await assert.rejects(finishReplyRegistration(mock.reload(checkpoint), mock.store), (error: unknown) =>
    error instanceof AcceptedReplyRegistrationError && error.original instanceof Error
      && error.original.message === 'REPLY_REGISTRATION_OUTCOME_UNKNOWN')
  assert.equal(mock.messages.length, 0)
  assert.equal(mock.calls.register, 1)
  assert.equal(mock.calls.publish, 1)
})

test('different registered content or duplicate rows prevent an automatic repair', async () => {
  for (const duplicate of [false, true]) {
    const mock = mockStore(), checkpoint = await dispatch(mock)
    const args = structuredClone(input().args)
    mock.messages.push(duplicate ? args : { ...args, p_content: 'Otro mensaje' })
    if (duplicate) mock.messages.push(args)
    await assert.rejects(registerAcceptedReply(checkpoint, mock.store), (error: unknown) =>
      error instanceof AcceptedReplyRegistrationError && error.original instanceof Error
        && error.original.message === 'REPLY_REGISTRATION_CONTENT_CONFLICT')
    assert.equal(mock.calls.register, 0)
    assert.equal(mock.calls.publish, 1)
  }
})

test('registration requires persisted provider acceptance, and an existing accepted journal never returns a dispatchable reply', async () => {
  const mock = mockStore()
  const checkpoint = await prepareReplyRegistration(input(), mock.store)
  await assert.rejects(finishReplyRegistration(checkpoint, mock.store), { message: 'REPLY_ACCEPTANCE_REQUIRED' })
  await markReplyDispatchStarted(checkpoint, mock.store)
  await assert.rejects(finishReplyRegistration(checkpoint, mock.store), { message: 'REPLY_ACCEPTANCE_REQUIRED' })
  await assert.rejects(prepareReplyRegistration(input(), mock.store), { message: 'REPLY_DISPATCH_REQUIRES_RECONCILIATION' })
  mock.calls.publish++
  await registerAcceptedReply(checkpoint, mock.store)
  await assert.rejects(prepareReplyRegistration(input(), mock.store), AcceptedReplyRegistrationError)
  assert.equal(mock.calls.publish, 1)
  assert.equal(mock.calls.register, 1)
})

test('two prepared checkpoints cannot both claim dispatch using the same journal phase', async () => {
  const mock = mockStore()
  const first = await prepareReplyRegistration(input(), mock.store)
  const second = await prepareReplyRegistration(input(), mock.store)
  await markReplyDispatchStarted(first, mock.store)
  await assert.rejects(markReplyDispatchStarted(second, mock.store), { message: 'REPLY_CHECKPOINT_SAVE_FAILED' })
  assert.equal(mock.calls.publish, 0)
  assert.equal(mock.calls.register, 0)
})

test('losing the durable acceptance update preserves known acceptance in the error without registering or allowing another dispatch', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  mock.setSaveFailure(data => data.delivery_state === 'accepted')
  await assert.rejects(registerAcceptedReply(checkpoint, mock.store), (error: unknown) =>
    error instanceof AcceptedReplyRegistrationError && error.checkpoint.data.delivery_state === 'accepted')
  assert.equal(mock.journal()?.delivery_state, 'attempted')
  assert.equal(mock.calls.register, 0)
  assert.equal(mock.calls.publish, 1)
  await assert.rejects(prepareReplyRegistration(input(), mock.store), { message: 'REPLY_DISPATCH_REQUIRES_RECONCILIATION' })
})

test('two recovery snapshots cannot both initiate a registration transaction', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted' })
  const first = mock.reload(checkpoint), second = mock.reload(checkpoint)
  const results = await Promise.allSettled([finishReplyRegistration(first, mock.store), finishReplyRegistration(second, mock.store)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(mock.calls.register, 1)
  assert.equal(mock.calls.publish, 1)
  assert.equal(mock.messages.length, 1)
})

/** Offline relational adapter: exercises the actual cron queries and CAS filters,
 * without Supabase credentials, a provider client, or any production mutation. */
function recoveryDatabase(checkpoint: ReplyCheckpoint) {
  const rpcCalls: Row[] = []
  const event: Row = { id: 'incoming-event-1', status: 'processing', result: {} }
  const checkpointRow: Row = { id: checkpoint.id, event_key: checkpoint.key, contact_key: checkpoint.contact, kind: 'lock', status: 'completed',
    payload: { task: 'reply_registration' }, result: structuredClone(checkpoint.data) }
  const tables: Record<string, Row[]> = {
    lv_integration_events: [checkpointRow, event],
    messages: [{ conversation_id: 'conversation', role: 'bot', content: input().args.p_content, tool_calls: input().args.p_tool_calls }],
    conversations: [{ id: 'conversation', summary: null }],
  }
  const valueAt = (row: Row, field: string) => {
    const [column, key] = field.split('->>')
    const value = key ? object(row[column])[key] : row[column]
    return key && typeof value === 'boolean' ? String(value) : value
  }
  class Query implements PromiseLike<{ data: Row[] | null; error: null; count: number }> {
    filters: ((row: Row) => boolean)[] = []
    patch: Row | null = null
    constructor(readonly table: string) {}
    select() { return this }
    update(patch: Row) { this.patch = patch; return this }
    match() { return this }
    eq(field: string, value: unknown) { this.filters.push(row => valueAt(row, field) === value); return this }
    neq(field: string, value: unknown) { this.filters.push(row => valueAt(row, field) !== value); return this }
    is(field: string, value: unknown) { return this.eq(field, value) }
    in(field: string, values: unknown[]) { this.filters.push(row => values.includes(valueAt(row, field))); return this }
    order() { return this }
    limit() { return this }
    abortSignal() { return this }
    execute() {
      const rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)))
      if (this.patch) for (const row of rows) Object.assign(row, structuredClone(this.patch))
      return { data: rows.map(row => structuredClone(row)), error: null, count: rows.length }
    }
    async maybeSingle() { const result = this.execute(); return { ...result, data: result.data[0] || null } }
    then<TResult1 = { data: Row[] | null; error: null; count: number }, TResult2 = never>(
      fulfilled?: ((value: { data: Row[] | null; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.execute()).then(fulfilled, rejected) }
  }
  return { db: () => ({ from: (table: string) => new Query(table),
    rpc: (name: string, args: Row) => { rpcCalls.push({ name, args }); return { abortSignal: async () => ({ data: { registered: true }, error: null }) } },
  }), event, checkpointRow, tables, rpcCalls }
}

test('reviewed provider history completes the original checkpoint memory without releasing or resending its input', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'attempted', registration_state: 'registered' })
  const fake = recoveryDatabase(checkpoint)
  Object.assign(fake.event, { status: 'uncertain', contact_key: checkpoint.contact, payload: { externalId: 'incoming-1' },
    result: { reply_registration_checkpoint: checkpoint.key } })
  const mutable = dataModule as unknown as { db: () => unknown }, original = mutable.db
  mutable.db = fake.db
  try {
    const input = { event: structuredClone(fake.event), evidence: { content: checkpoint.data.args && object(checkpoint.data.args).p_content,
      external_message_id: 'provider-1', sent_at: '2026-10-12T19:06:14Z' } }
    assert.equal(await finishReviewedReplyCheckpoint(input), true)
    assert.equal(await finishReviewedReplyCheckpoint(input), true)
    assert.equal(object(fake.checkpointRow.result).delivery_state, 'accepted')
    assert.equal(object(fake.checkpointRow.result).memory_saved, true)
    assert.equal(fake.tables.conversations[0].summary, checkpoint.data.summary_after)
    assert.equal(fake.event.status, 'uncertain')
    assert.equal(mock.calls.publish, 1)
    assert.equal(mock.calls.register, 0)
  } finally { mutable.db = original }
})

for (const conflict of ['content', 'source', 'contact', 'memory'] as const) test('reviewed checkpoint rejects '+conflict+' mismatch without completing the input', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'registered' })
  const fake = recoveryDatabase(checkpoint)
  Object.assign(fake.event, { status: 'uncertain', contact_key: conflict === 'contact' ? 'other' : checkpoint.contact,
    payload: { externalId: conflict === 'source' ? 'other-source' : 'incoming-1' }, result: { reply_registration_checkpoint: checkpoint.key } })
  if (conflict === 'memory') fake.tables.conversations[0].summary = 'Newer confirmed question'
  const before = fake.tables.conversations[0].summary
  const mutable = dataModule as unknown as { db: () => unknown }, original = mutable.db
  mutable.db = fake.db
  try {
    await assert.rejects(finishReviewedReplyCheckpoint({ event: structuredClone(fake.event), evidence: {
      content: conflict === 'content' ? 'A different reply' : object(checkpoint.data.args).p_content,
      external_message_id: 'provider-1', sent_at: '2026-10-12T19:06:14Z' } }))
    assert.equal(fake.tables.conversations[0].summary, before)
    assert.equal(fake.event.status, 'uncertain')
    assert.notEqual(object(fake.checkpointRow.result).memory_saved, true)
    assert.equal(mock.calls.register, 0)
  } finally { mutable.db = original }
})

test('cron cannot finish a journal before the worker has finished its processing input', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'registered' })
  const fake = recoveryDatabase(checkpoint)
  const mutableData = dataModule as unknown as { db: () => unknown }
  const original = mutableData.db
  mutableData.db = fake.db
  try {
    await recoverAcceptedReplyRegistrations(async () => {})
    assert.equal(object(fake.checkpointRow.result).recovery_complete, false,
      'A processing input can still be marked uncertain by its worker; keep the recovery journal available')
    fake.event.status = 'uncertain'
    fake.event.result = { reply_registration_checkpoint: checkpoint.key }
    await recoverAcceptedReplyRegistrations(async () => {})
    assert.equal(fake.event.status, 'completed')
    assert.equal(object(fake.checkpointRow.result).recovery_complete, true)
  } finally { mutableData.db = original }
})

test('recovery does not overwrite changed memory or release an unrelated uncertain input', async () => {
  for (const conflict of ['memory', 'different_checkpoint']) {
    const mock = mockStore(), checkpoint = await dispatch(mock)
    await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'registered' })
    const fake = recoveryDatabase(checkpoint)
    fake.event.status = 'uncertain'
    fake.event.result = { reply_registration_checkpoint: conflict === 'different_checkpoint' ? 'other-checkpoint' : checkpoint.key }
    if (conflict === 'memory') fake.tables.conversations[0].summary = 'Newer profile and pending question'
    const before = fake.tables.conversations[0].summary
    const mutableData = dataModule as unknown as { db: () => unknown }, original = mutableData.db
    mutableData.db = fake.db
    try {
      const result = await recoverAcceptedReplyRegistrations(async () => {})
      assert.equal(result.repaired, 0)
      assert.equal(result.unresolved, 1)
      assert.equal(fake.event.status, 'uncertain')
      assert.equal(fake.tables.conversations[0].summary, before)
      assert.equal(object(fake.checkpointRow.result).recovery_complete, false)
    } finally { mutableData.db = original }
  }
})

test('already-saved identical memory is a safe CAS no-op and still permits matching input completion', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'registered' })
  const fake = recoveryDatabase(checkpoint)
  fake.tables.conversations[0].summary = checkpoint.data.summary_after
  fake.event.status = 'uncertain'
  fake.event.result = { reply_registration_checkpoint: checkpoint.key }
  const mutableData = dataModule as unknown as { db: () => unknown }, original = mutableData.db
  mutableData.db = fake.db
  try {
    const result = await recoverAcceptedReplyRegistrations(async () => {})
    assert.equal(result.repaired, 1)
    assert.equal(fake.event.status, 'completed')
    assert.equal(object(fake.checkpointRow.result).recovery_complete, true)
  } finally { mutableData.db = original }
})

test('saving normal reply memory cannot close the journal before its source input is terminal', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'registered' })
  const fake = recoveryDatabase(checkpoint)
  const mutableData = dataModule as unknown as { db: () => unknown }, original = mutableData.db
  mutableData.db = fake.db
  try {
    await markReplyMemorySaved(checkpoint, true)
    assert.equal(object(fake.checkpointRow.result).recovery_complete, false)
    assert.equal(fake.event.status, 'processing')
  } finally { mutableData.db = original }
})

test('an administrator-reviewed not-sent outcome prevents later accepted-journal registration or memory restoration', async () => {
  const mock = mockStore(), checkpoint = await dispatch(mock)
  await mock.store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', registration_state: 'pending' })
  const fake = recoveryDatabase(checkpoint)
  fake.tables.messages.length = 0
  fake.event.status = 'cancelled'
  fake.event.result = { reconciliation_outcome: 'not_sent', reconciled_by: 'administrator',
    reply_registration_checkpoint: checkpoint.key }
  fake.tables.conversations[0].summary = 'Human-reviewed memory'
  const inputBefore = structuredClone(fake.event), summaryBefore = fake.tables.conversations[0].summary
  const mutableData = dataModule as unknown as { db: () => unknown }, original = mutableData.db
  mutableData.db = fake.db
  try {
    await recoverAcceptedReplyRegistrations(async () => {})
    assert.equal(fake.rpcCalls.length, 0, 'No registration RPC may contradict an explicit reviewed not-sent outcome')
    assert.deepEqual(fake.event, inputBefore)
    assert.equal(fake.tables.conversations[0].summary, summaryBefore)
    assert.equal(object(fake.checkpointRow.result).delivery_state, 'not_sent')
    assert.equal(object(fake.checkpointRow.result).recovery_complete, true)
  } finally { mutableData.db = original }
})

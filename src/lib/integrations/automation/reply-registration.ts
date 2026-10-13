import 'server-only'
import { createHash } from 'node:crypto'
import { db, object, rpc, scope, text, type Row } from './data'
import { assertPostgresText, preparePostgresJson } from './postgres-json'

const prefix = '__reply_registration__:'
export type ReplyCheckpoint = { id: string; key: string; contact: string; data: Row }
export type ReplyRegistrationStore = {
  prepare: (key: string, contact: string, data: Row) => Promise<ReplyCheckpoint>
  save: (checkpoint: ReplyCheckpoint, data: Row) => Promise<void>
  existing: (args: Row) => Promise<'absent' | 'matching' | 'conflicting'>
  register: (args: Row) => Promise<unknown>
}

/** Provider acceptance is known. This exception must never cause another send. */
export class AcceptedReplyRegistrationError extends Error {
  constructor(public readonly checkpoint: ReplyCheckpoint, public readonly original: unknown) {
    super('REPLY_ACCEPTED_REGISTRATION_PENDING')
  }
}

const code = (error: unknown) => error instanceof Error && /^[A-Z0-9_]{1,120}$/.test(error.message)
  ? error.message : 'REPLY_REGISTRATION_FAILED'
// An explicit PostgreSQL rejection rolls back its transaction. A lost HTTP
// response can hide a committed registration and cannot authorize a retry.
const transactionRejected = (error: unknown) => /^RPC_REGISTER_OUTBOUND_MESSAGE_(?:22[A-Z0-9]{3}|23[A-Z0-9]{3}|40[A-Z0-9]{3})$/.test(code(error))

const productionStore: ReplyRegistrationStore = {
  async prepare(key, contact, data) {
    const at = new Date().toISOString()
    const result = await db().from('lv_integration_events').upsert({ ...scope, event_key: key,
      kind: 'lock', status: 'completed', contact_key: contact, completed_at: at,
      payload: { task: 'reply_registration' }, result: data,
    }, { onConflict: 'project_id,event_key', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(10_000))
    if (result.error) throw Error('REPLY_CHECKPOINT_PREPARE_FAILED')
    const saved = await db().from('lv_integration_events').select('id,result').match(scope).eq('event_key', key)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (saved.error || !saved.data) throw Error('REPLY_CHECKPOINT_READ_FAILED')
    return { id: saved.data.id, key, contact, data: object(saved.data.result) }
  },
  async save(checkpoint, data) {
    const result = await db().from('lv_integration_events').update({ result: data }).match(scope)
      .eq('id', checkpoint.id).eq('event_key', checkpoint.key)
      .eq('result->>delivery_state', checkpoint.data.delivery_state)
      .eq('result->>registration_state', checkpoint.data.registration_state)
      .select('id').abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('REPLY_CHECKPOINT_SAVE_FAILED')
    checkpoint.data = data
  },
  async existing(args) {
    const source = text(object(args.p_tool_calls).source_message_id)
    const found = await db().from('messages').select('content').eq('conversation_id', args.p_conversation_id)
      .eq('role', 'bot').eq('tool_calls->>source_message_id', source).limit(2)
      .abortSignal(AbortSignal.timeout(10_000))
    if (found.error) throw Error('REPLY_REGISTRATION_CHECK_FAILED')
    if (!found.data?.length) return 'absent'
    return found.data.length === 1 && found.data[0].content === args.p_content ? 'matching' : 'conflicting'
  },
  register: args => rpc('register_outbound_message', args),
}

/** Prepare all persisted data before touching Kommo. The dedicated completed
 * lock row is a journal, not a conversation lease or a sendable queue item. */
export async function prepareReplyRegistration(input: {
  args: Row; summaryBefore: unknown; summaryAfter: Row; eventIds: string[]; contact: string
}, store: ReplyRegistrationStore = productionStore): Promise<ReplyCheckpoint> {
  assertPostgresText(text(input.args.p_content), 'reply')
  const prepared = preparePostgresJson(input.args)
  const summary = preparePostgresJson(input.summaryAfter)
  const args = object(prepared.value), source = text(object(args.p_tool_calls).source_message_id)
  if (!source || !text(args.p_conversation_id) || !input.eventIds.length || !input.contact) throw Error('REPLY_CHECKPOINT_INVALID')
  const key = prefix + createHash('sha256').update(JSON.stringify([args.p_conversation_id, source])).digest('hex')
  const fingerprint = createHash('sha256').update(JSON.stringify(args)).digest('hex')
  const data: Row = { version: 1, delivery_state: 'prepared', registration_state: 'pending', retry_safe: true, recovery_complete: false,
    args, content_hash: fingerprint, event_ids: input.eventIds,
    summary_before: typeof input.summaryBefore === 'string' ? input.summaryBefore : null,
    summary_after: JSON.stringify(summary.value), prepared_at: new Date().toISOString(),
    unicode_preflight: { arguments: prepared.diagnostics, summary: summary.diagnostics } }
  const checkpoint = await store.prepare(key, input.contact, data)
  if (checkpoint.data.delivery_state !== 'prepared') {
    if (checkpoint.data.delivery_state === 'accepted') throw new AcceptedReplyRegistrationError(checkpoint, Error('REPLY_ALREADY_ACCEPTED'))
    throw Error('REPLY_DISPATCH_REQUIRES_RECONCILIATION')
  }
  if (checkpoint.data.content_hash !== fingerprint) throw Error('REPLY_CHECKPOINT_CONTENT_CONFLICT')
  return checkpoint
}

export async function markReplyDispatchStarted(checkpoint: ReplyCheckpoint, store: ReplyRegistrationStore = productionStore) {
  if (checkpoint.data.delivery_state !== 'prepared') throw Error('REPLY_DISPATCH_REQUIRES_RECONCILIATION')
  await store.save(checkpoint, { ...checkpoint.data, delivery_state: 'attempted', attempted_at: new Date().toISOString() })
}

/** Called only after launchSalesbot returned successfully. Never interpret
 * this acknowledgement as confirmed WhatsApp delivery. */
export async function registerAcceptedReply(checkpoint: ReplyCheckpoint, store: ReplyRegistrationStore = productionStore) {
  if (checkpoint.data.delivery_state !== 'attempted') throw Error('REPLY_DISPATCH_STAGE_INVALID')
  try {
    await store.save(checkpoint, { ...checkpoint.data, delivery_state: 'accepted', accepted_at: new Date().toISOString() })
    await finishReplyRegistration(checkpoint, store)
  } catch (error) {
    // The worker retains acceptance proof even if this checkpoint update fails.
    checkpoint.data = { ...checkpoint.data, delivery_state: 'accepted' }
    throw error instanceof AcceptedReplyRegistrationError ? error : new AcceptedReplyRegistrationError(checkpoint, error)
  }
}

/** Registration only: this module deliberately has no Kommo/OpenAI calls. */
export async function finishReplyRegistration(checkpoint: ReplyCheckpoint, store: ReplyRegistrationStore = productionStore) {
  if (checkpoint.data.delivery_state !== 'accepted') throw Error('REPLY_ACCEPTANCE_REQUIRED')
  if (checkpoint.data.registration_state === 'registered') return
  const args = object(checkpoint.data.args)
  try {
    const existing = await store.existing(args)
    if (existing === 'conflicting') throw Error('REPLY_REGISTRATION_CONTENT_CONFLICT')
    if (existing === 'absent') {
      if (checkpoint.data.retry_safe !== true) throw Error('REPLY_REGISTRATION_OUTCOME_UNKNOWN')
      await store.save(checkpoint, { ...checkpoint.data, registration_state: 'attempted', retry_safe: false })
      try { await store.register(args) }
      catch (error) {
        const data = { ...checkpoint.data, registration_state: 'failed', retry_safe: transactionRejected(error), registration_error: code(error) }
        try { await store.save(checkpoint, data) } catch { /* Durable attempted state still forbids a blind retry. */ }
        throw error
      }
    }
    await store.save(checkpoint, { ...checkpoint.data, registration_state: 'registered',
      registered_at: new Date().toISOString(), registration_error: null, retry_safe: false })
  } catch (error) { throw new AcceptedReplyRegistrationError(checkpoint, error) }
}

/** Best-effort durable acceptance proof; errors here cannot change send status. */
export async function preserveAcceptedReply(checkpoint: ReplyCheckpoint) {
  try {
    const found = await db().from('lv_integration_events').select('result').match(scope).eq('id', checkpoint.id)
      .eq('event_key', checkpoint.key).abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (found.error || !found.data) return
    const fresh = { ...checkpoint, data: object(found.data.result) }
    if (!['attempted', 'accepted'].includes(text(fresh.data.delivery_state))) return
    await productionStore.save(fresh, { ...fresh.data, delivery_state: 'accepted', accepted_at: new Date().toISOString() })
  } catch { /* Worker result also retains proof. */ }
}

export async function markReplyMemorySaved(checkpoint: ReplyCheckpoint, saved: boolean) {
  if (!saved) return
  try { await productionStore.save(checkpoint, { ...checkpoint.data, memory_saved: true }) } catch { /* Cron may safely finish the journal. */ }
}

/** Cron repairs accepted replies internally, then releases only their matching
 * uncertain input events. An unknown provider outcome remains blocked. */
export async function recoverAcceptedReplyRegistrations(guard: () => Promise<void>, limit = 5): Promise<Row> {
  const pending = await db().from('lv_integration_events').select('id,event_key,contact_key,result').match(scope)
    .eq('kind', 'lock').eq('payload->>task', 'reply_registration').eq('result->>delivery_state', 'accepted')
    .neq('result->>recovery_complete', 'true').order('received_at', { ascending: true }).limit(limit)
    .abortSignal(AbortSignal.timeout(10_000))
  if (pending.error) throw Error('REPLY_REGISTRATION_RECOVERY_READ_FAILED')
  let repaired = 0, unresolved = 0
  for (const row of pending.data || []) {
    await guard()
    const checkpoint = { id: row.id, key: text(row.event_key), contact: text(row.contact_key), data: object(row.result) }
    if (!checkpoint.key.startsWith(prefix) || checkpoint.data.version !== 1) { unresolved++; continue }
    try {
      const events = Array.isArray(checkpoint.data.event_ids) ? checkpoint.data.event_ids : []
      const inputs = await db().from('lv_integration_events').select('id,status,result').match(scope).in('id', events)
        .abortSignal(AbortSignal.timeout(10_000))
      if (inputs.error || inputs.data?.length !== events.length) throw Error('REPLY_REGISTRATION_INPUT_CHECK_FAILED')
      if (inputs.data.some(event => event.status === 'cancelled' && object(event.result).reconciliation_outcome === 'not_sent')) {
        await productionStore.save(checkpoint, { ...checkpoint.data, delivery_state: 'not_sent', recovery_complete: true })
        repaired++
        continue
      }
      // The live worker still owns these inputs and may yet record uncertainty.
      // Closing the journal now would strand that later worker result forever.
      if (inputs.data.some(event => ['pending', 'processing'].includes(event.status))) { unresolved++; continue }
      if (inputs.data.some(event => event.status === 'uncertain'
        && object(event.result).reply_registration_checkpoint !== checkpoint.key)) throw Error('REPLY_REGISTRATION_INPUT_CONFLICT')
      await finishReplyRegistration(checkpoint)
      const reviewed = await db().from('lv_integration_events').select('id,status,result').match(scope).in('id', events)
        .abortSignal(AbortSignal.timeout(10_000))
      if (reviewed.error || reviewed.data?.length !== events.length) throw Error('REPLY_REGISTRATION_INPUT_CHECK_FAILED')
      if (reviewed.data.some(event => event.status === 'cancelled' && object(event.result).reconciliation_outcome === 'not_sent')) {
        await productionStore.save(checkpoint, { ...checkpoint.data, delivery_state: 'not_sent', recovery_complete: true })
        repaired++
        continue
      }
      const args = object(checkpoint.data.args), before = checkpoint.data.summary_before
      if (checkpoint.data.memory_saved !== true) {
        if (typeof checkpoint.data.delivery_retry_count === 'number') {
          if (await rpc('lv_app_save_retry_memory', { p_checkpoint: checkpoint.id }) !== true)
            throw Error('REPLY_REGISTRATION_MEMORY_CONFLICT')
        } else {
          let save = db().from('conversations').update({ summary: checkpoint.data.summary_after }).match(scope).eq('id', args.p_conversation_id)
          save = typeof before === 'string' ? save.eq('summary', before) : save.is('summary', null)
          const memory = await save.select('id').abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
          if (memory.error) throw Error('REPLY_REGISTRATION_MEMORY_FAILED')
          if (!memory.data) {
            const current = await db().from('conversations').select('summary').match(scope).eq('id', args.p_conversation_id)
              .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
            if (current.error || current.data?.summary !== checkpoint.data.summary_after) throw Error('REPLY_REGISTRATION_MEMORY_CONFLICT')
          }
        }
        await productionStore.save(checkpoint, { ...checkpoint.data, memory_saved: true })
      }
      // Do not modify processing events or incidents for a different reply.
      const released = await db().from('lv_integration_events').update({ status: 'completed', completed_at: new Date().toISOString(),
        result: { action: 'accepted', delivery_status: 'accepted', registration_status: 'registered',
          reply_registration_checkpoint: checkpoint.key, recovery: 'registration_only', requires_review: false } }).match(scope)
        .in('id', events).eq('status', 'uncertain').eq('result->>reply_registration_checkpoint', checkpoint.key)
        .abortSignal(AbortSignal.timeout(10_000))
      if (released.error) throw Error('REPLY_REGISTRATION_RELEASE_FAILED')
      const terminal = await db().from('lv_integration_events').select('id,status').match(scope).in('id', events)
        .abortSignal(AbortSignal.timeout(10_000))
      if (terminal.error || terminal.data?.length !== events.length
        || terminal.data.some(event => !['completed', 'cancelled'].includes(event.status))) throw Error('REPLY_REGISTRATION_INPUT_STILL_PENDING')
      await productionStore.save(checkpoint, { ...checkpoint.data, recovery_complete: true })
      repaired++
    } catch { unresolved++ }
  }
  return { repaired, unresolved, recovery: 'registration_only' }
}

/** The caller has validated an active administrator, matching provider history
 * and an exclusive worker lease. This completes only the original prepared
 * checkpoint and its compare-and-swap memory, never sends or unlocks inputs. */
export async function finishReviewedReplyCheckpoint(input: { event: Row; evidence: Row }): Promise<boolean> {
  const { event, evidence } = input, key = text(object(event.result).reply_registration_checkpoint)
  if (!key.startsWith(prefix)) return false
  const found = await db().from('lv_integration_events').select('id,event_key,contact_key,result').match(scope)
    .eq('event_key', key).eq('kind', 'lock').eq('payload->>task', 'reply_registration')
    .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
  if (found.error || !found.data) throw Error('REPLY_CHECKPOINT_READ_FAILED')
  const checkpoint: ReplyCheckpoint = { id: found.data.id, key, contact: text(found.data.contact_key), data: object(found.data.result) }
  const args = object(checkpoint.data.args), ids = Array.isArray(checkpoint.data.event_ids) ? checkpoint.data.event_ids.map(text) : []
  if (checkpoint.data.version !== 1 || checkpoint.contact !== event.contact_key || !ids.includes(text(event.id))
    || args.p_content !== evidence.content || !['attempted', 'accepted'].includes(text(checkpoint.data.delivery_state)))
    throw Error('REPLY_CHECKPOINT_CONTENT_CONFLICT')
  const inputs = await db().from('lv_integration_events').select('id,contact_key,status,payload,result').match(scope).in('id', ids)
    .abortSignal(AbortSignal.timeout(10_000))
  const source = text(object(args.p_tool_calls).source_message_id)
  if (inputs.error || inputs.data?.length !== ids.length || inputs.data.some(row => row.contact_key !== checkpoint.contact
    || !['uncertain', 'completed', 'cancelled'].includes(row.status)
    || row.status === 'uncertain' && object(row.result).reply_registration_checkpoint !== key)
    || !inputs.data.some(row => object(row.payload).externalId === source)) throw Error('REPLY_REGISTRATION_INPUT_CONFLICT')
  if (checkpoint.data.delivery_state === 'attempted') await productionStore.save(checkpoint, { ...checkpoint.data,
    delivery_state: 'accepted', accepted_at: evidence.sent_at, provider_message_id: evidence.external_message_id })
  await finishReplyRegistration(checkpoint)
  if (checkpoint.data.memory_saved !== true) {
    if (typeof checkpoint.data.delivery_retry_count === 'number') {
      if (await rpc('lv_app_save_retry_memory', { p_checkpoint: checkpoint.id }) !== true)
        throw Error('REPLY_REGISTRATION_MEMORY_CONFLICT')
    } else {
      const before = checkpoint.data.summary_before
      let save = db().from('conversations').update({ summary: checkpoint.data.summary_after }).match(scope).eq('id', args.p_conversation_id)
      save = typeof before === 'string' ? save.eq('summary', before) : save.is('summary', null)
      const result = await save.select('id').abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
      if (result.error) throw Error('REPLY_REGISTRATION_MEMORY_FAILED')
      if (!result.data) {
        const current = await db().from('conversations').select('summary').match(scope).eq('id', args.p_conversation_id)
          .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
        if (current.error || current.data?.summary !== checkpoint.data.summary_after) throw Error('REPLY_REGISTRATION_MEMORY_CONFLICT')
      }
    }
    await productionStore.save(checkpoint, { ...checkpoint.data, memory_saved: true })
  }
  return true
}

import 'server-only'
import { randomUUID } from 'node:crypto'
import { db, object, rpc, scope, text, type Row } from './data'
import { assertPostgresText, preparePostgresJson } from './postgres-json'
import { pendingQuestionFromReply } from './turn-semantics'
import { finishReviewedReplyCheckpoint } from './reply-registration'

export type DeliveryRegistrationRepairStore = {
  actor: (id: string) => Promise<Row>
  event: (id: string) => Promise<Row>
  evidence: (messageId: string) => Promise<Row[]>
  traces: (eventId: string) => Promise<Row[]>
  conversation: (id: string) => Promise<Row>
  exclusive: <T>(action: () => Promise<T>) => Promise<T>
  existing: (conversationId: string, source: string, providerMessageId: string) => Promise<Row[]>
  register: (args: Row) => Promise<unknown>
  stamp: (message: Row, evidence: Row) => Promise<void>
  savePending: (conversation: Row, pending: Row) => Promise<void>
  finishCheckpoint: (event: Row, evidence: Row) => Promise<boolean>
}

const productionStore: DeliveryRegistrationRepairStore = {
  async actor(id) {
    const result = await db().from('profiles').select('id,role,is_active').eq('id', id).abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('DELIVERY_REVIEW_FORBIDDEN')
    return result.data
  },
  async event(id) {
    const result = await db().from('lv_integration_events').select('*').match(scope).eq('id', id).abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('INCIDENT_NOT_REVIEWABLE')
    return result.data
  },
  async evidence(messageId) {
    const result = await db().from('kommo_message_evidence').select('*').match(scope)
      .eq('external_message_id', messageId).eq('direction', 'outgoing').in('delivery_status', ['sent', 'delivered', 'read'])
      .order('observed_at', { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(10_000))
    if (result.error) throw Error('DELIVERY_EVIDENCE_REQUIRED')
    return result.data || []
  },
  async traces(eventId) {
    const result = await db().from('lv_automation_execution_steps').select('event_id,lead_id,conversation_id,step_key,status,output_summary')
      .match(scope).eq('event_id', eventId).in('step_key', ['execution_version', 'response_validation']).abortSignal(AbortSignal.timeout(10_000))
    if (result.error) throw Error('DELIVERY_REGISTRATION_TRACE_REQUIRED')
    return result.data || []
  },
  async conversation(id) {
    const result = await db().from('conversations').select('id,lead_id,summary,last_message_at').match(scope).eq('id', id)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('DELIVERY_REGISTRATION_CONVERSATION_REQUIRED')
    return result.data
  },
  async exclusive(action) {
    const token = randomUUID()
    if (await rpc('lv_app_worker_lock', { p_token: token, p_action: 'acquire' }) !== true) throw Error('WORKER_BUSY')
    try { return await action() }
    finally { await rpc('lv_app_worker_lock', { p_token: token, p_action: 'release' }) }
  },
  async existing(conversationId, source, providerMessageId) {
    const client = db()
    const results = await Promise.all([
      client.from('messages').select('id,role,content,conversation_id,external_message_id,tool_calls')
        .eq('conversation_id', conversationId).eq('tool_calls->>source_message_id', source).limit(3).abortSignal(AbortSignal.timeout(10_000)),
      client.from('messages').select('id,role,content,conversation_id,external_message_id,tool_calls')
        .eq('conversation_id', conversationId).eq('external_message_id', providerMessageId).limit(3).abortSignal(AbortSignal.timeout(10_000)),
      client.from('messages').select('id,role,content,conversation_id,external_message_id,tool_calls')
        .eq('conversation_id', conversationId).eq('tool_calls->>provider_message_id', providerMessageId).limit(3).abortSignal(AbortSignal.timeout(10_000)),
    ])
    if (results.some(result => result.error)) throw Error('DELIVERY_REGISTRATION_CHECK_FAILED')
    return [...new Map(results.flatMap(result => result.data || []).map(row => [row.id, row])).values()]
  },
  register: args => rpc('register_outbound_message', args),
  async stamp(message, evidence) {
    const result = await db().from('messages').update({ external_message_id: evidence.external_message_id, sent_at: evidence.sent_at })
      .eq('id', message.id).eq('conversation_id', message.conversation_id).eq('role', 'bot').eq('content', message.content)
      .select('id').abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('DELIVERY_REGISTRATION_STAMP_FAILED')
  },
  async savePending(conversation, pending) {
    if (typeof conversation.summary === 'string' && conversation.summary.trim()) {
      try { const parsed = JSON.parse(conversation.summary); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error() }
      catch { throw Error('DELIVERY_REGISTRATION_MEMORY_REQUIRES_REVIEW') }
    }
    const summary = object(conversation.summary)
    if (JSON.stringify(summary._pending_question) === JSON.stringify(pending)) return
    let query = db().from('conversations').update({ summary: JSON.stringify({ ...summary, _pending_question: pending }) })
      .match(scope).eq('id', conversation.id)
    query = typeof conversation.summary === 'string' ? query.eq('summary', conversation.summary) : query.is('summary', null)
    const result = await query.select('id').abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (result.error || !result.data) throw Error('DELIVERY_REGISTRATION_MEMORY_CONFLICT')
  },
  finishCheckpoint: (event, evidence) => finishReviewedReplyCheckpoint({ event, evidence }),
}

const at = (value: unknown) => Date.parse(text(value))
const canonicalText = (value: string) => value.replace(/\s+/g, ' ').trim()

/** Restore only a verified, previously sent bot reply. No provider write,
 * model call, queue claim or contact release occurs here. The administrator's
 * existing reconciliation RPC may unlock the contact only after this succeeds. */
export async function repairReviewedDeliveryRegistration(input: {
  eventId: string; actorId: string; providerMessageId: string; reviewReference: string
}, store: DeliveryRegistrationRepairStore = productionStore): Promise<Row> {
  const [actor, initial] = await Promise.all([store.actor(input.actorId), store.event(input.eventId)])
  if (actor.id !== input.actorId || actor.role !== 'admin' || actor.is_active !== true) throw Error('DELIVERY_REVIEW_FORBIDDEN')
  const reason = text(object(initial.result).reason), checkpoint = text(object(initial.result).reply_registration_checkpoint)
  if (!checkpoint && !/^RPC_REGISTER_OUTBOUND_MESSAGE_[A-Z0-9]+$/.test(reason)) return { repaired: false, reason: 'registration_not_failed' }
  if (initial.status !== 'uncertain' || !['inbound', 'delivery_retry'].includes(text(initial.kind))) {
    if (initial.status === 'completed' && object(initial.result).reconciliation_outcome === 'sent') return { repaired: false, already_reviewed: true }
    throw Error('INCIDENT_NOT_REVIEWABLE')
  }
  return store.exclusive(async () => {
    const event = await store.event(input.eventId), payload = object(event.payload)
    if (event.status !== 'uncertain' || !['inbound', 'delivery_retry'].includes(text(event.kind)) || event.contact_key !== initial.contact_key
      || text(object(event.result).reason) !== reason || text(object(event.result).reply_registration_checkpoint) !== checkpoint)
      throw Error('INCIDENT_NOT_REVIEWABLE')
    if (![payload.kommoId, payload.contactId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0))
      throw Error('DELIVERY_REGISTRATION_IDENTITY_REQUIRED')
    const lower = at(event.claimed_at || event.received_at) - 60_000, upper = at(event.completed_at) + 60_000
    const candidates = (await store.evidence(input.providerMessageId)).filter(evidence =>
      evidence.external_message_id === input.providerMessageId && evidence.direction === 'outgoing'
      && ['sent', 'delivered', 'read'].includes(text(evidence.delivery_status))
      && String(evidence.contact_id) === String(payload.contactId)
      && Number(evidence.kommo_lead_id) === Number(payload.kommoId)
      && `${payload.kommoId}:${payload.contactId}` === text(event.contact_key)
      && Number.isFinite(lower) && Number.isFinite(upper) && at(evidence.sent_at) >= lower && at(evidence.sent_at) <= upper
      && text(evidence.content).trim())
    if (!candidates.length || candidates.some(value => value.content !== candidates[0].content)) throw Error('DELIVERY_EVIDENCE_REQUIRED')
    const evidence = candidates[0]
    assertPostgresText(text(evidence.content), 'reviewed_provider_reply')
    if (checkpoint) {
      if (!await store.finishCheckpoint(event, evidence)) throw Error('DELIVERY_REGISTRATION_CHECKPOINT_REQUIRED')
      return { repaired: true, recovery: 'reviewed_checkpoint_registration_only' }
    }
    const traces = await store.traces(input.eventId), version = traces.find(row => row.step_key === 'execution_version')
    const batch = object(version?.output_summary).batch_event_ids
    if (!Array.isArray(batch) || batch.length !== 1 || batch[0] !== event.id) throw Error('DELIVERY_REGISTRATION_BATCH_REVIEW_REQUIRED')
    const validations = traces.filter(row => row.event_id === event.id && row.step_key === 'response_validation' && row.status === 'succeeded'
      && object(row.output_summary).response_length === text(evidence.content).length
      && text(object(row.output_summary).final_preview) === canonicalText(text(evidence.content)))
    if (validations.length !== 1 || !text(validations[0].conversation_id) || !text(validations[0].lead_id))
      throw Error('DELIVERY_REGISTRATION_FULL_TRACE_REQUIRED')
    const validation = validations[0], conversation = await store.conversation(text(validation.conversation_id))
    if (conversation.lead_id !== validation.lead_id || evidence.lead_id && evidence.lead_id !== validation.lead_id)
      throw Error('DELIVERY_REGISTRATION_LEAD_CONFLICT')
    const source = text(payload.externalId)
    if (!source) throw Error('DELIVERY_REGISTRATION_SOURCE_REQUIRED')
    const args = object(preparePostgresJson({ p_conversation_id: conversation.id, p_content: evidence.content,
      p_model: 'reviewed_historical_delivery', p_tool_calls: { source_message_id: source, answered_message_ids: [source],
        provider_message_id: evidence.external_message_id, provider_status: evidence.delivery_status,
        delivery_reconciliation: { event_id: event.id, actor_id: actor.id, review_reference: input.reviewReference,
          recovery: 'registration_only', history_source: evidence.source, sent_at: evidence.sent_at,
          continuity_restoration: 'delivered_question_only' } } }).value)
    const existing = await store.existing(text(conversation.id), source, input.providerMessageId)
    const matching = (rows: Row[]) => rows.length === 1 && rows[0].role === 'bot' && rows[0].content === evidence.content
      && rows[0].conversation_id === conversation.id
    if (existing.length && !matching(existing)) throw Error('DELIVERY_REGISTRATION_CONTENT_CONFLICT')
    if (!existing.length) {
      // A PostgreSQL rejection rolled back the original transaction. A lost
      // response might still commit later, so absence alone cannot permit retry.
      if (!/^RPC_REGISTER_OUTBOUND_MESSAGE_(?:22|23|40)[A-Z0-9]{3}$/.test(reason)) throw Error('DELIVERY_REGISTRATION_OUTCOME_UNKNOWN')
      await store.register(args)
    }
    const saved = existing.length ? existing : await store.existing(text(conversation.id), source, input.providerMessageId)
    if (!matching(saved)) throw Error('DELIVERY_REGISTRATION_NOT_CONFIRMED')
    await store.stamp(saved[0], evidence)
    const pending = pendingQuestionFromReply(text(evidence.content))
    // The saved question may be restored only from the exact delivered copy,
    // and only while the pre-registration snapshot has no later conversation.
    if (text(pending.id) && (!text(conversation.last_message_at) || at(conversation.last_message_at) <= at(evidence.sent_at)))
      await store.savePending(conversation, { ...pending, delivered_message_id: evidence.external_message_id,
        receipt_source: 'reviewed_provider_history' })
    return { repaired: true, recovery: 'reviewed_historical_registration_only', continuity: text(pending.id) || null }
  })
}

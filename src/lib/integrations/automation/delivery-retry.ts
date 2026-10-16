import 'server-only'
import { automationSettings } from './config'
import { autoConfig, db, object, one, permitted, rpc, scope, text, type Row } from './data'
import { botStopped, getKommoLead, launchSalesbot, setKommoField } from './kommo'
import { markReplyDispatchStarted, registerAcceptedReply, markReplyMemorySaved, type ReplyCheckpoint } from './reply-registration'
import { PreReplySendError } from './delivery-phase'
import { audienceAllows } from './audience-boundary'

export type DeliveryRetryStore = {
  checkpoint: (key: string) => Promise<ReplyCheckpoint>
  allowed: (event: Row, checkpoint: ReplyCheckpoint) => Promise<boolean>
  start: (checkpoint: ReplyCheckpoint) => Promise<void>
  field: (lead: number, content: string) => Promise<void>
  launch: (lead: number, event: Row) => Promise<void>
  register: (checkpoint: ReplyCheckpoint) => Promise<void>
  memory: (checkpoint: ReplyCheckpoint) => Promise<boolean>
}
const productionStore: DeliveryRetryStore = {
  async checkpoint(key) {
    const found = await db().from('lv_integration_events').select('id,event_key,contact_key,result').match(scope)
      .eq('event_key', key).eq('kind', 'lock').eq('payload->>task', 'reply_registration')
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    if (found.error || !found.data) throw Error('DELIVERY_RETRY_CHECKPOINT_REQUIRED')
    return { id: found.data.id, key, contact: text(found.data.contact_key), data: object(found.data.result) }
  },
  async allowed(event, checkpoint) {
    const args = object(checkpoint.data.args), payload = object(event.payload)
    const config = await autoConfig()
    if (!audienceAllows(config._audience, text(payload.sentAt), text(event.received_at) || undefined)) return false
    const conversation = await one('conversations', text(args.p_conversation_id))
    const lead = await one('leads', text(conversation.lead_id))
    if (!permitted(config, lead, automationSettings().testLeadId) || lead.bot_enabled !== true || lead.tracking_opt_out_at
      || Number(lead.kommo_id) !== Number(payload.kommoId) || String(lead.contact_id) !== String(payload.contactId)
      || (conversation.summary ?? null) !== (checkpoint.data.summary_before ?? null)) return false
    const active = await db().from('lv_integration_events').select('id').match(scope).eq('id', event.id)
      .eq('status', 'processing').eq('claim_token', event.claim_token).maybeSingle()
    if (active.error) throw Error('DELIVERY_RETRY_STATE_CHECK_FAILED')
    if (!active.data || botStopped(await getKommoLead(Number(payload.kommoId)))) return false
    const [existing, human, outbox] = await Promise.all([
      db().from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id)
        .eq('role', 'bot').eq('tool_calls->>source_message_id', text(object(args.p_tool_calls).source_message_id)),
      db().from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id)
        .eq('role', 'asesor').gt('sent_at', payload.sentAt),
      db().from('lv_outbox').select('id', { count: 'exact', head: true }).match(scope).eq('lead_id', lead.id)
        .in('status', ['claimed', 'uncertain']),
    ])
    if ([existing, human, outbox].some(result => result.error)) throw Error('DELIVERY_RETRY_ACTIVITY_CHECK_FAILED')
    return !existing.count && !human.count && !outbox.count
  },
  start: markReplyDispatchStarted,
  field: (lead, content) => setKommoField(lead, 457014, content),
  async launch(lead, event) {
    const config = await autoConfig()
    await launchSalesbot(lead, 15578, { audience: config._audience, sourceAt: text(object(event.payload).sentAt), jobCreatedAt: text(event.received_at) || undefined })
  },
  register: registerAcceptedReply,
  async memory(checkpoint) {
    const saved = await rpc('lv_app_save_retry_memory', { p_checkpoint: checkpoint.id }) === true
    await markReplyMemorySaved(checkpoint, saved)
    return saved
  },
}

/** Only the reconciliation RPC creates these tasks, after an administrator
 * confirms non-delivery. Reuse the checked draft, without repeating AI or
 * commercial actions, and leave an ambiguous new launch for another review. */
export async function sendConfirmedDeliveryRetry(event: Row, guard: () => Promise<void>, store = productionStore): Promise<Row> {
  const payload = object(event.payload), sourceAt = Date.parse(text(payload.sentAt))
  const cancelled = (reason: string) => ({ action: 'cancelled', reason, delivery_status: 'not_sent', requires_review: true })
  const key = text(payload.checkpoint_key)
  if (!Number.isFinite(sourceAt) || Date.now() - sourceAt >= 24 * 3_600_000) return cancelled('REPLY_WINDOW_EXPIRED')
  let checkpoint: ReplyCheckpoint
  try {
    await guard()
    checkpoint = await store.checkpoint(key)
    if (!key.startsWith('__reply_registration__:') || checkpoint.contact !== event.contact_key
      || checkpoint.data.delivery_state !== 'prepared' || !text(checkpoint.data.reviewed_by)
      || !Array.isArray(checkpoint.data.event_ids) || !checkpoint.data.event_ids.includes(event.id)
      || !text(object(checkpoint.data.args).p_content)) throw Error('DELIVERY_RETRY_CHECKPOINT_INVALID')
    if (!await store.allowed(event, checkpoint)) return cancelled('DELIVERY_RETRY_NO_LONGER_AUTHORIZED')
    await store.field(Number(payload.kommoId), text(object(checkpoint.data.args).p_content))
    await guard()
    if (Date.now() - sourceAt >= 24 * 3_600_000) return cancelled('REPLY_WINDOW_EXPIRED')
    if (!await store.allowed(event, checkpoint)) return cancelled('DELIVERY_RETRY_NO_LONGER_AUTHORIZED')
    await store.start(checkpoint)
  } catch (error) { throw new PreReplySendError(error) }
  await store.launch(Number(payload.kommoId), event)
  await store.register(checkpoint)
  let memorySaved = false
  try { memorySaved = await store.memory(checkpoint) } catch { /* Accepted-reply recovery can finish registration; never resend. */ }
  return { action: 'confirmed_delivery_retry', delivery_status: 'accepted', registration_status: 'registered',
    reply_registration_checkpoint: checkpoint.key, memory_saved: memorySaved, delivery_confirmed: false }
}

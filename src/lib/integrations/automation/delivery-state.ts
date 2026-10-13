import 'server-only'
import { randomUUID } from 'node:crypto'
import { kommoFailureExplanation } from './kommo-failure'
import { db, object, rpc, scope, text } from './data'
import { transportHealth } from './transport-monitor'

const stateKey = '__kommo_delivery__'
export const accountBlockedStatus = (status: number) => [401, 402, 403].includes(status)
// A received rejection is different from a lost response after a write.
export const rejectedWriteStatus = (status: number) => status >= 400 && status < 500 && status !== 408

export async function recordKommoBlock(status: number, operation: string) {
  if (!accountBlockedStatus(status)) return
  const at = new Date().toISOString()
  const { error } = await db().from('lv_integration_events').upsert({ ...scope,
    event_key: stateKey, kind: 'lock', status: 'completed',
    result: { blocked: true, http_status: status, operation, detected_at: at }, completed_at: at,
  }, { onConflict: 'project_id,event_key' })
  if (error) throw Error('DELIVERY_BLOCK_SAVE_FAILED')
}

export async function kommoDeliveryBlock() {
  const { data, error } = await db().from('lv_integration_events').select('result').match(scope)
    .eq('event_key', stateKey).abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
  if (error) throw Error('DELIVERY_BLOCK_READ_FAILED')
  const state = object(data?.result)
  if (state.blocked === true) return state
  // Compatibility with failures recorded before this monitor existed, and a
  // fallback if recording the central block failed but the worker saved its event.
  let query = db().from('lv_integration_events').select('result,completed_at,received_at').match(scope)
    .in('status', ['uncertain', 'cancelled']).in('result->>reason', ['KOMMO_401', 'KOMMO_402', 'KOMMO_403'])
    .order('completed_at', { ascending: false, nullsFirst: false }).limit(1)
  if (text(state.resumed_at)) query = query.gt('completed_at', state.resumed_at)
  const failures = await query.abortSignal(AbortSignal.timeout(10_000))
  if (failures.error) throw Error('DELIVERY_BLOCK_READ_FAILED')
  const failure = failures.data?.[0]
  if (!failure) return null
  const result = object(failure.result)
  return { blocked: true, http_status: Number(result.http_status) || Number(text(result.reason).slice(-3)),
    operation: text(result.provider_operation), detected_at: failure.completed_at || failure.received_at }
}

export async function deliveryHealth() {
  const [block, incidents, pending, transport, retries] = await Promise.all([
    kommoDeliveryBlock(),
    db().from('lv_integration_events').select('id,contact_key,kind,status,result,completed_at,received_at', { count: 'exact' }).match(scope)
      .neq('kind', 'lock').or('status.eq.uncertain,and(status.eq.cancelled,result->>requires_review.eq.true)')
      .order('received_at', { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(10_000)),
    db().from('lv_integration_events').select('id', { count: 'exact', head: true }).match(scope)
      .eq('kind', 'inbound').eq('status', 'pending').abortSignal(AbortSignal.timeout(10_000)),
    transportHealth(),
    db().from('lv_integration_events').select('id', { count: 'exact', head: true }).match(scope)
      .eq('kind', 'delivery_retry').in('status', ['pending', 'processing']).abortSignal(AbortSignal.timeout(10_000)),
  ])
  if (incidents.error || pending.error || retries.error) throw Error('DELIVERY_HEALTH_READ_FAILED')
  const items = (incidents.data || []).map(row => {
    const result = object(row.result), kommoId = Number(text(row.contact_key).split(':')[0])
    // Older versions incorrectly called every 4xx write uncertain. A definite
    // provider rejection does not mean a bot was launched.
    const status = Number(result.http_status)
    const rejected = rejectedWriteStatus(status)
    return { id: row.id, kommoId: Number.isSafeInteger(kommoId) && kommoId > 0 ? kommoId : null,
      reason: text(result.reason), at: row.completed_at || row.received_at,
      explanation: kommoFailureExplanation(text(result.reason), result),
      canResolve: row.status === 'cancelled' && result.requires_review === true,
      canReconcile: row.status === 'uncertain' && ['inbound', 'advisor_outbound', 'delivery_retry'].includes(row.kind),
      delivery: result.delivery_status === 'accepted' && result.registration_status === 'pending' ? 'accepted_registration_pending' as const
        : rejected ? 'rejected' as const : result.delivery_status === 'not_sent' ? 'not_sent' as const
        : result.delivery_status === 'generation_failed' || /^OPENAI_(?:HTTP_|NETWORK_ERROR)/.test(text(result.reason)) ? 'generation_failed' as const : 'unknown' as const }
  })
  return { blocked: !!block, httpStatus: Number(block?.http_status) || null,
    detectedAt: text(block?.detected_at) || null, pendingMessages: pending.count || 0, retryPending: retries.count || 0,
    incidents: items, incidentCount: incidents.count || 0, transport }
}

// Explicit administrator recovery only. This does not replay any failed send,
// clear customer history, change DETENER IA, or claim that Kommo is now healthy.
export async function resumeAfterKommoReview(actorId: string) {
  const token = randomUUID()
  if (await rpc('lv_app_worker_lock', { p_token: token, p_action: 'acquire' }) !== true) throw Error('WORKER_BUSY')
  try {
    const at = new Date().toISOString()
    // Retain an actionable incident, but release the legacy per-contact lock for
    // known rejected requests. Never release a timeout or uncertain bot launch.
    for (;;) {
      const { data, error } = await db().from('lv_integration_events').select('id,result').match(scope)
        .eq('status', 'uncertain').in('result->>http_status', ['401', '402', '403']).limit(100)
      if (error) throw Error('DELIVERY_RECOVERY_READ_FAILED')
      if (!data?.length) break
      for (const row of data) {
        const { error: updateError } = await db().from('lv_integration_events').update({ status: 'cancelled',
          result: { ...object(row.result), delivery_uncertain: false, requires_review: true, recovery: 'not_replayed',
            account_reviewed_at: at, account_reviewed_by: actorId } }).match(scope).eq('id', row.id).eq('status', 'uncertain')
        if (updateError) throw Error('DELIVERY_RECOVERY_SAVE_FAILED')
      }
      if (await rpc('lv_app_worker_lock', { p_token: token, p_action: 'renew' }) !== true) throw Error('WORKER_BUSY')
    }
    const { error } = await db().from('lv_integration_events').upsert({ ...scope,
      event_key: stateKey, kind: 'lock', status: 'completed',
      result: { blocked: false, resumed_at: at, reviewed_by: actorId }, completed_at: at,
    }, { onConflict: 'project_id,event_key' })
    if (error) throw Error('DELIVERY_RECOVERY_SAVE_FAILED')
  } finally { await rpc('lv_app_worker_lock', { p_token: token, p_action: 'release' }) }
}

export async function resolveDeliveryIncident(id: string, actorId: string) {
  // Only definitively rejected attempts can be dismissed here. An ambiguous
  // delivery needs a provider-history review before its contact lock is removed.
  const { data, error } = await db().from('lv_integration_events').select('result,status').match(scope)
    .eq('id', id).eq('status', 'cancelled').contains('result', { requires_review: true }).maybeSingle()
  if (error || !data) throw Error('INCIDENT_NOT_REVIEWABLE')
  const { error: updateError } = await db().from('lv_integration_events').update({ result: {
    ...object(data.result), requires_review: false, reviewed_by: actorId, reviewed_at: new Date().toISOString(),
  } }).match(scope).eq('id', id).eq('status', 'cancelled')
  if (updateError) throw Error('INCIDENT_REVIEW_FAILED')
}

export type DeliveryReconciliation = {
  outcome: 'sent' | 'not_sent'; reviewed: boolean; providerMessageId?: string; reviewReference: string; retry?: boolean
}

/** A history check reconciles the whole reply batch. Optional non-delivery
 * recovery queues one guarded retry; this request never launches a bot. */
export async function reconcileDeliveryIncident(id: string, actorId: string, review: DeliveryReconciliation) {
  if (review.reviewed !== true || !['sent', 'not_sent'].includes(review.outcome)
    || review.reviewReference.trim().length < 3 || review.reviewReference.length > 300
    || (review.outcome === 'sent' && !review.providerMessageId?.trim())
    || (review.outcome === 'not_sent' && !!review.providerMessageId?.trim())) throw Error('DELIVERY_REVIEW_REQUIRED')
  if (review.outcome === 'sent') {
    const { repairReviewedDeliveryRegistration } = await import('./historical-delivery-registration')
    await repairReviewedDeliveryRegistration({ eventId: id, actorId, providerMessageId: review.providerMessageId!.trim(),
      reviewReference: review.reviewReference.trim() })
  }
  const saved = await db().rpc('lv_app_reconcile_delivery_v2', { p_event: id, p_actor: actorId,
    p_outcome: review.outcome, p_reviewed: true, p_provider_message_id: review.providerMessageId?.trim() || null,
    p_review_reference: review.reviewReference.trim(), p_retry: review.outcome === 'not_sent' && review.retry === true })
    .abortSignal(AbortSignal.timeout(15_000))
  if (saved.error) {
    const known = ['WORKER_BUSY', 'DELIVERY_REVIEW_REQUIRED', 'DELIVERY_REVIEW_FORBIDDEN', 'INCIDENT_NOT_REVIEWABLE',
      'DELIVERY_BATCH_CONFLICT', 'DELIVERY_EVIDENCE_REQUIRED', 'DELIVERY_OUTCOME_CONFLICT',
      'DELIVERY_RETRY_CHECKPOINT_REQUIRED', 'DELIVERY_RETRY_LIMIT']
    throw Error(known.includes(saved.error.message) ? saved.error.message
      : `RPC_LV_APP_RECONCILE_DELIVERY_V2_${/^[A-Z0-9]+$/.test(saved.error.code) ? saved.error.code : 'FAILED'}`)
  }
  const result = object(saved.data)
  if (result.reconciled !== true) throw Error('INCIDENT_REVIEW_FAILED')
  const contact = text(result.contact_key)
  if (contact) {
    try {
      const { scheduleConversations } = await import('./schedule-conversations')
      await scheduleConversations([contact])
    } catch { console.error('DELIVERY_REVIEW_WAKE_FAILED_CRON_FALLBACK') }
  }
  return result
}

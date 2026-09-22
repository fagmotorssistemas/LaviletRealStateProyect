import 'server-only'
import { cancelNutrition24h } from './nutrition'
import { cancelNutritionWeekOne } from './nutrition-week-one'
import { cancelNutritionLater } from './nutrition-later'
import { object, rpc, text, type Row } from './data'
import { setKommoField } from './kommo'
import type { AdvisorOutbound } from './webhook'

function advisorOutboundFromRow(value: unknown): AdvisorOutbound {
  const row = object(value)
  if (!text(row.externalId) || !Number.isSafeInteger(row.kommoId) || Number(row.kommoId) < 0
    || !Number.isSafeInteger(row.contactId) || Number(row.contactId) <= 0
    || !Number.isSafeInteger(row.userId) || !text(row.sentAt)) {
    throw new Error('INVALID_STORED_ADVISOR_OUTBOUND')
  }
  return row as unknown as AdvisorOutbound
}

/**
 * Records a verified manual Kommo reply and makes the database pause
 * authoritative before trying to mirror DETENER IA back to Kommo.
 */
export async function processAdvisorOutbound(row: Row) {
  const event = advisorOutboundFromRow(object(row.payload))
  const result = object(await rpc('lv_record_advisor_outbound', {
    p_kommo_lead_id: event.kommoId,
    p_contact_id: String(event.contactId),
    p_kommo_user_id: String(event.userId),
    p_external_message_id: event.externalId,
    p_content: event.text,
    p_sent_at: event.sentAt,
    p_author_name: event.name,
  }))

  if (result.handled !== true) {
    return { action: 'advisor_outbound_ignored', reason: text(result.reason) || 'NOT_A_PROJECT_ADVISOR' }
  }

  // Once the local pause is committed, a provider failure cannot reopen the
  // conversation. It is reported for reconciliation instead of replaying the
  // manual message event.
  let kommoStopSynced = false
  let kommoStopError: string | null = null
  const kommoId = Number(result.kommo_id)
  try {
    if (!Number.isSafeInteger(kommoId) || kommoId <= 0) throw new Error('KOMMO_LEAD_NOT_RESOLVED')
    await setKommoField(kommoId, 451530, 'true')
    kommoStopSynced = true
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    kommoStopError = /^[A-Z0-9_]+$/.test(message) ? message : 'KOMMO_STOP_SYNC_FAILED'
  }

  const cancellations = await Promise.allSettled([
    cancelNutrition24h(kommoId),
    cancelNutritionWeekOne(kommoId),
    cancelNutritionLater(kommoId),
  ])

  return {
    action: 'advisor_took_over',
    lead_id: result.lead_id,
    conversation_id: result.conversation_id,
    advisor_id: result.advisor_id,
    bot_paused: true,
    kommo_stop_synced: kommoStopSynced,
    ...(kommoStopError ? { kommo_stop_error: kommoStopError } : {}),
    nutrition_cancelled: cancellations.every(item => item.status === 'fulfilled'),
  }
}

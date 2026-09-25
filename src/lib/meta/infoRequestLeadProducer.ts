import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { persistMetaConversion } from './localOutbox'

export async function persistInfoRequestLeadEvent(
  admin: SupabaseClient,
  input: {
    leadId: string
    visitorKey: string
    requestId: string
    createdAt: string
    payload: Record<string, unknown>
  },
): Promise<{ eventId: string; eventTime: number; inserted: boolean }> {
  const eventTime = Math.floor(Date.parse(input.createdAt) / 1000)
  if (!Number.isFinite(eventTime)) throw new Error('TOUR_INFO_REQUEST_DATE_REQUIRED')
  const persisted = await persistMetaConversion(admin, {
    eventName: 'Lead',
    idempotencyKey: `lead:${input.leadId}`,
    eventTime,
    leadId: input.leadId,
    visitorKey: input.visitorKey,
    adsConsentRequired: true,
    payload: {
      ...input.payload,
      lv_internal_subtype: 'solicitud',
      request_id: input.requestId,
    },
  })
  return { eventId: persisted.eventId, eventTime, inserted: persisted.inserted }
}

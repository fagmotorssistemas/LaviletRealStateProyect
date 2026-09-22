/**
 * Captura interna AddToWishlist → outbox review_hold.
 * No enqueue / no flush Nest (event_name pendiente tipado).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildWishlistIdempotencyKey,
  META_NEST_BACKEND_PENDING_ERROR,
} from '@/lib/meta/metaMeasurementContract'
import {
  OUTBOX_REVIEW_HOLD_STATUS,
  persistMetaConversion,
} from '@/lib/meta/localOutbox'

function isCoreSetupConservative(): boolean {
  return (
    (process.env.META_CORE_SETUP_CONSERVATIVE ||
      process.env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
      'true')
      .trim()
      .toLowerCase() !== 'false'
  )
}

export async function persistAddToWishlist(
  admin: SupabaseClient,
  input: {
    leadId: string
    visitorKey: string
    unitId: string
    unitNumber: string
    typologyCode?: string | null
    eventId?: string | null
    eventSourceUrl?: string | null
    fbp?: string | null
    fbc?: string | null
    fbclid?: string | null
    clientIpAddress?: string | null
    clientUserAgent?: string | null
  },
): Promise<{ inserted: boolean; eventId: string; rowId: string | null; status: string }> {
  const leadId = String(input.leadId || '').trim()
  const unitId = String(input.unitId || '').trim()
  const visitorKey = String(input.visitorKey || '').trim()
  if (!leadId || !unitId || !visitorKey) {
    throw new Error('persistAddToWishlist: leadId, unitId y visitorKey son obligatorios')
  }

  const conservative = isCoreSetupConservative()
  const unitNumber = String(input.unitNumber || '').trim()
  const typologyCode = String(input.typologyCode || '').trim() || null

  return persistMetaConversion(admin, {
    eventName: 'AddToWishlist',
    idempotencyKey: buildWishlistIdempotencyKey(leadId, unitId),
    eventId: input.eventId || undefined,
    leadId,
    visitorKey,
    adsConsentRequired: true,
    status: OUTBOX_REVIEW_HOLD_STATUS,
    lastError: META_NEST_BACKEND_PENDING_ERROR,
    payload: {
      action_source: 'website',
      lv_internal_subtype: 'favorito',
      event_source_url: input.eventSourceUrl || undefined,
      ...(conservative
        ? {}
        : {
            content_ids: [unitId],
            content_name: unitNumber ? `Unidad ${unitNumber}` : undefined,
            content_category: typologyCode || 'unit',
          }),
      unit_id: unitId,
      unit_number: unitNumber || undefined,
      typology_code: typologyCode || undefined,
      fbp: input.fbp || undefined,
      fbc: input.fbc || undefined,
      fbclid: input.fbclid || undefined,
      client_ip_address: input.clientIpAddress || undefined,
      client_user_agent: input.clientUserAgent || undefined,
    },
  })
}

/**
 * Captura AddToWishlist → outbox pending + flush Nest.
 * Mismo event_id que Pixel browser. No libera filas históricas review_hold.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildWishlistIdempotencyKey } from '@/lib/meta/metaMeasurementContract'
import {
  OUTBOX_FLUSHABLE_STATUS,
  persistMetaConversion,
} from '@/lib/meta/localOutbox'
import {
  homeListingCatalogIdentityParams,
  isMetaCoreSetupConservativeEnv,
} from '@/lib/meta/homeListingContent'

function isCoreSetupConservative(): boolean {
  return isMetaCoreSetupConservativeEnv()
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
    eventTime?: number | null
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
  const listingContent = homeListingCatalogIdentityParams(unitId, {
    unitNumber,
    includeContentName: !conservative,
  })

  return persistMetaConversion(admin, {
    eventName: 'AddToWishlist',
    idempotencyKey: buildWishlistIdempotencyKey(leadId, unitId),
    eventId: input.eventId || undefined,
    eventTime: input.eventTime || undefined,
    leadId,
    visitorKey,
    adsConsentRequired: true,
    status: OUTBOX_FLUSHABLE_STATUS,
    lastError: null,
    payload: {
      action_source: 'website',
      lv_internal_subtype: 'favorito',
      event_source_url: input.eventSourceUrl || undefined,
      ...(listingContent || {}),
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

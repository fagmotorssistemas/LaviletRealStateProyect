import 'server-only'
import { cookies, headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LV_ADS_CONSENT_COOKIE, LV_CONSENT_COOKIE } from '@/lib/tour/trackingIds'
import { parseAdsConsentFromCookieValue } from '@/lib/tour/consent'
import { resolveEffectiveAdsConsent } from '@/lib/meta/effectiveAdsConsent'
import { clientIp as resolveClientIp } from '@/lib/tour/geo'

export type MetaServerEventName = 'ViewContent' | 'Lead' | 'Schedule'

function backendBaseUrl() {
  return (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
}

function internalSecret() {
  return process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
}

export function isMetaCapiConfigured() {
  return Boolean(backendBaseUrl() && internalSecret())
}

/** Solo cookie de medición (`full`). No usa casilla de contacto ni `lv_contact_consent`. */
export async function readServerAdsConsent(): Promise<boolean> {
  try {
    const jar = await cookies()
    const dedicated = jar.get(LV_ADS_CONSENT_COOKIE)?.value
    if (dedicated) return parseAdsConsentFromCookieValue(dedicated)
    const legacy = jar.get(LV_CONSENT_COOKIE)?.value
    // Legacy "1" = contacto histórico; no cuenta como ads.
    return parseAdsConsentFromCookieValue(legacy)
  } catch {
    return false
  }
}

/** Último ads_consent del ledger para el visitante; null si no hay filas. */
export async function fetchLatestVisitorLedgerAdsConsent(
  admin: SupabaseClient,
  visitorKey: string,
): Promise<boolean | null> {
  const key = visitorKey.trim()
  if (!key) return null
  const { data, error } = await admin
    .from('meta_ads_consent_ledger')
    .select('ads_consent')
    .eq('visitor_key', key)
    .order('consent_version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data || typeof data.ads_consent !== 'boolean') return null
  return data.ads_consent
}

/**
 * Cookie de medición ∧ ledger del visitante.
 * Una revocación vigente en ledger anula cookie `full` stale.
 */
export async function resolveServerAdsConsentForVisitor(
  admin: SupabaseClient,
  visitorKey: string,
): Promise<boolean> {
  const cookieAllowsAds = await readServerAdsConsent()
  const ledgerAdsConsent = await fetchLatestVisitorLedgerAdsConsent(admin, visitorKey)
  return resolveEffectiveAdsConsent({ cookieAllowsAds, ledgerAdsConsent })
}

function sanitizeUrl(raw?: string | null) {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (/^\/simulador(?:\/|$)/i.test(url.pathname)) return undefined
    const conservative =
      (process.env.META_CORE_SETUP_CONSERVATIVE ||
        process.env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
        'true')
        .trim()
        .toLowerCase() !== 'false'
    if (conservative) return url.origin
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

export type EnqueueMetaEventInput = {
  eventName: MetaServerEventName
  idempotencyKey: string
  eventId: string
  eventTime?: number
  actionSource: 'website' | 'system_generated' | 'business_messaging' | 'other' | 'chat'
  eventSourceUrl?: string | null
  phone?: string | null
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  city?: string | null
  country?: string | null
  externalId?: string | null
  fbp?: string | null
  fbc?: string | null
  fbclid?: string | null
  contentIds?: string[]
  contentName?: string | null
  contentCategory?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  deliveryLane?: 'test' | 'live'
  visitorKey?: string | null
  leadId?: string | null
  /** Si false, no encola. */
  adsConsent: boolean
  /** Solo website: capturar IP/UA del request actual (visitante). */
  includeRequestContext?: boolean
  messagingChannel?: 'whatsapp' | null
  ctwaClid?: string | null
  whatsappBusinessAccountId?: string | null
  messagingDatasetId?: string | null
}

/**
 * Encola en lavilet-meta-capi. Nunca lanza al caller de negocio:
 * fallos de Meta/cola se registran y se ignoran para no bloquear el contacto.
 */
const META_CAPI_HTTP_TIMEOUT_MS = 8_000

export async function enqueueMetaEvent(
  input: EnqueueMetaEventInput,
): Promise<{ ok: boolean; skipped?: string; status?: number }> {
  if (!input.adsConsent) return { ok: false, skipped: 'no_ads_consent' }
  if (!isMetaCapiConfigured()) return { ok: false, skipped: 'not_configured' }

  let clientIpAddress: string | undefined = input.clientIpAddress || undefined
  let clientUa: string | undefined = input.clientUserAgent || undefined
  if (input.includeRequestContext && input.actionSource === 'website') {
    try {
      const h = await headers()
      clientIpAddress = clientIpAddress || resolveClientIp(h) || undefined
      clientUa = clientUa || h.get('user-agent') || undefined
    } catch {
      // ignore
    }
  }

  try {
    const res = await fetch(`${backendBaseUrl()}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret(),
      },
      body: JSON.stringify({
        event_name: input.eventName,
        idempotency_key: input.idempotencyKey,
        event_id: input.eventId,
        event_time: input.eventTime,
        action_source: input.actionSource,
        event_source_url: sanitizeUrl(input.eventSourceUrl),
        phone: input.phone || undefined,
        email: input.email || undefined,
        first_name: input.firstName || undefined,
        last_name: input.lastName || undefined,
        full_name: input.fullName || undefined,
        city: input.city || undefined,
        country: input.country || undefined,
        external_id: input.externalId || undefined,
        visitor_key: input.visitorKey || undefined,
        lead_id: input.leadId || undefined,
        fbp: input.fbp || undefined,
        fbc: input.fbc || undefined,
        fbclid: input.fbclid || undefined,
        client_ip_address: clientIpAddress,
        client_user_agent: clientUa,
        content_ids: input.contentIds,
        content_name: input.contentName || undefined,
        content_category: input.contentCategory || undefined,
        delivery_lane: input.deliveryLane,
        ads_consent: true,
        messaging_channel: input.messagingChannel || undefined,
        ctwa_clid: input.ctwaClid || undefined,
        whatsapp_business_account_id: input.whatsappBusinessAccountId || undefined,
        messaging_dataset_id: input.messagingDatasetId || undefined,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(META_CAPI_HTTP_TIMEOUT_MS),
    })
    const ok = res.ok || res.status === 202
    console.info('[meta-capi] enqueue http', {
      event_id: input.eventId || null,
      event_name: input.eventName,
      http_status: res.status,
      ok,
    })
    return { ok, status: res.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error'
    const timedOut =
      (error instanceof Error && error.name === 'TimeoutError') ||
      /aborted|timeout/i.test(message)
    console.error('[meta-capi] enqueue failed', {
      event_id: input.eventId || null,
      error: message.slice(0, 180),
      timed_out: timedOut,
    })
    return { ok: false, skipped: timedOut ? 'timeout' : 'network' }
  }
}

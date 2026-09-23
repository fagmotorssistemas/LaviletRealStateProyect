/**
 * Marketing API / Ads Insights helpers.
 * NO reutiliza tokens CAPI Pixel ni WhatsApp BM.
 * Requiere System User / Marketing token con ads_read + META_AD_ACCOUNT_ID.
 * Las llamadas Graph deben ejecutarse solo en server (services con server-only).
 */

import { selectPrimaryMetaResult } from '@/lib/meta/metaAdsActions'

export type AdHierarchyResolution = {
  adId: string
  adAccountId: string | null
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  resolutionStatus:
    | 'resolved'
    | 'unresolved'
    | 'missing_ads_token'
    | 'graph_permission_denied'
    | 'not_found'
  error: string | null
}

export type AdSpendSnapshot = {
  adId: string
  adName?: string | null
  adsetId?: string | null
  adsetName?: string | null
  campaignId?: string | null
  campaignName?: string | null
  spend: number | null
  currency: string | null
  impressions: number | null
  clicks: number | null
  /**
   * Resultado Meta primario (un action_type). No es suma de actions.
   * No confundir con leads CRM.
   */
  metaReportedResults: number | null
  metaResultActionType: string | null
  metaResultLabel: string | null
  metaOtherActionTypes: string[]
  periodFrom: string
  periodTo: string
  fetchedAt: string
  error: string | null
  /** true si el valor viene de caché por fallo Graph. */
  stale?: boolean
  staleFetchedAt?: string | null
}

export type AdAccountSnapshot = {
  adAccountId: string
  name: string | null
  currency: string | null
  timezoneName: string | null
  timezoneOffsetHours: number | null
  fetchedAt: string
  error: string | null
}

export type AdsMarketingCredentials = {
  token: string
  adAccountId: string
  graphVersion: string
}

export function readAdsMarketingCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AdsMarketingCredentials | null {
  const token = (
    env.META_ADS_ACCESS_TOKEN?.trim() ||
    env.META_MARKETING_ACCESS_TOKEN?.trim() ||
    env.META_SYSTEM_USER_TOKEN?.trim() ||
    ''
  )
  const adAccountId = (
    env.META_AD_ACCOUNT_ID?.trim() ||
    env.META_ADS_ACCOUNT_ID?.trim() ||
    ''
  ).replace(/^act_/i, '')
  if (!token || !adAccountId) return null
  // Guardrail: no usar tokens CAPI conocidos por nombre de env.
  if (
    env.META_CAPI_ACCESS_TOKEN?.trim() === token ||
    env.META_WA_CAPI_ACCESS_TOKEN?.trim() === token
  ) {
    return null
  }
  const graphVersion = (env.META_GRAPH_API_VERSION || 'v21.0').replace(/^\/*/, '')
  return { token, adAccountId: `act_${adAccountId}`, graphVersion }
}

export function adsMarketingMissingHints(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  const missing: string[] = []
  if (!env.META_AD_ACCOUNT_ID?.trim() && !env.META_ADS_ACCOUNT_ID?.trim()) {
    missing.push('META_AD_ACCOUNT_ID (cuenta publicitaria act_…)')
  }
  if (
    !env.META_ADS_ACCESS_TOKEN?.trim() &&
    !env.META_MARKETING_ACCESS_TOKEN?.trim() &&
    !env.META_SYSTEM_USER_TOKEN?.trim()
  ) {
    missing.push(
      'META_ADS_ACCESS_TOKEN (System User / Marketing con ads_read; no reutilizar META_CAPI_* ni META_WA_CAPI_*)',
    )
  }
  return missing
}

export function isAdAccountMatch(
  adAccountId: string | null | undefined,
  configuredAccountId: string | null | undefined,
): boolean {
  const normalize = (value: string | null | undefined) =>
    String(value || '').trim().replace(/^act_/i, '')
  const actual = normalize(adAccountId)
  const configured = normalize(configuredAccountId)
  return Boolean(actual && configured && actual === configured)
}

/**
 * CPL = gasto Insights del anuncio ÷ leads únicos CRM atribuidos (CTWA source_id) en el mismo período.
 * Sin denominador válido (>0) → null (“No disponible”).
 * No usa conversiones CAPI aceptadas ni resultados Meta como denominador.
 */
export function computeCrmCostPerLead(
  spend: number | null | undefined,
  crmLeadsUnique: number | null | undefined,
): number | null {
  if (spend == null || !Number.isFinite(spend) || spend < 0) return null
  if (crmLeadsUnique == null || !Number.isFinite(crmLeadsUnique) || crmLeadsUnique <= 0) {
    return null
  }
  return Math.round((spend / crmLeadsUnique) * 100) / 100
}

async function graphGet<T>(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  timeoutMs = 12000,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const err = body.error as Record<string, unknown> | undefined
      const msg =
        (typeof err?.message === 'string' && err.message) ||
        `graph_http_${res.status}`
      return { ok: false, status: res.status, message: msg }
    }
    return { ok: true, data: body as T }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message: e instanceof Error ? e.message : 'graph_fetch_failed',
    }
  }
}

/** Sigue paging.next hasta agotar (máx. páginas de seguridad). */
async function graphGetAllDataRows(
  firstUrl: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  maxPages = 40,
): Promise<
  | { ok: true; rows: Array<Record<string, unknown>>; pages: number; incomplete: boolean }
  | { ok: false; status: number; message: string; rows: Array<Record<string, unknown>>; pages: number }
> {
  const rows: Array<Record<string, unknown>> = []
  let url: string | null = firstUrl
  let pages = 0
  while (url && pages < maxPages) {
    pages += 1
    const res: Awaited<ReturnType<typeof graphGet<{
      data?: Array<Record<string, unknown>>
      paging?: { next?: string }
    }>>> = await graphGet<{
      data?: Array<Record<string, unknown>>
      paging?: { next?: string }
    }>(url, fetchImpl, signal, 20000)
    if (!res.ok) {
      return { ok: false, status: res.status, message: res.message, rows, pages }
    }
    for (const row of res.data.data || []) rows.push(row)
    url = typeof res.data.paging?.next === 'string' ? res.data.paging.next : null
  }
  return { ok: true, rows, pages, incomplete: Boolean(url) }
}

function insightRowToSnapshot(
  row: Record<string, unknown>,
  period: { from: string; to: string },
  fetchedAt: string,
  fallbackAdId?: string,
): AdSpendSnapshot {
  const primary = selectPrimaryMetaResult(row.actions)
  const adId =
    (typeof row.ad_id === 'string' && row.ad_id) ||
    (typeof row.campaign_id === 'string' && fallbackAdId) ||
    fallbackAdId ||
    ''
  const spendRaw = row.spend
  const spend =
    spendRaw == null || spendRaw === ''
      ? null
      : Number.isFinite(Number(spendRaw))
        ? Number(spendRaw)
        : null
  return {
    adId,
    adName: typeof row.ad_name === 'string' ? row.ad_name : null,
    adsetId: typeof row.adset_id === 'string' ? row.adset_id : null,
    adsetName: typeof row.adset_name === 'string' ? row.adset_name : null,
    campaignId: typeof row.campaign_id === 'string' ? row.campaign_id : null,
    campaignName: typeof row.campaign_name === 'string' ? row.campaign_name : null,
    spend,
    currency:
      typeof row.account_currency === 'string' ? row.account_currency : null,
    impressions:
      row.impressions == null ? null : Number(row.impressions) || null,
    clicks: row.clicks == null ? null : Number(row.clicks) || null,
    metaReportedResults: primary?.value ?? null,
    metaResultActionType: primary?.actionType ?? null,
    metaResultLabel: primary?.label ?? null,
    metaOtherActionTypes: primary?.otherActionTypes ?? [],
    periodFrom: period.from,
    periodTo: period.to,
    fetchedAt,
    error: null,
    stale: false,
    staleFetchedAt: null,
  }
}

function emptySpendSnapshot(
  id: string,
  period: { from: string; to: string },
  fetchedAt: string,
): AdSpendSnapshot {
  return {
    adId: id,
    adName: null,
    adsetId: null,
    adsetName: null,
    campaignId: null,
    campaignName: null,
    spend: null,
    currency: null,
    impressions: null,
    clicks: null,
    metaReportedResults: null,
    metaResultActionType: null,
    metaResultLabel: null,
    metaOtherActionTypes: [],
    periodFrom: period.from,
    periodTo: period.to,
    fetchedAt,
    error: null,
    stale: false,
    staleFetchedAt: null,
  }
}

export async function resolveAdHierarchy(
  adId: string,
  opts?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  },
): Promise<AdHierarchyResolution> {
  const id = String(adId || '').trim()
  const base: AdHierarchyResolution = {
    adId: id,
    adAccountId: null,
    adName: null,
    adsetId: null,
    adsetName: null,
    campaignId: null,
    campaignName: null,
    resolutionStatus: 'unresolved',
    error: null,
  }
  if (!id) return { ...base, resolutionStatus: 'unresolved', error: 'ad_id_empty' }
  const creds = readAdsMarketingCredentials(opts?.env)
  if (!creds) {
    return {
      ...base,
      resolutionStatus: 'missing_ads_token',
      error: adsMarketingMissingHints(opts?.env).join('; '),
    }
  }
  const fetchImpl = opts?.fetchImpl ?? fetch
  const fields =
    'id,name,account_id,adset_id,campaign_id,adset{id,name},campaign{id,name}'
  const url = new URL(
    `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(id)}`,
  )
  url.searchParams.set('fields', fields)
  url.searchParams.set('access_token', creds.token)
  const res = await graphGet<Record<string, unknown>>(
    url.toString(),
    fetchImpl,
    opts?.signal,
  )
  if (!res.ok) {
    const denied =
      /permission|ads_read|#10|#100|#200|#190/i.test(res.message) ||
      res.status === 403 ||
      res.status === 400
    return {
      ...base,
      resolutionStatus: denied ? 'graph_permission_denied' : 'not_found',
      error: res.message.slice(0, 200),
    }
  }
  const adset =
    res.data.adset && typeof res.data.adset === 'object'
      ? (res.data.adset as Record<string, unknown>)
      : null
  const campaign =
    res.data.campaign && typeof res.data.campaign === 'object'
      ? (res.data.campaign as Record<string, unknown>)
      : null
  return {
    adId: id,
    adAccountId:
      typeof res.data.account_id === 'string' ? res.data.account_id : null,
    adName: typeof res.data.name === 'string' ? res.data.name : null,
    adsetId:
      (typeof res.data.adset_id === 'string' && res.data.adset_id) ||
      (typeof adset?.id === 'string' ? adset.id : null),
    adsetName: typeof adset?.name === 'string' ? adset.name : null,
    campaignId:
      (typeof res.data.campaign_id === 'string' && res.data.campaign_id) ||
      (typeof campaign?.id === 'string' ? campaign.id : null),
    campaignName: typeof campaign?.name === 'string' ? campaign.name : null,
    resolutionStatus: 'resolved',
    error: null,
  }
}

/**
 * Gasto del anuncio en período (YYYY-MM-DD, timezone cuenta Meta).
 * level=ad, filtering por ad.id. No reparte gasto a unidades.
 * Resultado Meta = un action_type preferente (no suma).
 */
export async function fetchAdSpendForPeriod(
  adId: string,
  period: { from: string; to: string },
  opts?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  },
): Promise<AdSpendSnapshot> {
  const fetchedAt = new Date().toISOString()
  const id = String(adId || '').trim()
  const empty = emptySpendSnapshot(id, period, fetchedAt)
  const creds = readAdsMarketingCredentials(opts?.env)
  if (!creds) {
    return { ...empty, error: adsMarketingMissingHints(opts?.env).join('; ') }
  }
  if (!id) return { ...empty, error: 'ad_id_empty' }

  const fetchImpl = opts?.fetchImpl ?? fetch
  const url = new URL(
    `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(creds.adAccountId)}/insights`,
  )
  url.searchParams.set(
    'fields',
    'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency',
  )
  url.searchParams.set('level', 'ad')
  url.searchParams.set('time_range', JSON.stringify({ since: period.from, until: period.to }))
  url.searchParams.set(
    'filtering',
    JSON.stringify([{ field: 'ad.id', operator: 'IN', value: [id] }]),
  )
  url.searchParams.set('limit', '100')
  url.searchParams.set('access_token', creds.token)

  const paged = await graphGetAllDataRows(url.toString(), fetchImpl, opts?.signal, 5)
  if (!paged.ok && !paged.rows.length) {
    return { ...empty, error: paged.message.slice(0, 200) }
  }
  const row = paged.rows[0]
  if (!row) {
    return { ...empty, spend: 0 }
  }
  const snap = insightRowToSnapshot(row, period, fetchedAt, id)
  if (!paged.ok) snap.error = `partial:${paged.message.slice(0, 160)}`
  return snap
}

/**
 * Metadatos de la cuenta publicitaria (nombre, moneda, TZ).
 * Verifica que el token vea la cuenta configurada en META_AD_ACCOUNT_ID.
 */
export async function fetchAdAccountSnapshot(opts?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<AdAccountSnapshot> {
  const fetchedAt = new Date().toISOString()
  const creds = readAdsMarketingCredentials(opts?.env)
  const empty: AdAccountSnapshot = {
    adAccountId: creds?.adAccountId || '',
    name: null,
    currency: null,
    timezoneName: null,
    timezoneOffsetHours: null,
    fetchedAt,
    error: null,
  }
  if (!creds) {
    return {
      ...empty,
      error: adsMarketingMissingHints(opts?.env).join('; '),
    }
  }
  const fetchImpl = opts?.fetchImpl ?? fetch
  const url = new URL(
    `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(creds.adAccountId)}`,
  )
  url.searchParams.set(
    'fields',
    'id,name,currency,timezone_name,timezone_offset_hours_utc',
  )
  url.searchParams.set('access_token', creds.token)
  const res = await graphGet<Record<string, unknown>>(
    url.toString(),
    fetchImpl,
    opts?.signal,
  )
  if (!res.ok) {
    return { ...empty, adAccountId: creds.adAccountId, error: res.message.slice(0, 200) }
  }
  return {
    adAccountId: creds.adAccountId,
    name: typeof res.data.name === 'string' ? res.data.name : null,
    currency: typeof res.data.currency === 'string' ? res.data.currency : null,
    timezoneName:
      typeof res.data.timezone_name === 'string' ? res.data.timezone_name : null,
    timezoneOffsetHours:
      res.data.timezone_offset_hours_utc == null
        ? null
        : Number(res.data.timezone_offset_hours_utc),
    fetchedAt,
    error: null,
  }
}

/**
 * Gasto a nivel campaña (Insights level=campaign). No usa source_id como campaign_id.
 */
export async function fetchCampaignSpendForPeriod(
  campaignId: string,
  period: { from: string; to: string },
  opts?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  },
): Promise<AdSpendSnapshot> {
  const fetchedAt = new Date().toISOString()
  const id = String(campaignId || '').trim()
  const empty = emptySpendSnapshot(id, period, fetchedAt)
  const creds = readAdsMarketingCredentials(opts?.env)
  if (!creds) {
    return { ...empty, error: adsMarketingMissingHints(opts?.env).join('; ') }
  }
  if (!id) return { ...empty, error: 'campaign_id_empty' }

  const fetchImpl = opts?.fetchImpl ?? fetch
  const url = new URL(
    `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(creds.adAccountId)}/insights`,
  )
  url.searchParams.set(
    'fields',
    'campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency',
  )
  url.searchParams.set('level', 'campaign')
  url.searchParams.set('time_range', JSON.stringify({ since: period.from, until: period.to }))
  url.searchParams.set(
    'filtering',
    JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [id] }]),
  )
  url.searchParams.set('limit', '50')
  url.searchParams.set('access_token', creds.token)

  const paged = await graphGetAllDataRows(url.toString(), fetchImpl, opts?.signal, 5)
  if (!paged.ok && !paged.rows.length) {
    return { ...empty, error: paged.message.slice(0, 200) }
  }
  const row = paged.rows[0]
  if (!row) return { ...empty, spend: 0 }
  const snap = insightRowToSnapshot(row, period, fetchedAt, id)
  snap.campaignId = id
  if (typeof row.campaign_name === 'string') snap.campaignName = row.campaign_name
  if (!paged.ok) snap.error = `partial:${paged.message.slice(0, 160)}`
  return snap
}

export type AccountAdInsightsResult = {
  ads: AdSpendSnapshot[]
  fetchedAt: string
  pages: number
  incomplete: boolean
  error: string | null
  /** Suma de spend de filas con misma moneda; null si monedas mixtas o vacío. */
  spendSumSameCurrency: number | null
  currency: string | null
}

/**
 * Insights level=ad de toda la cuenta en el período (paginado).
 * Incluye anuncios con gasto aunque no tengan leads CRM/CTWA.
 */
export async function fetchAccountAdInsightsForPeriod(
  period: { from: string; to: string },
  opts?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    /** Si true, solo filas con spend>0. Default true. */
    onlyWithSpend?: boolean
  },
): Promise<AccountAdInsightsResult> {
  const fetchedAt = new Date().toISOString()
  const creds = readAdsMarketingCredentials(opts?.env)
  if (!creds) {
    return {
      ads: [],
      fetchedAt,
      pages: 0,
      incomplete: false,
      error: adsMarketingMissingHints(opts?.env).join('; '),
      spendSumSameCurrency: null,
      currency: null,
    }
  }
  const fetchImpl = opts?.fetchImpl ?? fetch
  const url = new URL(
    `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(creds.adAccountId)}/insights`,
  )
  url.searchParams.set(
    'fields',
    'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency',
  )
  url.searchParams.set('level', 'ad')
  url.searchParams.set('time_range', JSON.stringify({ since: period.from, until: period.to }))
  url.searchParams.set('limit', '500')
  url.searchParams.set('access_token', creds.token)

  const paged = await graphGetAllDataRows(url.toString(), fetchImpl, opts?.signal, 40)
  const onlyWithSpend = opts?.onlyWithSpend !== false
  const ads: AdSpendSnapshot[] = []
  for (const row of paged.rows) {
    const snap = insightRowToSnapshot(row, period, fetchedAt)
    if (!snap.adId) continue
    if (onlyWithSpend && !(snap.spend != null && snap.spend > 0)) continue
    ads.push(snap)
  }
  const currencies = [
    ...new Set(ads.map((a) => (a.currency || '').trim().toUpperCase()).filter(Boolean)),
  ]
  let spendSumSameCurrency: number | null = null
  let currency: string | null = null
  if (currencies.length === 1) {
    currency = currencies[0]!
    spendSumSameCurrency =
      Math.round(ads.reduce((s, a) => s + (a.spend || 0), 0) * 100) / 100
  } else if (currencies.length === 0 && ads.every((a) => a.spend == null || a.spend === 0)) {
    spendSumSameCurrency = 0
  }

  return {
    ads,
    fetchedAt,
    pages: paged.pages,
    incomplete: paged.ok ? paged.incomplete : true,
    error: paged.ok ? null : paged.message.slice(0, 200),
    spendSumSameCurrency,
    currency,
  }
}


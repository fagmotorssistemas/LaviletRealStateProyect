import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdHierarchyResolution, AdSpendSnapshot } from '@/lib/meta/adsMarketingClient'

export type AdsCacheEntityLevel = 'ad' | 'campaign' | 'account'

export type AdsInsightsCacheRow = {
  ad_account_id: string
  entity_level: AdsCacheEntityLevel
  entity_id: string
  period_from: string
  period_to: string
  spend: number | null
  currency: string | null
  impressions: number | null
  clicks: number | null
  meta_reported_results: number | null
  hierarchy: Record<string, unknown>
  fetched_at: string
  last_error: string | null
}

/** Metadata may outlive a date filter; never reuse its spend for another period. */
export async function readLatestAdsCache(admin:SupabaseClient, account:string, level:AdsCacheEntityLevel, entityId:string):Promise<AdsInsightsCacheRow|null> {
  const {data,error}=await admin.from('meta_ads_insights_cache').select('*').eq('ad_account_id',account)
    .eq('entity_level',level).eq('entity_id',entityId).is('last_error',null).order('fetched_at',{ascending:false}).limit(1).maybeSingle()
  if (error) return null
  return data as AdsInsightsCacheRow|null
}

export async function upsertAdsInsightsCache(
  admin: SupabaseClient,
  input: {
    adAccountId: string
    entityLevel: AdsCacheEntityLevel
    entityId: string
    periodFrom: string
    periodTo: string
    spend: number | null
    currency: string | null
    impressions?: number | null
    clicks?: number | null
    metaReportedResults?: number | null
    hierarchy?: Record<string, unknown>
    fetchedAt?: string
    lastError?: string | null
  },
): Promise<void> {
  const row = {
    ad_account_id: input.adAccountId,
    entity_level: input.entityLevel,
    entity_id: input.entityId,
    period_from: input.periodFrom,
    period_to: input.periodTo,
    spend: input.spend,
    currency: input.currency,
    impressions: input.impressions ?? null,
    clicks: input.clicks ?? null,
    meta_reported_results: input.metaReportedResults ?? null,
    hierarchy: input.hierarchy ?? {},
    fetched_at: input.fetchedAt ?? new Date().toISOString(),
    last_error: input.lastError ?? null,
  }
  const { error } = await admin.from('meta_ads_insights_cache').upsert(row, {
    onConflict: 'ad_account_id,entity_level,entity_id,period_from,period_to',
  })
  if (error) {
    // Best-effort: no tumbar el embudo CRM.
    console.warn('[ads-cache] upsert failed', error.message)
  }
}

export async function readAdsInsightsCache(
  admin: SupabaseClient,
  input: {
    adAccountId: string
    entityLevel: AdsCacheEntityLevel
    entityId: string
    periodFrom: string
    periodTo: string
  },
): Promise<AdsInsightsCacheRow | null> {
  const { data, error } = await admin
    .from('meta_ads_insights_cache')
    .select(
      'ad_account_id,entity_level,entity_id,period_from,period_to,spend,currency,impressions,clicks,meta_reported_results,hierarchy,fetched_at,last_error',
    )
    .eq('ad_account_id', input.adAccountId)
    .eq('entity_level', input.entityLevel)
    .eq('entity_id', input.entityId)
    .eq('period_from', input.periodFrom)
    .eq('period_to', input.periodTo)
    .maybeSingle()
  if (error || !data) return null
  return data as AdsInsightsCacheRow
}

export function spendSnapshotFromCache(
  cache: AdsInsightsCacheRow,
  liveError: string | null,
): AdSpendSnapshot & { stale: true; staleFetchedAt: string } {
  const h =
    cache.hierarchy && typeof cache.hierarchy === 'object'
      ? (cache.hierarchy as Record<string, unknown>)
      : {}
  return {
    adId: cache.entity_id,
    adName: typeof h.adName === 'string' ? h.adName : null,
    adsetId: typeof h.adsetId === 'string' ? h.adsetId : null,
    adsetName: typeof h.adsetName === 'string' ? h.adsetName : null,
    campaignId: typeof h.campaignId === 'string' ? h.campaignId : null,
    campaignName: typeof h.campaignName === 'string' ? h.campaignName : null,
    spend: cache.spend == null ? null : Number(cache.spend),
    currency: cache.currency,
    impressions: cache.impressions == null ? null : Number(cache.impressions),
    clicks: cache.clicks == null ? null : Number(cache.clicks),
    metaReportedResults:
      cache.meta_reported_results == null
        ? null
        : Number(cache.meta_reported_results),
    metaResultActionType:
      typeof h.metaResultActionType === 'string' ? h.metaResultActionType : null,
    metaResultLabel:
      typeof h.metaResultLabel === 'string' ? h.metaResultLabel : null,
    metaOtherActionTypes: Array.isArray(h.metaOtherActionTypes)
      ? h.metaOtherActionTypes.filter((x): x is string => typeof x === 'string')
      : [],
    periodFrom: cache.period_from,
    periodTo: cache.period_to,
    fetchedAt: cache.fetched_at,
    error: liveError
      ? `meta_error:${liveError}; serving_stale_cache`
      : 'serving_stale_cache',
    stale: true,
    staleFetchedAt: cache.fetched_at,
  }
}

export function hierarchyFromCache(
  cache: AdsInsightsCacheRow,
  adId: string,
): Partial<AdHierarchyResolution> | null {
  const h = cache.hierarchy
  if (!h || typeof h !== 'object') return null
  return {
    adId,
    adAccountId: typeof h.adAccountId === 'string' ? h.adAccountId : null,
    adName: typeof h.adName === 'string' ? h.adName : null,
    adsetId: typeof h.adsetId === 'string' ? h.adsetId : null,
    adsetName: typeof h.adsetName === 'string' ? h.adsetName : null,
    campaignId: typeof h.campaignId === 'string' ? h.campaignId : null,
    campaignName: typeof h.campaignName === 'string' ? h.campaignName : null,
    resolutionStatus: 'resolved',
    error: null,
  }
}

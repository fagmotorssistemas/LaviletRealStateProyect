/**
 * Rollup CRM + gasto por campaña (tras resolver ad→campaign).
 * No trata CTWA source_id como campaign_id.
 * No suma monedas distintas; sin gasto verificable o leads≤0 → CPL null.
 */
import { computeCrmCostPerLead } from '@/lib/meta/adsMarketingClient'
import type { TemperatureBucket } from '@/services/marketingFunnel.logic'
import { emptyTemp } from '@/services/marketingFunnel.logic'

export type AdRowForCampaignRollup = {
  adId: string | null
  campaignId: string | null
  campaignName: string | null
  resolutionStatus: string
  leadsUnique: number
  temperature: Record<TemperatureBucket, number>
  adSpend: number | null
  currency: string | null
  metaReportedResults: number | null
  spendStale: boolean
  spendFetchedAt: string | null
  costPerLead: number | null
}

export type CampaignFunnelRollupRow = {
  campaignId: string
  campaignName: string | null
  adCount: number
  leadsUnique: number
  temperature: Record<TemperatureBucket, number>
  adSpend: number | null
  currency: string | null
  costPerLead: number | null
  metaReportedResults: number | null
  spendStale: boolean
  spendFetchedAt: string | null
  note: string
}

/**
 * Agrupa filas de anuncio ya resueltas. Omite sin campaignId (no inventa).
 * Gasto: suma solo si todas las monedas presentes coinciden; si hay mezcla → null + nota.
 */
export function rollupAttributedAdsByCampaign(
  rows: AdRowForCampaignRollup[],
): CampaignFunnelRollupRow[] {
  type Acc = {
    campaignId: string
    campaignName: string | null
    adIds: Set<string>
    leadsUnique: number
    temperature: Record<TemperatureBucket, number>
    spends: Array<{ spend: number; currency: string | null }>
    metaResults: number[]
    spendStale: boolean
    spendFetchedAt: string | null
  }
  const map = new Map<string, Acc>()

  for (const row of rows) {
    const campaignId = String(row.campaignId || '').trim()
    if (!campaignId) continue
    if (row.resolutionStatus === 'missing_ads_token') continue
    let acc = map.get(campaignId)
    if (!acc) {
      acc = {
        campaignId,
        campaignName: row.campaignName,
        adIds: new Set(),
        leadsUnique: 0,
        temperature: emptyTemp(),
        spends: [],
        metaResults: [],
        spendStale: false,
        spendFetchedAt: null,
      }
      map.set(campaignId, acc)
    }
    if (row.campaignName && !acc.campaignName) acc.campaignName = row.campaignName
    if (row.adId) acc.adIds.add(row.adId)
    acc.leadsUnique += row.leadsUnique
    for (const k of Object.keys(acc.temperature) as TemperatureBucket[]) {
      acc.temperature[k] += row.temperature[k] || 0
    }
    if (row.adSpend != null && Number.isFinite(row.adSpend)) {
      acc.spends.push({ spend: row.adSpend, currency: row.currency })
    }
    if (row.metaReportedResults != null && Number.isFinite(row.metaReportedResults)) {
      acc.metaResults.push(row.metaReportedResults)
    }
    if (row.spendStale) acc.spendStale = true
    if (row.spendFetchedAt) {
      if (
        !acc.spendFetchedAt ||
        Date.parse(row.spendFetchedAt) > Date.parse(acc.spendFetchedAt)
      ) {
        acc.spendFetchedAt = row.spendFetchedAt
      }
    }
  }

  const out: CampaignFunnelRollupRow[] = []
  for (const acc of map.values()) {
    const currencies = [
      ...new Set(
        acc.spends
          .map((s) => (s.currency || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ]
    let adSpend: number | null = null
    let currency: string | null = null
    let note =
      'Gasto = suma Insights de anuncios CTWA resueltos a esta campaña (no es necesariamente el gasto total del planificador Meta). source_id ≠ campaign_id.'
    if (acc.spends.length === 0) {
      adSpend = null
      note += ' Sin gasto verificable → CPL No disponible.'
    } else if (currencies.length > 1) {
      adSpend = null
      currency = null
      note += ` Monedas distintas (${currencies.join(', ')}); no se suma el gasto.`
    } else {
      adSpend = Math.round(acc.spends.reduce((s, x) => s + x.spend, 0) * 100) / 100
      currency = currencies[0] || acc.spends[0]?.currency || null
    }
    const metaReportedResults =
      acc.metaResults.length === 0
        ? null
        : acc.metaResults.reduce((s, n) => s + n, 0)
    out.push({
      campaignId: acc.campaignId,
      campaignName: acc.campaignName,
      adCount: acc.adIds.size,
      leadsUnique: acc.leadsUnique,
      temperature: acc.temperature,
      adSpend,
      currency,
      costPerLead: computeCrmCostPerLead(adSpend, acc.leadsUnique),
      metaReportedResults,
      spendStale: acc.spendStale,
      spendFetchedAt: acc.spendFetchedAt,
      note,
    })
  }
  out.sort((a, b) => b.leadsUnique - a.leadsUnique)
  return out
}

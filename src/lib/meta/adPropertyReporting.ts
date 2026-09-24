import { computeCrmCostPerLead } from './adsMetricMath'
import type { PropertyGroup } from './adPropertyIdentification'

export type PropertyReportAd = {
  adId: string | null; attributionKey: string; leadIds: string[]
  adSpend: number | null; currency: string | null
  promotedUnit: { group?: PropertyGroup; kind: string; unambiguousUnitId: string | null; links: Array<{unitId: string | null; externalLabel: string | null}> }
}

export function propertyGroup(row: PropertyReportAd): PropertyGroup {
  const p = row.promotedUnit
  return p.group || (p.kind === 'multi' ? 'multiple' : p.unambiguousUnitId ? 'inventory' : p.links.some(l => l.externalLabel) ? 'external' : 'unidentified')
}

export function uniqueReportAds<T extends PropertyReportAd>(rows: T[]): T[] {
  // Preserve all contacts if the same ad arrived through more than one source row.
  const ads = new Map<string, T>()
  for (const row of rows) {
    const key = row.adId || row.attributionKey
    const previous = ads.get(key)
    ads.set(key, previous ? {...previous, leadIds: [...new Set([...previous.leadIds, ...row.leadIds])]} : row)
  }
  return [...ads.values()].map(row => {
    const leadIds = [...new Set(row.leadIds)]
    return {...row, leadIds, leadsUnique: leadIds.length, costPerLead: computeCrmCostPerLead(row.adSpend, leadIds.length)}
  })
}

export function summarizePropertyAds(rows: PropertyReportAd[]) {
  const ads = uniqueReportAds(rows).filter(row => row.adId)
  const leadsUnique = new Set(ads.flatMap(a => a.leadIds)).size
  const currencies = new Set(ads.map(a => a.currency?.trim().toUpperCase()).filter(Boolean))
  const complete = ads.length > 0 && ads.every(a => a.adSpend != null && Number.isFinite(a.adSpend) && a.currency) && currencies.size === 1
  const adSpend = complete ? Math.round(ads.reduce((sum,a) => sum + a.adSpend!, 0) * 100) / 100 : null
  return {adCount: ads.filter(a => a.adId).length, leadsUnique, adSpend, currency: complete ? [...currencies][0]! : null, costPerLead: computeCrmCostPerLead(adSpend, leadsUnique)}
}

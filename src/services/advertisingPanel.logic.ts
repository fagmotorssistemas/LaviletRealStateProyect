import type { AttributedAdFunnelRow, MarketingFunnelReport } from './marketingFunnel.service'
import type { AttentionPerson } from './marketingAttention.logic'
import { interestGroups } from './marketingInterest.logic'
import { uniqueReportAds, summarizePropertyAds } from '@/lib/meta/adPropertyReporting'

export const pendingCampaign = '__pending_campaign__'
export type PanelMetric='contacts'|'hot'|'warm'|'cold'|'unevaluated'|'responded'|'unanswered'|'verify'
export type PanelGroups=Record<PanelMetric,string[]>
export type PanelFilters={campaign:string;ad:string;search:string}
export type PanelSummary={groups:PanelGroups;spend:number|null;currency:string|null;cost:number|null;stale:boolean}
export type PanelAd={key:string;name:string;row:AttributedAdFunnelRow;summary:PanelSummary}
export type PanelCampaign={key:string;name:string;ads:PanelAd[];summary:PanelSummary}

export function attentionCategory(person?:AttentionPerson):'responded'|'unanswered'|'verify' {
  if(person?.flags.responseRecorded===true) return 'responded'
  if(person?.historyComplete===true && person.flags.noResponse===true) return 'unanswered'
  return 'verify'
}
export function panelMetricText(summary:PanelSummary,key:PanelMetric):string {
  const count=summary.groups[key].length
  return panelUnknownMetric(key) && summary.groups[panelUnknownMetric(key)!].length?`${count} comprobados`:String(count)
}
export function panelUnknownMetric(key:PanelMetric):'unevaluated'|'verify'|null {
  return ['hot','warm','cold'].includes(key)?'unevaluated':['responded','unanswered'].includes(key)?'verify':null
}
export function buildAdvertisingPanel(report:MarketingFunnelReport,filters:PanelFilters) {
  const people=new Map((report.attention?.people || []).map(p=>[p.leadId,p]))
  const source=uniqueReportAds(report.byAttributedAd.filter(row=>Boolean(row.adId)))
  const owners=new Map<string,Set<string>>()
  for(const ad of source)for(const id of ad.leadIds){const set=owners.get(id) || new Set<string>();set.add(ad.adId!);owners.set(id,set)}
  const conflicts=new Set<string>()
  const ads=source.map(row=>({...row,leadIds:row.leadIds.filter(id=>{
    const declared=people.get(id)?.adId
    if(declared && owners.get(id)?.has(declared)) return declared===row.adId
    if(owners.get(id)!.size===1)return true
    conflicts.add(id);return false // Never invent a first origin from array order.
  })}))
  const campaignKey=(row:AttributedAdFunnelRow)=>row.campaignId || pendingCampaign
  const campaignName=(row:AttributedAdFunnelRow)=>row.campaignId?(row.campaignName?.trim() || 'Campaña sin nombre'):'Campaña pendiente de identificar'
  const campaigns=[...new Map(ads.map(row=>[campaignKey(row),{id:campaignKey(row),name:campaignName(row)}])).values()]
  const adOptions=ads.filter(row=>!filters.campaign || campaignKey(row)===filters.campaign).map(row=>({id:row.adId!,name:row.adName?.trim() || 'Anuncio sin nombre'}))
  const search=filters.search.trim().toLocaleLowerCase('es')
  const filtered=ads.filter(row=>(!filters.campaign || campaignKey(row)===filters.campaign) && (!filters.ad || row.adId===filters.ad)
    && (!search || `${row.adName || ''} ${campaignName(row)}`.toLocaleLowerCase('es').includes(search)))
  function summarize(rows:AttributedAdFunnelRow[]):PanelSummary {
    const ids=[...new Set(rows.flatMap(row=>row.leadIds))],interest=interestGroups(ids,report.interestByLead)
    const groups:PanelGroups={contacts:ids,hot:interest.caliente,warm:interest.tibio,cold:interest.frio,unevaluated:interest.sin_clasificar,responded:[],unanswered:[],verify:[]}
    for(const id of ids)groups[attentionCategory(people.get(id))].push(id)
    const sums=summarizePropertyAds(rows)
    return {groups,spend:sums.adSpend,currency:sums.currency,cost:sums.costPerLead,stale:rows.some(row=>row.spendStale)}
  }
  const grouped=new Map<string,AttributedAdFunnelRow[]>()
  for(const row of filtered){const key=campaignKey(row);grouped.set(key,[...(grouped.get(key) || []),row])}
  const rows:PanelCampaign[]=[...grouped].map(([key,list])=>({key,name:campaignName(list[0]),summary:summarize(list),ads:list.map(row=>({key:row.adId!,name:row.adName?.trim() || 'Anuncio sin nombre',row,summary:summarize([row])}))}))
  return {rows,summary:summarize(filtered),campaigns,adOptions,people,conflicts:[...conflicts],ads:filtered}
}

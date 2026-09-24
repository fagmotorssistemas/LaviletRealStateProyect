import { graphGetAllDataRows, isAdAccountMatch, readAdsMarketingCredentials } from './adsMarketingClient'

export function configuredAdsAccountId(env: Record<string,string|undefined> = process.env): string | null {
  const id = (env.META_AD_ACCOUNT_ID || env.META_ADS_ACCOUNT_ID || '').trim().replace(/^act_/i,'')
  return /^\d+$/.test(id) ? `act_${id}` : null
}

export type AdsCatalog = {
  campaigns: Array<{id:string;name:string;status:string}>
  ads: Array<{id:string;name:string;campaignId:string|null;adsetId:string|null;status:string}>
  status: 'success'|'failed'
  attemptedAt: string
  successfulAt: string|null
  error: string|null
}

/** The account catalog is independent of selected spend dates and CRM acquisition. */
export async function fetchAdsCatalog(opts?: {env?:Record<string,string|undefined>;fetchImpl?:typeof fetch}): Promise<AdsCatalog> {
  const attemptedAt = new Date().toISOString()
  const result: AdsCatalog = {campaigns:[],ads:[],status:'failed',attemptedAt,successfulAt:null,error:null}
  const creds = readAdsMarketingCredentials(opts?.env)
  if (!creds) return {...result,error:'missing_configuration'}
  const responses = await Promise.all((['campaigns','ads'] as const).map(async edge=>{
    const url = new URL(`https://graph.facebook.com/${creds.graphVersion}/${creds.adAccountId}/${edge}`)
    url.searchParams.set('fields',edge==='campaigns'?'id,name,account_id,effective_status':'id,name,account_id,campaign_id,adset_id,effective_status')
    url.searchParams.set('effective_status',JSON.stringify(['ACTIVE','PAUSED','ARCHIVED','DELETED',...(edge==='ads'?['CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED','PENDING_REVIEW','PREAPPROVED','PENDING_BILLING_INFO','IN_PROCESS','WITH_ISSUES']:[])]))
    url.searchParams.set('limit','500');url.searchParams.set('access_token',creds.token)
    return graphGetAllDataRows(url.toString(),opts?.fetchImpl ?? fetch)
  }))
  for (let i=0;i<responses.length;i++) {
    const response=responses[i]
    if (!response.ok || response.incomplete) result.error = response.ok?'incomplete_pagination':response.message
    const unique = new Map(response.rows.map(row=>[String(row.id),row]))
    for (const row of unique.values()) {
      if (!row.id || !isAdAccountMatch(String(row.account_id || ''),creds.adAccountId)) {result.error='account_mismatch';continue}
      if (i===0) result.campaigns.push({id:String(row.id),name:String(row.name || row.id),status:String(row.effective_status || '')})
      else result.ads.push({id:String(row.id),name:String(row.name || row.id),campaignId:typeof row.campaign_id==='string'?row.campaign_id:null,adsetId:typeof row.adset_id==='string'?row.adset_id:null,status:String(row.effective_status || '')})
    }
  }
  if (!result.error) {result.status='success';result.successfulAt=attemptedAt}
  return result
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchAdsCatalog, configuredAdsAccountId } from './adsCatalog'
import { graphGetAllDataRows } from './adsMarketingClient'
import { spendSnapshotFromCache } from './adsInsightsCache'
const env={META_AD_ACCOUNT_ID:'123',META_ADS_ACCESS_TOKEN:'test-only'}

test('catalog is independent of contacts and spend, includes archived/paused filters and complete pagination',async()=>{
  const result=await fetchAdsCatalog({env,fetchImpl:async input=>{
    const url=new URL(String(input));assert.equal(url.searchParams.has('time_range'),false)
    if(!url.searchParams.has('after')) assert.ok(JSON.parse(url.searchParams.get('effective_status')!).includes('ARCHIVED'))
    if(url.pathname.endsWith('/campaigns')) return new Response(JSON.stringify({data:[{id:'campaign',account_id:'123',name:'Paused campaign',effective_status:'PAUSED'},{id:'empty',account_id:'123',name:'No ads'}]}))
    if(!url.searchParams.has('after')) return new Response(JSON.stringify({data:[{id:'ad1',account_id:'123',campaign_id:'campaign',adset_id:'set1'}],paging:{next:'https://graph.facebook.com/v21.0/act_123/ads?after=next'}}))
    return new Response(JSON.stringify({data:[{id:'ad2',account_id:'123',campaign_id:'campaign',effective_status:'ARCHIVED'}]}))
  }})
  assert.equal(result.status,'success');assert.equal(result.campaigns.length,2);assert.equal(result.ads.length,2);assert.ok(result.successfulAt)
})
test('successful empty is not failure; missing config, permission and account mismatch remain failures',async()=>{
  assert.equal(configuredAdsAccountId({META_AD_ACCOUNT_ID:'123'}),'act_123')
  assert.equal((await fetchAdsCatalog({env:{}})).status,'failed')
  const empty=await fetchAdsCatalog({env,fetchImpl:async()=>new Response(JSON.stringify({data:[]}))})
  assert.equal(empty.status,'success');assert.equal(empty.ads.length,0)
  const denied=await fetchAdsCatalog({env,fetchImpl:async()=>new Response(JSON.stringify({error:{message:'permission denied'}}),{status:403})})
  assert.equal(denied.status,'failed');assert.equal(denied.successfulAt,null)
  const mismatch=await fetchAdsCatalog({env,fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'foreign',account_id:'999'}]}))})
  assert.equal(mismatch.status,'failed');assert.equal(mismatch.ads.length,0)
})
test('more than forty pages are traversed; repeated or foreign next URLs fail without leaking a token',async()=>{
  let calls=0
  const result=await graphGetAllDataRows('https://graph.facebook.com/ads',async()=>{calls++;return new Response(JSON.stringify({data:[{id:String(calls)}],...(calls<42?{paging:{next:'https://graph.facebook.com/ads?page='+calls}}:{})}))})
  assert.equal(result.ok,true);assert.equal(result.rows.length,42)
  const unsafe=await graphGetAllDataRows('https://graph.facebook.com/ads',async()=>new Response(JSON.stringify({data:[],paging:{next:'https://example.com/private'}})))
  assert.equal(unsafe.ok,false)
})
test('failed refresh retains original cache timestamp',()=>{
  const time='2026-09-20T12:00:00Z'
  const snap=spendSnapshotFromCache({ad_account_id:'act_123',entity_level:'ad',entity_id:'1',period_from:'2026-09-01',period_to:'2026-09-20',spend:2,currency:'USD',impressions:null,clicks:null,meta_reported_results:null,hierarchy:{},fetched_at:time,last_error:null},'offline')
  assert.equal(snap.fetchedAt,time);assert.equal(snap.staleFetchedAt,time)
})

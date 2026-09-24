import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchAccountAdInsightsForPeriod } from './adsMarketingClient'
import { summarizePropertyAds } from './adPropertyReporting'
import { summarizePropertyLinks } from './adPropertyIdentification'
import { rollupAttributedAdsByCampaign } from './adsCampaignRollup'
import { emptyTemp } from '@/services/marketingFunnel.logic'
import { firstAdOrigins } from './firstAdAcquisition'
import { extractAdReferral, extractCtwaFromKommoFlat } from '@/lib/integrations/automation/ctwa-from-kommo'

test('account activity includes spend-only and paused/archived campaigns, deduplicates paginated ads',async()=>{
  const requests:URL[]=[]
  const pages=[{data:[{ad_id:'11',campaign_id:'paused',spend:'20',account_currency:'USD'}],paging:{next:'https://graph.facebook.com/v21.0/act_123/insights?after=next'}},
    {data:[{ad_id:'11',campaign_id:'paused',spend:'20',account_currency:'USD'},{ad_id:'22',campaign_id:'archived',spend:'80',account_currency:'USD'},{ad_id:'33',campaign_id:'paused',spend:'0',account_currency:'USD',clicks:'1'}]}]
  const result=await fetchAccountAdInsightsForPeriod({from:'2026-09-01',to:'2026-09-23'},{env:{META_AD_ACCOUNT_ID:'123',META_ADS_ACCESS_TOKEN:'fake-test-token'},onlyWithSpend:false,
    fetchImpl:async(input)=>{requests.push(new URL(String(input)));return new Response(JSON.stringify(pages.shift()),{status:200})}})
  assert.equal(requests[0].searchParams.get('level'),'ad')
  assert.equal(requests[0].searchParams.has('filtering'),false,'no ACTIVE status filter: period activity is authoritative')
  assert.deepEqual(JSON.parse(requests[0].searchParams.get('time_range')!),{since:'2026-09-01',until:'2026-09-23'})
  assert.equal(result.ads.length,3);assert.equal(result.spendSumSameCurrency,100)
})

test('all properties sum once, including ads without contacts; total divides sums, not averages',()=>{
  const make=(adId:string,spend:number,leadIds:string[],external=false)=>({adId,attributionKey:adId,leadIds,leadsUnique:leadIds.length,
    adSpend:spend,currency:'USD',campaignId:'campaign',campaignName:'Campaign',resolutionStatus:'resolved',temperature:emptyTemp(),
    spendStale:false,spendFetchedAt:null,metaReportedResults:null,costPerLead:null,
    promotedUnit:summarizePropertyLinks(adId,external?[{id:'external',unitId:null,unitLabel:'Casa De Tarqui',externalLabel:'Casa De Tarqui'}]:[])})
  const a=make('11',20,['person-a','person-b']),b=make('22',80,['person-c'],true),c=make('33',50,[])
  const totals=summarizePropertyAds([a,b,c,c])
  assert.equal(totals.adSpend,150);assert.equal(totals.leadsUnique,3);assert.equal(totals.costPerLead,50)
  const campaign=rollupAttributedAdsByCampaign([a,b,c,c])[0]
  assert.equal(campaign.adCount,3);assert.equal(campaign.adSpend,150);assert.equal(campaign.costPerLead,50)
  assert.equal(summarizePropertyAds([a,{...b,adSpend:null}]).costPerLead,null)
})

test('saved legacy origin wins over later interactions; distinct people are never joined by name',()=>{
  const first=firstAdOrigins([{leadId:'one',adId:'111',recordedAt:'2026-09-01T00:00:00Z',key:'legacy',sourceUrl:null},
    {leadId:'one',adId:'222',recordedAt:'2026-09-02T00:00:00Z',key:'new',sourceUrl:null},
    {leadId:'two',adId:'222',recordedAt:'2026-09-02T00:00:00Z',key:'different',sourceUrl:null}])
  assert.equal(first.get('one')?.adId,'111');assert.equal(first.size,2)
  const close=firstAdOrigins([{leadId:'one',adId:'111',recordedAt:'2026-09-01T00:00:00.001001Z',key:'z',sourceUrl:null},
    {leadId:'one',adId:'222',recordedAt:'2026-09-01T00:00:00.001002Z',key:'a',sourceUrl:null}])
  assert.equal(close.get('one')?.adId,'111')
})

test('ad referral without click identifier is available for history, never fabricated for Meta delivery',()=>{
  const flat={'message[add][0][referral][source_id]':'12345','message[add][0][referral][source_type]':'ad'}
  assert.equal(extractAdReferral(flat,'0')?.sourceId,'12345')
  assert.equal(extractCtwaFromKommoFlat(flat,'0'),null)
  assert.equal(extractAdReferral({...flat,'message[add][0][referral][source_type]':'post'},'0'),null)
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectAdDestinationUrls, identifyPropertyFromUrls, normalizePropertyTargets, summarizePropertyLinks, type AdPromotedUnitLink } from './adPropertyIdentification'
import { propertyGroup, summarizePropertyAds, uniqueReportAds } from './adPropertyReporting'
import { fetchAdDestinationEvidence } from './adsMarketingClient'
import { rollupAttributedAdsByCampaign } from './adsCampaignRollup'

const first = '10000000-0000-4000-8000-000000000001'
const second = '10000000-0000-4000-8000-000000000002'
const inventory = [{id:first,unit_number:'101',category:'suite'},{id:second,unit_number:'102',category:'suite'}]
const link = (id: string) => `https://www.lavilett.com/tour/unidad/${id}`
const saved = (unitId: string|null, externalLabel: string|null): AdPromotedUnitLink => ({id:'saved',adId:'12345',unitId,externalLabel,unitLabel:externalLabel || '101',assignedAt:'2026-09-23',assignedBy:'user'})
describe('advertised property identification — simulated evidence',()=>{
  it('accepts only a direct unit route in the authorized project inventory',()=>{
    const result=identifyPropertyFromUrls('12345',[link(first)+'?utm_source=ad'],inventory)
    assert.equal(result.unambiguousUnitId,first)
    assert.equal(result.evidence,'ad_link')
    assert.equal(result.group,'inventory')
    assert.deepEqual(result.evidenceUrls,[link(first)])
    for(const url of ['https://fb.me/unknown','https://www.lavilett.com/tour?unit=101','https://evil.example/tour/unidad/'+first,'https://www.lavilett.com.evil.example/tour/unidad/'+first,'https://user@www.lavilett.com/tour/unidad/'+first,'http://www.lavilett.com/tour/unidad/'+first,link('99999999-0000-4000-8000-000000000009')]) assert.equal(identifyPropertyFromUrls('12345',[url],inventory).kind,'none')
  })
  it('collects destinations, not names, images, post URLs or later contact interests',()=>{
    const urls=collectAdDestinationUrls({name:'Suite 101',image_url:link(first),effective_object_story_id:'101',object_story_spec:{link_data:{link:link(first),child_attachments:[{link:link(second)}]}},asset_feed_spec:{link_urls:[{website_url:link(first)}]}})
    assert.deepEqual(urls,[link(first),link(second)])
    assert.deepEqual(collectAdDestinationUrls({name:'Suite 101',image_url:link(first),lead_units:[first]}),[])
  })
  it('deduplicates repeated destinations and never divides a multi-property ad',()=>{
    assert.equal(identifyPropertyFromUrls('12345',[link(first),link(first)],inventory).kind,'single')
    const multi=identifyPropertyFromUrls('12345',[link(first),link(second)],inventory)
    assert.equal(multi.group,'multiple'); assert.equal(multi.unambiguousUnitId,null)
    assert.match(multi.label,/101.*102/)
    assert.equal(identifyPropertyFromUrls('12345',[link(first),'https://external.example/house'],inventory).kind,'none')
  })
  it('retains externally confirmed names and mixed-property groups',()=>{
    assert.equal(summarizePropertyLinks('12345',[saved(null,'Casa externa')]).group,'external')
    const mixed=summarizePropertyLinks('12345',[saved(first,null),saved(null,'Casa externa')])
    assert.equal(mixed.group,'multiple');assert.equal(mixed.unambiguousUnitId,null)
    assert.match(mixed.label,/Casa externa/)
  })
  it('validates the entire confirmation, with one target type per property',()=>{
    assert.deepEqual(normalizePropertyTargets([{unitId:null,externalLabel:' Casa externa '}]),[{unitId:null,externalLabel:'Casa externa'}])
    for(const targets of [[{unitId:first,externalLabel:'Casa'}],[{unitId:null,externalLabel:null}],[{unitId:first,externalLabel:null},{unitId:first,externalLabel:null}],[{unitId:null,externalLabel:'Casa'},{unitId:null,externalLabel:'casa'}]]) assert.throws(()=>normalizePropertyTargets(targets))
  })
  it('verifies the Meta account and fails closed on denied or missing evidence',async()=>{
    const env={META_ADS_ACCESS_TOKEN:'fake-test-token',META_AD_ACCOUNT_ID:'123'}
    const mock=(account:string):typeof fetch=>async input=>{
      const url=new URL(String(input));assert.equal(url.searchParams.get('fields'),'id,account_id,creative{object_url,link_url,object_story_spec,asset_feed_spec}')
      return new Response(JSON.stringify({id:'12345',account_id:account,creative:{object_url:link(first)}}))
    }
    assert.deepEqual(await fetchAdDestinationEvidence('12345',{env,fetchImpl:mock('123')}),{urls:[link(first)],verifiedAccount:true})
    assert.deepEqual(await fetchAdDestinationEvidence('12345',{env,fetchImpl:mock('999')}),{urls:[],verifiedAccount:false})
    assert.equal((await fetchAdDestinationEvidence('12345',{env,fetchImpl:async()=>new Response('{}',{status:403})})).verifiedAccount,false)
  })
})

describe('classified advertising totals',()=>{
  const row=(adId:string,external:boolean,spend:number,leads:string[])=>({adId,attributionKey:adId,leadIds:leads,leadsUnique:leads.length,adSpend:spend,currency:'USD',promotedUnit:summarizePropertyLinks(adId,[saved(external?null:first,external?'Casa externa':null)]),campaignId:'campaign',campaignName:'Mixed campaign',resolutionStatus:'resolved',temperature:{frio:0,tibio:0,caliente:leads.length,sin_clasificar:0},metaReportedResults:null,spendStale:false,spendFetchedAt:null,costPerLead:null})
  it('keeps external spend and contacts out of inventory totals and mixed campaigns',()=>{
    const rows=[row('12345',false,20,['a','b']),row('67890',true,80,['c','d'])]
    const internal=rows.filter(r=>propertyGroup(r)==='inventory')
    assert.deepEqual(summarizePropertyAds(internal),{adCount:1,leadsUnique:2,adSpend:20,currency:'USD',costPerLead:10})
    const campaign=rollupAttributedAdsByCampaign(internal)[0]
    assert.equal(campaign.adSpend,20);assert.equal(campaign.costPerLead,10)
    assert.equal(summarizePropertyAds(rows.filter(r=>propertyGroup(r)==='external')).adSpend,80)
  })
  it('does not duplicate ad spend or unique contacts and refuses partial/mixed-currency averages',()=>{
    const a=row('12345',false,20,['a','b']);const b=row('67890',false,30,['b','c'])
    assert.deepEqual(summarizePropertyAds([a,a,b]),{adCount:2,leadsUnique:3,adSpend:50,currency:'USD',costPerLead:16.67})
    const campaign=rollupAttributedAdsByCampaign([a,a,b])[0]
    assert.equal(campaign.adSpend,50);assert.equal(campaign.leadsUnique,3)
    assert.equal(summarizePropertyAds([a,{...b,adSpend:null}]).costPerLead,null)
    assert.equal(summarizePropertyAds([a,{...b,currency:'EUR'}]).adSpend,null)
    assert.equal(summarizePropertyAds([{...a,leadIds:[]}]).costPerLead,null)
    const merged=uniqueReportAds([a,{...a,leadIds:['b','c']}])[0]
    assert.equal(merged.leadsUnique,3)
    assert.equal(merged.costPerLead,6.67)
    assert.equal(summarizePropertyAds([a,{...b,adId:null,adSpend:null}]).costPerLead,10)
  })
})

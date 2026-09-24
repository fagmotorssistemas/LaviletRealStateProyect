import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdvertisingPanel, panelMetricText, pendingCampaign } from './advertisingPanel.logic'
import type { MarketingFunnelReport, AttributedAdFunnelRow } from './marketingFunnel.service'
import type { AttentionPerson } from './marketingAttention.logic'
import { currentInterest } from './marketingInterest.logic'
function ad(id:string,campaign:string|null,spend:number|null,ids:string[]):AttributedAdFunnelRow {
 return {adId:id,attributionKey:id,campaignId:campaign,campaignName:campaign==='external'?'Casa De Tarqui':campaign,adName:'Anuncio '+id,adSpend:spend,currency:'USD',leadIds:ids,spendStale:false} as AttributedAdFunnelRow
}
const person=(id:string,adId:string,state:'responded'|'unanswered'|'verify',complete=false)=>({leadId:id,adId,historyComplete:complete,flags:{responseRecorded:state==='responded',noResponse:state==='unanswered'}} as AttentionPerson)
function report():MarketingFunnelReport{return {byAttributedAd:[ad('a','one',20,['p1','p2']),ad('b','one',80,['p3']),ad('c','external',50,[]),ad('d',null,10,['p4']),ad('','one',999,['organic'])],attention:{people:[person('p1','a','responded'),person('p2','a','unanswered',true),person('p3','b','verify'),person('p4','d','unanswered',false)]},interestByLead:{p1:{bucket:'caliente',evaluatedAt:'2026-09-23',score:60,reason:'Confirmado'},p2:{bucket:'frio',evaluatedAt:'2026-09-23',score:0,reason:'Evaluado sin señales'},p3:{bucket:'tibio',evaluatedAt:'2026-09-23',score:25,reason:'Precio'}}} as unknown as MarketingFunnelReport}
const all={campaign:'',ad:'',search:''}

test('CRM labels without evaluation dates produce exact campaign and ad rosters',()=>{
 const data=report()
 data.byAttributedAd.push(ad('other','other-campaign',12,['outside']))
 data.interestByLead={p1:currentInterest({temperature:'frio'}),p2:currentInterest({temperature:'tibio'}),p3:currentInterest({temperature:'caliente'}),outside:currentInterest({temperature:'frio'})}
 const campaign=buildAdvertisingPanel(data,{...all,campaign:'one'})
 assert.deepEqual(campaign.summary.groups.cold,['p1'])
 assert.deepEqual(campaign.summary.groups.warm,['p2'])
 assert.deepEqual(campaign.summary.groups.hot,['p3'])
 assert.deepEqual(campaign.summary.groups.unevaluated,[])
 const single=buildAdvertisingPanel(data,{...all,campaign:'one',ad:'a'})
 assert.deepEqual(single.summary.groups.cold,['p1'])
 assert.deepEqual(single.summary.groups.warm,['p2'])
 assert.deepEqual(single.summary.groups.hot,[])
 assert.deepEqual(single.rows[0].ads[0].summary.groups,single.summary.groups)
 data.interestByLead.p1=currentInterest({temperature:'caliente'})
 const refreshed=buildAdvertisingPanel(data,{...all,campaign:'one',ad:'a'})
 assert.deepEqual(refreshed.summary.groups.cold,[])
 assert.deepEqual(refreshed.summary.groups.hot,['p1'])
})
test('one denominator: ads, campaign totals, cards and all filtered people; spend-only and external stay visible',()=>{
 const model=buildAdvertisingPanel(report(),all)
 assert.equal(model.summary.spend,160);assert.equal(model.summary.cost,40)
 assert.equal(model.rows[0].summary.spend,100);assert.equal(model.rows[0].summary.cost,33.33)
 assert.equal(model.rows.find(r=>r.name==='Casa De Tarqui')?.summary.spend,50)
 assert.ok(model.rows.some(r=>r.key===pendingCampaign))
 assert.deepEqual(model.summary.groups.contacts,['p1','p2','p3','p4'])
 const groups=model.summary.groups
 assert.equal(groups.hot.length+groups.warm.length+groups.cold.length+groups.unevaluated.length,4)
 assert.deepEqual(groups.responded,['p1']);assert.deepEqual(groups.unanswered,['p2']);assert.deepEqual(groups.verify,['p3','p4'])
 assert.equal(groups.responded.length+groups.unanswered.length+groups.verify.length,4)
})
test('campaign/ad/name filters share totals and dependent options',()=>{
 assert.equal(buildAdvertisingPanel(report(),{...all,campaign:'one'}).adOptions.length,2)
 const model=buildAdvertisingPanel(report(),{campaign:'one',ad:'b',search:'Anuncio'})
 assert.equal(model.rows.length,1);assert.equal(model.summary.spend,80);assert.deepEqual(model.summary.groups.contacts,['p3'])
 assert.equal(buildAdvertisingPanel(report(),{...all,search:'Casa De Tarqui'}).summary.spend,50)
})
test('unknowns do not become cold, unanswered or zero-valued acquisition costs',()=>{
 const data=report();data.byAttributedAd[0].adSpend=null
 const model=buildAdvertisingPanel(data,all)
 assert.equal(model.summary.spend,null);assert.equal(model.summary.cost,null)
 const pending=buildAdvertisingPanel(data,{...all,ad:'d'}).summary
 assert.deepEqual(pending.groups.unevaluated,['p4']);assert.equal(panelMetricText(pending,'cold'),'0 comprobados');assert.equal(panelMetricText(pending,'unanswered'),'0 comprobados')
})

test('responses from eight unrelated people cannot populate the eight ad acquisitions',()=>{
 const data=report(),attributed=Array.from({length:8},(_,i)=>'attributed-'+i),other=Array.from({length:8},(_,i)=>'other-'+i)
 data.byAttributedAd=[ad('tarqui','external',80,attributed),ad('','',0,other)]
 data.attention!.people=[...other.map(id=>person(id,'','responded')),...attributed.map(id=>person(id,'tarqui','verify'))]
 data.interestByLead=Object.fromEntries(other.map(id=>[id,{bucket:'caliente',evaluatedAt:'2026-09-23',score:60,reason:'Otro origen'}]))
 for(const filters of [{...all,campaign:'external'},{...all,ad:'tarqui'}]){
   const model=buildAdvertisingPanel(data,filters)
   assert.deepEqual(model.summary.groups.contacts,attributed)
   assert.deepEqual(model.summary.groups.responded,[])
   assert.deepEqual(model.summary.groups.hot,[])
   assert.deepEqual(model.summary.groups.verify,attributed)
   assert.deepEqual(model.summary.groups.unevaluated,attributed)
   assert.deepEqual(model.rows[0].ads[0].summary.groups,model.summary.groups)
 }
})
test('one acquisition follows saved source, ambiguous duplicate sources are not invented',()=>{
 const data=report();data.byAttributedAd[1].leadIds.push('p1','conflict');data.byAttributedAd[0].leadIds.push('conflict')
 const model=buildAdvertisingPanel(data,all)
 assert.equal(model.summary.groups.contacts.filter(id=>id==='p1').length,1)
 assert.deepEqual(model.rows[0].ads[1].summary.groups.contacts,['p3'])
 assert.deepEqual(model.conflicts,['conflict'])
})

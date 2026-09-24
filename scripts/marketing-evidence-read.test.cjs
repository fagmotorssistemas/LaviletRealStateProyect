const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module')
require('./test-typescript.cjs')
test('journal preceding CRM creation resolves only unique original contact and commercial-file IDs, read-only',async()=>{
 const original=Module._load
 Module._load=function(id,parent,isMain){if(id==='server-only')return {};return original.call(this,id,parent,isMain)}
 try{
  const {readMessageEvidence}=require('../src/services/marketingEvidence.service.ts')
  const evidence=(id,contact,kommo)=>({id,lead_id:null,contact_id:contact,kommo_lead_id:kommo,external_message_id:id,direction:'incoming',observed_at:'2026-09-23',sent_at:'2026-09-23'})
  const owners=[{id:'one',contact_id:'11',kommo_id:22},{id:'two',contact_id:'33',kommo_id:44},{id:'duplicate',contact_id:'33',kommo_id:44}]
  const admin={from(table){let unlinked=false;const q={select(){return q},eq(){return q},in(){return q},lte(){return q},order(){return q},is(){unlinked=true;return q},range(){return Promise.resolve({error:null,data:table==='leads'?owners:unlinked?[evidence('valid','11',22),evidence('wrong-file','11',23),evidence('ambiguous','33',44),evidence('no-file','11',null)]:[]})}};return q}}
  const result=await readMessageEvidence(admin,'business',['one','two'],'2026-09-24',owners.slice(0,2))
  assert.equal(result.available,true)
  assert.deepEqual(result.rows.map(r=>[r.id,r.lead_id]),[['valid','one']])
 }finally{Module._load=original}
})

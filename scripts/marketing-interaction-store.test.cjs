/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS test harness. */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const ts=require('typescript')

test('marketing records referrals without clid; legacy delivery capture keeps its original contract',async()=>{
  const calls=[]
  const scope={tenant_id:'tenant',project_id:'project'}
  const loaded={exports:{}}
  const source=ts.transpileModule(fs.readFileSync('src/lib/integrations/automation/ctwa-lead-store.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const data={scope,object:v=>v || {},text:v=>String(v || ''),rpc:async(name,input)=>{calls.push({name,input});return {ok:true,action:'preserved_existing'}}}
  new Function('require','module','exports',source)(id=>id==='./data'?data:{},loaded,loaded.exports)
  const base={leadId:'lead',occurredAt:'2026-09-23T12:00:00Z',contactId:123,kommoId:456,externalMessageId:'one',adReferral:{sourceId:'111',sourceUrl:null,referralSourceType:'ad'},ctwa:null}
  const first=await loaded.exports.preserveCtwaForContact(base)
  assert.equal(first.code,'CTWA_NOOP')
  assert.deepEqual(calls.map(c=>c.name),['record_marketing_ad_interaction'])
  assert.equal(calls[0].input.p_lead_id,'lead')
  assert.equal(calls[0].input.p_ad_id,'111')
  const second=await loaded.exports.preserveCtwaForContact({...base,externalMessageId:'two',adReferral:null,ctwa:{clid:'test-only',sourceId:'222',sourceUrl:null,referralSourceType:'ad',fieldPath:'referral'}})
  assert.equal(second.code,'CTWA_PRESERVED')
  assert.deepEqual(calls.map(c=>c.name),['record_marketing_ad_interaction','record_marketing_ad_interaction','lv_app_preserve_ctwa'])
  assert.equal(calls[1].input.p_ad_id,'222')
  assert.equal(calls[2].input.p_ctwa_clid,'test-only')
})

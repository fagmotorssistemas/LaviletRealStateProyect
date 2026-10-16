const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
require('./test-typescript.cjs')
const root=path.resolve(__dirname,'..'),data=require('../src/lib/integrations/automation/data.ts')
const current=new Date(Date.now()-1000).toISOString(),old=new Date(Date.now()-120000).toISOString()
const audience={version:1,mode:'future_messages',activatedAt:new Date(Date.now()-60000).toISOString()}
function load(name,mocks) {
  const filename=path.join(root,'src/lib/integrations/automation',name+'.ts'),m={exports:{}},req=Module.createRequire(filename)
  const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS}}).outputText
  new Function('require','module','exports',source)(id=>id in mocks?mocks[id]:req(id),m,m.exports)
  return m.exports
}
const forbidden=()=>{throw Error('unexpected_side_effect')}
test('24h followup blocks old source and old event before reading content or invoking the provider',async()=>{
  const mod=load('nutrition',{'./config':{assertLive(){},automationSettings:()=>({testLeadId:null})},
    './data':{...data,autoConfig:async()=>({_audience:audience}),db:forbidden,one:forbidden,rpc:forbidden},
    './kommo':{launchSalesbot:forbidden,setKommoField:forbidden,getKommoLead:forbidden}})
  for(const [sourceAt,receivedAt]of[[old,current],[current,old]]) {
    const result=await mod.sendNutrition24h({received_at:receivedAt,payload:{anchorAt:sourceAt}},async()=>{})
    assert.equal(result.reason,'before_audience_activation')
  }
})

test('confirmed non-delivery does not authorize replaying a pre-activation message',async()=>{
  const key='__reply_registration__:source',event={id:'retry',contact_key:'123:42',received_at:current,
    payload:{checkpoint_key:key,kommoId:123,contactId:42,sentAt:old}}
  const checkpoint={id:'journal',event_key:key,contact_key:'123:42',result:{reviewed_by:'admin',delivery_state:'prepared',
    event_ids:['retry'],args:{p_content:'Previously checked draft',p_conversation_id:'conv'}}}
  const q={};for(const method of['select','match','eq','abortSignal','maybeSingle'])q[method]=()=>q
  q.then=resolve=>Promise.resolve({data:checkpoint,error:null}).then(resolve)
  const mod=load('delivery-retry',{'./data':{...data,db:()=>({from:()=>q}),autoConfig:async()=>({_audience:audience}),one:forbidden,rpc:forbidden},
    './kommo':{launchSalesbot:forbidden,setKommoField:forbidden,getKommoLead:forbidden}})
  const result=await mod.sendConfirmedDeliveryRetry(event,async()=>{})
  assert.equal(result.delivery_status,'not_sent')
  assert.equal(result.reason,'DELIVERY_RETRY_NO_LONGER_AUTHORIZED')
})

test('showroom rejects old consent or a rescheduled historical registration before loading the lead',async()=>{
  for(const invitation of[{id:'job',consent_at:old,created_at:current},{id:'job',consent_at:current,created_at:old}]) {
    const changes=[]
    const from=()=>{let update=null;const q={}
      for(const method of['select','match','eq','lt','lte','order','limit','in'])q[method]=()=>q
      q.update=value=>{update=value;return q}
      q.then=resolve=>{if(update)changes.push(update);return Promise.resolve({data:update?null:[invitation],error:null}).then(resolve)}
      return q}
    const mod=load('showroom-contact',{'./config':{automationSettings:()=>({testLeadId:null})},
      './data':{...data,db:()=>({from}),one:forbidden,rpc:forbidden},
      './kommo':{launchSalesbot:forbidden,getKommoLead:forbidden,verifyShowroomTemplates:forbidden}})
    await mod.processShowroomContacts({_audience:audience},async()=>{})
    assert.ok(changes.some(change=>change.status==='cancelled'&&change.reason==='before_audience_activation'))
  }
})

function visitHarness(options={}) {
  const writes=[],lead={...data.scope,id:'lead',kommo_id:123},appointment={...data.scope,id:'appt',lead_id:'lead',confirmed_at:options.confirmedAt??old,start_time:new Date(Date.now()+3*3600000).toISOString(),status:'aceptado'}
  const context={lead,appointment,config:{...data.scope,enabled:true,dry_run:false,test_only:false},job:{id:'job',kind:options.kind||'visit_2h',created_at:options.createdAt??current,payload:{}},request:{source_message_id:options.reference||'customer-source',client_acceptance_message_id:options.reference||'customer-acceptance'}}
  function from(table) {
    const q={},filters={};let update
    for(const method of['select','match','maybeSingle','in','order','limit','neq'])q[method]=()=>q
    q.eq=(key,value)=>{filters[key]=value;return q}
    q.update=value=>{update=value;return q}
    q.upsert=value=>{update=value;return q}
    q.then=resolve=>{
      if(update)writes.push({table,update})
      let result=null
      if(table==='projects')result={address:'Cuenca',policies_json:options.missingPolicy?{}:{automation_audience:audience}}
      if(table==='project_automation_config')result={mode:'lanzamiento'}
      if(table==='appointment_units')result=[]
      if(table==='conversations')result=[{id:'conversation'}]
      if(table==='appointment_reschedule_requests')result=options.missingRequest?null:{id:'request',source_message_id:options.reference||'customer-source',client_acceptance_message_id:options.reference||'customer-acceptance'}
      if(table==='messages')result=filters.id?(options.idMessageAt?[{sent_at:options.idMessageAt}]:[]):[{sent_at:options.messageAt??old}]
      return Promise.resolve({data:result,error:null}).then(resolve)
    };return q
  }
  const mod=load('visits',{'./config':{assertLive(){},automationSettings:()=>({testLeadId:null})},
    './data':{...data,db:()=>({from}),permitted:()=>true,autoConfig:async()=>({...context.config,_audience:audience}),
      rpc:async(name,args)=>{if(name==='lv_app_visit_context')return structuredClone(context);if(name==='lv_app_visit_candidates')return[{lead,appointment,visit_state:{}}];if(name==='lv3_enqueue'){writes.push({table:'enqueue',update:args.p});return{}}throw Error('unexpected_rpc_'+name)}},
    './kommo':{launchSalesbot:forbidden,getKommoLead:forbidden,setKommoField:forbidden,setKommoFields:forbidden},
    './operational-copy':{operationalReply:forbidden}})
  return{mod,writes}
}
test('an old confirmed appointment never gains a reminder from its future start time',async()=>{
  const h=visitHarness()
  assert.equal(await h.mod.planVisits(async()=>{}),0)
  assert.deepEqual(h.writes,[])
  const result=await h.mod.sendVisit('job',async()=>{})
  assert.equal(result.reason,'before_audience_activation')
  assert.ok(h.writes.some(write=>write.table==='lv_outbox'&&write.update.status==='cancelled'))
})
test('reminders use new confirmation evidence and never resurrect an old outbox task',async()=>{
  for(const [createdAt,allowed]of[[old,false],[current,true]]) {
    const h=visitHarness({confirmedAt:current,createdAt,messageAt:current})
    const c=await h.mod.visitContext('job')
    assert.equal(c.audience_allowed,allowed)
    assert.equal(c.audience_source_at,current)
  }
})

test('confirming an old client request today cannot create a new reminder without new client evidence',async()=>{
  const stale=visitHarness({confirmedAt:current,messageAt:old})
  assert.equal(await stale.mod.planVisits(async()=>{}),0)
  assert.deepEqual(stale.writes,[])
  assert.equal((await stale.mod.sendVisit('job',async()=>{})).reason,'before_audience_activation')
  const sourceAt=new Date(Date.now()-3000).toISOString(),fresh=visitHarness({confirmedAt:current,messageAt:sourceAt})
  const context=await fresh.mod.visitContext('job')
  assert.equal(context.audience_allowed,true)
  assert.equal(context.audience_source_at,sourceAt)
  assert.equal(await fresh.mod.planVisits(async()=>{}),1)
  assert.equal(fresh.writes.find(write=>write.table==='enqueue').update.payload.source_at,sourceAt)
  const unproven=visitHarness({confirmedAt:current,messageAt:current,missingRequest:true})
  assert.equal((await unproven.mod.visitContext('job')).audience_allowed,false)
})
test('visit proposal follows the referenced customer action, not the appointment or dispatch time',async()=>{
  const oldMessage=visitHarness({kind:'visit_propose',confirmedAt:current,messageAt:old})
  assert.equal((await oldMessage.mod.sendVisit('job',async()=>{})).reason,'before_audience_activation')
  const freshMessage=visitHarness({kind:'visit_confirm',messageAt:current})
  assert.equal((await freshMessage.mod.visitContext('job')).audience_allowed,true)
})
test('visits fail closed when a live all-lead configuration loses the boundary policy',async()=>{
  await assert.rejects(visitHarness({missingPolicy:true}).mod.visitContext('job'),/AUTOMATION_AUDIENCE_REQUIRED/)
})

test('a Kommo UUID remains an external message ID and collisions with local IDs fail closed',async()=>{
  const reference='d8300387-383a-4b8a-85e1-caa1a53db3a2'
  const h=visitHarness({kind:'visit_confirm',reference,messageAt:current})
  const c=await h.mod.visitContext('job')
  assert.equal(c.audience_allowed,true)
  assert.equal(c.audience_source_at,current)
  const collision=visitHarness({kind:'visit_confirm',reference,messageAt:current,idMessageAt:old})
  assert.equal((await collision.mod.visitContext('job')).audience_allowed,false)
})

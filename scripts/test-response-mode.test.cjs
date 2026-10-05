/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'..')
function load(file,mocks={}){
  const loaded={exports:{}}
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('require','module','exports',code)(id=>{if(id in mocks)return mocks[id];throw Error(id)},loaded,loaded.exports)
  return loaded.exports
}
const settings=load('src/lib/inmobiliaria/testResponseMode.ts')

function harness({enabled=true,phone='593987110032',rows=[]}={}){
  const calls=[]
  const db={from(table){let write=null;const filters=[];const q={then(resolve){calls.push({table,write,filters});return Promise.resolve({data:table==='lv_test_contacts_state'?[{id:'entry',phone,fast_response:enabled,version:2,lead_id:'carlos',kommo_id:2710090,matches:1}]:rows,error:null}).then(resolve)}};for(const key of ['select','match','eq','in','order','maybeSingle','abortSignal','lte'])q[key]=(...args)=>{filters.push([key,...args]);return q};q.update=value=>{write=value;return q};return q}}
  const mod=load('src/lib/integrations/automation/test-response-mode.ts',{'server-only':{},'./data':{db:()=>db,scope:{tenant_id:'tenant',project_id:'project'}},'@/lib/inmobiliaria/testResponseMode':settings})
  return {...mod,calls}
}
test('phone normalization detects duplicates and requires country code for non-Ecuadorian numbers',()=>{
  for(const p of ['0987110032','+593 98 711 0032','593987110032'])assert.equal(settings.normalizeTestPhone(p),'593987110032')
  assert.equal(settings.normalizeTestPhone('+1 (202) 555-0199'),'12025550199')
  for(const p of ['987110032','call +593987110032',null,'123'])assert.equal(settings.normalizeTestPhone(p),null)
})
test('a CRM lead without Kommo is awaiting WhatsApp, not a paused WhatsApp bot',()=>{
 const contact={id:'entry',phone:'593991234567',label:'',fastResponse:false,version:1,leadId:'web-lead',kommoId:null,botEnabled:false,matches:1,blocked:false,lastResetAt:null}
 const pending=settings.testContactControls(contact)
 assert.equal(pending.label,'Pendiente de vincular WhatsApp')
 assert.equal(pending.canReset,false);assert.equal(pending.canResume,false)
 assert.match(pending.explanation,/lead en el CRM/)
 assert.match(pending.explanation,/Actualizar lista/)
 // A first inbound link does not silently lift a stored pause. Both explicit
 // admin actions become available once the verified Kommo identity exists.
 const linked=settings.testContactControls({...contact,kommoId:123})
 assert.equal(linked.label,'Bot pausado')
 assert.equal(linked.canReset,true);assert.equal(linked.canResume,true)
 for(const kommoId of [0,-1,NaN,Infinity,1.5])assert.equal(settings.testContactControls({...contact,kommoId}).canReset,false)
})
test('contact controls distinguish missing leads, duplicates and blocked linked leads',()=>{
 const contact={id:'entry',phone:'593991234567',label:'',fastResponse:false,version:1,leadId:'lead',kommoId:123,botEnabled:true,matches:1,blocked:false,lastResetAt:null}
 const missing=settings.testContactControls({...contact,matches:0,leadId:null,kommoId:null})
 assert.equal(missing.label,'Esperando primer mensaje');assert.equal(missing.canReset,false)
 const duplicate=settings.testContactControls({...contact,matches:2})
 assert.equal(duplicate.label,'Varios leads con este número');assert.equal(duplicate.canResume,false);assert.equal(duplicate.canReset,false)
 const blocked=settings.testContactControls({...contact,blocked:true,botEnabled:false})
 assert.equal(blocked.canResume,false);assert.match(blocked.resumeDisabledReason,/derivación/)
 assert.equal(blocked.canReset,true) // The transactional reset separately protects opt-outs and sales.
 const enabled=settings.testContactControls(contact)
 assert.equal(enabled.label,'Bot habilitado');assert.equal(enabled.canReset,true)
 assert.equal(enabled.canResume,true) // A failed Kommo sync remains retryable.
})
test('test-only gate uses enrollment including empty list; production and environment gates remain independent',()=>{
 assert.equal(settings.testLeadAllowed({test_only:true,test_lead_id:'legacy',test_lead_ids:['new']},'new'),true)
 assert.equal(settings.testLeadAllowed({test_only:true,test_lead_id:'legacy',test_lead_ids:[]},'legacy'),false)
 assert.equal(settings.testLeadAllowed({test_only:false,test_lead_ids:[]},'ordinary'),true)
 assert.equal(settings.testLeadAllowed({test_only:false},'ordinary','only'),false)
})
test('disabled mode and another contact cannot claim messages',async()=>{
 for(const options of [{enabled:false},{}]){
  const h=harness(options);assert.deepEqual(await h.claimTestMessages('lease',options.enabled===false?'2710090:456':'999:1'),[]);assert.equal(h.calls.some(c=>c.write),false)
 }
})
test('test claims preserve grouping, in-progress and unknown-delivery barriers',async()=>{
 for(const row of [{status:'uncertain'},{status:'processing'},{status:'pending',available_at:new Date(Date.now()+30_000).toISOString()}]){
  const h=harness({rows:[row]});assert.deepEqual(await h.claimTestMessages('lease','2710090:456'),[]);assert.equal(h.calls.some(c=>c.write),false)
 }
})
test('any enrolled fast phone can be claimed with scope, status and deadline guards',async()=>{
 const h=harness({phone:'593991234567',rows:[{id:'one',status:'pending',available_at:'2020-01-01',received_at:'2020-01-01',payload:{}}]})
 assert.equal((await h.claimTestMessages('lease','2710090:456')).length,1)
 const write=h.calls.find(c=>c.write)
 assert.equal(write.write.claim_token,'lease')
 assert.ok(write.filters.some(f=>f[0]==='match'&&f[1].project_id==='project'))
 assert.ok(write.filters.some(f=>f[0]==='eq'&&f[1]==='contact_key'&&f[2]==='2710090:456'))
 assert.ok(write.filters.some(f=>f[0]==='eq'&&f[1]==='status'&&f[2]==='pending'))
 assert.ok(write.filters.some(f=>f[0]==='lte'&&f[1]==='available_at'))
})
test('server actions enforce admin and project access before any mutation',async()=>{
 let denied=true,projectAccess=true;const calls=[]
 const mod=load('src/app/inmobiliaria/automatizacion/pruebas/actions.ts',{
  '@/lib/auth/session':{assertAdmin:async()=>{if(denied)throw Error('forbidden')},getSessionUser:async()=>({user:{id:'admin'},supabase:{from(){const q={select:()=>q,eq:()=>q,single:async()=>({data:projectAccess?{id:'project'}:null,error:null})};return q}}})},
  '@/lib/integrations/automation/data':{scope:{tenant_id:'tenant',project_id:'project'},db:()=>({rpc:async(...args)=>{calls.push(args);return {error:null}}})},
  '@/lib/integrations/automation/kommo':{setKommoField:async()=>{}},
  '@/lib/integrations/automation/test-response-mode':{testContacts:async()=>[]},
  '@/lib/inmobiliaria/testResponseMode':settings,
 })
 await assert.rejects(()=>mod.addTestContactAction('0991234567','test'),/forbidden/)
 denied=false;projectAccess=false
 await assert.rejects(()=>mod.addTestContactAction('0991234567','test'),/Sin acceso/)
 assert.equal(calls.length,0);projectAccess=true
 await assert.rejects(()=>mod.addTestContactAction('bad','test'),/teléfono/)
 await mod.addTestContactAction('0991234567','test');assert.equal(calls[0][1].p_phone,'593991234567')
 await assert.rejects(()=>mod.updateTestContactAction('00000000-0000-4000-8000-000000000001',1,'reset'),/lista cambió/)
 assert.equal(calls.length,1)
})
test('reset and resume explain a missing Kommo link before attempting a mutation',async()=>{
 const id='00000000-0000-4000-8000-000000000001',calls=[]
 const mod=load('src/app/inmobiliaria/automatizacion/pruebas/actions.ts',{
  '@/lib/auth/session':{assertAdmin:async()=>{},getSessionUser:async()=>({user:{id:'admin'},supabase:{from(){const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'project'},error:null})};return q}}})},
  '@/lib/integrations/automation/data':{scope:{tenant_id:'tenant',project_id:'project'},db:()=>({rpc:()=>{calls.push('rpc');throw Error('Unexpected RPC')}})},
  '@/lib/integrations/automation/kommo':{setKommoField:async()=>{calls.push('kommo')}},
  '@/lib/integrations/automation/test-response-mode':{testContacts:async()=>[{id,version:1,leadId:'web-lead',kommoId:null,botEnabled:false,matches:1,blocked:false}]},
  '@/lib/inmobiliaria/testResponseMode':settings,
 })
 for(const action of ['reset','resume'])await assert.rejects(()=>mod.updateTestContactAction(id,1,action),/todavía no está vinculado con Kommo/)
 assert.deepEqual(calls,[])
})

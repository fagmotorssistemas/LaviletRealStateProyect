/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
function load(file,mocks){
 const module={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('require','module','exports',code)(id=>{if(id==='server-only')return {};if(id in mocks)return mocks[id];throw Error(id)},module,module.exports)
 return module.exports
}
function resumeHarness(options={}){
 const calls=[]
 const {resumeTestContact}=load('src/lib/integrations/automation/resume-test-contact.ts',{
  'node:crypto':{randomUUID:()=> 'lease'},
  './data':{object:x=>x||{},db:()=>({rpc:(name,args)=>({abortSignal:async()=>{
   calls.push([name,args])
   if(name==='lv_resume_enrolled_test_contact')return {data:{kommo_id:101},error:options.databaseError||null}
   return {data:args.p_action==='acquire'?!options.busy:true,error:null}
  }})})},
  './kommo':{setKommoField:async(...args)=>{calls.push(['kommo',...args]);if(options.kommoError)throw Error('unavailable')}},
 })
 return {calls,run:()=>resumeTestContact('enrolled',4,'admin')}
}
test('reactivation holds the worker lease across database and Kommo writes without sending a message',async()=>{
 const h=resumeHarness()
 assert.deepEqual(await h.run(),{kommoSynced:true})
 assert.deepEqual(h.calls,[
  ['lv_app_worker_lock',{p_token:'lease',p_action:'acquire'}],
  ['lv_resume_enrolled_test_contact',{p_id:'enrolled',p_version:4,p_actor:'admin',p_token:'lease'}],
  ['kommo',101,451530,'false'],['lv_app_worker_lock',{p_token:'lease',p_action:'release'}],
 ])
})
test('busy worker and rejected resume never reactivate Kommo; failed writes still release the lease',async()=>{
 const busy=resumeHarness({busy:true})
 await assert.rejects(busy.run(),/TEST_RESUME_BUSY/);assert.equal(busy.calls.length,1)
 const denied=resumeHarness({databaseError:Error('TEST_CONTACT_OPT_OUT')})
 await assert.rejects(denied.run(),/TEST_CONTACT_OPT_OUT/)
 assert.equal(denied.calls.some(call=>call[0]==='kommo'),false)
 assert.equal(denied.calls.at(-1)[1].p_action,'release')
})
test('Kommo failure reports partial success and releases the lease for a later explicit retry',async()=>{
 const h=resumeHarness({kommoError:true})
 assert.deepEqual(await h.run(),{kommoSynced:false})
 assert.equal(h.calls.at(-1)[1].p_action,'release')
})
test('missing migration has an actionable error and never changes Kommo',async()=>{
 const h=resumeHarness({databaseError:{code:'PGRST202'}})
 await assert.rejects(h.run(),/TEST_RESUME_NOT_INSTALLED/)
 assert.equal(h.calls.some(call=>call[0]==='kommo'),false)
 assert.equal(h.calls.at(-1)[1].p_action,'release')
})
function advisorHarness(result){
 const calls=[]
 const {processAdvisorOutbound}=load('src/lib/integrations/automation/advisor-outbound.ts',{
  './data':{object:x=>x||{},text:x=>typeof x==='string'?x:'',rpc:async()=>result},
  './kommo':{setKommoField:async(...args)=>calls.push(['kommo',...args])},
  './nutrition':{cancelNutrition24h:async()=>calls.push(['24h'])},
  './nutrition-week-one':{cancelNutritionWeekOne:async()=>calls.push(['week'])},
  './nutrition-later':{cancelNutritionLater:async()=>calls.push(['later'])},
 })
 return {calls,run:()=>processAdvisorOutbound({payload:{externalId:'message',kommoId:101,contactId:101,userId:9001,sentAt:'2026-10-05T17:00:00Z',text:'manual'}})}
}
test('delayed manual evidence is recorded without pausing Kommo or cancelling followups again',async()=>{
 const h=advisorHarness({handled:true,kommo_id:101,bot_paused:false,reason:'MANUAL_MESSAGE_BEFORE_RESUME'})
 const result=await h.run()
 assert.equal(result.action,'advisor_message_recorded');assert.equal(result.bot_paused,false)
 assert.deepEqual(h.calls,[])
})
test('a new manual takeover still pauses Kommo and cancels followups',async()=>{
 const h=advisorHarness({handled:true,kommo_id:101,bot_paused:true}),result=await h.run()
 assert.equal(result.bot_paused,true);assert.equal(result.kommo_stop_synced,true)
 assert.deepEqual(h.calls,[['kommo',101,451530,'true'],['24h'],['week'],['later']])
})

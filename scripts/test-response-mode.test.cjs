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
function harness({enabled=true,phone='+593987110032',rows=[]}={}){
  const calls=[]
  const db={from(table){let write=null;const filters=[];const q={then(resolve){calls.push({table,write,filters});return Promise.resolve({data:table==='agent_prompts'?{content:JSON.stringify({enabled,leadId:'carlos'}),version:2}:table==='leads'?{id:'carlos',phone,kommo_id:2710090}:write?rows:rows,error:null}).then(resolve)}};for(const key of ['select','match','eq','in','order','maybeSingle'])q[key]=(...args)=>{filters.push([key,...args]);return q};q.update=value=>{write=value;return q};return q}}
  const object=value=>typeof value==='string'?JSON.parse(value):value||{}
  const mod=load('src/lib/integrations/automation/test-response-mode.ts',{'server-only':{},'./data':{db:()=>db,scope:{tenant_id:'tenant',project_id:'project'},object},'@/lib/inmobiliaria/testResponseMode':settings})
  return {...mod,calls}
}
test('phone matching permits only the requested Ecuadorian number',()=>{
  for(const p of ['0987110032','+593 98 711 0032'])assert.equal(settings.isTestPhone(p),true)
  for(const p of ['0987110033','987110032','+10987110032',null])assert.equal(settings.isTestPhone(p),false)
})
test('disabled mode and another contact cannot claim messages',async()=>{
  for(const options of [{enabled:false},{phone:'+593987110033'},{}]){
    const h=harness(options)
    assert.deepEqual(await h.claimTestMessages('lease','999:1'),[])
    assert.equal(h.calls.some(c=>c.write),false)
  }
})
test('test claims preserve grouping, in-progress and unknown-delivery barriers',async()=>{
  for(const row of [{status:'uncertain'},{status:'processing'},{status:'pending',available_at:new Date(Date.now()+30_000).toISOString()}]){
    const h=harness({rows:[row]})
    assert.deepEqual(await h.claimTestMessages('lease','2710090:456'),[])
    assert.equal(h.calls.some(c=>c.write),false)
  }
})
test('ready messages are claimed with project, contact, status and lease restrictions',async()=>{
  const h=harness({rows:[{id:'one',status:'pending',available_at:'2020-01-01',received_at:'2020-01-01',payload:{}}]})
  assert.equal((await h.claimTestMessages('lease','2710090:456')).length,1)
  const write=h.calls.find(c=>c.write)
  assert.equal(write.write.claim_token,'lease')
  assert.ok(write.filters.some(f=>f[0]==='match'&&f[1].project_id==='project'))
  assert.ok(write.filters.some(f=>f[0]==='eq'&&f[1]==='contact_key'&&f[2]==='2710090:456'))
  assert.ok(write.filters.some(f=>f[0]==='eq'&&f[1]==='status'&&f[2]==='pending'))
})
test('a changed mode version cancels a previously scheduled acceleration',async()=>{
  const h=harness()
  assert.deepEqual(await h.accelerateTestMessages([{kommoId:2710090}],1),[])
  assert.equal(h.calls.some(c=>c.write),false)
})

test('admin control saves independently of normal timings and restores pending original deadlines',async()=>{
  let row=null,deny=false
  const calls=[]
  const client={from(table){let mutation=null;const q={then(resolve){calls.push({table,mutation});let data
    if(table==='projects')data={id:'project'}
    if(table==='leads')data=[{id:'carlos',phone:'+593987110032',kommo_id:2710090,bot_enabled:true}]
    if(table==='agent_prompts'){if(mutation){row={...row,...mutation,id:'setting'};data=[{id:'setting'}]}else data=row}
    if(table==='lv_integration_events')data=mutation?[]:[{id:'pending',available_at:'2026-01-01',result:{test_original_available_at:'2026-01-02'}}]
    return Promise.resolve({data,error:null}).then(resolve)}}
    for(const key of ['select','eq','in','match','single','maybeSingle','like'])q[key]=()=>q
    q.insert=q.update=value=>{mutation=value;return q};return q}}
  const mod=load('src/app/inmobiliaria/automatizacion/pruebas/actions.ts',{
    '@/lib/auth/session':{assertAdmin:async()=>{if(deny)throw Error('forbidden')},getSessionUser:async()=>({supabase:client,user:{id:'admin'}})},
    '@/lib/integrations/automation/data':{db:()=>client,scope:{tenant_id:'tenant',project_id:'project'},object:v=>typeof v==='string'?JSON.parse(v):v||{}},
    '@/lib/inmobiliaria/testResponseMode':settings,
  })
  assert.equal((await mod.loadTestResponseAction()).enabled,false)
  assert.equal((await mod.saveTestResponseAction(true,0)).enabled,true)
  assert.equal(row.is_active,false)
  await assert.rejects(()=>mod.saveTestResponseAction(false,0),/configuración cambió/)
  assert.equal((await mod.saveTestResponseAction(false,1)).enabled,false)
  assert.ok(calls.some(c=>c.table==='lv_integration_events'&&c.mutation?.available_at==='2026-01-02'))
  assert.equal(calls.some(c=>c.table==='lv_auto_config'),false)
  deny=true
  await assert.rejects(()=>mod.saveTestResponseAction(true,2),/forbidden/)
})

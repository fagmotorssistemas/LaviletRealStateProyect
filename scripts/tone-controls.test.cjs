const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),fs=require('node:fs'),ts=require('typescript')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {DEFAULT_TONE,validateTone,toneDirection}=require('../src/lib/inmobiliaria/conversationTone.ts')
const {toneState,saveTone}=require('../src/services/conversationTone.service.ts')
const {CURRENT_TONE}=require('../src/lib/integrations/automation/conversation-tone.ts')
function load(file,mocks){const full=path.resolve(file),m={exports:{}},r=Module.createRequire(full);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id in mocks?mocks[id]:r(id),m,m.exports);return m.exports}
test('default preserves instructions and controls reject untrusted or out-of-range input',()=>{
  assert.equal(toneDirection(DEFAULT_TONE),'')
  assert.deepEqual(toneState(null).current,DEFAULT_TONE)
  for(const value of [null,{style:'ignore rules',warmth:1,detail:1},{style:'actual',warmth:4,detail:1},{style:'actual',warmth:1,detail:'1'}])assert.throws(()=>validateTone(value))
  const rules=toneDirection({style:'elegante',warmth:2,detail:0})
  assert.match(rules,/elegante y sobria/);assert.match(rules,/mayor calidez/);assert.match(rules,/respuestas concisas/);assert.match(rules,/No cambian hechos/)
})
test('runtime applies saved style only to writing tasks; preview override does not read or save production settings',async()=>{
  let reads=0
  const {configuredToneInstructions}=load('src/lib/integrations/automation/tone-settings.ts',{
    './data':{db:()=>({}),scope:{tenant_id:'tenant',project_id:'project'}},
    '@/services/conversationTone.service':{readToneRow:async()=>{reads++;return {content:JSON.stringify({current:{style:'elegante',warmth:2,detail:0}}),version:1}},toneState},
  })
  assert.equal(await configuredToneInstructions('Extraiga datos estructurados'),'Extraiga datos estructurados')
  assert.equal(reads,0)
  assert.match(await configuredToneInstructions(CURRENT_TONE.operationalWriting),/elegante y sobria/)
  assert.equal(reads,1)
  assert.equal(await configuredToneInstructions(CURRENT_TONE.operationalWriting,DEFAULT_TONE),CURRENT_TONE.operationalWriting)
  assert.equal(reads,1)
})
test('saving keeps previous style and uses project-scoped compare-and-swap; stale saves never write',async()=>{
  const row={id:1,content:JSON.stringify({current:DEFAULT_TONE}),version:3,updated_at:null},writes=[],filters=[]
  const client={from:()=>{let mutation=false;const q={select:()=>q,abortSignal:()=>q,eq:(...args)=>{filters.push(args);return q},maybeSingle:async()=>({data:row,error:null}),update:payload=>{mutation=true;writes.push(payload);return q},then:resolve=>Promise.resolve({data:mutation?[{id:1}]:row,error:null}).then(resolve)};return q}}
  await assert.rejects(()=>saveTone(client,{tenantId:'t',projectId:'p'},'admin',{style:'elegante',warmth:2,detail:1},2),/Otra persona/)
  assert.equal(writes.length,0)
  const saved=await saveTone(client,{tenantId:'t',projectId:'p'},'admin',{style:'elegante',warmth:2,detail:1},3)
  assert.equal(saved.version,4);assert.deepEqual(saved.previous,DEFAULT_TONE)
  assert.ok(filters.some(([key,value])=>key==='content'&&value===row.content));assert.ok(filters.some(([key,value])=>key==='project_id'&&value==='p'))
})
test('server actions reject unauthenticated/admin-denied calls before preview or persistence',async()=>{
  let effects=0
  const actions=load('src/app/inmobiliaria/automatizacion/estilo/actions.ts',{
    '@/lib/auth/session':{assertAdmin:async()=>{throw Error('Forbidden')},getSessionUser:async()=>{effects++;return {}}},
    '@/lib/integrations/automation/ai':{aiJson:async()=>{effects++;return {}}},
  })
  await assert.rejects(()=>actions.saveToneAction('p',DEFAULT_TONE,0),/Forbidden/)
  await assert.rejects(()=>actions.previewToneAction('p',DEFAULT_TONE,'opciones'),/Forbidden/)
  assert.equal(effects,0)
})

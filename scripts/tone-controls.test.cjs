const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),fs=require('node:fs'),ts=require('typescript')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {DEFAULT_TONE,validateTone,toneDirection}=require('../src/lib/inmobiliaria/conversationTone.ts')
const {toneState,saveTone}=require('../src/services/conversationTone.service.ts')
const {CURRENT_TONE}=require('../src/lib/integrations/automation/conversation-tone.ts')
const {DIRECT_CONVERSATION_RULE}=require('../src/lib/integrations/automation/direct-conversation-rule.ts')
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
  assert.match(await configuredToneInstructions(CURRENT_TONE.operationalWriting,undefined,'writing'),/elegante y sobria/)
  assert.equal(reads,1)
  assert.equal(await configuredToneInstructions(CURRENT_TONE.operationalWriting,DEFAULT_TONE,'writing'),CURRENT_TONE.operationalWriting+DIRECT_CONVERSATION_RULE)
  assert.equal(reads,1)
})
test('turn snapshot survives edits, isolates concurrent leads and audits the actual profile',async()=>{
  let reads=0, current={style:'elegante',warmth:0,detail:0}
  const runtime=load('src/lib/integrations/automation/tone-settings.ts',{
    './data':{db:()=>({}),scope:{tenant_id:'tenant',project_id:'project'}},
    '@/services/conversationTone.service':{readToneRow:async()=>{reads++;return {content:JSON.stringify({current}),version:reads}},toneState},
  })
  let resume,started
  const waiting=new Promise(resolve=>{resume=resolve}),ready=new Promise(resolve=>{started=resolve})
  const first=runtime.withConversationTone(async()=>{
    const writer=await runtime.configuredToneInstructions(CURRENT_TONE.operationalWriting,undefined,'writing')
    started();await waiting
    const reviewer=await runtime.configuredToneInstructions(CURRENT_TONE.operationalReview,undefined,'review')
    assert.match(writer,/elegante y sobria/);assert.match(reviewer,/elegante y sobria/)
    assert.deepEqual(runtime.conversationToneAudit(),{style:'elegante',warmth:0,detail:0,version:1,source:'saved',applied:true})
  })
  await ready;current={style:'cercano',warmth:2,detail:2}
  await runtime.withConversationTone(async()=>{
    const reply=await runtime.configuredToneInstructions('Responda la consulta.',undefined,'writing')
    assert.match(reply,/lenguaje cotidiano/)
    assert.equal(runtime.conversationToneAudit().version,2)
  })
  resume();await first;assert.equal(reads,2);assert.equal(runtime.conversationToneAudit(),null)
})
test('custom styles replace competing wording while retaining business constraints; failures preserve original',async()=>{
  const runtime=load('src/lib/integrations/automation/tone-settings.ts',{
    './data':{db:()=>{throw Error('offline')},scope:{}},
  })
  const originalText=Object.values(CURRENT_TONE).join('\n')
  assert.equal(await runtime.configuredToneInstructions(originalText,undefined,'writing'),originalText+DIRECT_CONVERSATION_RULE)
  assert.equal(await runtime.configuredToneInstructions(originalText,{style:'elegante',warmth:0,detail:0},'data'),originalText)
  const custom=await runtime.configuredToneInstructions(originalText,{style:'elegante',warmth:0,detail:0},'writing')
  assert.ok(!custom.includes('Normalmente 25 a 55'))
  assert.ok(!custom.includes('Use aperturas amables de forma ocasional'))
  assert.match(custom,/No atribuya parqueo a visitantes/)
  assert.match(custom,/sin emojis ni identidad de asesor/)
  assert.match(custom,/Una pregunta como m/)
  assert.match(custom,/No omita respuestas/)
  assert.match(custom,/reply responde SOLO/)
})
test('direct conversation rule reaches every style and slider combination in writers and reviewers, never extraction',async()=>{
  const {configuredToneInstructions}=require('../src/lib/integrations/automation/tone-settings.ts')
  for(const style of ['actual','cercano','equilibrado','elegante']) for(const warmth of [0,1,2]) for(const detail of [0,1,2]) {
    for(const task of ['writing','review']) {
      const result=await configuredToneInstructions('Instrucciones base.',{style,warmth,detail},task)
      assert.ok(result.endsWith(DIRECT_CONVERSATION_RULE),`${style}/${warmth}/${detail}/${task}`)
    }
    assert.equal(await configuredToneInstructions('Extraiga datos.',{style,warmth,detail},'data'),'Extraiga datos.')
  }
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

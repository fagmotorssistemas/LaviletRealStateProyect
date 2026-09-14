const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
require('./test-typescript.cjs')
const helpers = require('../src/lib/inmobiliaria/visitProposalOptions.ts')
const filename = path.resolve(__dirname, '../src/services/visitProposal.service.ts')
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

function harness(overrides = {}) {
  const calls = [], aiCalls = [], state = { userId:'advisor', conflict:false, requestedReason:null, ...overrides }
  const context = { request_version:'revision-1', address:'Ricardo Darquea y Elena Landívar, Cuenca', map_url:'https://maps.example/lavilet', mode:'lanzamiento', launch_destination:'office', source_text:'¿Qué otras opciones tiene?', messages:[], ...overrides.context }
  const client = {
    auth:{getUser:async()=>({data:{user:{id:state.userId}}})},
    rpc:async(name, args)=>{
      calls.push({name,args})
      return name==='lv_validate_visit_options' ? {data:context,error:null}
        : name==='lv_visit_scheduling_options' ? {data:{reason:state.requestedReason},error:null}
        : state.conflict ? {data:null,error:{message:'El horario ya está ocupado'}} : {data:{id:'proposal',status:'awaiting_client'},error:null}
    },
  }
  const mocks = {
    'server-only':{},
    '@/lib/integrations/automation/ai':{aiJson:async(...args)=>{ aiCalls.push(args); return overrides.ai ?? {apertura:'Tenemos estas opciones para que elija la que le venga mejor.',cierre:'Si prefiere otro día y hora, puede indicárnoslos para verificar la disponibilidad.'} }},
    '@/lib/integrations/automation/data':{object:value=>value && typeof value==='object' ? value : {},text:value=>typeof value==='string' ? value : ''},
    '@/lib/inmobiliaria/visitProposalOptions':helpers,
  }
  const module={exports:{}}, localRequire=Module.createRequire(filename)
  new Function('require','module','exports',source)(id=>id in mocks ? mocks[id] : localRequire(id),module,module.exports)
  return {...module.exports,client,calls,aiCalls,state}
}
const slots=[14,16,20].map(hour=>({start_time:`2030-09-17T${hour}:00:00Z`,end_time:`2030-09-17T${hour+1}:00:00Z`}))

test('advisor previews are bound to the exact message, dates, revision and authenticated account', async t=>{
  const previous=process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-test-signing-secret-not-a-real-credential'
  t.after(()=>{if(previous===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=previous})
  await t.test('generation reads availability and never schedules a send; unconfirmed proposals include times without unsolicited location',async()=>{
    const h=harness(), preview=await h.prepareVisitProposal(h.client,'request',slots)
    assert.deepEqual(h.calls.map(call=>call.name),['lv_validate_visit_options','lv_visit_scheduling_options'])
    assert.match(preview.message,/1\. martes 17 de septiembre a las 9 a\. m\./)
    assert.match(preview.message,/3\. martes 17 de septiembre a las 3 p\. m\./)
    assert.doesNotMatch(preview.message,/Mapa|https:|Ricardo|oficina/)
    assert.equal(h.aiCalls[0][1].horario_ocupado,false)
    await h.sendVisitProposal(h.client,preview)
    assert.equal(h.calls.at(-1).args.p_message,preview.message)
    assert.equal(h.calls.at(-1).name,'lv_advisor_propose_visit_options')
  })
  await t.test('edited text, times, reordered choices and another advisor require a new reviewed preview',async()=>{
    const h=harness(), preview=await h.prepareVisitProposal(h.client,'request',slots)
    for(const modified of [{...preview,message:'Changed message'},{...preview,options:preview.options.slice().reverse()},{...preview,requestVersion:'revision-2'}]) {
      await assert.rejects(h.sendVisitProposal(h.client,modified),/cambió o venció/)
    }
    h.state.userId='different-advisor'
    await assert.rejects(h.sendVisitProposal(h.client,preview),/cambió o venció/)
    assert.deepEqual(h.calls.map(call=>call.name),['lv_validate_visit_options','lv_visit_scheduling_options'])
  })
  await t.test('a generated invented time cannot become a preview and unconfirmed proposals do not require a map',async()=>{
    const h=harness({ai:{apertura:'Le esperamos el lunes a las 8.',cierre:'Puede indicar otra fecha para verificarla.'}})
    await assert.rejects(h.prepareVisitProposal(h.client,'request',slots),/redactar/)
    const missing=harness({context:{map_url:''}})
    const preview=await missing.prepareVisitProposal(missing.client,'request',slots)
    assert.doesNotMatch(preview.message,/Mapa|https:/)
  })
  await t.test('a conflict apology is grounded in actual advisor availability',async()=>{
    const ai={apertura:'Una disculpa, ese horario está ocupado. Le proponemos estas alternativas.',cierre:'Si prefiere otro día, lo revisamos con el equipo.'}
    const free=harness({ai})
    await assert.rejects(free.prepareVisitProposal(free.client,'request',slots),/redactar/)
    const busy=harness({ai,requestedReason:'busy'})
    const preview=await busy.prepareVisitProposal(busy.client,'request',slots)
    assert.match(preview.message,/ese horario está ocupado/)
    assert.equal(busy.aiCalls[0][1].horario_ocupado,true)
  })
  await t.test('the final atomic write can reject newly occupied slots without sending an alternative automatically',async()=>{
    const h=harness(),preview=await h.prepareVisitProposal(h.client,'request',slots)
    h.state.conflict=true
    await assert.rejects(h.sendVisitProposal(h.client,preview),/ocupado/)
    assert.equal(h.calls.filter(call=>call.name==='lv_advisor_propose_visit_options').length,1)
  })
  await t.test('a call agreement requires an explicit advisor attestation and records only the agreed time',async()=>{
    const h=harness(), input={requestId:'urgent-request',startTime:slots[0].start_time,endTime:slots[0].end_time,callNotes:'Acordamos este horario por llamada.',agreedByPhone:true}
    await assert.rejects(h.completeUrgentVisitCoordination(h.client,{...input,agreedByPhone:false}),/Confirma el acuerdo/)
    await assert.rejects(h.completeUrgentVisitCoordination(h.client,{...input,callNotes:'ok'}),/resumen de la llamada/)
    assert.equal(h.calls.length,0)
    await h.completeUrgentVisitCoordination(h.client,input)
    assert.deepEqual(h.calls,[{name:'lv_complete_urgent_visit_coordination',args:{p_request_id:'urgent-request',p_start:new Date(slots[0].start_time).toISOString(),p_end:new Date(slots[0].end_time).toISOString(),p_call_notes:input.callNotes}}])
    assert.equal(h.aiCalls.length,0)
  })
})

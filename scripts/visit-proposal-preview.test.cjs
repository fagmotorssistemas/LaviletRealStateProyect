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
  const calls = [], state = { userId:'advisor', conflict:false, ...overrides }
  const context = { request_version:'revision-1', address:'Ricardo Darquea y Elena Landívar, Cuenca', map_url:'https://maps.example/lavilet', mode:'lanzamiento', launch_destination:'office', source_text:'¿Qué otras opciones tiene?', messages:[], ...overrides.context }
  const client = {
    auth:{getUser:async()=>({data:{user:{id:state.userId}}})},
    rpc:async(name, args)=>{
      calls.push({name,args})
      return name==='lv_validate_visit_options' ? {data:context,error:null}
        : state.conflict ? {data:null,error:{message:'El horario ya está ocupado'}} : {data:{id:'proposal',status:'awaiting_client'},error:null}
    },
  }
  const mocks = {
    'server-only':{},
    '@/lib/integrations/automation/ai':{aiJson:async()=>overrides.ai ?? {apertura:'Tenemos estas opciones para que elija la que le venga mejor.',cierre:'Si prefiere otro día y hora, puede indicárnoslos para verificar la disponibilidad.'}},
    '@/lib/integrations/automation/data':{object:value=>value && typeof value==='object' ? value : {},text:value=>typeof value==='string' ? value : ''},
    '@/lib/inmobiliaria/visitProposalOptions':helpers,
  }
  const module={exports:{}}, localRequire=Module.createRequire(filename)
  new Function('require','module','exports',source)(id=>id in mocks ? mocks[id] : localRequire(id),module,module.exports)
  return {...module.exports,client,calls,state}
}
const slots=[14,16,20].map(hour=>({start_time:`2030-09-17T${hour}:00:00Z`,end_time:`2030-09-17T${hour+1}:00:00Z`}))

test('advisor previews are bound to the exact message, dates, revision and authenticated account', async t=>{
  const previous=process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-test-signing-secret-not-a-real-credential'
  t.after(()=>{if(previous===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=previous})
  await t.test('generation reads availability and never schedules a send; approved preview includes each time and map',async()=>{
    const h=harness(), preview=await h.prepareVisitProposal(h.client,'request',slots)
    assert.deepEqual(h.calls.map(call=>call.name),['lv_validate_visit_options'])
    assert.match(preview.message,/1\. martes 17 de septiembre a las 9 a\. m\./)
    assert.match(preview.message,/3\. martes 17 de septiembre a las 3 p\. m\./)
    assert.match(preview.message,/Ricardo Darquea y Elena Landívar, Cuenca\nMapa: https:\/\/maps.example\/lavilet$/)
    assert.match(preview.message,/oficina.*construirá/)
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
    assert.deepEqual(h.calls.map(call=>call.name),['lv_validate_visit_options'])
  })
  await t.test('a generated invented time or missing map cannot become a preview',async()=>{
    const h=harness({ai:{apertura:'Le esperamos el lunes a las 8.',cierre:'Puede indicar otra fecha para verificarla.'}})
    await assert.rejects(h.prepareVisitProposal(h.client,'request',slots),/redactar/)
    const missing=harness({context:{map_url:''}})
    await assert.rejects(missing.prepareVisitProposal(missing.client,'request',slots),/dirección/)
  })
  await t.test('the final atomic write can reject newly occupied slots without sending an alternative automatically',async()=>{
    const h=harness(),preview=await h.prepareVisitProposal(h.client,'request',slots)
    h.state.conflict=true
    await assert.rejects(h.sendVisitProposal(h.client,preview),/ocupado/)
    assert.equal(h.calls.filter(call=>call.name==='lv_advisor_propose_visit_options').length,1)
  })
})

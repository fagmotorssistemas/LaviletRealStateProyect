const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module')
require('./test-typescript.cjs')
test('webhook observes bot/media atomically while automation is off; failed persistence is not acknowledged',async()=>{
  const original=Module._load,calls=[]
  let reject=false
  Module._load=function(id,parent,isMain){
    if(id==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)},after:()=>{throw Error('AUTOMATION_MUST_NOT_RUN')}}
    if(id==='@/lib/integrations/automation/config')return {secretMatches:()=>true,automationSettings:()=>({live:false,activatedAt:'2026-01-01T00:00:00Z'})}
    if(id==='@/lib/integrations/automation/data')return {rpc:async(name,args)=>{calls.push({name,args});if(reject)throw Error('WRITE_FAILED');return 1}}
    if(id==='@/lib/integrations/automation/test-response-mode')return {}
    return original.call(this,id,parent,isMain)
  }
  try{
    const {POST}=require('../src/app/api/integrations/kommo/webhook/route.ts')
    const request=()=>new Request('http://localhost/api/integrations/kommo/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:{id:36919007},outgoing_message:{add:[{id:'original-audio',contact_id:11,created_at:Math.floor(Date.now()/1000),origin:'waba',author:{type:'bot'},attachment:{type:'voice'}}]}})})
    const response=await POST(request())
    assert.equal(response.status,200)
    assert.equal((await response.json()).automation,'disabled')
    assert.deepEqual(calls.map(c=>c.name),['lv_receive_kommo_observation'])
    assert.equal(calls[0].args.p_evidence[0].mediaType,'voice')
    assert.deepEqual(calls[0].args.p_inbound,[])
    assert.deepEqual(calls[0].args.p_advisor,[])
    reject=true
    assert.equal((await POST(request())).status,503)
    assert.ok(calls.every(c=>c.name==='lv_receive_kommo_observation'))
  }finally{Module._load=original}
})

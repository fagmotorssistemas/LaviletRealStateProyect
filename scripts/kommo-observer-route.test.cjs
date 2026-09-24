const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module')
require('./test-typescript.cjs')
test('isolated observer only writes journal: real-shape inbound, advisor and Salesbot media; no automation',async()=>{
 const original=Module._load,calls=[];let authorized=true,fail=false
 Module._load=function(id,parent,isMain){
  if(id==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}}
  if(id==='@/lib/integrations/automation/config')return {secretMatches:()=>authorized}
  if(id==='@/lib/integrations/automation/data')return {rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'lv_record_message_evidence');if(fail)throw Error('WRITE_FAILED');return args.p_events.length}}
  if(/automation\/(worker|kommo|conversation)$/.test(id))throw Error('COMMERCIAL_DEPENDENCY_NOT_ALLOWED')
  return original.call(this,id,parent,isMain)
 }
 try{
  const {POST}=require('../src/app/api/integrations/kommo/observe/route.ts')
  const base={contact_id:11,entity_id:22,chat_id:'chat',talk_id:1,origin:'waba',created_at:Math.floor(Date.now()/1000)}
  const body={account:{id:36919007},message:{add:[{...base,id:'in',type:'incoming',author:{type:'external'},text:'test'}]},outgoing_message:{add:[{...base,id:'text',author:{type:'internal',user_id:9},text:'reply'},{...base,id:'audio',author:{type:'bot'},message_type:'voice',attachment:{type:'voice'}}]}}
  const request=()=>new Request('https://example.com/api/integrations/kommo/observe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const result=await POST(request());assert.equal(result.status,200);assert.equal((await result.json()).automation,false)
  assert.equal(calls.length,1);assert.equal(calls[0].args.p_events.length,3)
  fail=true;assert.equal((await POST(request())).status,503)
  authorized=false;const before=calls.length;assert.equal((await POST(request())).status,401);assert.equal(calls.length,before)
 }finally{Module._load=original}
})

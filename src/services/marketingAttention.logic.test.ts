import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateAttention, summarizeAttention, type AttentionLead, type AttentionMessage } from './marketingAttention.logic'

const at='2026-09-23T10:00:00Z', now='2026-09-23T12:00:00Z'
const lead:AttentionLead={id:'one',created_at:at,temperature:'frio',status:'nuevo',stage:'lanzamiento',stage_reason:null,bot_enabled:true,handoff_status:'none',handoff_requested_at:null,seller_response_due_at:null,seller_first_response_at:null}
const msg=(id:string,role:string,sent_at:string,provider_status:string|null=null):AttentionMessage=>({id,conversation_id:'conversation',role,sent_at,external_message_id:role==='cliente'||role==='asesor'?id:null,verified_source:role==='asesor'?'advisor_verified':null,provider_status})
const incoming=msg('in','cliente',at)

test('a sent response in another conversation does not answer the acquisition conversation',()=>{
 const response={...msg('other','asesor','2026-09-23T10:01:00Z'),conversation_id:'other'}
 const person=evaluate([incoming,response],{conversations:[{id:'conversation',lead_id:'one',started_at:at,last_message_at:at,status:'activa'},{id:'other',lead_id:'one',started_at:at,last_message_at:at,status:'activa'}],coverage:{messages:true,tasks:true,appointments:true,sales:true,kommo:false}})
 assert.equal(person.firstResponseAt,null)
 assert.equal(person.flags.responseRecorded,null)
 assert.equal(person.flags.noResponse,null)
})
test('voice with a transcript is still audio evidence',()=>{
 const person=evaluate([incoming,{...msg('audio','bot','2026-09-23T10:01:00Z','sent'),media_type:'voice',content:'Transcript'}])
 assert.equal(person.responses[0].type,'audio')
})
function evaluate(messages:AttentionMessage[],overrides:Partial<Parameters<typeof evaluateAttention>[0]>={}) {
  return evaluateAttention({lead,adId:'12345',asOf:now,conversations:[{id:'conversation',lead_id:'one',started_at:at,last_message_at:messages.at(-1)?.sent_at || at,status:'activa'}],messages,tasks:[],appointments:[],purchased:false,coverage:{messages:true,tasks:true,appointments:true,sales:true,kommo:true},...overrides})
}
test('responded requires the first real outbound after the first inbound, and exposes the dates used',()=>{
  const before=evaluate([incoming,{...msg('out','bot','2026-09-23T09:59:00Z','sent'),content:'Mensaje previo'}])
  assert.equal(before.flags.responseRecorded,null)
  assert.equal(before.flags.noResponse,null)
  assert.equal(before.firstInboundAt,at)
  assert.equal(before.firstResponseAt,null)

  const after=evaluate([incoming,{...msg('out','bot','2026-09-23T10:01:00Z','sent'),content:'Hola'},msg('later','cliente','2026-09-23T10:02:00Z')])
  assert.equal(after.flags.responseRecorded,true)
  assert.equal(after.flags.noResponse,false)
  assert.equal(after.firstInboundAt,at)
  assert.equal(after.firstResponseAt,'2026-09-23T10:01:00Z')
})

test('failed and queued messages are not sent responses; unknown delivery stays unknown',()=>{
  for(const status of ['failed','queued','rejected','not_sent']) {
    const row=evaluate([incoming,msg('out','bot','2026-09-23T10:01:00Z',status)])
    assert.equal(row.flags.noResponse,true);assert.equal(row.flags.botOnly,false);assert.equal(row.botSeconds,null)
  }
  const unknown=evaluate([incoming,msg('old','bot','2026-09-23T10:01:00Z')],{lead:{...lead,bot_enabled:false}})
  assert.equal(unknown.flags.noResponse,null);assert.equal(unknown.flags.botOnly,null);assert.equal(unknown.flags.teamPending,null)
  assert.equal(evaluate([incoming,msg('accepted','bot','2026-09-23T10:01:00Z','accepted')]).flags.noResponse,null)
})
test('only bot is not a human-attention failure; first bot/advisor timing stays separate',()=>{
  const bot=msg('bot','bot','2026-09-23T10:01:00Z','sent')
  const onlyBot=evaluate([incoming,bot])
  assert.equal(onlyBot.flags.botOnly,true);assert.equal(onlyBot.flags.teamPending,false);assert.equal(onlyBot.flags.clientPending,true)
  assert.equal(onlyBot.botSeconds,60);assert.equal(onlyBot.advisorSeconds,null)
  const human=evaluate([incoming,bot,msg('human','asesor','2026-09-23T10:10:00Z')])
  assert.equal(human.flags.advisor,true);assert.equal(human.flags.botOnly,true);assert.equal(human.advisorSeconds,600)
})
test('a new inbound after an advisor response is a current pending, not never answered',()=>{
  const row=evaluate([incoming,msg('human','asesor','2026-09-23T10:10:00Z'),msg('again','cliente','2026-09-23T10:20:00Z')])
  assert.equal(row.flags.noResponse,false);assert.equal(row.flags.teamPending,true);assert.equal(row.flags.clientPending,false)
  assert.equal(row.flags.discarded,false)
})
test('uses recorded deadlines; absent threshold is unknown; overlapping pending people count once',()=>{
  const row=evaluate([incoming],{lead:{...lead,handoff_status:'assigned',handoff_requested_at:at,seller_response_due_at:'2026-09-23T11:30:00Z'},tasks:[{leadId:'one',pending:true,dueAt:'2026-09-23T11:00:00Z'},{leadId:'one',pending:true,dueAt:'2026-09-24T10:00:00Z'}]})
  assert.equal(row.flags.teamOverdue,true);assert.equal(row.flags.followupOverdue,true)
  const summary=summarizeAttention([row,row])
  assert.equal(summary.total,1);assert.equal(summary.metrics.anyPending.ids.length,1);assert.equal(summary.metrics.anyPending.percent,100)
  const noDue=evaluate([incoming],{lead:{...lead,handoff_status:'queued',handoff_requested_at:at}})
  assert.equal(noDue.flags.teamOverdue,null)
})
test('missing history and zero denominators do not become unresponded contacts or 0% claims',()=>{
  const unknown=evaluate([],{conversations:[]})
  assert.equal(unknown.flags.noResponse,null)
  assert.equal(summarizeAttention([unknown]).metrics.noResponse.percent,null)
  assert.equal(summarizeAttention([]).metrics.anyPending.percent,null)
  const partial=evaluate([incoming],{coverage:{messages:false,tasks:false,appointments:false,sales:false}})
  assert.equal(partial.flags.noResponse,null);assert.equal(partial.flags.followupPending,null)
})
test('appointments are distinct contacts, discard reasons are recorded; silence is not loss',()=>{
  const row=evaluate([incoming],{lead:{...lead,status:'no_interesado',stage:'perdido',stage_reason:'Fuera de presupuesto'},appointments:[{lead_id:'one',status:'atendido',confirmed_at:at,no_show:false,start_time:at},{lead_id:'one',status:'atendido',confirmed_at:at,no_show:false,start_time:at}],purchased:true})
  assert.equal(row.flags.appointmentDone,true);assert.equal(summarizeAttention([row]).metrics.appointmentDone.ids.length,1)
  assert.deepEqual(row.reasons,['Fuera de presupuesto']);assert.equal(row.flags.purchased,true)
  assert.deepEqual(evaluate([incoming]).reasons,[])
})
test('generated content is not a sent response and cannot prove a negative',()=>{
  const row=evaluate([incoming,{...msg('draft','bot','2026-09-23T10:01:00Z','accepted'),content:'Generated reply'}])
  assert.equal(row.flags.responseRecorded,null)
  assert.equal(row.flags.botOnly,null)
  assert.equal(row.responses.length,0)
})
test('sent unknown author is counted without inventing a bot or advisor',()=>{
  const row=evaluate([incoming,{...msg('out','unknown','2026-09-23T10:01:00Z','sent'),content:null}])
  assert.equal(row.flags.responseRecorded,true)
  assert.equal(row.flags.responseAuthorUnknown,true)
  assert.equal(row.flags.advisor,false)
})
test('verified audio/image/document does not require text, auxiliary external ID, or a read receipt',()=>{
  for(const media_type of ['audio','picture','file']){
    const row=evaluate([incoming,{...msg(media_type,'bot','2026-09-23T10:01:00Z','sent'),media_type,content:null}])
    assert.equal(row.flags.responseRecorded,true)
    assert.equal(row.responses.length,1)
  }
})
test('partial original history never becomes advisor pending or never answered',()=>{
  const row=evaluate([incoming],{lead:{...lead,handoff_status:'assigned',bot_enabled:false},coverage:{messages:true,kommo:false,tasks:true,appointments:true,sales:true}})
  assert.equal(row.flags.teamPending,null)
  assert.equal(row.flags.noResponse,null)
  assert.equal(row.historyComplete,false)
})
test('failed content and queued multimedia do not count as sent',()=>{
  for(const status of ['error','failed','queued','draft','generated']){
    const row=evaluate([incoming,{...msg('x','asesor','2026-09-23T10:01:00Z',status),content:'not sent',media_type:'audio'}])
    assert.equal(row.flags.responseRecorded,false)
    assert.equal(row.responses.length,0)
  }
})

const test=require('node:test'),assert=require('node:assert/strict')
const {pages,compare}=require('./kommo-crm-audit.cjs')
test('all pages, including a short page with next, are visited; loops/foreign hosts fail',async()=>{
  let count=0
  const rows=await pages(async()=>({ _embedded:{contacts:[{id:++count}]},_links:count<4?{next:{href:'/api/v4/contacts?page='+(count+1)}}:{} }),'/api/v4/contacts','contacts')
  assert.equal(rows.length,4)
  await assert.rejects(pages(async()=>({_embedded:{contacts:[{id:1}]},_links:{next:{href:'/api/v4/contacts?page=2'}}}),'/api/v4/contacts','contacts'),/REPEATED/)
  await assert.rejects(pages(async()=>({_embedded:{contacts:[{id:1}]},_links:{next:{href:'https://foreign.example/'}}}),'/api/v4/contacts','contacts'),/FOREIGN/)
})
test('contact ID is never a commercial file ID; names never merge identities; reset events never replay',()=>{
  const crm={leads:[{id:'crm1',contact_id:'10',kommo_id:20,phone_normalized:'593999999999'}],messages:[],events:[{status:'cancelled',payload:{externalId:'reset'},result:{reason:'manual_test_lead_reset'}}]}
  const contacts=[{id:10,created_at:1,custom_fields_values:[{field_code:'PHONE',values:[{value:'+593 999999999'}]}],_embedded:{leads:[{id:20}]}}]
  const leads=[{id:20,_embedded:{contacts:[{id:10}]}}]
  const talks=[{talk_id:30,contact_id:10,entity_id:20,entity_type:'lead',origin:'waba'}]
  const histories=new Map([['30',{complete:true,messages:['real','reset'].map(id=>({id,type:'outgoing',created_at:100,author:{type:'bot'},delivery_status:'sent'}))}]])
  const result=compare(crm,contacts,leads,talks,histories,'1970-01-01T00:01:00.000Z','1970-01-02T00:00:00.000Z')
  assert.equal(result.counts.olderActiveKommoContacts,1)
  assert.equal(result.proposed.length,1)
  assert.equal(result.proposed[0].kommoId,20)
  assert.equal(result.proposed[0].contactId,10)
  assert.equal(result.differences.find(x=>x.messageId==='reset').blocked,'MANUAL_RESET')
  const talksUsingApiId=talks.map(({talk_id,...rest})=>({...rest,id:talk_id}))
  assert.equal(compare(crm,contacts,leads,talksUsingApiId,histories,'1970-01-01','1970-01-02').proposed[0].talkId,'30')
  crm.leads[0].phone_normalized='593988888888'
  assert.equal(compare(crm,contacts,leads,talks,histories,'1970-01-01','1970-01-02').proposed.length,0)
})
test('existing messages are compared for original date, author and CRM owner, not silently accepted',()=>{
  const crm={leads:[{id:'one',contact_id:'10',kommo_id:20,phone_normalized:'593999999999'}],conversations:[{id:'c',lead_id:'wrong-person'}],messages:[{external_message_id:'m',conversation_id:'c',role:'bot',sent_at:'1970-01-01T00:03:00Z'}],events:[]}
  const contacts=[{id:10,created_at:1,custom_fields_values:[{field_code:'PHONE',values:[{value:'593999999999'}]}],_embedded:{leads:[{id:20}]}}]
  const files=[{id:20,_embedded:{contacts:[{id:10}]}}]
  const talks=[{talk_id:30,contact_id:10,entity_id:20,entity_type:'lead',origin:'waba'}]
  const history=new Map([['30',{complete:true,messages:[{id:'m',type:'outgoing',created_at:100,author:{type:'internal'},delivery_status:'sent'}]}]])
  const report=compare(crm,contacts,files,talks,history,'1970-01-01','1970-01-02')
  assert.deepEqual(report.differences[0].issues,['ORIGINAL_DATE_DIFFERS','AUTHOR_OR_DIRECTION_DIFFERS','IDENTITY_REQUIRES_REVIEW'])
  assert.equal(report.proposed.length,0)
})

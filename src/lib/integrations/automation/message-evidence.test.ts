import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKommoWebhook } from './webhook'
const now=Date.parse('2026-09-23T10:00:00Z')

test('failed human notifications remain evidence without takeover; explicit incoming survives missing auxiliary author',()=>{
 for(const status of ['failed','pending','draft','generated','accepted','error']){
  const result=normalizeKommoWebhook(JSON.stringify({account:{id:36919007},outgoing_message:{add:[{id:'human',contact_id:11,entity_id:22,sec_created_at:now,origin:'waba',author:{type:'internal',user_id:3},delivery_status:status}]}}),'application/json',now)
  assert.equal(result.advisorOutbound.length,0)
  assert.equal(result.evidence[0].deliveryStatus,status)
 }
 const result=normalizeKommoWebhook(JSON.stringify({account:{id:36919007},message:{add:[{id:'in',contact_id:11,entity_id:22,sec_created_at:now,origin:'waba',type:'incoming',attachment:{type:'file'}}]}}),'application/json',now)
 assert.equal(result.inbound.length,1)
 assert.equal(result.evidence.length,1)
 assert.equal(result.inbound[0].sentAt,new Date(now).toISOString())
})
test('Salesbot, unknown author and multimedia survive the manual-takeover filter',()=>{
  const result=normalizeKommoWebhook(JSON.stringify({account:{id:36919007},outgoing_message:{add:[
    {id:'bot-audio',contact_id:11,entity_id:22,chat_id:'chat',talk_id:33,created_at:now/1000,origin:'waba',author:{type:'bot'},message_type:'voice',attachment:{type:'voice',link:'https://example.com/audio'}},
    {id:'unknown-file',contact_id:11,created_at:now/1000,origin:'whatsapp',author:{type:'internal'},attachment:{type:'file'}},
  ]}}),'application/json',now)
  assert.equal(result.advisorOutbound.length,0)
  assert.equal(result.evidence.length,2)
  assert.equal(result.evidence[0].deliveryStatus,'sent')
  assert.equal(result.evidence[0].talkId,'33')
  assert.equal(result.evidence[0].mediaType,'voice')
  assert.equal(result.evidence[1].userId,'')
})
test('explicit send failure overrides notification, wrong accounts are rejected',()=>{
  const raw={account:{id:36919007},outgoing_message:{add:[{id:'failed',contact_id:11,created_at:now/1000,origin:'waba',author:{type:'bot'},delivery_status:'error'}]}}
  assert.equal(normalizeKommoWebhook(JSON.stringify(raw),'application/json',now).evidence[0].deliveryStatus,'error')
  assert.throws(()=>normalizeKommoWebhook(JSON.stringify({...raw,account:{id:7}}),'application/json',now),/WRONG_KOMMO_ACCOUNT/)
})

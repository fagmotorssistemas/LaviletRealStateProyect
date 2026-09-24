import test from 'node:test'
import assert from 'node:assert/strict'
import { advertisingConversation } from './advertisingConversation.logic'
import type { EvidenceRow } from './marketingEvidence.service'
const row=(id:string,chat:string,at:string,direction='incoming',talk='talk')=>({id,external_message_id:id,lead_id:'person',chat_id:chat,talk_id:talk,sent_at:at,direction} as EvidenceRow)
test('original referral anchors one conversation and excludes prior messages and other talks of the same person',()=>{
 const rows=[row('old','chat','2026-09-20'),row('referral','chat','2026-09-21'),row('reply','chat','2026-09-22','outgoing'),row('other','chat','2026-09-22','outgoing','different-talk')]
 assert.deepEqual(advertisingConversation(rows,'referral').map(r=>r.id),['referral','reply'])
 assert.deepEqual(advertisingConversation(rows,'different-namespace-wamid'),[])
 assert.deepEqual(advertisingConversation(rows,null),[])
 assert.deepEqual(advertisingConversation([...rows,rows[1]],'referral'),[])
})

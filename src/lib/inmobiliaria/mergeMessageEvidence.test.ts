import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeLeadTimeline} from './leadTimeline'
import {mergeMessageEvidence} from './mergeMessageEvidence'

test('incoming stored by current receiver and parallel observer appears once by original provider ID',()=>{
  const existing=mergeLeadTimeline([],[{id:'existing-incoming',role:'cliente',content:'Hello',external_message_id:'kommo-incoming',sent_at:'2026-09-23T12:00:00Z'}])
  const merged=mergeMessageEvidence(existing,[{id:'observation',external_message_id:'kommo-incoming',direction:'incoming',author_type:'external',content:'Hello',media_type:null,sent_at:'2026-09-23T12:00:00Z',delivery_status:'unknown'}])
  assert.equal(merged.length,1)
  assert.equal(merged[0].kind,'whatsapp')
  if(merged[0].kind==='whatsapp')assert.equal(merged[0].message.external_message_id,'kommo-incoming')
})
test('CRM timeline keeps generated history but deduplicates exact provider IDs and preserves media/time',()=>{
  const existing=mergeLeadTimeline([],[{id:'local',role:'asesor',content:'text',external_message_id:'original',sent_at:'2026-09-01T10:00:00Z'},{id:'generated',role:'bot',content:'draft',sent_at:'2026-09-01T09:59:00Z'}])
  const merged=mergeMessageEvidence(existing,[{id:'journal',external_message_id:'original',direction:'outgoing',author_type:'internal',content:null,media_type:'voice',sent_at:'2026-09-01T10:00:00Z',delivery_status:'sent'}])
  assert.equal(merged.length,2)
  assert.equal(merged[0].kind,'whatsapp')
  if(merged[0].kind==='whatsapp'){
    assert.equal(merged[0].message.media_type,'voice')
    assert.equal(merged[0].message.delivery_status,'sent')
    assert.equal(merged[0].message.external_message_id,'original')
  }
  assert.equal(merged[1].id,'whatsapp:generated')
})

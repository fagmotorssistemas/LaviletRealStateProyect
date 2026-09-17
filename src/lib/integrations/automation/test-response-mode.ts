import 'server-only'
import { db, scope, object, type Row } from './data'
import { isTestPhone, TEST_RESPONSE_SETTING } from '@/lib/inmobiliaria/testResponseMode'
import type { Inbound } from './webhook'

export async function testResponseMode() {
  const {data,error}=await db().from('agent_prompts').select('content,version').match(scope).eq('name',TEST_RESPONSE_SETTING).maybeSingle()
  if(error)throw Error('TEST_MODE_READ_FAILED')
  const value=object(data?.content)
  if(value.enabled!==true)return null
  const {data:lead,error:leadError}=await db().from('leads').select('id,phone,kommo_id').match(scope).eq('id',value.leadId).maybeSingle()
  if(leadError)throw Error('TEST_LEAD_READ_FAILED')
  return lead && isTestPhone(lead.phone) && lead.kommo_id ? {leadId:lead.id,kommoId:Number(lead.kommo_id),version:data!.version} : null
}

/** Only newly received pending messages are accelerated; duplicate webhooks never replay work. */
export async function accelerateTestMessages(events: Inbound[], version: number) {
  const mode=await testResponseMode()
  if(!mode || mode.version!==version)return []
  const contacts=new Set<string>()
  for(const event of events.filter(e=>e.kommoId===mode.kommoId)) {
    const {data,error}=await db().from('lv_integration_events').select('id,available_at,received_at,result').match(scope)
      .eq('event_key',`inbound:${event.externalId}`).eq('status','pending').maybeSingle()
    if(error)throw Error('TEST_EVENT_READ_FAILED')
    if(!data || Date.now()-Date.parse(data.received_at)>60_000 || object(data.result).test_original_available_at)continue
    const {data:updated,error:writeError}=await db().from('lv_integration_events').update({available_at:new Date().toISOString(),
      result:{...object(data.result),test_original_available_at:data.available_at,test_mode_version:version}})
      .match(scope).eq('id',data.id).eq('status','pending').eq('available_at',data.available_at).select('id')
    if(writeError)throw Error('TEST_EVENT_UPDATE_FAILED')
    if(updated?.length)contacts.add(`${event.kommoId}:${event.contactId}`)
  }
  return [...contacts]
}

/** Runs under the same global worker lease as the scheduled worker. */
export async function claimTestMessages(token: string, contact: string): Promise<Row[]> {
  const mode=await testResponseMode()
  if(!mode || !contact.startsWith(`${mode.kommoId}:`))return []
  const {data,error}=await db().from('lv_integration_events').select('*').match(scope).eq('contact_key',contact)
    .eq('kind','inbound').in('status',['pending','processing','uncertain']).order('received_at').order('id')
  if(error)throw Error('TEST_CLAIM_READ_FAILED')
  const rows=data||[]
  if(rows.some(r=>r.status!=='pending'||Date.parse(r.available_at)>Date.now()))return []
  const limit=rows.some(r=>object(r.payload).media)?2:10
  const ids=rows.slice(0,limit).map(r=>r.id)
  if(!ids.length)return []
  const {data:claimed,error:claimError}=await db().from('lv_integration_events')
    .update({status:'processing',claimed_at:new Date().toISOString(),claim_token:token})
    .match(scope).eq('contact_key',contact).eq('status','pending').in('id',ids).select('*')
  if(claimError)throw Error('TEST_CLAIM_FAILED')
  return (claimed||[]).sort((a,b)=>a.received_at.localeCompare(b.received_at)||a.id.localeCompare(b.id))
}

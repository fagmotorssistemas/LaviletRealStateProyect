import 'server-only'
import { db, scope, type Row } from './data'
import { isTestPhone, type TestContact } from '@/lib/inmobiliaria/testResponseMode'
import type { Inbound } from './webhook'

export async function testContacts(): Promise<TestContact[]> {
  const { data, error } = await db().from('lv_test_contacts_state').select('*').match(scope)
    .order('created_at').abortSignal(AbortSignal.timeout(10_000))
  if (error) throw Error('TEST_CONTACTS_READ_FAILED')
  return (data || []).map(row => ({ id: row.id, phone: row.phone, label: row.label,
    fastResponse: row.fast_response === true, version: row.version, leadId: row.lead_id,
    kommoId: row.kommo_id ? Number(row.kommo_id) : null, botEnabled: row.bot_enabled === true,
    matches: Number(row.matches), blocked: (row.opt_out_blocked ?? row.blocked) === true, lastResetAt: row.last_reset_at }))
}

/** Separate authorization for unpublished policy previews. */
export async function testResponseMode() {
  return (await testContacts()).find(c => isTestPhone(c.phone) && c.fastResponse && c.matches === 1 && c.kommoId) || null
}

/** Current enrollment is checked atomically. Duplicate webhooks never replay work. */
export async function accelerateTestMessages(events: Inbound[]) {
  const { data, error } = await db().rpc('lv_accelerate_test_messages', {
    p_event_keys: events.map(event => 'inbound:' + event.externalId),
  }).abortSignal(AbortSignal.timeout(10_000))
  if (error) throw Error('TEST_EVENT_UPDATE_FAILED')
  return (data || []) as string[]
}

/** Runs under the same global worker lease as the scheduled worker. */
export async function claimTestMessages(token: string, contact: string): Promise<Row[]> {
  const mode = (await testContacts()).find(c => c.fastResponse && c.matches === 1 && c.kommoId && contact.startsWith(c.kommoId + ':'))
  if (!mode) return []
  const {data,error}=await db().from('lv_integration_events').select('*').match(scope).eq('contact_key',contact)
    .in('kind',['advisor_outbound','inbound']).in('status',['pending','processing','uncertain']).order('received_at').order('id')
  if(error)throw Error('TEST_CLAIM_READ_FAILED')
  const rows=data||[]
  if(rows.some(r=>r.status!=='pending'||Date.parse(r.available_at)>Date.now()))return []
  const advisorOutbound=rows.find(r=>r.kind==='advisor_outbound')
  const limit=rows.some(r=>r.payload?.media)?2:10
  const ids=advisorOutbound?[advisorOutbound.id]:rows.filter(r=>!r.kind||r.kind==='inbound').slice(0,limit).map(r=>r.id)
  if(!ids.length)return []
  const {data:claimed,error:claimError}=await db().from('lv_integration_events')
    .update({status:'processing',claimed_at:new Date().toISOString(),claim_token:token})
    .match(scope).eq('contact_key',contact).eq('status','pending').in('id',ids).lte('available_at',new Date().toISOString()).select('*')
  if(claimError)throw Error('TEST_CLAIM_FAILED')
  return (claimed||[]).sort((a,b)=>a.received_at.localeCompare(b.received_at)||a.id.localeCompare(b.id))
}

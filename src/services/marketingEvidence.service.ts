import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttentionMessage } from './marketingAttention.logic'

export type EvidenceRow={id:string;lead_id:string;external_message_id:string;direction:string;author_type:string;content:string|null;media_type:string|null;sent_at:string;observed_at:string;delivery_status:string;source:string;chat_id:string|null;talk_id:string|null}
export async function readMessageEvidence(admin:SupabaseClient,tenantId:string,leadIds:string[],asOf:string,identities:Array<{id:string;contact_id?:string|null;kommo_id?:number|null}>=[]) {
  const rows:EvidenceRow[]=[]
  for(let i=0;i<leadIds.length;i+=200) for(let offset=0;;offset+=1000){
    const {data,error}=await admin.from('kommo_message_evidence').select('id,lead_id,external_message_id,direction,author_type,content,media_type,sent_at,observed_at,delivery_status,source,chat_id,talk_id')
      .eq('tenant_id',tenantId).in('lead_id',leadIds.slice(i,i+200)).lte('sent_at',asOf).order('observed_at').order('id').range(offset,offset+999)
    if(error) return {rows,available:false}
    rows.push(...data as EvidenceRow[])
    if(data.length<1000) break
  }
  // A webhook can precede creation of its CRM lead. Resolve unlinked journal
  // observations only by BOTH original Kommo IDs with one owner in the business.
  // This is read-only; it never reassigns messages or matches phone numbers.
  const contacts=[...new Set(identities.map(l=>l.contact_id).filter((id):id is string=>Boolean(id)))]
  for(let i=0;i<contacts.length;i+=200){
    const owners:Array<{id:string;contact_id:string;kommo_id:number}>=[]
    for(let offset=0;;offset+=1000){
      const {data,error}=await admin.from('leads').select('id,contact_id,kommo_id').eq('tenant_id',tenantId).in('contact_id',contacts.slice(i,i+200)).order('id').range(offset,offset+999)
      if(error)return {rows,available:false}
      owners.push(...data);if(data.length<1000)break
    }
    for(let offset=0;;offset+=1000){
      const {data,error}=await admin.from('kommo_message_evidence').select('id,lead_id,contact_id,kommo_lead_id,external_message_id,direction,author_type,content,media_type,sent_at,observed_at,delivery_status,source,chat_id,talk_id')
        .eq('tenant_id',tenantId).is('lead_id',null).in('contact_id',contacts.slice(i,i+200)).lte('sent_at',asOf).order('observed_at').order('id').range(offset,offset+999)
      if(error)return {rows,available:false}
      for(const row of data){
        const matching=owners.filter(l=>l.contact_id===row.contact_id && l.kommo_id===row.kommo_lead_id && row.kommo_lead_id>0)
        if(matching.length===1 && leadIds.includes(matching[0].id))rows.push({...row,lead_id:matching[0].id} as EvidenceRow)
      }
      if(data.length<1000)break
    }
  }
  // Keep observations in storage; use the latest authoritative state per message.
  const unique=new Map<string,EvidenceRow>()
  for(const r of rows.sort((a,b)=>a.observed_at.localeCompare(b.observed_at)||a.id.localeCompare(b.id))) unique.set(`${r.lead_id}:${r.direction}:${r.external_message_id}`,r)
  return {rows:[...unique.values()],available:true}
}
export function evidenceMessage(row:EvidenceRow,conversationId:string):AttentionMessage & {content:string|null} {
  return {id:`evidence:${row.external_message_id}`,conversation_id:conversationId,role:row.direction==='incoming'?'cliente':row.author_type==='bot'?'bot':row.author_type==='internal'?'asesor':'desconocido',content:row.content,media_type:row.media_type,sent_at:row.sent_at,external_message_id:row.external_message_id,provider_status:null,delivery_status:row.delivery_status,verified_source:row.delivery_status==='unknown'?null:row.source==='webhook'?'kommo_webhook':'kommo_history'}
}

export async function internalContactIds(admin:SupabaseClient,tenantId:string) {
  const latest=new Map<string,string>()
  for(let offset=0;;offset+=1000){
    const {data,error}=await admin.from('crm_contact_classifications').select('lead_id,classification').eq('tenant_id',tenantId).order('recorded_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999)
    if(error) {
      if(['42P01','PGRST205'].includes(error.code)) return {ids:new Set<string>(),available:false}
      throw Error('No se pudo comprobar la clasificación de contactos internos.')
    }
    for(const row of data) if(!latest.has(row.lead_id)) latest.set(row.lead_id,row.classification)
    if(data.length<1000) break
  }
  return {ids:new Set([...latest].filter(([,v])=>v==='internal').map(([id])=>id)),available:true}
}

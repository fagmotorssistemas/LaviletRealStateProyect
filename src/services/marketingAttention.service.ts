import 'server-only'
import { readMessageEvidence, evidenceMessage } from './marketingEvidence.service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateAttention, type AttentionData, type AttentionLead, type AttentionConversation, type AttentionMessage, type AttentionAppointment, type AttentionTask } from './marketingAttention.logic'
import type { SavedAdOrigin } from '@/lib/meta/firstAdAcquisition'
import { advertisingConversation } from './advertisingConversation.logic'

type Query=PromiseLike<{data:unknown[]|null;error:{message:string}|null}>
async function read<T>(ids:string[],page:(chunk:string[],from:number,to:number)=>Query):Promise<{rows:T[];ok:boolean}> {
  const rows:T[]=[]
  try {
    for(let i=0;i<ids.length;i+=200) for(let offset=0;;offset+=1000) {
      const {data,error}=await page(ids.slice(i,i+200),offset,offset+999)
      if(error) throw error
      rows.push(...(data || []) as T[])
      if(!data || data.length<1000) break
    }
    return {rows,ok:true}
  } catch {return {rows,ok:false}}
}

/** Read-only current progress for the original acquisition cohort. No message bodies leave this service. */
export async function loadMarketingAttention(admin:SupabaseClient,input:{tenantId:string;leadIds:string[];origins:Map<string,SavedAdOrigin>;asOf:string}):Promise<AttentionData> {
  const {tenantId,leadIds,asOf}=input
  const leads=await read<AttentionLead & {project_id:string}>(leadIds,(ids,from,to)=>admin.from('leads')
    .select('id,name,project_id,contact_id,kommo_id,created_at,temperature,temperature_updated_at,status,stage,stage_reason,bot_enabled,handoff_status,handoff_requested_at,seller_response_due_at,seller_first_response_at')
    .eq('tenant_id',tenantId).in('id',ids).order('id').range(from,to))
  if(!leads.ok) throw new Error('No se pudo consultar el avance de los contactos.')
  const authorizedIds=leads.rows.map(l=>l.id)
  const conversations=await read<AttentionConversation>(authorizedIds,(ids,from,to)=>admin.from('conversations').select('id,lead_id,started_at,last_message_at,status')
    .eq('tenant_id',tenantId).in('lead_id',ids).lte('started_at',asOf).order('id').range(from,to))
  const [messages,recovery,nutrition,events,appointments,sales,configs,reasons,outbox]=await Promise.all([
    read<AttentionMessage & {content:string|null}>(conversations.rows.map(c=>c.id),(ids,from,to)=>admin.from('messages')
      .select('id,conversation_id,role,content,media_type,sent_at,external_message_id,provider_status:tool_calls->>provider_status,delivery_status:tool_calls->>delivery_status')
      .in('conversation_id',ids).lte('sent_at',asOf).order('sent_at').order('id').range(from,to)),
    read<{lead_id:string;next_action_at:string|null;is_active:boolean;stop:boolean}>(authorizedIds,(ids,from,to)=>admin.from('lead_recovery').select('lead_id,next_action_at,is_active,stop').in('lead_id',ids).order('id').range(from,to)),
    read<{lead_id:string;next_send_at:string|null;paused_at:string|null;completed_at:string|null}>(authorizedIds,(ids,from,to)=>admin.from('lead_nutrition').select('lead_id,next_send_at,paused_at,completed_at').in('lead_id',ids).order('lead_id').range(from,to)),
    read<{lead_id:string;task:string;available_at:string|null;status:string}>(authorizedIds,(ids,from,to)=>admin.from('lv_integration_events').select('lead_id:payload->>leadId,task:payload->>task,available_at,status').eq('tenant_id',tenantId).eq('kind','maintenance').in('payload->>leadId',ids).in('status',['pending','processing']).lte('received_at',asOf).order('id').range(from,to)),
    read<AttentionAppointment>(authorizedIds,(ids,from,to)=>admin.from('appointments').select('lead_id,status,confirmed_at,no_show,start_time').eq('tenant_id',tenantId).in('lead_id',ids).lte('created_at',asOf).order('id').range(from,to)),
    read<{lead_id:string}>(authorizedIds,(ids,from,to)=>admin.from('unit_sales_closings').select('lead_id').eq('tenant_id',tenantId).in('lead_id',ids).lte('sale_at',asOf).order('id').range(from,to)),
    read<{project_id:string;sla_response_minutes:number|null;timezone:string|null}>([...new Set(leads.rows.map(l=>l.project_id))].filter(Boolean),(ids,from,to)=>admin.from('project_automation_config').select('project_id,sla_response_minutes,timezone').eq('tenant_id',tenantId).in('project_id',ids).order('project_id').range(from,to)),
    read<{lead_id:string;reason:string|null;to_stage:string}>(authorizedIds,(ids,from,to)=>admin.from('lead_stage_history').select('lead_id,reason,to_stage').in('lead_id',ids).in('to_stage',['perdido','descartado','no_interesado']).lte('created_at',asOf).order('id').range(from,to)),
    read<{lead_id:string;kind:string;scheduled_at:string|null}>(authorizedIds,(ids,from,to)=>admin.from('lv_outbox').select('lead_id,kind,scheduled_at').eq('tenant_id',tenantId).in('lead_id',ids).in('status',['pending','claimed']).lte('created_at',asOf).order('id').range(from,to)),
  ])
  const tasks:AttentionTask[]=[
    ...recovery.rows.map(r=>({leadId:r.lead_id,dueAt:r.next_action_at,pending:r.is_active && !r.stop})),
    ...nutrition.rows.map(r=>({leadId:r.lead_id,dueAt:r.next_send_at,pending:!r.paused_at && !r.completed_at})),
    ...events.rows.filter(r=>r.task?.startsWith('nutrition_')).map(r=>({leadId:r.lead_id,dueAt:r.available_at,pending:true})),
    ...outbox.rows.filter(r=>/^(nutrition|recovery|followup)(_|$)/.test(r.kind)).map(r=>({leadId:r.lead_id,dueAt:r.scheduled_at,pending:true})),
  ]
  const evidence=await readMessageEvidence(admin,tenantId,authorizedIds,asOf,leads.rows)
  const purchased=new Set(sales.rows.map(s=>s.lead_id))
  const coverage={messages:conversations.ok && messages.ok,tasks:recovery.ok && nutrition.ok && events.ok && outbox.ok,appointments:appointments.ok,sales:sales.ok,kommo:false}
  const people=leads.rows.map(lead=>{
    const origin=input.origins.get(lead.id)
    const ownEvidence=evidence.rows.filter(r=>r.lead_id===lead.id)
    const known=new Set(ownEvidence.map(r=>r.external_message_id))
    const ownConversations=conversations.rows.filter(c=>c.lead_id===lead.id)
    const ownIds=new Set(ownConversations.map(c=>c.id))
    const journalConversations=[...new Map(ownEvidence.map(r=>[r.chat_id || r.talk_id || r.id,{id:'journal:'+(r.chat_id || r.talk_id || r.id),lead_id:lead.id,started_at:null,last_message_at:null,status:'activa'}])).values()]
    const combined=messages.rows.filter(m=>ownIds.has(m.conversation_id) && (!m.external_message_id || !known.has(m.external_message_id)))
    combined.push(...ownEvidence.map(r=>evidenceMessage(r,'journal:'+(r.chat_id || r.talk_id || r.id))))
    const scopedEvidence=advertisingConversation(ownEvidence,origin?.externalMessageId)
    const scopedMessages=scopedEvidence.map(r=>evidenceMessage(r,'advertising-conversation'))
    const person=evaluateAttention({lead:{...lead,stage_reason:['perdido','descartado','no_interesado'].includes(lead.stage || '')?lead.stage_reason:null},adId:origin?.adId || null,conversations:origin?(scopedMessages.length?[{id:'advertising-conversation',lead_id:lead.id,started_at:scopedMessages[0].sent_at,last_message_at:null,status:'activa'}]:[]):[...ownConversations,...journalConversations],messages:origin?scopedMessages:combined,tasks,appointments:appointments.rows,purchased:purchased.has(lead.id),asOf,coverage})
    if(origin && !scopedMessages.length)person.reasons.push('Falta vincular el mensaje del anuncio con su conversación original. No se usan respuestas de otras conversaciones de esta ficha.')
    person.sourceUrl=origin?.sourceUrl || null
    person.sourceCapturedAt=origin?.recordedAt || null
    if(person.flags.discarded) person.reasons=[...new Set([...person.reasons,...reasons.rows.filter(r=>r.lead_id===lead.id && r.reason).map(r=>r.reason!)])]
    return person
  })
  const latest=(direction:string)=>evidence.rows.filter(r=>r.direction===direction).map(r=>r.observed_at).sort().at(-1) || null
  const lastInboundSyncAt=latest('incoming')
  const lastOutboundSyncAt=latest('outgoing')
  const syncDelays=(['incoming','outgoing'] as const).map(direction=>{
    const samples=evidence.rows.filter(r=>r.direction===direction && r.source==='webhook').map(r=>(Date.parse(r.observed_at)-Date.parse(r.sent_at))/1000).filter(n=>Number.isFinite(n) && n>=0).sort((a,b)=>a-b)
    return {direction,sample:samples.length,medianSeconds:samples.length?samples[Math.floor(samples.length/2)]:null}
  })
  return {asOf,syncDelays,lastMessageSyncAt:[lastInboundSyncAt,lastOutboundSyncAt].filter(Boolean).sort().at(-1) || null,lastInboundSyncAt,lastOutboundSyncAt,people,deadlines:configs.rows.map(c=>({project:c.project_id,minutes:c.sla_response_minutes,timezone:c.timezone})),limitations:[
    ...(!evidence.available?['El registro independiente de sincronización todavía no está disponible. Un evento de automatización completado no demuestra sincronización completa.']:[]),
    'Una respuesta exige evidencia de envío. Texto generado, lanzamiento de bot aceptado o multimedia sin evidencia de envío no bastan; no se exige lectura.',
    'Sin acceso al historial original de Kommo en este entorno: la conciliación con Kommo queda pendiente. Sin esa verificación, la ausencia de respuesta local no se atribuye al asesor.',
    'Sin inicio de conversación verificable o con salidas sin evidencia suficiente, no se afirma que nunca hubo respuesta ni se calcula un primer tiempo.',
    ...(!Object.values(coverage).every(Boolean)?['Algunas fuentes no se pudieron consultar; sus cifras se muestran con la cobertura disponible.']:[]),
    ...(!configs.ok?['No se pudieron consultar los plazos de atención.']:[]),
  ]}
}

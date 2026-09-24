import { computeSlaStatus } from '@/lib/inmobiliaria/slaStatus'

export type AttentionLead = {id:string;name?:string|null;contact_id?:string|null;kommo_id?:number|null;created_at:string;temperature:string|null;temperature_updated_at?:string|null;status:string|null;stage:string|null;stage_reason:string|null;bot_enabled:boolean|null;handoff_status:string|null;handoff_requested_at:string|null;seller_response_due_at:string|null;seller_first_response_at:string|null}
export type AttentionConversation = {id:string;lead_id:string;started_at:string|null;last_message_at:string|null;status:string|null}
export type AttentionMessage = {id:string;conversation_id:string;role:string;content?:string|null;media_type?:string|null;sent_at:string|null;external_message_id:string|null;provider_status:string|null;delivery_status?:string|null;verified_source?:string|null}
export type AttentionResponse = {id:string;at:string|null;author:'bot'|'asesor'|'desconocido';type:'texto'|'audio'|'imagen'|'documento'|'otro';delivery:'confirmada'|'no confirmada'|'desconocida'}
export type AttentionTask = {leadId:string;dueAt:string|null;pending:boolean}
export type AttentionAppointment = {lead_id:string;status:string|null;confirmed_at:string|null;no_show:boolean|null;start_time:string|null}
export const attentionLabels = {
  cold:'Frío (interés bajo)',warm:'Tibio (interés medio)',hot:'Caliente (interés alto)',unclassified:'Sin evaluar',
  responseRecorded:'Personas con alguna respuesta enviada',responseAuthorUnknown:'Respuesta registrada, autor no identificado',
  noResponse:'Sin respuesta registrada en el CRM; pendiente de contrastar con Kommo',botOnly:'Personas con respuesta enviada del bot',advisor:'Respuesta registrada de un asesor',
  teamPending:'Respuesta del equipo pendiente',teamOverdue:'Plazo de atención vencido',clientPending:'Esperando respuesta del cliente',
  followupPending:'Seguimientos pendientes',followupOverdue:'Seguimientos vencidos',
  appointmentRequested:'Citas solicitadas',appointmentConfirmed:'Citas confirmadas',appointmentDone:'Citas realizadas',
  purchased:'Contactos con compra',discarded:'Contactos descartados',anyPending:'Personas con algún pendiente',
} as const
export type AttentionKey = keyof typeof attentionLabels
export type AttentionPerson = {leadId:string;name?:string|null;historyComplete?:boolean;contactId:string|null;kommoId:number|null;kommoUrl:string|null;adId:string|null;sourceUrl:string|null;sourceCapturedAt:string|null;flags:Record<AttentionKey,boolean|null>;responses:AttentionResponse[];firstInboundAt:string|null;firstResponseAt:string|null;botSeconds:number|null;advisorSeconds:number|null;reasons:string[];dueAt:string|null}
export type AttentionData = {asOf:string;syncDelays?:Array<{direction:string;sample:number;medianSeconds:number|null}>;lastMessageSyncAt:string|null;lastInboundSyncAt:string|null;lastOutboundSyncAt:string|null;people:AttentionPerson[];deadlines:Array<{project:string;minutes:number|null;timezone:string|null}>;limitations:string[]}

const time=(v:string|null|undefined)=>v?Date.parse(v):NaN
function delivery(m:AttentionMessage):'sent'|'unsent'|'unknown' {
  const status=m.delivery_status || m.provider_status
  if (['failed','rejected','not_sent','queued','pending','generation_failed','error','draft','generated'].includes(status || '')) return 'unsent'
  if (['sent','delivered','read'].includes(status || '')) return 'sent'
  // The existing manual-outbound RPC stores the original Kommo message ID.
  // An explicit failed/queued status above still overrides that identifier.
  if (m.role==='asesor' && m.external_message_id) return 'sent'
  if (m.external_message_id && ['kommo_webhook','kommo_history','advisor_verified'].includes(m.verified_source || '')) return 'sent'
  // The existing Kommo flow records "accepted" after launching Salesbot and
  // explicitly marks delivery_confirmed=false. It is not proof of a sent reply.
  return 'unknown'
}

function hasMessageEvidence(m: AttentionMessage & {content?: string|null}) {
  return Number.isFinite(time(m.sent_at)) && Boolean(
    m.content?.trim() ||
      m.external_message_id ||
      m.media_type ||
      (m.role !== 'cliente' && delivery(m) === 'sent'),
  )
}

function responseType(message: AttentionMessage): AttentionResponse['type'] {
  const type = String(message.media_type || '').toLowerCase()
  if (type.includes('audio') || type.includes('voice')) return 'audio'
  if (type.includes('image') || type.includes('photo') || type==='picture') return 'imagen'
  if (type.includes('document') || type.includes('file')) return 'documento'
  if (message.content?.trim()) return 'texto'
  return 'otro'
}

function responseDelivery(message: AttentionMessage): AttentionResponse['delivery'] {
  const value = delivery(message)
  return value === 'sent' ? 'confirmada' : value === 'unsent' ? 'no confirmada' : 'desconocida'
}

/** No guessed timeouts, inferred loss reasons, or LLM conclusions. */
export function evaluateAttention(input:{lead:AttentionLead;adId:string|null;conversations:AttentionConversation[];messages:(AttentionMessage & {content?: string|null})[];tasks:AttentionTask[];appointments:AttentionAppointment[];purchased:boolean;asOf:string;coverage:{messages:boolean;tasks:boolean;appointments:boolean;sales:boolean;kommo?:boolean}}):AttentionPerson {
  const {lead,coverage}=input, now=time(input.asOf)
  const conversations=input.conversations.filter(c=>c.lead_id===lead.id)
  const conversationIds=new Set(conversations.map(c=>c.id))
  const messages=[...new Map(input.messages.filter(m=>conversationIds.has(m.conversation_id) && time(m.sent_at)<=now).map(m=>[m.id,m])).values()].sort((a,b)=>time(a.sent_at)-time(b.sent_at)||a.id.localeCompare(b.id))
  const inbound=messages.filter(m=>m.role==='cliente' && hasMessageEvidence(m))
  const outbound=messages.filter(m=>m.role!=='cliente' && hasMessageEvidence(m) && delivery(m)==='sent')
  const firstInboundAt=inbound[0]?.sent_at || null
  const firstResponseCandidates=firstInboundAt ? outbound.filter(m=>m.conversation_id===inbound[0].conversation_id && time(m.sent_at)>=time(firstInboundAt)) : []
  const firstResponseAt=firstResponseCandidates.sort((a,b)=>time(a.sent_at)-time(b.sent_at))[0]?.sent_at || null
  const bots=firstResponseCandidates.filter(m=>m.role==='bot'), advisors=firstResponseCandidates.filter(m=>m.role==='asesor')
  const unknownAuthors=firstResponseCandidates.filter(m=>!['bot','asesor'].includes(m.role))
  const outboundWithUnknownEvidence=messages.some(m=>m.role!=='cliente' && delivery(m)==='unknown')
  const advisorAt=advisors[0]?.sent_at || null
  // Prove the start and end of each recorded conversation; unknown delivery invalidates negative claims.
  const complete=coverage.kommo===true && coverage.messages && conversations.length>0 && conversations.every(c=>{
    const own=messages.filter(m=>m.conversation_id===c.id)
    return own.length>0 && own[0].role==='cliente' && hasMessageEvidence(own[0])
  }) && !outboundWithUnknownEvidence
  const responseRecorded=Boolean(firstResponseAt)
  const answered=responseRecorded
  const kommoVerified=input.coverage.kommo !== false
  const handoff=['queued','assigned','escalated'].includes(lead.handoff_status || '')
    && !(advisorAt && time(advisorAt)>=time(lead.handoff_requested_at))
  const active=conversations.filter(c=>!['cerrada','closed','finalizada'].includes(c.status || ''))
  let team=complete && handoff, waitingClient=false
  for(const c of active){
    const own=messages.filter(m=>m.conversation_id===c.id && (m.role==='cliente' || delivery(m)==='sent'))
    const latest=own.at(-1)
    if (complete && outbound.length>0 && latest?.role==='cliente' && (lead.bot_enabled===false || own.filter(m=>m.role!=='cliente').at(-1)?.role==='asesor')) team=true
    if (complete && latest && latest.role!=='cliente' && delivery(latest)==='sent') waitingClient=true
  }
  const tasks=input.tasks.filter(t=>t.leadId===lead.id && t.pending)
  const appointments=input.appointments.filter(a=>a.lead_id===lead.id)
  const statusKnown=Boolean(lead.status || lead.stage)
  const discarded=['no_interesado','descartado','perdido'].includes(lead.status || '') || ['perdido','descartado'].includes(lead.stage || '')
  const flags:Record<AttentionKey,boolean|null>={
    cold:!!lead.temperature_updated_at && lead.temperature==='frio',warm:!!lead.temperature_updated_at && lead.temperature==='tibio',hot:!!lead.temperature_updated_at && lead.temperature==='caliente',unclassified:!lead.temperature_updated_at || !['frio','tibio','caliente'].includes(lead.temperature || ''),
    noResponse:answered?false:complete && kommoVerified?true:null,
    responseRecorded:responseRecorded?true:complete?false:null,
    responseAuthorUnknown:unknownAuthors.length>0?true:complete?false:null,
    botOnly:bots.length>0?true:complete?false:null,
    advisor:advisorAt?true:complete?false:null,
    teamPending:team?true:complete?false:null,
    teamOverdue:team && lead.seller_response_due_at ? computeSlaStatus(lead.seller_response_due_at,advisorAt,input.asOf?now:undefined)==='vencido' : team?null:complete?false:null,
    clientPending:complete?waitingClient:null,
    followupPending:tasks.length>0?true:coverage.tasks?false:null,
    followupOverdue:tasks.some(t=>time(t.dueAt)<now)?true:!coverage.tasks || tasks.some(t=>!Number.isFinite(time(t.dueAt)))?null:false,
    appointmentRequested:coverage.appointments?appointments.some(a=>['solicitada','pendiente'].includes(a.status || '')):null,
    appointmentConfirmed:coverage.appointments?appointments.some(a=>Boolean(a.confirmed_at)):null,
    appointmentDone:coverage.appointments?appointments.some(a=>a.status==='atendido' && !a.no_show && time(a.start_time)<=now):null,
    purchased:input.purchased || lead.status==='vendido'?true:coverage.sales && statusKnown?false:null,
    discarded:statusKnown?discarded:null,
    anyPending:null,
  }
  const pending=[flags.teamPending,flags.followupPending,flags.noResponse]
  flags.anyPending=pending.some(v=>v===true)?true:pending.every(v=>v===false)?false:null
  const latency=(at:string|null)=>complete && firstInboundAt && at && time(at)>=time(firstInboundAt)?(time(at)-time(firstInboundAt))/1000:null
  const responses: AttentionResponse[]=firstResponseCandidates.map(message=>({id:message.id,at:message.sent_at,author:message.role==='bot'?'bot':message.role==='asesor'?'asesor':'desconocido',type:responseType(message),delivery:responseDelivery(message)}))
  return {leadId:lead.id,name:lead.name || null,historyComplete:complete,contactId:lead.contact_id ?? null,kommoId:lead.kommo_id ?? null,kommoUrl:lead.kommo_id ? `https://lavilet.kommo.com/leads/detail/${lead.kommo_id}` : null,adId:input.adId,sourceUrl:null,sourceCapturedAt:null,flags,responses,firstInboundAt,firstResponseAt,botSeconds:latency(bots[0]?.sent_at || null),advisorSeconds:latency(advisorAt),reasons:discarded && lead.stage_reason?[lead.stage_reason]:[],dueAt:lead.seller_response_due_at}
}

export function summarizeAttention(people:AttentionPerson[]) {
  const unique=[...new Map(people.map(p=>[p.leadId,p])).values()]
  const metrics=Object.fromEntries((Object.keys(attentionLabels) as AttentionKey[]).map(key=>{
    const ids=unique.filter(p=>p.flags[key]===true).map(p=>p.leadId)
    const evaluated=unique.filter(p=>p.flags[key]!==null).length
    return [key,{ids,evaluated,unknown:unique.length-evaluated,percent:evaluated?Math.round(ids.length/evaluated*1000)/10:null}]
  })) as Record<AttentionKey,{ids:string[];evaluated:number;unknown:number;percent:number|null}>
  const duration=(key:'botSeconds'|'advisorSeconds')=>{
    const measured=unique.filter(p=>p[key]!=null)
    return {ids:measured.map(p=>p.leadId),seconds:measured.length?measured.reduce((sum,p)=>sum+p[key]!,0)/measured.length:null}
  }
  return {total:unique.length,ids:unique.map(p=>p.leadId),metrics,bot:duration('botSeconds'),advisor:duration('advisorSeconds')}
}

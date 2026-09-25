import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { selectWeeklyContactsForObjective, type WeeklyObjectiveContact, type WeeklyObjectiveScoringRule } from '@/lib/meta/weeklyObjectiveQualification'
import { WEEKLY_OBJECTIVE_DEFINITIONS, WEEKLY_OBJECTIVE_TARGET } from '@/lib/meta/weeklyObjectiveDefinitions'

export type WeeklyObjectivePanelRow={objectiveId:string;label:string;own:number;incorporated:number;eligible:number;selected:number;pending:number;sent:number;metaAccepted:number;missing:number;configurationPending:string[]}
export type WeeklyObjectivePanel={enabled:boolean;windowStart:string;windowEnd:string;target:number;rows:WeeklyObjectivePanelRow[];note:string}

export async function buildWeeklyObjectiveQualification(admin:SupabaseClient,tenantIds:string[],persist=false,now=new Date()):Promise<WeeklyObjectivePanel>{
  const end=now.toISOString(),start=new Date(now.getTime()-7*86400000).toISOString()
  const {data:ruleRows,error:ruleError}=await admin.from('lead_scoring_rules').select('event_type,points,active,repeatable').eq('active',true)
  if(ruleError)throw ruleError
  const rules:WeeklyObjectiveScoringRule[]=(ruleRows||[]).map(r=>({eventType:String(r.event_type),points:Number(r.points),active:r.active===true,repeatable:r.repeatable===true}))
  const {data:leadRows,error:leadError}=await admin.from('leads').select('id,tenant_id,project_id,temperature,temperature_updated_at').in('tenant_id',tenantIds).in('temperature',['tibio','caliente'])
  if(leadError)throw leadError
  const classifications=await admin.from('crm_contact_classifications').select('lead_id,classification,recorded_at,id').in('tenant_id',tenantIds).order('recorded_at',{ascending:false}).order('id',{ascending:false})
  if(classifications.error)throw classifications.error
  const latestClassification=new Map<string,string>();for(const row of classifications.data||[])if(!latestClassification.has(String(row.lead_id)))latestClassification.set(String(row.lead_id),String(row.classification))
  const internal=new Set([...latestClassification].filter(([,value])=>value==='internal').map(([leadId])=>leadId))
  const auto=await admin.from('lv_auto_config').select('test_lead_id').in('tenant_id',tenantIds);const tests=new Set((auto.data||[]).map(row=>String(row.test_lead_id||'')).filter(Boolean))
  if(auto.error)throw auto.error
  const eligibleLeads=(leadRows||[]).filter(row=>!internal.has(String(row.id))&&!tests.has(String(row.id)))
  const leadIds=eligibleLeads.map(r=>String(r.id))
  let eventRows:Array<{id:string;lead_id:string;event_type:string;created_at:string}>=[]
  if(leadIds.length){const res=await admin.from('lead_score_events').select('id,lead_id,event_type,created_at').in('lead_id',leadIds).gte('created_at',start).lt('created_at',end).order('created_at');if(res.error)throw res.error;eventRows=(res.data||[]).map(r=>({id:String(r.id),lead_id:String(r.lead_id),event_type:String(r.event_type),created_at:String(r.created_at)}))}
  const objectiveByEvent=new Map<string,string>();for(const d of WEEKLY_OBJECTIVE_DEFINITIONS)for(const e of d.eventTypes)objectiveByEvent.set(e,d.objectiveId)
  const eventsByLead=new Map<string,typeof eventRows>();for(const e of eventRows)eventsByLead.set(e.lead_id,[...(eventsByLead.get(e.lead_id)||[]),e])
  const contacts:WeeklyObjectiveContact[]=eligibleLeads.map(l=>{const evidence=eventsByLead.get(String(l.id))||[];const labels=[...new Set(evidence.map(e=>objectiveByEvent.get(e.event_type)).filter((v):v is string=>Boolean(v)))];return{contactId:String(l.id),primaryGroupId:labels[0]||'unassigned',labels,temperature:l.temperature as 'tibio'|'caliente',qualifiedAt:l.temperature_updated_at?String(l.temperature_updated_at):null,evidence:evidence.map(e=>({evidenceId:e.id,eventType:e.event_type,occurredAt:e.created_at}))}})
  const activation=await admin.from('crm_weekly_objective_selection_activation').select('enabled').eq('singleton',true).maybeSingle()
  if(activation.error)throw activation.error
  const enabled=!activation.error&&activation.data?.enabled===true
  const intents=leadIds.length?await admin.from('meta_crm_qualification_intents').select('lead_id,event_id,status').in('lead_id',leadIds):{data:[],error:null}
  if(intents.error)throw intents.error
  const eventIds=(intents.data||[]).map(r=>String(r.event_id));const accepted=new Set<string>()
  const sent=new Set<string>()
  if(eventIds.length){const outbox=await admin.from('meta_capi_outbox').select('event_id,status,forwarded_at').in('event_id',eventIds);if(outbox.error)throw outbox.error;for(const r of outbox.data||[])if(r.forwarded_at||r.status==='forwarded')sent.add(String(r.event_id))}
  if(eventIds.length){const log=await admin.from('meta_capi_conversion_log').select('event_id,stage').in('event_id',eventIds).eq('stage','meta_accepted');if(log.error)throw log.error;for(const r of log.data||[])accepted.add(String(r.event_id))}
  const intentByLead=new Map((intents.data||[]).map(r=>[String(r.lead_id),r]))
  const rows:WeeklyObjectivePanelRow[]=[]
  for(const definition of WEEKLY_OBJECTIVE_DEFINITIONS){const selection=selectWeeklyContactsForObjective(contacts,rules,{objectiveId:definition.objectiveId,ownGroupId:definition.objectiveId,eligibleEventTypes:[...definition.eventTypes],weeklyTarget:WEEKLY_OBJECTIVE_TARGET,windowStart:start,windowEnd:end});const ids=[...selection.ownContactIds,...selection.incorporatedContactIds]
    if(persist&&enabled&&ids.length){const contactById=new Map(contacts.map(c=>[c.contactId,c]));const payload=ids.map(id=>{const c=contactById.get(id)!;const ev=c.evidence.find(e=>definition.eventTypes.includes(e.eventType as never))!;const lead=eligibleLeads.find(l=>String(l.id)===id)!;return{tenant_id:lead.tenant_id,project_id:lead.project_id,objective_id:definition.objectiveId,lead_id:id,relation:selection.ownContactIds.includes(id)?'own':'incorporated',evidence_event_id:ev.evidenceId,evidence_event_type:ev.eventType,evidence_occurred_at:ev.occurredAt}});const saved=await admin.from('crm_weekly_objective_selections').upsert(payload,{onConflict:'objective_id,lead_id',ignoreDuplicates:true});if(saved.error)throw saved.error}
    const sentCount=ids.filter(id=>{const intent=intentByLead.get(id);return Boolean(intent&&sent.has(String(intent.event_id)))}).length;const metaAccepted=ids.filter(id=>{const intent=intentByLead.get(id);return Boolean(intent&&accepted.has(String(intent.event_id)))}).length
    rows.push({objectiveId:definition.objectiveId,label:definition.label,own:selection.own,incorporated:selection.incorporated,eligible:selection.total,selected:selection.total,pending:selection.total-metaAccepted,sent:sentCount,metaAccepted,missing:selection.missingToTarget,configurationPending:selection.configurationPending})}
  return{enabled,windowStart:start,windowEnd:end,target:WEEKLY_OBJECTIVE_TARGET,rows,note:'Selección interna ≠ envío ni aceptación Meta. Solo meta_accepted cuenta como aceptación.'}
}

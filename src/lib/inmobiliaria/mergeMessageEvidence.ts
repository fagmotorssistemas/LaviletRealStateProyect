import {mergeLeadTimeline} from './leadTimeline'
import type {LeadTimelineItem} from '@/types/inmobiliaria'
export type TimelineEvidence={id:string;external_message_id:string;direction:string;author_type:string;content:string|null;media_type:string|null;sent_at:string;delivery_status:string}
export function mergeMessageEvidence(timeline:LeadTimelineItem[],rows:TimelineEvidence[]) {
  const originalIds=new Set(rows.map(r=>r.external_message_id))
  const retained=timeline.filter(t=>t.kind!=='whatsapp' || !t.message.external_message_id || !originalIds.has(t.message.external_message_id))
  const evidence=mergeLeadTimeline([],rows.map(r=>({id:'evidence:'+r.id,external_message_id:r.external_message_id,role:r.direction==='incoming'?'cliente':r.author_type==='bot'?'bot':r.author_type==='internal'?'asesor':'desconocido',content:r.content,media_type:r.media_type,sent_at:r.sent_at,delivery_status:r.delivery_status})))
  return [...retained,...evidence].sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id))
}

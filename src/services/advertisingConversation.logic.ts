import type { EvidenceRow } from './marketingEvidence.service'

/** Anchor on the actual referral message, never the first conversation of a person.
 * IDs in different namespaces require an original, verified correspondence;
 * absent that correspondence we return no qualifying messages, not a negative claim.
 */
export function advertisingConversation(rows:EvidenceRow[],externalMessageId?:string|null) {
  const anchors=rows.filter(r=>externalMessageId && r.external_message_id===externalMessageId && r.direction==='incoming')
  if(anchors.length!==1)return []
  const anchor=anchors[0]
  if(!anchor.chat_id && !anchor.talk_id)return []
  return rows.filter(r=>r.lead_id===anchor.lead_id
    && (anchor.talk_id ? r.talk_id===anchor.talk_id : r.chat_id===anchor.chat_id)
    && (!anchor.chat_id || !r.chat_id || r.chat_id===anchor.chat_id)
    && Date.parse(r.sent_at)>=Date.parse(anchor.sent_at))
}

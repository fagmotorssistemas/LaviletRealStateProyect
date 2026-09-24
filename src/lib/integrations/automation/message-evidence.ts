/** An observation is not a command: never run automation while recording it. */
export type KommoMessageEvidence = {
  externalId:string; contactId:number; kommoId:number; chatId:string; talkId:string;
  direction:'incoming'|'outgoing'; authorType:string; authorId:string; userId:string;
  sentAt:string; origin:string; text:string; mediaType:string; mediaUrl:string;
  deliveryStatus:string; source:'webhook'|'history';
}

export function messageEvidence(flat:Record<string,string>,now=Date.now()):KommoMessageEvidence[] {
  const result=new Map<string,KommoMessageEvidence>()
  for(const root of ['message','outgoing_message']) {
    const indexes=[...new Set(Object.keys(flat).map(k=>k.match(new RegExp(`^${root}\\[add\\]\\[(\\d+)\\]`))?.[1]).filter(Boolean))]
    for(const index of indexes) {
      const get=(key:string)=>flat[`${root}[add][${index}][${key}]`] || ''
      const direction=root==='outgoing_message'?'outgoing':get('type')==='outgoing'?'outgoing':'incoming'
      const origin=get('origin').toLowerCase()
      if(origin && !['whatsapp','waba'].includes(origin)) continue
      if(get('entity_type') && !['lead','leads'].includes(get('entity_type'))) continue
      const externalId=get('id') || get('message_id'), contactId=Number(get('contact_id')), kommoId=Number(get('entity_id') || get('element_id'))
      const milliseconds=Number(get('sec_created_at')) || Number(get('created_at'))*1000
      if(!externalId || externalId.length>200 || !Number.isSafeInteger(contactId) || contactId<=0 || !Number.isSafeInteger(kommoId) || kommoId<0 || !Number.isFinite(milliseconds) || milliseconds<=0 || milliseconds>now+60000) throw Error('INVALID_MESSAGE_EVIDENCE')
      // outgoing_message is documented as a sent-message notification, not the
      // Chats transport callback. An explicit error/queued status takes priority.
      const status=get('delivery_status') || get('status') || (root==='outgoing_message'?'sent':'unknown')
      result.set(`${direction}:${externalId}`,{externalId,contactId,kommoId,chatId:get('chat_id'),talkId:get('talk_id'),direction,
        authorType:get('author][type'),authorId:get('author][id'),userId:get('author][user_id'),sentAt:new Date(milliseconds).toISOString(),origin,
        text:get('text').slice(0,20000),mediaType:get('attachment][type') || get('message_type'),mediaUrl:get('attachment][link'),deliveryStatus:status,source:'webhook'})
    }
  }
  return [...result.values()]
}

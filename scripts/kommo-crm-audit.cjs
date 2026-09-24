/* Read-only audit. Never calls workers, sends messages, or writes remotely. */
const {createHash}=require('node:crypto')
const ORIGIN='https://lavilet.kommo.com', ACCOUNT=36919007
const TENANT='a1b2c3d4-0001-4000-8000-000000000001'
function normalizedPhone(value){
  let n=String(value || '').replace(/\D/g,'')
  if(n.startsWith('00')) n=n.slice(2)
  if(/^09\d{8}$/.test(n)) n='593'+n.slice(1)
  return n.length>=8?n:null
}
async function pages(get,path,key){
  const rows=[],seenPages=new Set(),seenIds=new Set()
  for(let page=1;;page++){
    const url=new URL(path,ORIGIN);url.searchParams.set('limit','250');url.searchParams.set('page',String(page))
    const data=await get(url.pathname+url.search)
    if(data==null) break
    const batch=data._embedded?.[key]
    if(!Array.isArray(batch)) throw Error('UNEXPECTED_'+key.toUpperCase()+'_RESPONSE')
    const signature=batch.map(r=>String(r.id ?? r.talk_id)).join('|')
    if(batch.length && seenPages.has(signature)) throw Error('REPEATED_PAGE_'+key.toUpperCase())
    seenPages.add(signature)
    for(const r of batch){const id=String(r.id ?? r.talk_id);if(!seenIds.has(id)){seenIds.add(id);rows.push(r)}}
    if(!batch.length || (!data._links?.next && batch.length<250)) break
    if(data._links?.next){const next=new URL(data._links.next.href,ORIGIN);if(next.origin!==ORIGIN) throw Error('FOREIGN_PAGINATION')}
  }
  return rows
}
async function allRows(admin,table,select,configure=q=>q){
  const rows=[]
  for(let offset=0;;offset+=1000){
    const {data,error}=await configure(admin.from(table).select(select)).order('id').range(offset,offset+999)
    if(error) throw Error('CRM_READ_'+table.toUpperCase()+'_'+error.code)
    rows.push(...data);if(data.length<1000) return rows
  }
}
function compare(crm,contacts,leads,talks,histories,from,to){
  talks=talks.map(t=>({...t,talk_id:t.talk_id ?? t.id}))
  const contactsById=new Map(contacts.map(c=>[String(c.id),c])),leadsById=new Map(leads.map(l=>[String(l.id),l]))
  const scopeContacts=new Set(talks.map(t=>String(t.contact_id)))
  const scopedContacts=contacts.filter(c=>scopeContacts.has(String(c.id)))
  const kommoPhoneOwners=new Map()
  for(const c of scopedContacts) for(const f of c.custom_fields_values || []) if(f.field_code==='PHONE') for(const v of f.values || []){
    const phone=normalizedPhone(v.value)
    if(phone){const ids=kommoPhoneOwners.get(phone) || new Set();ids.add(c.id);kommoPhoneOwners.set(phone,ids)}
  }
  const phoneOwners=new Map()
  for(const l of crm.leads){const phone=normalizedPhone(l.phone_normalized);if(phone) phoneOwners.set(phone,[...(phoneOwners.get(phone)||[]),l.id])}
  const identities=crm.leads.map(l=>{
    const contact=contactsById.get(String(l.contact_id)),file=leadsById.get(String(l.kommo_id))
    const phones=(contact?.custom_fields_values || []).filter(f=>f.field_code==='PHONE').flatMap(f=>(f.values || []).map(v=>normalizedPhone(v.value))).filter(Boolean)
    const linked=contact?._embedded?.leads?.some(x=>x.id===l.kommo_id)===true && file?._embedded?.contacts?.some(x=>String(x.id)===String(l.contact_id))===true
    const phone=normalizedPhone(l.phone_normalized)
    return {crmId:l.id,contactId:l.contact_id,kommoLeadId:l.kommo_id,crmCreatedAt:l.created_at || null,kommoContactCreatedAt:contact?new Date(contact.created_at*1000).toISOString():null,contactFound:!!contact,leadFound:!!file,relationshipVerified:linked,phoneMatches:!!phone && phones.includes(phone),phoneIdentity:phone?createHash('sha256').update(TENANT+':'+phone).digest('hex'):null}
  })
  const contactOwners=new Map()
  for(const i of identities) if(i.relationshipVerified && i.phoneMatches) contactOwners.set(String(i.contactId),[...(contactOwners.get(String(i.contactId)) || []),i.crmId])
  const existing=new Map()
  for(const m of crm.messages) if(m.external_message_id) existing.set(m.external_message_id,[...(existing.get(m.external_message_id)||[]),m])
  const conversationOwners=new Map((crm.conversations || []).map(c=>[c.id,c.lead_id]))
  const suppressed=new Set(crm.events.filter(e=>e.status==='cancelled' && /reset/.test(e.result?.reason || '')).map(e=>e.payload?.externalId))
  const proposed=[],preserved=[],differences=[],activeContacts=new Set(),incomplete=[]
  for(const talk of talks){
    const history=histories.get(String(talk.talk_id))
    if(!history?.complete){incomplete.push({talkId:talk.talk_id,reason:history?.error || 'NOT_QUERIED'});continue}
    for(const m of history.messages){
      const at=new Date(Number(m.sec_created_at) || Number(m.created_at)*1000).toISOString()
      if(at>=from && at<to) activeContacts.add(String(talk.contact_id))
      const owners=contactOwners.get(String(talk.contact_id)) || []
      const saved=existing.get(m.id)
      if(saved){
        const expectedRole=m.type==='incoming'?'cliente':m.author?.type==='bot'?'bot':m.author?.type==='internal'?'asesor':null
        const issues=[]
        if(saved.length!==1) issues.push('DUPLICATE_MESSAGE_ID')
        if(saved.some(row=>Date.parse(row.sent_at)!==Date.parse(at))) issues.push('ORIGINAL_DATE_DIFFERS')
        if(expectedRole && saved.some(row=>row.role!==expectedRole)) issues.push('AUTHOR_OR_DIRECTION_DIFFERS')
        if(owners.length!==1 || saved.some(row=>conversationOwners.get(row.conversation_id)!==owners[0])) issues.push('IDENTITY_REQUIRES_REVIEW')
        if(issues.length) differences.push({talkId:talk.talk_id,messageId:m.id,direction:m.type,blocked:'REVIEW_EXISTING_HISTORY',issues})
        else preserved.push({talkId:talk.talk_id,messageId:m.id,action:'preserve'})
        continue
      }
      const sourceFile=leadsById.get(String(talk.entity_id))
      const talkLinked=(!talk.entity_id || (talk.entity_type==='lead' && sourceFile?._embedded?.contacts?.some(c=>String(c.id)===String(talk.contact_id))))
      const owner=identities.find(i=>i.crmId===owners[0])
      const blocked=suppressed.has(m.id)?'MANUAL_RESET':owners.length!==1 || !talkLinked || (talk.entity_id && owner?.kommoLeadId!==talk.entity_id)?'IDENTITY_UNVERIFIED':null
      differences.push({talkId:talk.talk_id,messageId:m.id,direction:m.type,blocked})
      if(blocked) continue
      proposed.push({externalId:m.id,contactId:talk.contact_id,kommoId:talk.entity_type==='lead'?talk.entity_id || 0:0,chatId:m.chat_id || talk.chat_id,talkId:String(talk.talk_id),direction:m.type,authorType:m.author?.type || 'unknown',authorId:m.author?.id || '',userId:String(m.author?.user_id || ''),sentAt:at,origin:m.origin || talk.origin,text:m.text || '',mediaType:m.attachment?.type || m.message_type || '',mediaUrl:m.attachment?.link || '',deliveryStatus:m.delivery_status || 'unknown',source:'history'})
    }
  }
  const newContacts=scopedContacts.filter(c=>new Date(c.created_at*1000).toISOString()>=from && new Date(c.created_at*1000).toISOString()<to)
  return {accountId:ACCOUNT,tenantId:TENANT,from,to,identities,counts:{crm:crm.leads.length,kommoContactsAcrossAccount:contacts.length,kommoContactsWithScopedChannel:scopedContacts.length,kommoLeads:leads.length,talks:talks.length,newKommoContacts:newContacts.length,olderActiveKommoContacts:scopedContacts.filter(c=>activeContacts.has(String(c.id)) && new Date(c.created_at*1000).toISOString()<from).length,missingCrmContacts:scopedContacts.filter(c=>!crm.leads.some(l=>String(l.contact_id)===String(c.id))).length,duplicateCrmPhones:[...phoneOwners.values()].filter(ids=>ids.length>1).length,duplicateKommoPhones:[...kommoPhoneOwners.values()].filter(ids=>ids.size>1).length,incompleteTalks:incomplete.length,messageDifferences:differences.length,recoveryCandidates:proposed.length},incomplete,differences,proposed,preserved}
}
async function main(){
  const queriedAt=new Date().toISOString()
  require('@next/env').loadEnvConfig(process.cwd(),true,{info(){},error(){}})
  const {createClient}=require('@supabase/supabase-js')
  if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname!=='xhjnyntywqhczdtecgim.supabase.co') throw Error('WRONG_SUPABASE_PROJECT')
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  // Account-wide CRM inventory; no default 1000-row truncation.
  const leads=await allRows(admin,'leads','id,contact_id,kommo_id,phone_normalized,created_at',q=>q.eq('tenant_id',TENANT))
  const conversations=await allRows(admin,'conversations','id,lead_id,channel,external_thread_id',q=>q.eq('tenant_id',TENANT))
  const messages=[]
  for(let i=0;i<conversations.length;i+=200) messages.push(...await allRows(admin,'messages','id,conversation_id,external_message_id,role,sent_at',q=>q.in('conversation_id',conversations.slice(i,i+200).map(c=>c.id))))
  const events=await allRows(admin,'lv_integration_events','id,status,payload,result',q=>q.eq('tenant_id',TENANT).eq('kind','inbound'))
  console.log(JSON.stringify({crmReadComplete:true,leads:leads.length,conversations:conversations.length,messages:messages.length,events:events.length,kommoConfigured:!!process.env.KOMMO_BASE_URL && !!process.env.KOMMO_ACCESS_TOKEN}))
  if(!process.env.KOMMO_BASE_URL || !process.env.KOMMO_ACCESS_TOKEN) throw Error('KOMMO_CREDENTIALS_MISSING_COMPARISON_NOT_PERFORMED')
  if(new URL(process.env.KOMMO_BASE_URL).origin!==ORIGIN) throw Error('WRONG_KOMMO_ACCOUNT')
  const get=async path=>{
    for(let attempt=0;;attempt++){
      await new Promise(r=>setTimeout(r,400*(attempt+1)))
      const res=await fetch(ORIGIN+path,{method:'GET',headers:{Authorization:'Bearer '+process.env.KOMMO_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)})
      if((res.status===429 || res.status>=500) && attempt<2){await res.body?.cancel();continue}
      if(!res.ok){await res.body?.cancel();throw Error('KOMMO_HTTP_'+res.status)}
      if(res.status===204)return null
      return res.json()
    }
  }
  if((await get('/api/v4/account')).id!==ACCOUNT) throw Error('WRONG_KOMMO_ACCOUNT')
  const contacts=await pages(get,'/api/v4/contacts?with=leads&order[id]=asc','contacts')
  const kommoLeads=await pages(get,'/api/v4/leads?with=contacts&order[id]=asc','leads')
  const allTalks=(await pages(get,'/api/v4/talks','talks')).map(t=>({...t,talk_id:t.talk_id ?? t.id}))
  if([...contacts,...kommoLeads,...allTalks].some(r=>r.account_id && r.account_id!==ACCOUNT))throw Error('CROSS_ACCOUNT_RECORD')
  const talks=allTalks.filter(t=>['whatsapp','waba'].includes(t.origin?.toLowerCase()))
  const histories=new Map()
  for(const talk of talks){
    try{histories.set(String(talk.talk_id),{complete:true,messages:await pages(get,`/api/v4/talks/${talk.talk_id}/messages?filter[created_at][to]=${Math.floor(Date.parse(queriedAt)/1000)}`,'messages')})}
    catch(e){histories.set(String(talk.talk_id),{complete:false,error:e.message})}
  }
  const from=process.env.KOMMO_AUDIT_FROM || '2026-08-24T00:00:00-05:00',to=process.env.KOMMO_AUDIT_TO || '2026-09-24T00:00:00-05:00'
  const report=compare({leads,conversations,messages,events},contacts,kommoLeads,talks,histories,new Date(from).toISOString(),new Date(to).toISOString())
  report.queriedAt=queriedAt
  report.visibleChannelCounts=Object.fromEntries([...new Set(allTalks.map(t=>t.origin || 'unknown'))].map(origin=>[origin,allTalks.filter(t=>(t.origin || 'unknown')===origin).length]))
  report.accountVisibilityVerified=false // API success alone cannot prove the user sees all account records.
  report.historyReadsComplete=talks.length>0 && report.incomplete.length===0
  report.recoveryPreview={
    insertEvidenceOnly:report.proposed.map(m=>({messageId:m.externalId,contactId:m.contactId,kommoId:m.kommoId,sentAt:m.sentAt})),
    preserve:report.preserved,
    conflicts:report.differences.filter(d=>d.blocked),
    interestEvaluation:report.proposed.filter(m=>m.direction==='incoming').map(m=>({messageId:m.externalId,action:m.text?.trim()?'requires_verified_interpretation':'blocked_uninterpretable_content',points:null})),
    productionWrites:0,approvalRequired:true,
  }
  const {mkdtempSync,writeFileSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os')
  const directory=mkdtempSync(join(tmpdir(),'kommo-audit-'))
  // PII and original content stay outside the repository. No tokens exported.
  writeFileSync(join(directory,'recovery-review.json'),JSON.stringify(report.proposed,null,2),{mode:0o600})
  delete report.proposed
  writeFileSync(join(directory,'comparison.json'),JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify({counts:report.counts,historyErrors:report.incomplete,visibleChannelCounts:report.visibleChannelCounts,artifacts:directory,productionWrites:0,historyReadsComplete:report.historyReadsComplete,accountVisibilityVerified:false,comparisonComplete:false}))
}
module.exports={pages,compare,normalizedPhone,allRows}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'AUDIT_FAILED_NO_REMOTE_WRITES');process.exitCode=1})

/* Read-only inventory. Never prints tokens, webhook query values or widget settings. */
require('@next/env').loadEnvConfig(process.cwd(),true,{info(){},error(){}})
const origin='https://lavilet.kommo.com'
async function get(path){
 if(new URL(process.env.KOMMO_BASE_URL).origin!==origin)throw Error('WRONG_ACCOUNT')
 const res=await fetch(origin+path,{headers:{Authorization:'Bearer '+process.env.KOMMO_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!res.ok){await res.body?.cancel();return {http:res.status}}
 return {http:res.status,body:res.status===204?null:await res.json()}
}
function safeDestination(value){try{const u=new URL(value);return {origin:u.origin,path:u.pathname,queryKeys:[...u.searchParams.keys()],hasUserInfo:Boolean(u.username||u.password)}}catch{return {invalid:true}}}
async function main(){
 const account=await get('/api/v4/account');if(account.body?.id!==36919007)throw Error('ACCOUNT_NOT_VERIFIED')
 console.log(JSON.stringify({accountId:account.body.id,queriedAt:new Date().toISOString()}))
 if(!process.argv.includes('--catalog-only')) for(const [path,key] of [['/api/v4/webhooks','webhooks'],['/api/v4/sources','sources']]){
  const seen=new Set();let page=1
  while(true){
   const r=await get(path+'?limit=250&page='+page)
   const rows=r.body?._embedded?.[key] || []
   const safe=rows.map(x=>key==='webhooks'?{id:x.id,destination:safeDestination(x.destination),settings:x.settings,disabled:x.disabled}:key==='widgets'?{id:x.id,code:x.code,name:x.name,is_active:x.is_active,is_installed:x.is_installed}:{id:x.id,name:x.name,origin_code:x.origin_code,services:(x.services||[]).map(s=>({type:s.type,waba:s.params?.waba}))})
   console.log(JSON.stringify({resource:key,page,http:r.http,rows:safe}))
   const next=r.body?._links?.next?.href;if(!next)break
   const u=new URL(next,origin);if(u.origin!==origin||u.pathname!==path||seen.has(next))throw Error('INVALID_PAGINATION');seen.add(next)
   page++;await new Promise(r=>setTimeout(r,400))
  }
 }
 if(!process.argv.includes('--catalog-only')) for(const code of ['officialwhatsapp','whatsappbusinessapi','amowhatsapp','amo_wazzup']){
  const r=await get('/api/v4/widgets/'+code),x=r.body
  console.log(JSON.stringify({resource:'widget',code,http:r.http,is_active_in_account:x?.is_active_in_account,pipeline_id:x?.pipeline_id}))
  await new Promise(r=>setTimeout(r,400))
 }
 const catalog=await get('/api/v4/widgets?limit=250&page=1')
 const widgets=catalog.body?._embedded?.widgets || []
 console.log(JSON.stringify({resource:'widgetCatalog',http:catalog.http,count:widgets.length,installed:widgets.filter(w=>w.is_active_in_account===true).map(w=>({code:w.code,id:w.id})),installationFlagPresent:widgets.some(w=>'is_active_in_account' in w)}))
 const {pages}=require('./kommo-crm-audit.cjs')
 const talks=await pages(async path=>{const r=await get(path);if(r.http!==200&&r.http!==204)throw Error('TALKS_FAILED');return r.body},'/api/v4/talks','talks')
 console.log(JSON.stringify({resource:'talkOrigins',counts:talks.reduce((a,t)=>{a[t.origin||'unspecified']=(a[t.origin||'unspecified']||0)+1;return a},{})}))
}
main().catch(()=>{console.error('TRANSPORT_INSPECTION_FAILED');process.exitCode=1})

/* Read-only access preflight. Never outputs tokens, bodies, names or phones. */
const {pages}=require('./kommo-crm-audit.cjs')
const ORIGIN='https://lavilet.kommo.com',ACCOUNT=36919007
async function checkAccess(get){
  const account=await get('/api/v4/account')
  if(account?.id!==ACCOUNT) throw Error('WRONG_KOMMO_ACCOUNT')
  const file=await get('/api/v4/leads/4453096?with=contacts')
  const contact=await get('/api/v4/contacts/9431328?with=leads')
  if([file,contact].some(r=>r?.account_id && r.account_id!==ACCOUNT)) throw Error('CROSS_ACCOUNT_RECORD')
  const linked=file?.id===4453096 && contact?.id===9431328 && file._embedded?.contacts?.some(c=>String(c.id)==='9431328')===true && contact._embedded?.leads?.some(l=>String(l.id)==='4453096')===true
  const talks=await pages(get,'/api/v4/talks','talks')
  if(talks.some(t=>t.account_id && t.account_id!==ACCOUNT)) throw Error('CROSS_ACCOUNT_RECORD')
  const selected=talks.find(t=>String(t.contact_id)==='9431328') || talks[0]
  let history={tested:false,reason:'NO_VISIBLE_TALKS'}
  if(selected){
    const id=selected.talk_id ?? selected.id
    if(!/^\d+$/.test(String(id))) throw Error('INVALID_TALK_ID')
    try{
      const messages=await pages(get,`/api/v4/talks/${id}/messages`,'messages')
      history={tested:true,accessible:true,talkId:id,messages:messages.length}
    }catch(e){history={tested:true,accessible:false,error:/^KOMMO_HTTP_\d+$/.test(e.message)?e.message:'HISTORY_CHECK_FAILED'}}
  }
  return {accountId:ACCOUNT,relationship4453096To9431328:linked,visibleTalks:talks.length,history,fullAuditComplete:false,productionWrites:0}
}
async function main(){
  require('@next/env').loadEnvConfig(process.cwd(),true,{info(){},error(){}})
  if(!process.env.KOMMO_BASE_URL || !process.env.KOMMO_ACCESS_TOKEN) throw Error('KOMMO_CREDENTIALS_MISSING')
  const base=new URL(process.env.KOMMO_BASE_URL)
  if(base.origin!==ORIGIN || base.username || base.password || base.search || base.hash || base.pathname!=='/') throw Error('WRONG_KOMMO_ACCOUNT')
  const get=async path=>{
    const url=new URL(path,ORIGIN)
    if(url.origin!==ORIGIN) throw Error('FOREIGN_REQUEST')
    await new Promise(resolve=>setTimeout(resolve,400))
    const res=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+process.env.KOMMO_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)})
    if(!res.ok){await res.body?.cancel();throw Error('KOMMO_HTTP_'+res.status)}
    return res.status===204?null:res.json()
  }
  console.log(JSON.stringify({queriedAt:new Date().toISOString(),...await checkAccess(get)}))
}
module.exports={checkAccess}
if(require.main===module) main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'ACCESS_CHECK_FAILED');process.exitCode=1})

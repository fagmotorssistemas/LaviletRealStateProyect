/* eslint-disable @typescript-eslint/no-require-imports -- Explicit admin-only template preparation, never starts a Salesbot. */
const fs=require('node:fs'),path=require('node:path');
const buttons=['Sí, quiero información','Más adelante','No recibir mensajes'].map(text=>({type:'inline',text}));
const routes=[{sourceId:19934,name:'SHOWROOM_UNIDAD_BOTONES_V2',externalId:'lavilet_showroom_unidad_botones_v2'},{sourceId:19936,name:'SHOWROOM_GENERAL_BOTONES_V2',externalId:'lavilet_showroom_general_botones_v2'}];
(async()=>{
 const origin=new URL(process.env.KOMMO_BASE_URL||'https://invalid.invalid').origin;
 if(origin!=='https://lavilet.kommo.com'||!process.env.KOMMO_ACCESS_TOKEN)throw Error('KOMMO_ACCOUNT_OR_CREDENTIALS_MISSING');
 const apply=process.argv.includes('--apply'),submit=process.argv.includes('--submit');
 async function request(route,method='GET',body){const response=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+process.env.KOMMO_ACCESS_TOKEN,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json().catch(()=>null);if(!response.ok)throw Error('KOMMO_TEMPLATE_HTTP_'+response.status+':'+JSON.stringify(value?.['validation-errors']||value?.detail||value?.title||'request_rejected').slice(0,500));return value}
 let templates=[];for(let page=1;page<=10;page++){const response=await request('/api/v4/chats/templates?with=reviews&limit=50&page='+page);const rows=response?._embedded?.chat_templates||[];templates.push(...rows);if(rows.length<50)break}
 const prepared=[];
 for(const route of routes){
  const source=await request('/api/v4/chats/templates/'+route.sourceId+'?with=reviews');
  if(source.type!=='waba'||!source.waba_selected_waba_ids?.length)throw Error('SOURCE_TEMPLATE_UNAVAILABLE');
  let target=templates.find(row=>row.external_id===route.externalId||row.name===route.name);
  if(!target){const payload={name:route.name,type:'waba',content:source.content.trim(),is_editable:true,external_id:route.externalId,buttons,waba_category:source.waba_category,waba_language:source.waba_language,waba_examples:Array.isArray(source.waba_examples)?{}:source.waba_examples,waba_selected_waba_ids:source.waba_selected_waba_ids};
   if(!apply){prepared.push({action:'draft_to_create',payload});continue}
   // Do not replay an uncertain POST. Re-running reconciles by external_id first.
   const created=await request('/api/v4/chats/templates','POST',[payload]);target=created?._embedded?.chat_templates?.[0];if(!target?.id)throw Error('TEMPLATE_CREATE_RECEIPT_UNCONFIRMED');templates.push({...payload,...target});
  }
  target=await request('/api/v4/chats/templates/'+target.id+'?with=reviews');
  const reviews=target._embedded?.reviews||[];
  let status=reviews.length?reviews.map(row=>row.status).join(','):target.is_on_review?'review':'draft',review=null;
  if(!target.waba_selected_waba_ids?.length){prepared.push({id:target.id,name:route.name,status:'draft',action:'select_waba_in_kommo_interface',buttons:target.buttons});continue}
  if(apply&&submit&&status==='draft'){
   review=await request('/api/v4/chats/templates/'+target.id+'/review','POST');
   const receipt=await request('/api/v4/chats/templates/'+target.id+'?with=reviews');
   const confirmed=receipt._embedded?.reviews||[];
   status=confirmed.length?confirmed.map(row=>row.status).join(','):receipt.is_on_review?'review':'review_unconfirmed';
  }
  prepared.push({id:target.id,name:route.name,sourceId:route.sourceId,status,review,buttons:target.buttons||buttons});
 }
 fs.mkdirSync(path.join(process.cwd(),'tmp'),{recursive:true});fs.writeFileSync('tmp/showroom-button-template-receipts.json',JSON.stringify(prepared,null,2));
 console.log(JSON.stringify(prepared.map(({review,...item})=>({...item,reviewSubmitted:Boolean(review?._embedded?.reviews?.length)})),null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1});

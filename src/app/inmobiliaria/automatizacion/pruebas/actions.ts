'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { db, scope, object } from '@/lib/integrations/automation/data'
import { TEST_RESPONSE_SETTING, isTestPhone, type TestResponseState } from '@/lib/inmobiliaria/testResponseMode'

async function access() {
  await assertAdmin()
  const {supabase,user}=await getSessionUser()
  if(!user)throw Error('No autenticado')
  const {data,error}=await supabase.from('projects').select('id').eq('id',scope.project_id).eq('tenant_id',scope.tenant_id).single()
  if(error||!data)throw Error('Sin acceso al proyecto')
  return user
}
async function read() {
  const {data:leads,error}=await db().from('leads').select('id,phone,kommo_id,bot_enabled').match(scope).in('phone',['0987110032','+593987110032','593987110032'])
  if(error||leads?.length!==1||!isTestPhone(leads[0].phone)||!leads[0].kommo_id)throw Error('No se pudo identificar un único lead para pruebas')
  const {data:row,error:rowError}=await db().from('agent_prompts').select('id,content,version').match(scope).eq('name',TEST_RESPONSE_SETTING).maybeSingle()
  if(rowError)throw Error('No se pudo leer el modo de pruebas')
  const lead=leads[0]
  const state:TestResponseState={enabled:object(row?.content).enabled===true,version:row?.version||0,leadId:lead.id,kommoId:Number(lead.kommo_id),botEnabled:lead.bot_enabled===true}
  return {row,state}
}
export async function loadTestResponseAction() { await access(); return (await read()).state }
export async function saveTestResponseAction(enabled:boolean,expectedVersion:number) {
  const user=await access()
  if(typeof enabled!=='boolean'||!Number.isSafeInteger(expectedVersion))throw Error('Configuración inválida')
  const {row,state}=await read()
  if(state.version!==expectedVersion)throw Error('La configuración cambió. Recargue la página.')
  const payload={content:JSON.stringify({enabled,leadId:state.leadId}),version:expectedVersion+1,updated_at:new Date().toISOString(),updated_by:user.id}
  const result=row?await db().from('agent_prompts').update(payload).match(scope).eq('id',row.id).eq('version',expectedVersion).select('id')
    :await db().from('agent_prompts').insert({...scope,...payload,name:TEST_RESPONSE_SETTING,is_active:false,channel:[],mode:'lanzamiento',priority:0,load_when:'Modo de pruebas de tiempos de respuesta'}).select('id')
  if(result.error||result.data?.length!==1)throw Error('No se pudo guardar; recargue para comprobar el estado')
  if(!enabled) {
    const {data:pending,error}=await db().from('lv_integration_events').select('id,available_at,result').match(scope).eq('kind','inbound').eq('status','pending').like('contact_key',`${state.kommoId}:%`)
    if(error)throw Error('Modo desactivado; no se pudo comprobar la cola pendiente')
    for(const event of pending||[]) {
      const original=object(event.result).test_original_available_at
      if(typeof original!=='string')continue
      const {error:restoreError}=await db().from('lv_integration_events').update({available_at:original}).match(scope).eq('id',event.id).eq('status','pending').eq('available_at',event.available_at)
      if(restoreError)throw Error('Modo desactivado; no se pudo restaurar una espera pendiente')
    }
  }
  return {...state,enabled,version:expectedVersion+1}
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TONE, TONE_SETTING_NAME, validateTone, type ToneSettings, type ToneState } from '@/lib/inmobiliaria/conversationTone'
type Scope = { tenantId: string; projectId: string }
export async function readToneRow(client: SupabaseClient, scope: Scope) {
  const {data,error} = await client.from('agent_prompts').select('id,content,version,updated_at').eq('tenant_id',scope.tenantId).eq('project_id',scope.projectId).eq('name',TONE_SETTING_NAME).abortSignal(AbortSignal.timeout(3000)).maybeSingle()
  if (error) throw new Error('No se pudo cargar el estilo de conversación')
  return data
}
export function toneState(row: Awaited<ReturnType<typeof readToneRow>>): ToneState {
  if (!row) return {current:{...DEFAULT_TONE},previous:null,version:0,updatedAt:null}
  const data = JSON.parse(row.content)
  return {current:validateTone(data.current),previous:data.previous ? validateTone(data.previous) : null,version:row.version,updatedAt:row.updated_at}
}
export async function saveTone(client: SupabaseClient, scope: Scope, userId: string, value: ToneSettings, expectedVersion: number) {
  const current=validateTone(value), row=await readToneRow(client,scope), previous=toneState(row)
  if(previous.version!==expectedVersion)throw new Error('Otra persona cambió el estilo. Recargue antes de guardar.')
  const updatedAt=new Date().toISOString()
  const content=JSON.stringify({current,previous:previous.current})
  const payload={content,version:expectedVersion+1,updated_by:userId,updated_at:updatedAt}
  const result=row
    ? await client.from('agent_prompts').update(payload).eq('id',row.id).eq('tenant_id',scope.tenantId).eq('project_id',scope.projectId).eq('content',row.content).eq('version',expectedVersion).select('id')
    : await client.from('agent_prompts').insert({...payload,name:TONE_SETTING_NAME,tenant_id:scope.tenantId,project_id:scope.projectId,is_active:false,channel:[],mode:'lanzamiento',priority:0,load_when:'Configuración del estilo de conversación'}).select('id')
  if(result.error || result.data?.length!==1)throw new Error('No se pudo guardar. Recargue para comprobar la configuración vigente.')
  return {current,previous:previous.current,version:expectedVersion+1,updatedAt}
}

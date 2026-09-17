'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { projectReadiness, validateReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { launchPricesVisible } from '@/lib/inmobiliaria/unitPrices'
async function access(projectId: string) {
  await assertAdmin()
  const {supabase,user}=await getSessionUser()
  if(!user)throw Error('No autenticado')
  const {data:project,error}=await supabase.from('projects').select('id,tenant_id,name,policies_json,updated_at').eq('id',projectId).single()
  if(error||!project)throw Error('Proyecto no disponible')
  return {supabase,user,project}
}
export async function loadProjectReadiness(projectId:string) {
  const {supabase,project}=await access(projectId)
  const config=await supabase.from('project_automation_config').select('mode').eq('project_id',project.id).eq('tenant_id',project.tenant_id).maybeSingle()
  if(config.error)throw Error('No se pudo leer la etapa comercial')
  const mode=config.data?.mode||'lanzamiento'
  return {projectName:project.name,mode,pricesVisible:launchPricesVisible(project.policies_json),updatedAt:project.updated_at as string,...projectReadiness(project.policies_json,mode)}
}
export async function saveProjectReadiness(projectId:string,value:unknown,expectedUpdatedAt:string) {
  try {
  const {supabase,user,project}=await access(projectId)
  let current
  try {current=validateReadiness(value)}catch(e){return {ok:false as const,error:e instanceof Error?e.message:'Revise los datos del proyecto.'}}
  if(project.updated_at!==expectedUpdatedAt)return {ok:false as const,error:'La configuración cambió. Recargue antes de guardar para conservar los cambios de otros controles.'}
  const policies=project.policies_json||{}, now=new Date().toISOString()
  const previous=policies.project_readiness?.current||null
  const history=Array.isArray(policies.project_readiness?.history)?policies.project_readiness.history:[]
  const next={...policies,bot_visits:{...policies.bot_visits,launch_destination:current.primaryPlace==='office'?'office':'site'},project_readiness:{current,updatedAt:now,updatedBy:user.id,history:[{previous,current,at:now,by:user.id},...history].slice(0,20)}}
  const result=await supabase.from('projects').update({policies_json:next,updated_at:now}).eq('id',projectId).eq('tenant_id',project.tenant_id).eq('updated_at',expectedUpdatedAt).select('id,updated_at')
  if(result.error)return {ok:false as const,error:'No se pudo guardar la configuración. Intente nuevamente.'}
  if(result.data?.length!==1)return {ok:false as const,error:'La configuración cambió. Recargue e intente de nuevo.'}
  return {ok:true as const,value:current,updatedAt:result.data[0].updated_at as string,configured:true}
  } catch {return {ok:false as const,error:'No se pudo guardar. Compruebe su sesión y el acceso al proyecto e intente nuevamente.'}}
}

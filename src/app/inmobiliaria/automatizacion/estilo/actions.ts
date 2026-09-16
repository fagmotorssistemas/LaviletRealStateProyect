'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { DEFAULT_TONE, validateTone, type ToneSettings } from '@/lib/inmobiliaria/conversationTone'
import { readToneRow, saveTone, toneState } from '@/services/conversationTone.service'
import { aiJson } from '@/lib/integrations/automation/ai'
import { CURRENT_TONE } from '@/lib/integrations/automation/conversation-tone'

async function access(projectId: string) {
  await assertAdmin()
  const {supabase,user}=await getSessionUser()
  if(!user)throw new Error('No autenticado')
  const {data:project,error}=await supabase.from('projects').select('id,name,tenant_id').eq('id',projectId).single()
  if(error||!project)throw new Error('No se pudo acceder al proyecto')
  return {supabase,user,project,scope:{tenantId:project.tenant_id,projectId:project.id}}
}
export async function loadToneAction(projectId: string) {
  const context=await access(projectId)
  return {projectName:context.project.name,state:toneState(await readToneRow(context.supabase,context.scope))}
}
export async function saveToneAction(projectId: string, settings: ToneSettings, expectedVersion: number) {
  const c=await access(projectId)
  return saveTone(c.supabase,c.scope,c.user.id,validateTone(settings),expectedVersion)
}
export async function restoreToneAction(projectId: string, expectedVersion: number, original = false) {
  const c=await access(projectId), state=toneState(await readToneRow(c.supabase,c.scope))
  if(state.version!==expectedVersion)throw new Error('La configuración cambió. Recargue antes de restaurar.')
  if(!original&&!state.previous)throw new Error('No hay una versión anterior')
  return saveTone(c.supabase,c.scope,c.user.id,original?DEFAULT_TONE:state.previous!,expectedVersion)
}
export async function previewToneAction(projectId: string, settings: ToneSettings, scenario: string) {
  await access(projectId)
  const tone=validateTone(settings)
  const examples: Record<string,{question:string;facts:string}>={
    opciones:{question:'Quiero información de departamentos para vivir con mi familia.',facts:'Ejemplo: el catálogo ofrece departamentos de 2 y 3 dormitorios. Puede preguntar cuántos dormitorios busca. No invente precios, disponibilidad de una unidad, ubicación ni instalaciones.'},
    financiamiento:{question:'Me gustaría comprar, pero no sé si me alcanza.',facts:'Ejemplo: se puede orientar sobre revisión de financiamiento con Banco Pichincha o Cooperativa JEP. No prometa aprobación, no pida cédula ni afirme haber iniciado trámites.'},
    visita:{question:'Me gustaría visitar el proyecto. ¿Cómo coordinamos?',facts:'Ejemplo: pregunte qué día y hora le gustaría ir para revisar disponibilidad. No confirme una cita ni invente horarios o dirección.'},
  }
  const example=examples[scenario]
  if(!example)throw new Error('Seleccione un ejemplo válido')
  const result=await aiJson(CURRENT_TONE.operationalIntro+'\n'+CURRENT_TONE.operationalWriting+'\n'+CURRENT_TONE.commercialLength+'\nEsta es una vista previa aislada. Responda solo con los hechos del ejemplo y no ejecute ni afirme haber ejecutado ninguna acción.',example,{type:'object',properties:{mensaje:{type:'string'}},required:['mensaje'],additionalProperties:false},undefined,undefined,tone)
  if(typeof result.mensaje!=='string'||!result.mensaje.trim()||result.mensaje.length>1500)throw new Error('No se pudo generar la vista previa. Intente nuevamente.')
  return {question:example.question,reply:result.mensaje}
}

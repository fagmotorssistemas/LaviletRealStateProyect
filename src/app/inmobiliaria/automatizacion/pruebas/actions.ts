'use server'
import { randomUUID } from 'node:crypto'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { db, scope } from '@/lib/integrations/automation/data'
import { setKommoField } from '@/lib/integrations/automation/kommo'
import { testContacts } from '@/lib/integrations/automation/test-response-mode'
import { resumeTestContact } from '@/lib/integrations/automation/resume-test-contact'
import { normalizeTestPhone, testContactControls, type TestResponseActionResult } from '@/lib/inmobiliaria/testResponseMode'

type Failure = Extract<TestResponseActionResult, {ok:false}>
const problems: Record<string, string> = {
  TEST_CONTACT_CHANGED: 'La lista cambió. Pulse «Actualizar lista» antes de volver a intentarlo.',
  TEST_CONTACT_DUPLICATE: 'Ese número ya está en la lista de pruebas.',
  TEST_CONTACT_AMBIGUOUS: 'Hay varios leads con ese teléfono. Resuelva el duplicado antes de reiniciar.',
  TEST_CONTACT_NOT_LINKED: 'El número aún no está vinculado con Kommo. Envíe un mensaje desde ese número al WhatsApp del proyecto y pulse «Actualizar lista».',
  TEST_RESET_BUSY: 'No se reinició la prueba: el sistema está procesando mensajes o tiene un envío pendiente de confirmar. Espere a que termine y vuelva a intentarlo.',
  TEST_RESUME_BUSY: 'No se reanudó el bot: hay un procesamiento o envío pendiente de confirmar. Espere a que termine y vuelva a intentarlo.',
  TEST_RESUME_NOT_INSTALLED: 'Falta actualizar la base de datos para reanudar el bot conservando la conversación. Aplique la migración de reanudación y vuelva a intentarlo.',
  TEST_RESET_PROTECTED: 'Este lead tiene contratos, reservas o ventas y no se puede reiniciar.',
  TEST_CONTACT_OPT_OUT: 'El contacto solicitó no recibir mensajes. No se puede reactivar desde aquí.',
  TEST_CONTACTS_READ_FAILED: 'No se pudo cargar la lista de pruebas. Pulse «Actualizar lista» para reintentar.',
  TEST_ACCESS_DENIED: 'Su sesión no tiene acceso de administrador a este proyecto. Vuelva a iniciar sesión con una cuenta autorizada.',
}

async function access() {
  await assertAdmin()
  const {supabase,user}=await getSessionUser()
  if(!user)throw Error('No autenticado')
  const {data,error}=await supabase.from('projects').select('id').eq('id',scope.project_id).eq('tenant_id',scope.tenant_id).single()
  if(error||!data)throw Error('Sin acceso al proyecto')
  return user
}

function rejected(code: string, error = problems[code], refreshRequired = false): Failure {
  return {ok:false,code,error,refreshRequired}
}

// Only allowlisted messages reach the browser. Database details may contain lead data.
function recordFailure(operation: string, error: unknown) {
  const source = error && typeof error === 'object' ? error as {code?:unknown} : {}
  const reference = randomUUID()
  const safeCode = typeof source.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(source.code) ? source.code : 'UNKNOWN'
  console.error('test_contacts_action_failed', {operation, reference, code:safeCode})
  return reference
}

function failure(operation: string, error: unknown, mutationStarted = false): Failure {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : ''
  if (typeof message === 'string' && Object.hasOwn(problems,message)) {
    return rejected(message,problems[message],message==='TEST_CONTACT_CHANGED')
  }
  if (['No autenticado','Solo el administrador puede hacer esto','Sin acceso al proyecto'].includes(String(message))) {
    return rejected('TEST_ACCESS_DENIED')
  }
  const reference = recordFailure(operation,error)
  return rejected('TEST_ACTION_FAILED', mutationStarted
    ? `No se pudo confirmar el resultado. Pulse «Actualizar lista» y compruebe el estado del contacto antes de repetir la acción. Referencia: ${reference}.`
    : `No se pudo completar la consulta. Pulse «Actualizar lista» para reintentar. Referencia: ${reference}.`, mutationStarted)
}

async function mutate(operation: string, args: Record<string, unknown>): Promise<Failure | null> {
  try {
    const {error} = await db().rpc(operation==='reset'?'lv_restart_enrolled_test_contact':'lv_manage_test_contact',args)
      .abortSignal(AbortSignal.timeout(30_000))
    return error ? failure(operation,error,true) : null
  } catch(error) { return failure(operation,error,true) }
}

// A committed mutation remains successful even if refreshing the list fails afterwards.
async function updatedState(operation: string, notice: string, warning?: string): Promise<TestResponseActionResult> {
  try { return {ok:true,state:{contacts:await testContacts()},notice,warning} }
  catch(error) {
    const reference = recordFailure(`${operation}:refresh`,error)
    return {ok:true,state:null,notice,warning:[warning,`No se pudo actualizar la lista. Pulse «Actualizar lista» antes de hacer otro cambio. Referencia: ${reference}.`].filter(Boolean).join(' ')}
  }
}

export async function loadTestResponseAction(): Promise<TestResponseActionResult> {
  try {
    await access()
    return {ok:true,state:{contacts:await testContacts()},notice:''}
  } catch(error) { return failure('load',error) }
}

export async function addTestContactAction(phoneInput: string, label: string): Promise<TestResponseActionResult> {
  try {
    const user = await access(), phone = normalizeTestPhone(phoneInput)
    if (!phone || typeof label !== 'string' || label.trim().length > 80) {
      return rejected('TEST_CONTACT_INVALID','Indique un teléfono válido y un nombre de hasta 80 caracteres.')
    }
    const error = await mutate('add',{p_action:'add',p_phone:phone,p_label:label.trim(),p_actor:user.id})
    if(error)return error
    return updatedState('add','Número añadido con la espera habitual de 30 segundos.')
  } catch(error) { return failure('add:prepare',error) }
}

export async function updateTestContactAction(id: string, version: number, action: 'fast_on'|'fast_off'|'remove'|'reset'|'resume'): Promise<TestResponseActionResult> {
  try {
    const user = await access()
    if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id) || !Number.isSafeInteger(version) || version < 1
      || !['fast_on','fast_off','remove','reset','resume'].includes(action)) return rejected('TEST_ACTION_INVALID','Acción inválida')
    const contact = (await testContacts()).find(c=>c.id===id && c.version===version)
    if (!contact) return rejected('TEST_CONTACT_CHANGED',problems.TEST_CONTACT_CHANGED,true)
    const controls = testContactControls(contact)
    if (action==='reset' && !controls.canReset) return rejected('TEST_RESET_UNAVAILABLE',controls.resetDisabledReason)
    if (action==='resume' && !controls.canResume) return rejected('TEST_RESUME_UNAVAILABLE',controls.resumeDisabledReason)
    if (action==='resume') {
      try {
        const result = await resumeTestContact(id,version,user.id)
        return updatedState(action,
          result.kommoSynced ? 'Bot reanudado. Continuará con el próximo mensaje del lead y conservará su ficha y conversación.' : 'Reanudación guardada en el sistema.',
          result.kommoSynced ? undefined : 'No se pudo reanudar el bot en Kommo. Pulse «Reanudar bot» para reintentar.')
      } catch(error) { return failure('resume',error,true) }
    }
    const error = await mutate(action,{
      ...(action==='reset'?{}:{p_action:action}),p_id:id,p_version:version,p_actor:user.id,
    })
    if(error)return error
    let notice = action==='reset'?'Prueba reiniciada. Ya puede comenzar una conversación nueva.':action==='remove'?'Número eliminado de la lista de pruebas.':'Cambio guardado.'
    let warning: string | undefined
    if (action==='reset' && contact.kommoId) {
      try { await setKommoField(contact.kommoId,451530,'false') }
      catch(error) {
        const reference = recordFailure(`${action}:kommo`,error)
        notice = action==='reset'?'Prueba reiniciada.':'Cambio guardado en el sistema.'
        warning = `No se pudo reanudar el bot en Kommo. Pulse «Reanudar bot» para reintentar. Referencia: ${reference}.`
      }
    }
    return updatedState(action,notice,warning)
  } catch(error) { return failure('update:prepare',error) }
}

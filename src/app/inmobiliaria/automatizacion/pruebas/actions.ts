'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { db, scope } from '@/lib/integrations/automation/data'
import { setKommoField } from '@/lib/integrations/automation/kommo'
import { testContacts } from '@/lib/integrations/automation/test-response-mode'
import { normalizeTestPhone, type TestResponseState } from '@/lib/inmobiliaria/testResponseMode'

async function access() {
  await assertAdmin()
  const {supabase,user}=await getSessionUser()
  if(!user)throw Error('No autenticado')
  const {data,error}=await supabase.from('projects').select('id').eq('id',scope.project_id).eq('tenant_id',scope.tenant_id).single()
  if(error||!data)throw Error('Sin acceso al proyecto')
  return user
}
function problem(message: string) {
  const errors: Record<string,string> = {
    TEST_CONTACT_CHANGED: 'La lista cambió. Actualícela y vuelva a intentarlo.',
    TEST_CONTACT_DUPLICATE: 'Ese número ya está en la lista de pruebas.',
    TEST_CONTACT_AMBIGUOUS: 'Hay varios leads con ese teléfono. Resuelva el duplicado antes de reiniciar.',
    TEST_CONTACT_NOT_LINKED: 'El número aún no tiene un lead de WhatsApp vinculado.',
    TEST_RESET_BUSY: 'Hay una respuesta en curso. Espere a que termine y vuelva a intentarlo.',
    TEST_RESET_PROTECTED: 'Este lead tiene contratos, reservas o ventas y no se puede reiniciar.',
    TEST_CONTACT_OPT_OUT: 'El contacto solicitó no recibir mensajes. No se puede reactivar desde aquí.',
  }
  return errors[message] || 'No se pudo guardar el cambio. Actualice la lista para comprobar su estado.'
}
export async function loadTestResponseAction(): Promise<TestResponseState> {
  await access()
  return {contacts: await testContacts()}
}
export async function addTestContactAction(phoneInput: string, label: string): Promise<TestResponseState> {
  const user = await access(), phone = normalizeTestPhone(phoneInput)
  if (!phone || typeof label !== 'string' || label.trim().length > 80) throw Error('Indique un teléfono válido y un nombre de hasta 80 caracteres.')
  const {error} = await db().rpc('lv_manage_test_contact', {p_action:'add',p_phone:phone,p_label:label.trim(),p_actor:user.id})
  if(error)throw Error(problem(error.message))
  return {contacts:await testContacts()}
}
export async function updateTestContactAction(id: string, version: number, action: 'fast_on'|'fast_off'|'remove'|'reset'|'resume'): Promise<{state:TestResponseState;notice:string}> {
  const user = await access()
  if (!/^[a-f\d-]{36}$/i.test(id) || !Number.isSafeInteger(version) || version < 1
    || !['fast_on','fast_off','remove','reset','resume'].includes(action)) throw Error('Acción inválida')
  const contact = (await testContacts()).find(c=>c.id===id && c.version===version)
  if (!contact) throw Error(problem('TEST_CONTACT_CHANGED'))
  if (action==='resume' && (contact.blocked || !contact.kommoId)) throw Error('Resuelva la derivación o la baja de mensajes antes de reanudar el bot.')
  const {error} = await db().rpc(action==='reset'?'lv_restart_enrolled_test_contact':'lv_manage_test_contact', {
    ...(action==='reset'?{}:{p_action:action}),p_id:id,p_version:version,p_actor:user.id,
  }).abortSignal(AbortSignal.timeout(30_000))
  if(error)throw Error(problem(error.message))
  let notice = action==='reset'?'Prueba reiniciada. Ya puede comenzar una conversación nueva.':action==='remove'?'Número eliminado de la lista de pruebas.':'Cambio guardado.'
  if ((action==='reset'||action==='resume') && contact.kommoId) {
    try { await setKommoField(contact.kommoId,451530,'false') }
    catch { notice = action==='reset'?'La prueba se reinició, pero no se pudo reanudar el bot en Kommo. Pulse «Reanudar bot» para reintentar.':'No se pudo reanudar el bot en Kommo. Puede reintentarlo.' }
  }
  return {state:{contacts:await testContacts()},notice}
}

'use client'
import { useState } from 'react'
import { addTestContactAction, loadTestResponseAction, updateTestContactAction } from '@/app/inmobiliaria/automatizacion/pruebas/actions'
import { NORMAL_RESPONSE_SECONDS, testContactControls, type TestContact, type TestResponseState } from '@/lib/inmobiliaria/testResponseMode'
import { AutomationSettingsHeader, automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ConversationToneSettings.module.css'
import local from './TestContactsSettings.module.css'

export function TestResponseSettings({initial}:{initial:TestResponseState}) {
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [phone,setPhone]=useState(''),[label,setLabel]=useState('')
  const [confirmation,setConfirmation]=useState<{id:string;action:'reset'|'remove'}|null>(null)
  async function perform(task:()=>Promise<void>){
    setBusy(true);setError('');setNotice('')
    try{await task()}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar')}
    finally{setBusy(false)}
  }
  async function update(contact:TestContact,action:'fast_on'|'fast_off'|'reset'|'remove'|'resume'){
    await perform(async()=>{const result=await updateTestContactAction(contact.id,contact.version,action);setState(result.state);setNotice(result.notice);setConfirmation(null)})
  }
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="pruebas" title="Contactos de prueba" description="Añada números para probar la conversación y controle la espera de cada contacto." project={<span>La Vilet</span>}/>
    <section className={styles.card} aria-busy={busy}>
      <h2>Números para pruebas</h2>
      <p>Las respuestas de WhatsApp son reales. Cada número conserva las reglas comerciales y los controles del bot. Puede añadirlo antes de que envíe su primer mensaje.</p>
      <form className={local.form} onSubmit={event=>{event.preventDefault();void perform(async()=>{setState(await addTestContactAction(phone,label));setPhone('');setLabel('');setNotice('Número añadido con la espera habitual de 30 segundos.')})}}>
        <label className={local.field}>Nombre para identificarlo (opcional)<input value={label} maxLength={80} disabled={busy} onChange={e=>setLabel(e.target.value)} placeholder="Por ejemplo, prueba de ventas"/></label>
        <label className={local.field}>Número de WhatsApp<input type="tel" value={phone} disabled={busy} required onChange={e=>setPhone(e.target.value)} placeholder="0991234567 o +593991234567" autoComplete="off"/></label>
        <button className={styles.primary} disabled={busy||!phone.trim()} type="submit">Añadir número</button>
      </form>
      <button disabled={busy} onClick={()=>void perform(async()=>setState(await loadTestResponseAction()))}>Actualizar lista</button>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div role="status" aria-live="polite">{notice&&<p className={local.notice}>{notice}</p>}</div>
      <div className={local.list}>
        {!state.contacts.length&&<p className={local.empty}>Todavía no hay números de prueba. Añada el primero arriba.</p>}
        {state.contacts.map(contact=>{const controls=testContactControls(contact);const helpId=`test-contact-help-${contact.id}`;return <article className={local.contact} key={contact.id}>
          <div className={local.heading}><div><h3>{contact.label||'Contacto de prueba'}</h3><span className={local.phone}>+{contact.phone}</span></div><span className={local.badge}>{controls.label}</span></div>
          <label className={local.switch}><input type="checkbox" role="switch" checked={contact.fastResponse} disabled={busy} onChange={e=>void update(contact,e.target.checked?'fast_on':'fast_off')}/>Respuesta rápida</label>
          <p>{contact.fastResponse?'Sin espera de agrupación: cada mensaje puede iniciar una respuesta por separado.':`Espera de ${NORMAL_RESPONSE_SECONDS} segundos para agrupar mensajes consecutivos.`} La generación y una respuesta que ya esté en curso pueden añadir tiempo.</p>
          {controls.explanation&&<p id={helpId}>{controls.explanation}</p>}
          <div className={styles.actions}>
            <button disabled={busy||!controls.canReset} aria-describedby={controls.resetDisabledReason?helpId:undefined} title={controls.resetDisabledReason||undefined} onClick={()=>setConfirmation({id:contact.id,action:'reset'})}>Reiniciar prueba</button>
            {contact.leadId&&<button disabled={busy||!controls.canResume} aria-describedby={controls.resumeDisabledReason?helpId:undefined} title={controls.resumeDisabledReason||undefined} onClick={()=>void update(contact,'resume')}>Reanudar bot</button>}
            <button className={local.danger} disabled={busy} onClick={()=>setConfirmation({id:contact.id,action:'remove'})}>Eliminar de pruebas</button>
          </div>
          {confirmation?.id===contact.id&&<div className={local.confirm}>
            <p>{confirmation.action==='reset'?`¿Reiniciar la prueba de +${contact.phone}? Se guardará un respaldo y se limpiarán su conversación, preferencias, datos recogidos y citas de prueba para empezar desde cero. El historial de WhatsApp y Kommo se conserva.`:`¿Quitar +${contact.phone} de la lista? Se restaurarán sus tiempos habituales. Su lead y conversación se conservan; si la automatización está limitada a pruebas, dejará de responderle.`}</p>
            <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={()=>void update(contact,confirmation.action)}>{confirmation.action==='reset'?'Confirmar reinicio':'Confirmar eliminación'}</button><button disabled={busy} onClick={()=>setConfirmation(null)}>Cancelar</button></div>
          </div>}
        </article>})}
      </div>
    </section>
  </div>
}

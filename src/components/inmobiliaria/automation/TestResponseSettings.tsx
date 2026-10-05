'use client'
import { useState, type ReactNode } from 'react'
import { addTestContactAction, loadTestResponseAction, updateTestContactAction } from '@/app/inmobiliaria/automatizacion/pruebas/actions'
import { NORMAL_RESPONSE_SECONDS, testContactControls, type TestContact, type TestResponseState, type TestResponseActionResult } from '@/lib/inmobiliaria/testResponseMode'
import { AutomationSettingsHeader, automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ConversationToneSettings.module.css'
import local from './TestContactsSettings.module.css'

export function TestResponseSettings({initial,initialError='',reviewControl}:{initial:TestResponseState;initialError?:string;reviewControl?:ReactNode}) {
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(initialError),[notice,setNotice]=useState('')
  const [needsRefresh,setNeedsRefresh]=useState(Boolean(initialError))
  const [phone,setPhone]=useState(''),[label,setLabel]=useState('')
  const [confirmation,setConfirmation]=useState<{id:string;action:'reset'|'remove'}|null>(null)
  const disabled=busy||needsRefresh
  function applyResult(result:TestResponseActionResult){
    if(!result.ok){
      setError(result.error)
      if(result.refreshRequired)setNeedsRefresh(true)
      return false
    }
    if(result.state)setState(result.state)
    setNeedsRefresh(!result.state)
    setNotice(result.notice)
    setError(result.warning||'')
    return true
  }
  async function perform(task:()=>Promise<void>){
    setBusy(true);setError('');setNotice('')
    try{await task()}catch{
      setError('No se pudo confirmar la respuesta del servidor. Pulse «Actualizar lista» para comprobar el estado antes de repetir la acción.')
      setNeedsRefresh(true)
    }
    finally{setBusy(false)}
  }
  async function update(contact:TestContact,action:'fast_on'|'fast_off'|'reset'|'remove'|'resume'){
    await perform(async()=>{
      if(applyResult(await updateTestContactAction(contact.id,contact.version,action)))setConfirmation(null)
    })
  }
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="pruebas" title="Pruebas y revisión" description="Controle la revisión general de mensajes y gestione sus contactos de prueba." project={<span>La Vilet</span>}/>
    {reviewControl}
    <section className={styles.card} aria-busy={busy}>
      <h2>Números para pruebas</h2>
      <p>Las respuestas de WhatsApp son reales. Cada número conserva las reglas comerciales y los controles del bot. Puede añadirlo antes de que envíe su primer mensaje.</p>
      <form className={local.form} onSubmit={event=>{event.preventDefault();if(disabled)return;void perform(async()=>{
        if(applyResult(await addTestContactAction(phone,label))){setPhone('');setLabel('')}
      })}}>
        <label className={local.field}>Nombre para identificarlo (opcional)<input value={label} maxLength={80} disabled={disabled} onChange={e=>setLabel(e.target.value)} placeholder="Por ejemplo, prueba de ventas"/></label>
        <label className={local.field}>Número de WhatsApp<input type="tel" value={phone} disabled={disabled} required onChange={e=>setPhone(e.target.value)} placeholder="0991234567 o +593991234567" autoComplete="off"/></label>
        <button className={styles.primary} disabled={disabled||!phone.trim()} type="submit">Añadir número</button>
      </form>
      <button disabled={busy} onClick={()=>void perform(async()=>{
        if(applyResult(await loadTestResponseAction()))setConfirmation(null)
      })}>Actualizar lista</button>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div role="status" aria-live="polite">{notice&&<p className={local.notice}>{notice}</p>}</div>
      <div className={local.list}>
        {!state.contacts.length&&!needsRefresh&&<p className={local.empty}>Todavía no hay números de prueba. Añada el primero arriba.</p>}
        {state.contacts.map(contact=>{const controls=testContactControls(contact);const helpId=`test-contact-help-${contact.id}`;return <article className={local.contact} key={contact.id}>
          <div className={local.heading}><div><h3>{contact.label||'Contacto de prueba'}</h3><span className={local.phone}>+{contact.phone}</span></div><span className={local.badge}>{controls.label}</span></div>
          <label className={local.switch}><input type="checkbox" role="switch" checked={contact.fastResponse} disabled={disabled} onChange={e=>void update(contact,e.target.checked?'fast_on':'fast_off')}/>Respuesta rápida</label>
          <p>{contact.fastResponse?'Sin espera de agrupación: cada mensaje puede iniciar una respuesta por separado.':`Espera de ${NORMAL_RESPONSE_SECONDS} segundos para agrupar mensajes consecutivos.`} La generación y una respuesta que ya esté en curso pueden añadir tiempo.</p>
          {contact.lastResetAt&&<p>Último reinicio confirmado: <time dateTime={contact.lastResetAt}>{new Date(contact.lastResetAt).toLocaleString('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'short'})}</time> (hora de Ecuador).</p>}
          {controls.explanation&&<p id={helpId}>{controls.explanation}</p>}
          <div className={styles.actions}>
            <button disabled={disabled||!controls.canReset} aria-describedby={controls.resetDisabledReason?helpId:undefined} title={controls.resetDisabledReason||undefined} onClick={()=>setConfirmation({id:contact.id,action:'reset'})}>Reiniciar prueba</button>
            {contact.leadId&&<button disabled={disabled||!controls.canResume} aria-describedby={controls.resumeDisabledReason?helpId:undefined} title={controls.resumeDisabledReason||undefined} onClick={()=>void update(contact,'resume')}>Reanudar bot</button>}
            <button className={local.danger} disabled={disabled} onClick={()=>setConfirmation({id:contact.id,action:'remove'})}>Eliminar de pruebas</button>
          </div>
          {confirmation?.id===contact.id&&<div className={local.confirm}>
            <p>{confirmation.action==='reset'?`¿Reiniciar la prueba de +${contact.phone}? Se guardará un respaldo y se limpiarán su conversación, preferencias, datos recogidos y citas de prueba para empezar desde cero. El historial de WhatsApp y Kommo se conserva.`:`¿Quitar +${contact.phone} de la lista? Se restaurarán sus tiempos habituales. Su lead y conversación se conservan; si la automatización está limitada a pruebas, dejará de responderle.`}</p>
            <div className={styles.actions}><button className={styles.primary} disabled={disabled} onClick={()=>void update(contact,confirmation.action)}>{confirmation.action==='reset'?'Confirmar reinicio':'Confirmar eliminación'}</button><button disabled={busy} onClick={()=>setConfirmation(null)}>Cancelar</button></div>
          </div>}
        </article>})}
      </div>
    </section>
  </div>
}

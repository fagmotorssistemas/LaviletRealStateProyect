'use client'
import { useState } from 'react'
import { saveTestResponseAction } from '@/app/inmobiliaria/automatizacion/pruebas/actions'
import { TEST_RESPONSE_PHONE, TEST_RESPONSE_SECONDS, type TestResponseState } from '@/lib/inmobiliaria/testResponseMode'
import { AutomationSettingsHeader, automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ConversationToneSettings.module.css'
export function TestResponseSettings({initial}:{initial:TestResponseState}) {
  const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(enabled:boolean){setBusy(true);setError('');try{setState(await saveTestResponseAction(enabled,state.version))}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar')}finally{setBusy(false)}}
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="pruebas" title="Modo de pruebas" description="Acelere las respuestas de un contacto y restaure los tiempos habituales al terminar." project={<span>La Vilet</span>}/>
    <section className={styles.card}>
      <h2>Pruebas con {TEST_RESPONSE_PHONE}</h2>
      <p role="status">{state.enabled?'Modo de pruebas activo':'Tiempos habituales activos'}</p>
      <p>Al activarlo, el bot espera {TEST_RESPONSE_SECONDS} segundos para agrupar mensajes y solicita su procesamiento sin esperar al siguiente ciclo del minuto. La generación de la respuesta y una tarea que ya esté en curso pueden añadir tiempo.</p>
      <p>Solo afecta a este contacto. Conserva el tono, las pausas, las reglas comerciales y la verificación de citas. Las respuestas y acciones siguen siendo reales.</p>
      {!state.botEnabled&&<p>Este lead tiene el bot pausado. El modo de pruebas no lo reactiva.</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={busy||state.enabled} onClick={()=>void save(true)}>Activar modo de pruebas</button><button disabled={busy||!state.enabled} onClick={()=>void save(false)}>Restaurar tiempos habituales</button></div>
      <p>Al restaurar, se vuelve a la espera habitual de agrupación y al procesamiento programado. Una respuesta que ya esté en curso terminará normalmente.</p>
      {error&&<p role="alert">{error}</p>}
    </section>
  </div>
}

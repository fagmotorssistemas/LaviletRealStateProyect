'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { TONE_LABELS, TONE_STYLES, type ToneSettings, type ToneState } from '@/lib/inmobiliaria/conversationTone'
import { previewToneAction, restoreToneAction, saveToneAction } from '@/app/inmobiliaria/automatizacion/estilo/actions'
import { AutomationSettingsHeader, automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ConversationToneSettings.module.css'

export function ConversationToneSettings({projectId,projectName,initial}:{projectId:string;projectName:string;initial:ToneState}) {
  const [saved,setSaved]=useState(initial),[draft,setDraft]=useState(initial.current)
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[scenario,setScenario]=useState('opciones')
  const [preview,setPreview]=useState<{question:string;reply:string;settings:string}|null>(null)
  const dirty=JSON.stringify(saved.current)!==JSON.stringify(draft)
  const previewStale=preview&&preview.settings!==JSON.stringify({draft,scenario})
  const update=(value:Partial<ToneSettings>)=>setDraft(current=>({...current,...value}))
  const run=async(kind:string)=>{
    setBusy(kind);setError('')
    try {
      if(kind==='preview') {
        const value=await previewToneAction(projectId,draft,scenario)
        setPreview({...value,settings:JSON.stringify({draft,scenario})})
      } else {
        const value=kind==='save'?await saveToneAction(projectId,draft,saved.version):await restoreToneAction(projectId,saved.version,kind==='original')
        setSaved(value);setDraft(value.current);toast.success('Estilo guardado. Se aplicará en las próximas respuestas generadas.')
      }
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo completar la operación')}
    finally{setBusy('')}
  }
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="estilo" title="Estilo de conversación" description="Una misma voz en cada conversación. Pruebe los ajustes antes de aplicarlos." project={<span>{projectName}</span>} />
    <div className={styles.status} aria-live="polite"><strong>Activo: {TONE_LABELS[saved.current.style]}</strong><span>Calidez: {['Discreta','Moderada','Cálida'][saved.current.warmth]} · Detalle: {['Breve','Habitual','Explicativo'][saved.current.detail]}</span><span>{dirty?'Tiene cambios sin guardar':saved.version?`Versión ${saved.version}`:'Configuración original'}</span></div>
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="tone-controls">
        <h2 id="tone-controls">Personalidad del bot</h2><p>El estilo actual se conserva hasta que guarde un cambio.</p>
        <fieldset disabled={!!busy}><legend>Estilo principal</legend><div className={styles.options}>{TONE_STYLES.map(style=><label key={style} data-selected={draft.style===style}><input type="radio" name="tone-style" value={style} checked={draft.style===style} onChange={()=>update({style})}/>{TONE_LABELS[style]}</label>)}</div>
          <label className={styles.slider} htmlFor="tone-warmth">Calidez <strong>{['Discreta','Moderada','Cálida'][draft.warmth]}</strong></label><input id="tone-warmth" aria-valuetext={['Discreta','Moderada','Cálida'][draft.warmth]} type="range" min="0" max="2" step="1" value={draft.warmth} onChange={e=>update({warmth:Number(e.target.value)})}/><div className={styles.ends}><span>Más reservado</span><span>Más cálido</span></div>
          <label className={styles.slider} htmlFor="tone-detail">Nivel de detalle <strong>{['Breve','Habitual','Explicativo'][draft.detail]}</strong></label><input id="tone-detail" aria-valuetext={['Breve','Habitual','Explicativo'][draft.detail]} type="range" min="0" max="2" step="1" value={draft.detail} onChange={e=>update({detail:Number(e.target.value)})}/><div className={styles.ends}><span>Más breve</span><span>Más explicativo</span></div>
        </fieldset>
        <p className={styles.note}>El tono cambia la redacción, no los precios, las condiciones ni las reglas de atención. Las plantillas aprobadas y los mensajes fijos conservan su texto.</p>
        <div className={styles.actions}><button className={styles.primary} disabled={!!busy||!dirty} onClick={()=>void run('save')}>{busy==='save'?'Guardando…':'Guardar y aplicar'}</button><button disabled={!!busy||!dirty} onClick={()=>setDraft(saved.current)}>Descartar cambios</button></div>
        <div className={styles.actions}><button disabled={!!busy||!saved.previous} onClick={()=>void run('previous')}>Restaurar versión anterior</button><button disabled={!!busy||saved.version===0} onClick={()=>void run('original')}>Restaurar estilo original</button></div>
      </section>
      <section className={styles.card} aria-labelledby="tone-preview"><h2 id="tone-preview">Pruebe cómo sonaría</h2><p>Ejemplos independientes del historial de sus leads. No se envía ningún mensaje.</p>
        <label htmlFor="tone-scenario">Consulta de ejemplo</label><select id="tone-scenario" value={scenario} disabled={!!busy} onChange={e=>setScenario(e.target.value)}><option value="opciones">Opciones de vivienda</option><option value="financiamiento">Duda sobre financiamiento</option><option value="visita">Coordinar una visita</option></select>
        <button className={styles.previewButton} disabled={!!busy} onClick={()=>void run('preview')}>{busy==='preview'?'Generando ejemplo…':'Generar vista previa'}</button>
        <div className={styles.chat} aria-live="polite">{preview?<><div className={styles.client}>{preview.question}</div><div className={styles.bot}>{preview.reply}</div>{previewStale&&<p>Los ajustes cambiaron. Genere otra vista previa para compararlos.</p>}</>:<p>Seleccione un ejemplo para ver una respuesta con estos ajustes.</p>}</div>
        <p className={styles.note}>La vista previa usa IA y puede variar entre pruebas. Generarla no guarda los ajustes.</p>
      </section>
    </div>{error&&<p className={styles.error} role="alert">{error}</p>}
  </div>
}

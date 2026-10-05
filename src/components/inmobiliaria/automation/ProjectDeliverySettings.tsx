'use client'
import { useState } from 'react'
import { saveProjectDelivery } from '@/app/inmobiliaria/automatizacion/proyecto/actions'
import { DELIVERY_TIMINGS, deliveryContext, validateProjectDelivery, type ProjectDelivery } from '@/lib/inmobiliaria/projectDelivery'
import styles from './ProjectReadinessSettings.module.css'

type Settings = { configured: boolean; value: ProjectDelivery; error?: string }
type Props = { projectId: string; initial: Settings; updatedAt: string; busy: boolean; onBusy: (busy: boolean) => void;
  onSaved: (delivery: Settings, updatedAt: string) => void }
export function ProjectDeliverySettings({projectId,initial,updatedAt,busy,onBusy,onSaved}:Props) {
  const [draft,setDraft]=useState(initial.value),[notice,setNotice]=useState('')
  const update=(value:Partial<ProjectDelivery>)=>{setDraft(previous=>({...previous,...value}));setNotice('')}
  const dirty=JSON.stringify(initial.value)!==JSON.stringify(draft)||!initial.configured
  let preview=''
  try { preview=deliveryContext({project_delivery:{current:validateProjectDelivery(draft)}}).statement }
  catch(e) { preview=e instanceof Error?e.message:'Complete los datos para ver la vista previa.' }
  async function save() {
    onBusy(true);setNotice('')
    try {
      const result=await saveProjectDelivery(projectId,draft,updatedAt)
      if(!result.ok){setNotice(result.error);return}
      setDraft(result.delivery.value);onSaved(result.delivery,result.updatedAt)
      setNotice('Plazo guardado. Se aplicará a las próximas respuestas de todos los leads autorizados para recibirlas.')
    } catch {setNotice('No se pudo completar el guardado. Compruebe la conexión e intente nuevamente.')}
    finally {onBusy(false)}
  }
  return <section id="project-delivery" aria-labelledby="project-delivery-title">
    <fieldset disabled={busy} className={styles.card}>
      <legend id="project-delivery-title">Plazo de entrega</legend>
      <p>Configure lo que el bot puede comunicar a cualquier lead del proyecto. Esto no cambia el modo de pruebas ni el avance físico de la obra.</p>
      {initial.error&&<p role="alert">{initial.error}</p>}
      <label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={e=>update({enabled:e.target.checked})}/>Comunicar el plazo configurado</label>
      <p>Al desactivarlo se conservan los datos, pero el bot no utiliza esa fecha ni ese plazo.</p>
      <fieldset disabled={!draft.enabled} className={styles.deliveryFields}>
        <label>Información disponible<select value={draft.timing} onChange={e=>update({timing:e.target.value as ProjectDelivery['timing']})}>
          {Object.entries(DELIVERY_TIMINGS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        {draft.timing!=='unknown'&&<>
          <label>Grado de certeza<select value={draft.certainty} onChange={e=>update({certainty:e.target.value as ProjectDelivery['certainty']})}>
            <option value="estimated">Estimado: puede cambiar</option><option value="confirmed">Confirmado por el proyecto</option>
          </select></label>
          {draft.timing==='date'&&<label>Fecha de entrega<input type="date" value={draft.date} onChange={e=>update({date:e.target.value})}/></label>}
          {['month','year'].includes(draft.timing)&&<label>Año de entrega<input type="number" min={1900} max={2200} step={1} value={draft.year??''} onChange={e=>update({year:e.target.value?Number(e.target.value):null})}/></label>}
          {draft.timing==='month'&&<label>Mes de entrega<select value={draft.month??''} onChange={e=>update({month:e.target.value?Number(e.target.value):null})}>
            <option value="">Seleccione un mes</option>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Intl.DateTimeFormat('es',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,i,1)))}</option>)}
          </select></label>}
          {draft.timing==='duration'&&<>
            <label>Plazo en meses<input type="number" min={1} max={600} step={1} value={draft.months??''} onChange={e=>update({months:e.target.value?Number(e.target.value):null})}/></label>
            <label>El plazo se cuenta desde<select value={draft.reference} onChange={e=>update({reference:e.target.value as ProjectDelivery['reference'],referenceDate:''})}>
              <option value="date">Una fecha de referencia fija</option><option value="construction_start">El inicio de obra</option>
            </select></label>
            <label>{draft.reference==='date'?'Fecha de referencia':'Fecha de inicio de obra, si está confirmada'}<input type="date" value={draft.referenceDate} onChange={e=>update({referenceDate:e.target.value})}/></label>
            <p>{draft.reference==='date'?'El mes y año de entrega se calculan desde esta fecha. No se recalculan desde el día de cada consulta.':'Si aún no conoce la fecha de inicio, déjela vacía. El bot comunicará los meses desde el inicio de obra, sin inventar un mes o año de entrega.'}</p>
          </>}
          <label>Condiciones que el bot puede comunicar<textarea rows={2} maxLength={700} value={draft.conditions} onChange={e=>update({conditions:e.target.value})} placeholder="Solo condiciones autorizadas, si existen."/></label>
          <label>Fuente o responsable que confirmó el plazo<input maxLength={600} value={draft.source} onChange={e=>update({source:e.target.value})}/></label>
        </>}
      </fieldset>
      <h3>Vista previa de la información autorizada</h3><p>{preview}</p>
      <p>El bot conserva el carácter estimado o confirmado y no inventa un mes cuando solo se conoce el año. Si el periodo ya pasó, indicará que necesita actualización.</p>
    </fieldset>
    <div className={styles.actions}>
      <button disabled={busy||!dirty} onClick={save}>{busy?'Guardando…':'Guardar plazo de entrega'}</button>
      <button disabled={busy||!dirty} onClick={()=>{setDraft(initial.value);setNotice('')}}>Descartar cambios de entrega</button>
      <p role="status">{notice||(dirty?'Plazo pendiente de guardar':'Plazo guardado')}</p>
    </div>
  </section>
}

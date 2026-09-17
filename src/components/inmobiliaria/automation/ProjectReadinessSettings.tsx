'use client'
import { useState } from 'react'
import Link from 'next/link'
import { BUILD_STAGES,VISIT_PLACES,readinessInvitation,type ProjectReadiness,type VisitPlace } from '@/lib/inmobiliaria/projectReadiness'
import { saveProjectReadiness } from '@/app/inmobiliaria/automatizacion/proyecto/actions'
import { AutomationSettingsHeader,automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ProjectReadinessSettings.module.css'
type Initial={projectName:string;mode:string;pricesVisible:boolean;updatedAt:string;configured:boolean;value:ProjectReadiness}
export function ProjectReadinessSettings({projectId,initial}:{projectId:string;initial:Initial}) {
  const [saved,setSaved]=useState(initial),[draft,setDraft]=useState(initial.value),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const update=(value:Partial<ProjectReadiness>)=>setDraft(p=>({...p,...value}))
  const dirty=JSON.stringify(saved.value)!==JSON.stringify(draft)||!saved.configured
  async function save(){setBusy(true);setNotice('');try{const result=await saveProjectReadiness(projectId,draft,saved.updatedAt);setSaved({...saved,...result});setDraft(result.value);setNotice('Guardado. Se aplicará a las próximas respuestas.')}catch(e){setNotice(e instanceof Error?e.message:'No se pudo guardar')}finally{setBusy(false)}}
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="proyecto" title="Estado del proyecto y visitas" description="El avance de obra, los permisos de visita y los materiales son independientes de la etapa comercial y el tono." project={initial.projectName}/>
    <div className={styles.grid}>
      <section className={styles.card}><h2>Configuraciones independientes</h2><p>Etapa comercial actual: <strong>{initial.mode}</strong>.</p><p>Lanzamiento presenta el proyecto; preventa comercializa unidades antes de su entrega. Ninguna determina por sí sola el avance de obra.</p><p>Precios en lanzamiento: <strong>{initial.pricesVisible?'permitidos como referenciales':'ocultos'}</strong>. Guardar esta página no cambia ese permiso.</p><Link href="/inmobiliaria/automatizacion/precios">Administrar precios</Link> · <Link href="/inmobiliaria/automatizacion/reglas">Etapa comercial y reglas</Link> · <Link href="/inmobiliaria/automatizacion/estilo">Personalidad</Link></section>
      <section className={styles.card}><h2>Qué puede ofrecer el bot</h2><p>{readinessInvitation(draft)||'No hay un lugar habilitado para proponer visitas.'}</p><p>Esta vista previa describe los lugares autorizados. El permiso existente para sugerir visitas sigue aplicando; una visita siempre requiere coordinar y confirmar disponibilidad.</p>{!saved.configured&&<p role="status">Aún se utiliza la configuración anterior. Verifique los datos y guarde para separar el estado de obra de la etapa comercial.</p>}<p>Última verificación: {saved.value.verifiedOn}. Revise periódicamente si sigue vigente.</p></section>
    </div>
    <fieldset disabled={busy} className={styles.card}><legend>Estado físico y avance verificado</legend>
      <label>Estado de obra<select value={draft.stage} onChange={e=>update({stage:e.target.value as ProjectReadiness['stage']})}>{Object.entries(BUILD_STAGES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Fecha de verificación<input type="date" value={draft.verifiedOn} onChange={e=>update({verifiedOn:e.target.value})}/></label>
      <label>Avance que el bot puede comunicar<textarea value={draft.progress} maxLength={1500} rows={3} placeholder="Describa únicamente avances comprobados, por ejemplo: estructura del segundo piso terminada." onChange={e=>update({progress:e.target.value})}/></label>
      <p>El bot no deducirá avances por el tiempo transcurrido. No incluya información de clientes.</p>
    </fieldset>
    <fieldset disabled={busy} className={styles.card}><legend>Lugares habilitados para visitas</legend><p>La obra puede estar en construcción sin permitir visitas. Habilite solo accesos autorizados.</p>
      {Object.entries(VISIT_PLACES).map(([place,label])=><label key={place} className={styles.check}><input type="checkbox" checked={draft.enabledPlaces.includes(place as VisitPlace)} onChange={e=>{const places=e.target.checked?[...draft.enabledPlaces,place as VisitPlace]:draft.enabledPlaces.filter(p=>p!==place);update({enabledPlaces:places,primaryPlace:places.includes(draft.primaryPlace as VisitPlace)?draft.primaryPlace:places[0]||'none'})}}/>{label}</label>)}
      <label>Lugar principal<select value={draft.primaryPlace} onChange={e=>update({primaryPlace:e.target.value as VisitPlace|'none'})}>{!draft.enabledPlaces.length&&<option value="none">Sin visitas habilitadas</option>}{draft.enabledPlaces.map(p=><option key={p} value={p}>{VISIT_PLACES[p]}</option>)}</select></label>
      <label>Condiciones de acceso<textarea rows={2} maxLength={700} value={draft.conditions} onChange={e=>update({conditions:e.target.value})} placeholder="Con cita previa y acompañamiento del asesor. Indique las restricciones reales."/></label>
    </fieldset>
    <fieldset disabled={busy} className={styles.card}><legend>Materiales autorizados</legend><p>Registre enlaces públicos que ya funcionen. El bot compartirá solo los marcados como autorizados, identificando su tipo y fecha. Esta sección no sube archivos.</p>
      {draft.materials.map((m,i)=><div className={styles.material} key={i}>{(['title','url','date'] as const).map(key=><label key={key}>{({title:'Título',url:'Enlace público HTTPS',date:'Fecha del material'})[key]}<input type={key==='date'?'date':key==='url'?'url':'text'} value={m[key]} onChange={e=>update({materials:draft.materials.map((x,j)=>j===i?{...x,[key]:e.target.value}:x)})}/></label>)}<label>Tipo<select value={m.kind} onChange={e=>update({materials:draft.materials.map((x,j)=>j===i?{...x,kind:e.target.value as typeof m.kind}:x)})}><option value="progress">Foto o video de avance real</option><option value="render">Render / representación</option><option value="plan">Plano</option><option value="tour">Recorrido virtual</option></select></label><label className={styles.check}><input type="checkbox" checked={m.approved} onChange={e=>update({materials:draft.materials.map((x,j)=>j===i?{...x,approved:e.target.checked}:x)})}/>Autorizado para compartir con leads</label><button type="button" onClick={()=>update({materials:draft.materials.filter((_,j)=>j!==i)})}>Quitar material {i+1}</button></div>)}
      <button type="button" disabled={draft.materials.length>=12} onClick={()=>update({materials:[...draft.materials,{title:'',url:'',date:draft.verifiedOn,kind:'progress',approved:false}]})}>Agregar material</button>
    </fieldset>
    <div className={styles.actions}><button disabled={busy||!dirty} onClick={save}>{busy?'Guardando…':'Guardar y aplicar'}</button><button disabled={busy} onClick={()=>{setDraft(saved.value);setNotice('')}}>Descartar cambios</button><p role="status">{notice|| (dirty?'Tiene cambios sin guardar':'Configuración guardada')}</p></div>
  </div>
}

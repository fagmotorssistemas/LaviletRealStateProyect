'use client'
import { useState } from 'react'
import { SettingsFieldHelp } from './SettingsHelp'
import Link from 'next/link'
import { BUILD_STAGES,VISIT_PLACES,readinessInvitation,type ProjectReadiness,type VisitPlace } from '@/lib/inmobiliaria/projectReadiness'
import { saveProjectReadiness } from '@/app/inmobiliaria/automatizacion/proyecto/actions'
import { AutomationSettingsHeader,automationSettingsStyles as shared } from './AutomationSettings'
import styles from './ProjectReadinessSettings.module.css'
import { ProjectDeliverySettings } from './ProjectDeliverySettings'
import type { projectDeliverySettings } from '@/lib/inmobiliaria/projectDelivery'
import { ProjectIntroductionSettings } from './ProjectIntroductionSettings'
import type { projectIntroductionSettings } from '@/lib/inmobiliaria/projectIntroduction'
type Initial={projectName:string;mode:string;pricesVisible:boolean;updatedAt:string;configured:boolean;value:ProjectReadiness;delivery:ReturnType<typeof projectDeliverySettings>;introduction:ReturnType<typeof projectIntroductionSettings>}
export function ProjectReadinessSettings({projectId,initial}:{projectId:string;initial:Initial}) {
  const [saved,setSaved]=useState(initial),[draft,setDraft]=useState(initial.value),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const update=(value:Partial<ProjectReadiness>)=>setDraft(p=>({...p,...value}))
  const dirty=JSON.stringify(saved.value)!==JSON.stringify(draft)||!saved.configured
  async function save(){setBusy(true);setNotice('');try{const result=await saveProjectReadiness(projectId,draft,saved.updatedAt);if(!result.ok){setNotice(result.error);return}setSaved(previous=>({...previous,...result}));setDraft(result.value);setNotice('Guardado. Se aplicará a las próximas respuestas.')}catch{setNotice('No se pudo completar el guardado. Compruebe la conexión y vuelva a intentarlo.')}finally{setBusy(false)}}
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="proyecto" title="Información del proyecto" description="Configure la presentación inicial, el avance de obra, el plazo de entrega y los lugares habilitados para visitas." project={initial.projectName}/>
    <div className={styles.grid}>
      <section className={styles.card}><h2>Configuraciones independientes</h2><p>Etapa comercial actual: <strong>{initial.mode}</strong>.</p><p>Lanzamiento presenta el proyecto; preventa comercializa unidades antes de su entrega. Ninguna determina por sí sola el avance de obra.</p><p>Precios en lanzamiento: <strong>{initial.pricesVisible?'permitidos como referenciales':'ocultos'}</strong>. Guardar esta página no cambia ese permiso.</p><Link href="/inmobiliaria/automatizacion/precios">Administrar precios</Link> · <Link href="/inmobiliaria/automatizacion/reglas">Etapa comercial y reglas</Link> · <Link href="/inmobiliaria/automatizacion/estilo">Personalidad</Link></section>
      <section className={styles.card}><h2>Qué puede ofrecer el bot</h2><p>{readinessInvitation(draft)||'No hay un lugar habilitado para proponer visitas.'}</p><p>Esta vista previa describe los lugares autorizados. El permiso existente para sugerir visitas sigue aplicando; una visita siempre requiere coordinar y confirmar disponibilidad.</p>{!saved.configured&&<p role="status">Aún se utiliza la configuración anterior. Verifique los datos y guarde para separar el estado de obra de la etapa comercial.</p>}<p>{saved.configured ? `Última verificación: ${saved.value.verifiedOn}. Revise periódicamente si sigue vigente.` : 'Pendiente de verificación.'}</p></section>
    </div>
    <ProjectIntroductionSettings projectId={projectId} projectName={initial.projectName} initial={saved.introduction} updatedAt={saved.updatedAt} busy={busy} onBusy={setBusy} onSaved={(introduction,updatedAt)=>setSaved(previous=>({...previous,introduction,updatedAt}))}/>
    <fieldset disabled={busy} className={styles.card}><legend>Estado físico y avance verificado</legend>
      <label><span>Estado de obra<SettingsFieldHelp title="Estado de obra" section="proyecto" /></span><select value={draft.stage} onChange={e=>update({stage:e.target.value as ProjectReadiness['stage']})}>{Object.entries(BUILD_STAGES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Fecha de verificación<SettingsFieldHelp title="Fecha de verificación" section="proyecto" /></span><input type="date" value={draft.verifiedOn} onChange={e=>update({verifiedOn:e.target.value})}/></label>
      <label><span>Avance que el bot puede comunicar<SettingsFieldHelp title="Avance que el bot puede comunicar" section="proyecto" /></span><textarea value={draft.progress} maxLength={1500} rows={3} placeholder="Describa únicamente avances comprobados, por ejemplo: estructura del segundo piso terminada." onChange={e=>update({progress:e.target.value})}/></label>
      <p>El bot no deducirá avances por el tiempo transcurrido. No incluya información de clientes.</p>
    </fieldset>
    <fieldset disabled={busy} className={styles.card}><legend>Lugares habilitados para visitas</legend><p>La obra puede estar en construcción sin permitir visitas. Habilite solo accesos autorizados.</p>
      {Object.entries(VISIT_PLACES).map(([place,label])=><label key={place} className={styles.check}><input type="checkbox" checked={draft.enabledPlaces.includes(place as VisitPlace)} onChange={e=>{const places=e.target.checked?[...draft.enabledPlaces,place as VisitPlace]:draft.enabledPlaces.filter(p=>p!==place);update({enabledPlaces:places,primaryPlace:places.includes(draft.primaryPlace as VisitPlace)?draft.primaryPlace:places[0]||'none'})}}/>{label}<SettingsFieldHelp title={label} section="proyecto" /></label>)}
      <label><span>Lugar principal<SettingsFieldHelp title="Lugar principal" section="proyecto" /></span><select value={draft.primaryPlace} onChange={e=>update({primaryPlace:e.target.value as VisitPlace|'none'})}>{!draft.enabledPlaces.length&&<option value="none">Sin visitas habilitadas</option>}{draft.enabledPlaces.map(p=><option key={p} value={p}>{VISIT_PLACES[p]}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={draft.officeAtProjectSite===true} onChange={e=>update({officeAtProjectSite:e.target.checked})}/>La oficina está en el mismo sitio del proyecto<SettingsFieldHelp title="La oficina está en el mismo sitio del proyecto" section="proyecto" /></label>
      <p>Permite explicar dónde está la oficina. No autoriza acceso a la obra, a departamentos modelo ni a unidades terminadas.</p>
      <label><span>Condiciones de acceso<SettingsFieldHelp title="Condiciones de acceso" section="proyecto" /></span><textarea rows={2} maxLength={700} value={draft.conditions} onChange={e=>update({conditions:e.target.value})} placeholder="Con cita previa y acompañamiento del asesor. Indique las restricciones reales."/></label>
    </fieldset>
    <div className={styles.actions}><button disabled={busy||!dirty} onClick={save}>{busy?'Guardando…':'Guardar y aplicar'}</button><button disabled={busy} onClick={()=>{setDraft(saved.value);setNotice('')}}>Descartar cambios</button><p role="status">{notice|| (dirty?'Tiene cambios sin guardar':'Configuración guardada')}</p></div>
    <ProjectDeliverySettings projectId={projectId} initial={saved.delivery} updatedAt={saved.updatedAt} busy={busy} onBusy={setBusy} onSaved={(delivery,updatedAt)=>setSaved(previous=>({...previous,delivery,updatedAt}))}/>
  </div>
}

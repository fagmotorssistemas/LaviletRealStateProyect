'use client'

import { useState } from 'react'
import { SettingsFieldHelp, SettingsHelp } from './SettingsHelp'
import { automationHelpFor } from '@/lib/inmobiliaria/automationHelp'
import { saveProjectIntroduction } from '@/app/inmobiliaria/automatizacion/proyecto/actions'
import { approvedProjectIntroduction, type ProjectIntroduction } from '@/lib/inmobiliaria/projectIntroduction'
import styles from './ProjectReadinessSettings.module.css'

type Settings = { configured: boolean; value: ProjectIntroduction; defaulted?: boolean; error?: string }
type Props = { projectId: string; projectName?: string; initial: Settings; updatedAt: string; busy: boolean; onBusy: (busy: boolean) => void;
  onSaved: (introduction: Settings, updatedAt: string) => void }

export function ProjectIntroductionSettings({ projectId, projectName = '', initial, updatedAt, busy, onBusy, onSaved }: Props) {
  const [draft, setDraft] = useState(initial.value), [notice, setNotice] = useState('')
  const approved = approvedProjectIntroduction(projectName)
  const changed = JSON.stringify(initial.value) !== JSON.stringify(draft)
  const dirty = changed || !initial.configured
  const update = (value: Partial<ProjectIntroduction>) => { setDraft(previous => ({ ...previous, ...value })); setNotice('') }
  async function save() {
    onBusy(true); setNotice('')
    try {
      const result = await saveProjectIntroduction(projectId, draft, updatedAt)
      if (!result.ok) { setNotice(result.error); return }
      setDraft(result.introduction.value); onSaved(result.introduction, result.updatedAt)
      setNotice('Presentación guardada. Se aplicará a las próximas consultas generales del proyecto.')
    } catch { setNotice('No se pudo completar el guardado. Compruebe la conexión e intente nuevamente.') }
    finally { onBusy(false) }
  }
  return <section id="project-introduction" aria-labelledby="project-introduction-title">
    <fieldset disabled={busy} className={styles.card}>
      <legend id="project-introduction-title">Presentación inicial del proyecto<SettingsHelp title="Presentación inicial del proyecto" {...automationHelpFor('presentacion')} /></legend>
      <p>Guarde un resumen breve con información autorizada. El bot lo utiliza cuando un lead pide información general, adaptándolo a la conversación.</p>
      <p>Un saludo, una consulta de precios o una pregunta concreta se atienden según lo que solicita el lead. El resumen conserva las preguntas de nombre y residencia, el brochure y el siguiente paso que corresponda.</p>
      {initial.defaulted && <p>El bot utiliza el resumen aprobado de La Vilet mientras no guarde una presentación propia. Puede editarlo y guardar los cambios.</p>}
      {initial.error && <p role="alert">{initial.error}</p>}
      <label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />Utilizar la presentación configurada<SettingsFieldHelp title="Utilizar la presentación configurada" section="presentacion" /></label>
      <p>Al desactivarla se conserva el texto. El bot sigue respondiendo con los demás datos publicados del proyecto.</p>
      <label><span>Resumen autorizado del proyecto<SettingsFieldHelp title="Resumen autorizado del proyecto" section="presentacion" /></span><textarea rows={4} maxLength={1200} value={draft.summary} onChange={event => update({ summary: event.target.value })} placeholder="Describa el proyecto, sus opciones y los aspectos confirmados que quiera presentar brevemente." /></label>
      <p>Incluya datos del negocio, sin instrucciones para el bot, preguntas de cierre ni información de clientes. Las fechas, precios y condiciones se administran en sus secciones y se comunican cuando la consulta lo requiere.</p>
      <label><span>Fuente o responsable del resumen<SettingsFieldHelp title="Fuente o responsable del resumen" section="presentacion" /></span><input maxLength={600} value={draft.source} onChange={event => update({ source: event.target.value })} /></label>
    </fieldset>
    <div className={styles.actions}>
      {approved && <button disabled={busy} onClick={() => update(approved)}>Usar resumen aprobado de La Vilet</button>}
      <button disabled={busy || !dirty} onClick={save}>{busy ? 'Guardando…' : 'Guardar presentación'}</button>
      <button disabled={busy || !dirty} onClick={() => { setDraft(initial.value); setNotice('') }}>Descartar cambios de presentación</button>
      <p role="status">{notice || (initial.defaulted && !changed ? 'Resumen aprobado de La Vilet activo' : dirty ? 'Presentación pendiente de guardar' : 'Presentación guardada')}</p>
    </div>
  </section>
}

'use client'

import { useState } from 'react'
import { AREA_FACT_AUDIENCES, AREA_FACT_CATEGORIES, AREA_FACT_MODES, emptyAreaFact, type AreaFactDraft, type ProjectAreaFact } from '@/lib/inmobiliaria/projectAreaFacts'
import { saveProjectAreaFact } from '@/app/inmobiliaria/automatizacion/conocimiento/area-fact-actions'
import { automationHelpFor } from '@/lib/inmobiliaria/automationHelp'
import { SettingsHelp } from './SettingsHelp'
import styles from './KnowledgeCenter.module.css'

const saving = 'Guardar borrador conserva la ficha publicada. Publicar reemplaza el contenido vigente y autoriza su uso en futuras respuestas. Pausar retira la ficha de esas respuestas.'
const help = (title: string, configures: string, usedByBot: string, example?: string) => <SettingsHelp title={title} configures={configures} usedByBot={usedByBot} applies="A la ficha del entorno del proyecto y a las consultas compatibles con sus destinatarios y etapa." saving={saving} example={example} />
export function ProjectAreaFactsSettings({ projectId, initial, loadError }: { projectId: string; initial: ProjectAreaFact[]; loadError: string }) {
  const [facts, setFacts] = useState(initial), [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<AreaFactDraft>(emptyAreaFact()), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const existing = facts.find(fact => fact.id === editing)
  const update = (value: Partial<AreaFactDraft>) => { setDraft(old => ({ ...old, ...value })); setConfirmed(false) }
  const open = (fact?: ProjectAreaFact) => { setEditing(fact?.id || crypto.randomUUID()); setDraft(fact?.draft || emptyAreaFact()); setConfirmed(false); setError(''); setNotice('') }
  const run = async (action: 'draft' | 'publish' | 'pause') => {
    if (!editing) return
    setBusy(true); setError(''); setNotice('')
    try {
      const saved = await saveProjectAreaFact(projectId, { action, id: editing, value: draft, expectedUpdatedAt: existing?.updatedAt || null, confirmed })
      setFacts(old => old.some(fact => fact.id === saved.id) ? old.map(fact => fact.id === saved.id ? saved : fact) : [...old, saved])
      setDraft(saved.draft); setConfirmed(false)
      setNotice(action === 'publish' ? 'Ficha publicada y aprobada para las próximas respuestas a las que aplique.' : action === 'pause' ? 'Publicación pausada. El bot dejará de recibir esta ficha en nuevas ejecuciones.' : 'Borrador guardado. El bot conserva la información ya publicada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la ficha.') }
    finally { setBusy(false) }
  }
  return <section id="entorno" className={styles.areaSection} aria-labelledby="area-facts-title">
    <div className={styles.toolbar}><h2 id="area-facts-title">Entorno y seguridad del sector<SettingsHelp title="Entorno y seguridad del sector" {...automationHelpFor('entorno')} /></h2>
      <button type="button" disabled={busy || !!editing || !!loadError} onClick={() => open()}>Nueva ficha del entorno</button></div>
    <p className={styles.description}>Aquí se registra lo que se puede comunicar del barrio. Distinga seguridad del sector y del edificio; publique hechos confirmados con sus límites, sin prometer ausencia de riesgos.</p>
    {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
    <div className={styles.grid}>{facts.map(fact => <article key={fact.id} className={styles.card}>
      <span className={styles.badge}>{fact.status === 'published' ? 'Publicada y verificada' : fact.status === 'paused' ? 'Publicación pausada' : 'Borrador'}</span>
      <h3>{fact.published?.headline || fact.draft.headline}</h3><p>{fact.published?.safe_sales_text || fact.draft.safe_sales_text}</p>
      <p>Fuente: {fact.published?.source_name || fact.draft.source_name || 'Pendiente de indicar'}<br />Verificado el: {fact.published?.verified_on || fact.draft.verified_on || 'Pendiente'}</p>
      <div className={styles.buttons}><button type="button" disabled={busy || !!editing && editing !== fact.id} onClick={() => open(fact)}>Ver y editar ficha</button></div>
    </article>)}</div>
    {!loadError && !facts.length && <p className={styles.description}>Todavía no hay fichas. Registrar un borrador no autoriza al bot a utilizarlo.</p>}
    {editing && <div className={styles.editor}>
      <h3>{existing ? 'Editar ficha del entorno' : 'Nueva ficha del entorno'}</h3>
      {existing?.published && <p>La información publicada se conserva hasta que publique el nuevo borrador o pause la publicación.</p>}
      <fieldset className={styles.form} disabled={busy}><legend className="sr-only">Información verificada del entorno</legend>
        <label><span>Título{help('Título del entorno', 'Nombre breve para localizar la ficha.', 'Identifica el hecho disponible; no establece por sí mismo una afirmación de seguridad.')}</span><input maxLength={120} value={draft.headline} onChange={event => update({ headline: event.target.value })} /></label>
        <label><span>Tema{help('Tema del entorno', 'Clasifica la información del sector.', 'Ayuda a escoger hechos pertinentes a la consulta; elegir seguridad no demuestra que la zona sea segura.')}</span><select value={draft.category} onChange={event => update({ category: event.target.value as AreaFactDraft['category'] })}>{Object.entries(AREA_FACT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className={styles.wide}><span>Hecho y límites confirmados{help('Hecho y límites', 'Descripción interna de lo que confirmó la fuente y sus límites.', 'La redacción autorizada debe ser coherente con esta información; no se infieren estadísticas, rentabilidad ni garantías.', 'Describa qué confirmó el responsable sobre el sector y qué aspectos no se han verificado.')}</span><textarea maxLength={1200} value={draft.fact_text} onChange={event => update({ fact_text: event.target.value })} /></label>
        <label className={styles.wide}><span>Redacción autorizada para el cliente{help('Redacción autorizada', 'Texto prudente que el equipo aprueba para comunicar el hecho.', 'El bot puede expresarlo con naturalidad, conservando el significado y sus límites; solo recibe fichas publicadas.', 'Si solo está confirmada la presencia de servicios, describa esos servicios sin deducir un nivel de seguridad.')}</span><textarea maxLength={700} value={draft.safe_sales_text} onChange={event => update({ safe_sales_text: event.target.value })} /></label>
        <label className={styles.wide}><span>Fuente o responsable{help('Fuente o responsable', 'Documento o persona que confirmó la información.', 'Permite al administrador comprobar el respaldo antes de publicarlo. Es obligatorio indicar una fuente o un enlace.', 'Responsable comercial, documento y versión, con la fecha de confirmación.')}</span><input maxLength={600} value={draft.source_name} onChange={event => update({ source_name: event.target.value })} /></label>
        <label><span>Enlace de la fuente (opcional){help('Enlace de la fuente', 'Referencia HTTPS al documento o fuente.', 'Sirve para su revisión; guardar la URL no hace que la plataforma compruebe automáticamente su contenido.')}</span><input type="url" maxLength={1000} value={draft.source_url} onChange={event => update({ source_url: event.target.value })} placeholder="https://…" /></label>
        <label><span>Fecha de verificación{help('Fecha de verificación', 'Día en que el responsable comprobó esta información.', 'Acompaña al hecho publicado y permite identificar información que requiere una nueva revisión.')}</span><input type="date" value={draft.verified_on} onChange={event => update({ verified_on: event.target.value })} /></label>
        <div className={styles.wide}><p>Destinatarios{help('Destinatarios del entorno', 'Intereses para los que resulta pertinente este hecho.', 'Orienta su uso para vivienda, comercio o inversión, sin limitar a qué números responde el bot.')}</p><div className={styles.checks}>{Object.entries(AREA_FACT_AUDIENCES).map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.audiences.includes(value as keyof typeof AREA_FACT_AUDIENCES)} onChange={event => update({ audiences: event.target.checked ? [...draft.audiences, value as keyof typeof AREA_FACT_AUDIENCES] : draft.audiences.filter(item => item !== value) })} />{label}</label>)}</div></div>
        <div className={styles.wide}><p>Etapas comerciales{help('Etapas del entorno', 'Modos comerciales en los que esta ficha sigue siendo válida.', 'Solo incluye el hecho en el contexto si el modo actual del proyecto está seleccionado.')}</p><div className={styles.checks}>{Object.entries(AREA_FACT_MODES).map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.commercial_modes.includes(value as keyof typeof AREA_FACT_MODES)} onChange={event => update({ commercial_modes: event.target.checked ? [...draft.commercial_modes, value as keyof typeof AREA_FACT_MODES] : draft.commercial_modes.filter(item => item !== value) })} />{label}</label>)}</div></div>
        <label className={`${styles.wide} ${styles.confirmation}`}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />He revisado la fuente y autorizo que el bot comunique esta información y sus límites al publicar.</label>
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
      <div className={styles.buttons}><button type="button" disabled={busy} onClick={() => void run('draft')}>Guardar borrador</button>
        <button type="button" className={styles.primary} disabled={busy || !confirmed} onClick={() => void run('publish')}>Publicar ficha verificada</button>
        {existing?.published && <button type="button" disabled={busy} onClick={() => void run('pause')}>Pausar publicación</button>}
        <button type="button" disabled={busy} onClick={() => { setEditing(null); setError(''); setNotice(''); setConfirmed(false) }}>Cerrar editor</button></div>
    </div>}
  </section>
}

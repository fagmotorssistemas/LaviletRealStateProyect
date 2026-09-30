'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AutomationSettingsHeader, automationSettingsStyles as shared } from './AutomationSettings'
import { KnowledgeNavigation } from './KnowledgeNavigation'
import { KNOWLEDGE_SECTIONS } from '@/lib/inmobiliaria/knowledgeSections'
import { POLICY_TOPICS, emptyPolicy, type BusinessPolicyState, type PolicyContent } from '@/lib/inmobiliaria/businessPolicies'
import { saveBusinessPolicy } from '@/app/inmobiliaria/automatizacion/conocimiento/actions'
import styles from './KnowledgeCenter.module.css'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
type Initial = { projectName: string; updatedAt: string; state: BusinessPolicyState }
export function KnowledgeCenter({ projectId, initial, section, policyId }: {
  projectId: string; initial: Initial; section?: string; policyId?: string
}) {
  const [saved, setSaved] = useState(initial)
  const selected = initial.state.items.find(item => item.id === policyId)
  const [editing, setEditing] = useState<string | null>(selected?.id || null)
  const [draft, setDraft] = useState<PolicyContent>(selected?.draft || emptyPolicy())
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const active = KNOWLEDGE_SECTIONS.find(item => item.id === section) || KNOWLEDGE_SECTIONS[0]
  const found = saved.state.items.find(item => item.id === editing)
  const search = normalize(query.trim())
  const matches = (value: unknown) => !search || normalize(JSON.stringify(value)).includes(search)
  const entries = KNOWLEDGE_SECTIONS.filter(item => search || item.id === active.id).flatMap(item => item.entries.map(entry => ({ ...entry, category: item.label }))).filter(matches)
  const policies = saved.state.items.filter(item => matches([item.draft, item.published]))
  const showPolicies = active.id === 'politicas' || !!search
  const update = (value: Partial<PolicyContent>) => setDraft(old => ({ ...old, ...value }))
  const run = async (action: 'draft' | 'publish' | 'pause') => {
    if (!editing) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await saveBusinessPolicy(projectId, { action, id: editing, value: draft }, saved.updatedAt)
      setSaved(old => ({ ...old, ...result }))
      setDraft(result.state.items.find(item => item.id === editing)!.draft)
      setNotice(action === 'publish' ? 'Política publicada. Se utilizará en las próximas ejecuciones a las que aplique.'
        : action === 'pause' ? 'Publicación pausada. La IA dejará de recibir esta política en nuevas ejecuciones.'
          : 'Borrador guardado. La versión publicada se conserva hasta que publique los cambios.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.') }
    finally { setBusy(false) }
  }
  return <div className={shared.shell}>
    <AutomationSettingsHeader active="conocimiento" title="Conocimiento y reglas"
      description="Administre la información, las condiciones comerciales y las reglas que utiliza el asistente."
      project={<span>{saved.projectName}</span>} />
    <KnowledgeNavigation active={active.id} />
    <div className={styles.toolbar}>
      <input type="search" aria-label="Buscar conocimiento y reglas" placeholder="Buscar políticas, precios, preguntas, visitas…" value={query} onChange={e => setQuery(e.target.value)} />
      {showPolicies && <button disabled={busy || !!editing} onClick={() => { setEditing(crypto.randomUUID()); setDraft(emptyPolicy()); setError(''); setNotice('') }}>Nueva política</button>}
    </div>
    <p className={styles.description}>{search ? 'Resultados en todas las categorías.' : active.description}</p>
    <div className={styles.grid}>
      {entries.map(entry => <article className={styles.card} key={entry.href}>
        <span className={styles.badge}>{entry.category}</span><h2>{entry.title}</h2><p>{entry.description}</p>
        <p>Lo aplica: {entry.owner}.</p><Link href={entry.href.startsWith('/') ? entry.href.replace('{projectId}', projectId) : `/inmobiliaria/automatizacion/${entry.href}`}>Abrir configuración →</Link>
      </article>)}
      {showPolicies && policies.map(item => <article className={styles.card} key={item.id}>
        <span className={styles.badge}>{item.published ? item.published.validUntil && item.published.validUntil < new Date().toISOString().slice(0, 10) ? 'Vencida' : `Publicada · versión ${item.published.version}` : 'Borrador · sin publicación activa'}</span>
        <h2>{item.published?.title || item.draft.title}</h2><p>{POLICY_TOPICS[item.draft.topic]}</p>
        <p>{item.published?.scope || item.draft.scope || 'Alcance pendiente de definir.'}</p>
        <p>Contenido: negocio · Uso: redactor y revisor.</p>
        <div className={styles.buttons}><button disabled={busy || !!editing && editing !== item.id} onClick={() => { setEditing(item.id); setDraft(item.draft); setError(''); setNotice('') }}>Ver y editar</button></div>
      </article>)}
    </div>
    {showPolicies && !policies.length && <div className={styles.card}><h2>{search ? 'Sin políticas coincidentes' : 'Todavía no hay políticas comerciales'}</h2>
      <p>Registre las condiciones que su equipo haya confirmado. Una política sin publicar no se utiliza para responder al cliente.</p></div>}
    {!showPolicies && !entries.length && <p className={styles.description}>No se encontraron configuraciones.</p>}
    {active.id === 'conversacion' && !search && <div className={styles.card}>
      <h2>Reglas obligatorias del flujo</h2><p>La restricción de presentar tipos de inmuebles antes de recoger los datos sigue en el flujo de apertura. La validación de cifras exactas, identidad confirmada y acciones realizadas sigue a cargo del sistema.</p>
      <p>Estas reglas requieren cambios de desarrollo; la personalidad y las preguntas editables se administran arriba.</p>
    </div>}
    {editing && <section className={styles.editor} aria-label="Editor de política comercial">
      <h2>{found ? 'Editar política' : 'Nueva política comercial'}</h2>
      <p>Describa condiciones confirmadas y sus límites. Para cambiar precios, preguntas o acciones automáticas utilice sus configuraciones correspondientes.</p>
      {found?.published && <p>Versión publicada: {found.published.version}. Editar y guardar un borrador no reemplaza esa versión.</p>}
      <fieldset disabled={busy} className={styles.form}>
        <legend className="sr-only">Contenido de la política</legend>
        <label>Título<input maxLength={120} value={draft.title} onChange={e => update({ title: e.target.value })} /></label>
        <label>Tema<select value={draft.topic} onChange={e => update({ topic: e.target.value as PolicyContent['topic'] })}>{Object.entries(POLICY_TOPICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className={styles.wide}>Condiciones confirmadas<textarea maxLength={3000} value={draft.content} onChange={e => update({ content: e.target.value })} placeholder="Describa qué está permitido, qué condiciones deben cumplirse y qué queda pendiente de confirmar." /></label>
        <label className={styles.wide}>Alcance y excepciones<textarea maxLength={600} value={draft.scope} onChange={e => update({ scope: e.target.value })} placeholder="A quién y a qué etapas aplica. Por ejemplo: información, reserva o firma; residencia y nacionalidad se distinguen." /></label>
        <label className={styles.wide}>Fuente o responsable que confirmó la información<input maxLength={600} value={draft.source} onChange={e => update({ source: e.target.value })} placeholder="Documento y versión, enlace o responsable y fecha de confirmación" /></label>
        <label>Etapa comercial<select value={draft.mode} onChange={e => update({ mode: e.target.value as PolicyContent['mode'] })}><option value="todos">Todas</option><option value="lanzamiento">Lanzamiento</option><option value="preventa">Preventa</option></select></label>
        <label>Vigente hasta (opcional)<input type="date" value={draft.validUntil} onChange={e => update({ validUntil: e.target.value })} /></label>
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <div className={styles.buttons}>
        <button disabled={busy} onClick={() => void run('draft')}>Guardar borrador</button>
        <button className={styles.primary} disabled={busy} onClick={() => void run('publish')}>{busy ? 'Guardando…' : 'Publicar política confirmada'}</button>
        {found?.published && <button disabled={busy} onClick={() => void run('pause')}>Pausar publicación</button>}
        <button disabled={busy} onClick={() => { setEditing(null); setError(''); setNotice('') }}>Cerrar editor (descartar cambios sin guardar)</button>
      </div>
      {!!found?.history.length && <div className={styles.history}><h2>Historial de publicaciones</h2><p>Puede recuperar una versión como borrador y revisarla antes de publicarla nuevamente. Se conservan las últimas 20 publicaciones.</p>
        {found.history.map(version => <details key={version.version}><summary>Versión {version.version} · {version.title} · {new Date(version.publishedAt).toLocaleString('es-EC')}</summary>
          <pre>{version.content}{'\n\n'}Alcance: {version.scope}{'\n'}Fuente: {version.source}{'\n'}Etapa: {version.mode}{'\n'}Vigente hasta: {version.validUntil || 'Sin fecha límite'}</pre>
          <div className={styles.buttons}><button disabled={busy} onClick={() => { setDraft({ title: version.title, topic: version.topic, content: version.content, scope: version.scope, source: version.source, mode: version.mode, validUntil: version.validUntil }); setNotice('Versión recuperada en el editor. Revísela y guarde o publique cuando esté lista.') }}>Recuperar como borrador</button></div>
        </details>)}</div>}
    </section>}
  </div>
}

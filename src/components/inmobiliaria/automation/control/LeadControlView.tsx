'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BotOff,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  Filter,
  GitBranch,
  Inbox,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import type {
  LeadControlCategory,
  LeadControlResponse,
  LeadControlRow,
  LeadControlState,
  LeadControlStep,
} from '@/types/leadControl'
import styles from './LeadControlView.module.css'

const STATE_LABEL: Record<LeadControlState, string> = {
  intervention: 'Requiere intervención', waiting: 'En espera', healthy: 'Estable', intentional: 'Pausa intencional',
}

const CATEGORY_LABEL: Record<LeadControlCategory, string> = {
  entry: 'Entrada y webhook', interpretation: 'Interpretación', context: 'Contexto', routing: 'Enrutamiento',
  generation: 'Generación', delivery: 'Entrega', advisor: 'Atención humana', visit: 'Visitas',
  nutrition: 'Nutrición', inactivity: 'Inactividad', intentional: 'Pausa intencional', normal: 'Sin incidentes',
}

const EMPTY: LeadControlResponse = {
  generatedAt: '',
  thresholds: { automationResponseMinutes: 10, processingMinutes: 5, commercialInactivityDays: 21 },
  summary: { total: 0, intervention: 0, waiting: 0, healthy: 0, intentional: 0, unassigned: 0 },
  rows: [],
}

export function LeadControlView() {
  const [data, setData] = useState<LeadControlResponse>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'all' | LeadControlState>('all')
  const [category, setCategory] = useState<'all' | LeadControlCategory>('all')
  const [owner, setOwner] = useState<'all' | 'assigned' | 'unassigned'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/inmobiliaria/automation/control', { cache: 'no-store' })
      const body = await response.json() as LeadControlResponse & { error?: string }
      if (!response.ok) throw new Error(body.error || 'No se pudo cargar el control de leads')
      setData(body)
      setSelectedId(current => current && body.rows.some(row => row.leadId === current)
        ? current
        : body.rows.find(row => row.state === 'intervention')?.leadId ?? body.rows[0]?.leadId ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el control de leads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const categories = useMemo(() => [...new Set(data.rows.map(row => row.category))], [data.rows])
  const rows = useMemo(() => data.rows.filter(row => {
    const normalized = query.trim().toLocaleLowerCase('es')
    const matchesQuery = !normalized || `${row.name} ${row.phone ?? ''} ${row.reason} ${row.projectName ?? ''}`.toLocaleLowerCase('es').includes(normalized)
    const matchesState = state === 'all' || row.state === state
    const matchesCategory = category === 'all' || row.category === category
    const matchesOwner = owner === 'all' || (owner === 'assigned' ? Boolean(row.assigneeName) : !row.assigneeName)
    return matchesQuery && matchesState && matchesCategory && matchesOwner
  }), [category, data.rows, owner, query, state])
  const selected = data.rows.find(row => row.leadId === selectedId) ?? null

  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}><strong>Automatización</strong><span>/</span>Supervisión operativa</p>
        <h1>Control de leads</h1>
        <p>Detecte qué leads se detuvieron, por qué ocurrió y en qué punto del flujo necesitan atención.</p>
      </div>
      <div className={styles.headerActions}>
        <AutomationSectionTabs active="control" />
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Actualizar</button>
      </div>
    </header>

    <section className={styles.summary} aria-label="Resumen del control de leads">
      <SummaryCard icon={AlertTriangle} label="Intervención" value={data.summary.intervention} tone="danger" active={state === 'intervention'} onClick={() => setState(state === 'intervention' ? 'all' : 'intervention')} />
      <SummaryCard icon={Clock3} label="En espera" value={data.summary.waiting} tone="warning" active={state === 'waiting'} onClick={() => setState(state === 'waiting' ? 'all' : 'waiting')} />
      <SummaryCard icon={CheckCircle2} label="Estables" value={data.summary.healthy} tone="success" active={state === 'healthy'} onClick={() => setState(state === 'healthy' ? 'all' : 'healthy')} />
      <SummaryCard icon={BotOff} label="Pausa intencional" value={data.summary.intentional} tone="muted" active={state === 'intentional'} onClick={() => setState(state === 'intentional' ? 'all' : 'intentional')} />
      <SummaryCard icon={UserRound} label="Sin responsable" value={data.summary.unassigned} tone="neutral" active={owner === 'unassigned'} onClick={() => setOwner(owner === 'unassigned' ? 'all' : 'unassigned')} />
    </section>

    <section className={styles.rules}>
      <ShieldCheck size={17} />
      <div><strong>Reglas de detección visibles</strong><p>Respuesta automática: {data.thresholds.automationResponseMinutes} min · Evento procesando: {data.thresholds.processingMinutes} min · Inactividad comercial: {data.thresholds.commercialInactivityDays} días. Estas reglas solo generan alertas.</p></div>
      {data.generatedAt && <time>Actualizado {formatDate(data.generatedAt)}</time>}
    </section>

    <section className={styles.filters} aria-label="Filtros">
      <label className={styles.search}><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar lead, teléfono o motivo" /></label>
      <label><Filter size={13} /><select value={state} onChange={event => setState(event.target.value as typeof state)}><option value="all">Todos los estados</option>{Object.entries(STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><GitBranch size={13} /><select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="all">Todas las causas</option>{categories.map(value => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}</select></label>
      <label><UserRound size={13} /><select value={owner} onChange={event => setOwner(event.target.value as typeof owner)}><option value="all">Todos los responsables</option><option value="assigned">Con responsable</option><option value="unassigned">Sin responsable</option></select></label>
      <span>{rows.length} de {data.rows.length}</span>
    </section>

    {error ? <section className={styles.empty}><AlertTriangle size={22} /><h2>No se pudo cargar el panel</h2><p>{error}</p><button type="button" onClick={() => void load()}>Reintentar</button></section>
      : <section className={styles.controlGrid}>
        <div className={styles.listPanel} aria-busy={loading}>
          <header><div><p>Cola operativa</p><h2>Leads y puntos de caída</h2></div><span>{loading ? 'Actualizando…' : `${rows.length} visibles`}</span></header>
          {loading && !data.rows.length ? <div className={styles.empty}><RefreshCw className="animate-spin" size={20} /><p>Reconstruyendo recorridos…</p></div>
            : rows.length === 0 ? <div className={styles.empty}><Inbox size={20} /><p>No hay leads que coincidan con los filtros.</p></div>
              : <div className={styles.leadList}>{rows.map(row => <LeadItem key={row.leadId} row={row} active={selectedId === row.leadId} onSelect={() => setSelectedId(row.leadId)} />)}</div>}
        </div>
        <LeadInspector row={selected} onClose={() => setSelectedId(null)} />
      </section>}
  </main>
}

function SummaryCard({ icon: Icon, label, value, tone, active, onClick }: {
  icon: typeof Activity; label: string; value: number; tone: string; active: boolean; onClick: () => void
}) {
  return <button type="button" className={styles.summaryCard} data-tone={tone} data-active={active ? 'true' : 'false'} onClick={onClick}>
    <span><Icon size={15} />{label}</span><strong>{value}</strong>
  </button>
}

function LeadItem({ row, active, onSelect }: { row: LeadControlRow; active: boolean; onSelect: () => void }) {
  return <button type="button" className={styles.leadItem} data-state={row.state} data-active={active ? 'true' : 'false'} onClick={onSelect}>
    <span className={styles.stateDot} />
    <span className={styles.leadIdentity}><strong>{row.name}</strong><small>{row.phone || row.projectName || 'Sin contacto'}</small></span>
    <span className={styles.leadDiagnosis}><em>{CATEGORY_LABEL[row.category]}</em><strong>{row.reason}</strong><small>{row.lastSuccessfulNode ? `Último paso correcto: ${row.lastSuccessfulNode}` : 'Sin traza de ejecución disponible'}</small></span>
    <span className={styles.leadOwner}><strong>{row.assigneeName || 'Sin responsable'}</strong><small>{formatElapsed(row.detectedAt)}</small></span>
    <ChevronRight size={15} />
  </button>
}

function LeadInspector({ row, onClose }: { row: LeadControlRow | null; onClose: () => void }) {
  if (!row) return <aside className={`${styles.inspector} ${styles.inspectorEmpty}`}><CircleDot size={24} /><h2>Seleccione un lead</h2><p>Aquí verá el diagnóstico, la evidencia y el recorrido de su última ejecución.</p></aside>
  return <LeadInspectorContent key={row.leadId} row={row} onClose={onClose} />
}

function LeadInspectorContent({ row, onClose }: { row: LeadControlRow; onClose: () => void }) {
  const [executionId, setExecutionId] = useState(row.executions[0]?.id ?? null)
  const execution = row.executions.find(item => item.id === executionId) ?? row.executions[0]
  const kommoUrl = row.kommoId ? `https://lavilet.kommo.com/leads/detail/${row.kommoId}` : null
  return <aside className={styles.inspector}>
    <header className={styles.inspectorHeader}>
      <div><span data-state={row.state}>{STATE_LABEL[row.state]}</span><h2>{row.name}</h2><p>{row.phone || 'Sin teléfono'} · {row.projectName || 'Proyecto sin definir'}</p></div>
      <button type="button" onClick={onClose} aria-label="Cerrar detalle"><X size={16} /></button>
    </header>

    <section className={styles.diagnosis} data-state={row.state}>
      <div><AlertTriangle size={17} /><span><small>{CATEGORY_LABEL[row.category]}</small><strong>{row.reason}</strong></span></div>
      <p>{row.explanation}</p>
    </section>

    <dl className={styles.facts}>
      <div><dt>Etapa</dt><dd>{humanize(row.stage)}</dd></div>
      <div><dt>Temperatura</dt><dd>{humanize(row.temperature)}</dd></div>
      <div><dt>Responsable</dt><dd>{row.assigneeName || 'Sin asignar'}</dd></div>
      <div><dt>Bot</dt><dd>{row.botEnabled ? 'Activo' : 'Detenido'}</dd></div>
      <div><dt>Último paso correcto</dt><dd>{row.lastSuccessfulNode || 'Sin registro'}</dd></div>
      <div><dt>Punto de detención</dt><dd>{row.stoppedNode || 'No detectado'}</dd></div>
    </dl>

    <section className={styles.recommendation}>
      <span><ArrowRight size={14} />Acción recomendada</span><p>{row.recommendation}</p>
    </section>

    {row.executions.length > 0 && <section className={styles.inspectorSection}>
      <header><div><p>Historial</p><h3>Últimas ejecuciones del lead</h3></div><span>{row.executions.length} registradas</span></header>
      <div className={styles.executionHistory}>{row.executions.map(item => <button
        key={item.id}
        type="button"
        aria-pressed={execution?.id === item.id}
        onClick={() => setExecutionId(item.id)}
      >
        <i data-status={item.status} />
        <span><strong>{item.action ? humanize(item.action) : humanize(item.kind)}</strong><small>{item.message || `${item.steps.length} pasos registrados`}</small></span>
        <time>{formatDate(item.occurredAt)}</time>
      </button>)}</div>
    </section>}

    <section className={styles.inspectorSection}>
      <header><div><p>Recorrido técnico</p><h3>{execution ? `Ejecución ${formatDate(execution.occurredAt)}` : 'Sin ejecución registrada'}</h3></div>{execution && <span>{execution.steps.length} pasos</span>}</header>
      {execution?.steps.length ? <div className={styles.stepList}>{execution.steps.map(step => <ExecutionStep key={`${execution.id}:${step.order}`} step={step} />)}</div>
        : <p className={styles.sectionEmpty}>Este lead todavía no tiene una traza detallada. El diagnóstico usa el estado comercial y sus mensajes.</p>}
    </section>

    <section className={styles.inspectorSection}>
      <header><div><p>Evidencia</p><h3>Datos que explican el diagnóstico</h3></div></header>
      {row.evidence.length ? <div className={styles.evidence}>{row.evidence.map((item, index) => <article key={`${item.label}:${index}`}><strong>{item.label}</strong><p>{item.value}</p>{item.at && <time>{formatDate(item.at)}</time>}</article>)}</div>
        : <p className={styles.sectionEmpty}>No hay evidencia adicional registrada.</p>}
    </section>

    <footer className={styles.inspectorActions}>
      <Link href="/inmobiliaria/automatizacion/workflow">Ver mapa general<GitBranch size={12} /></Link>
      {kommoUrl && <a href={kommoUrl} target="_blank" rel="noreferrer">Abrir en Kommo<ExternalLink size={12} /></a>}
    </footer>
  </aside>
}

function ExecutionStep({ step }: { step: LeadControlStep }) {
  return <article className={styles.step} data-status={step.status}>
    <i>{step.order}</i><div><span><strong>{step.label}</strong><em>{step.status === 'succeeded' ? 'Correcto' : step.status === 'failed' ? 'Error' : step.status === 'paused' ? 'Detenido' : 'Omitido'}</em></span><p>{step.source}</p>{step.errorCode && <code>{step.errorCode}</code>}</div>
  </article>
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase()) || 'Por definir'
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(date)
}

function formatElapsed(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'Sin fecha'
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}

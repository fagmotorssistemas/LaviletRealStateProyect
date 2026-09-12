'use client'

import { Suspense } from 'react'
import { Activity, ArrowRight, BellRing, Inbox, RefreshCw } from 'lucide-react'
import { useLeadAutomationDashboard } from '@/hooks/inmobiliaria/useLeadAutomationDashboard'
import { useVisitInboxContext } from '@/contexts/VisitInboxContext'
import { AutomationKpiCards } from '@/components/inmobiliaria/automation/AutomationKpiCards'
import { AutomationLeadsTable } from '@/components/inmobiliaria/automation/AutomationLeadsTable'
import { AutomationLeadDetailDrawer } from '@/components/inmobiliaria/automation/AutomationLeadDetailDrawer'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { AutomationFilters } from '@/components/inmobiliaria/automation/AutomationFilters'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { visitWaitLabel } from '@/lib/inmobiliaria/visitInbox'
import styles from '@/components/inmobiliaria/automation/AutomationWorkspace.module.css'

function AutomationDashboard() {
  const dashboard = useLeadAutomationDashboard()
  const inbox = useVisitInboxContext()
  const { rows, kpis, projects, advisors, isLoading, error, total, page, pageSize, filters, hasFilters,
    selectedLeadId, detail, detailLoading, detailError, updateFilter, updateFilters, resetFilters,
    setPage, openLead, closeLead, reload, updatedAt } = dashboard
  const sources = Array.from(new Set([...kpis.leads_by_source.map(item => item.source), filters.source]
    .filter((value): value is string => Boolean(value) && value !== 'sin_origen')))
  const next = inbox.pending[0]
  const refresh = () => { void Promise.all([reload(), inbox.reload()]) }

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}><strong>Seguimiento comercial</strong><span>/</span>{isLoading ? 'Actualizando…' : `${total} registros`}</p>
        <h1 className={styles.title}>Automatización</h1>
        <p className={styles.description}>Una vista clara de cada lead, su conversación y el siguiente paso de atención.</p>
      </div>
      <div className={styles.headerActions}>
        <AutomationSectionTabs active="monitoreo" />
        <div className={styles.actions}>
          <button type="button" className={styles.action} disabled={isLoading || inbox.loading} onClick={refresh}><RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />Actualizar</button>
          <button type="button" className={`${styles.action} ${styles.primary}`} onClick={() => inbox.openInbox()}><Inbox size={14} />Bandeja de citas{inbox.ready ? ` (${inbox.pending.length})` : ''}</button>
        </div>
      </div>
    </header>

    {(inbox.ready || inbox.error) && <section className={styles.attention} aria-label="Citas que requieren atención">
      <div className={styles.attentionIcon}>{next ? <BellRing size={18} /> : <Inbox size={18} />}</div>
      <div className={styles.attentionBody}>
        <h2>{inbox.error ? 'La bandeja necesita actualizarse' : next ? `${inbox.pending.length} ${inbox.pending.length === 1 ? 'cita necesita' : 'citas necesitan'} respuesta` : 'Sin citas pendientes de revisión'}</h2>
        <p>{inbox.error || (next
          ? `${next.lead?.name || 'Cliente'} · ${visitWaitLabel(next.created_at, inbox.now)}${inbox.overdue.length ? ` · ${inbox.overdue.length} con plazo vencido` : ''}`
          : inbox.waiting.length ? `${inbox.waiting.length} propuestas esperan la respuesta del cliente.` : 'Las nuevas solicitudes aparecerán aquí y en la campana superior.')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={styles.action} onClick={() => inbox.openInbox('all')}>Ver todas{inbox.ready ? ` (${inbox.items.length})` : ''}</button>
        {next && <button type="button" className={`${styles.action} ${styles.primary}`} onClick={() => inbox.openRequest(next)}>Atender siguiente<ArrowRight size={13} /></button>}
      </div>
    </section>}

    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-stone-400"><span>Indicadores del proyecto y período seleccionados</span>{updatedAt && !isLoading && !error && <span>Actualizado: {formatAgendaDateTime(updatedAt)}</span>}</div>
      <AutomationKpiCards kpis={kpis} loading={isLoading || Boolean(error)} />
    </div>

    <AutomationFilters filters={filters} projects={projects} advisors={advisors} sources={sources} hasFilters={hasFilters} updateFilter={updateFilter} updateFilters={updateFilters} resetFilters={resetFilters} />

    <section className={styles.tableWrap} aria-label="Monitoreo de leads" aria-busy={isLoading}>
      {isLoading ? <div className="flex items-center justify-center gap-3 py-20 text-sm text-stone-400"><Spinner />Cargando leads…</div>
        : error ? <EmptyState icon={Activity} title="No se pudo cargar el monitoreo" description={error}><button type="button" className={styles.action} onClick={refresh}>Reintentar</button></EmptyState>
        : total === 0 ? <EmptyState icon={Activity} title="No hay leads para estos filtros" description="Pruebe con otro proyecto, fecha o búsqueda.">{hasFilters && <button type="button" className={styles.action} onClick={resetFilters}>Limpiar filtros</button>}</EmptyState>
        : <><AutomationLeadsTable rows={rows} selectedLeadId={selectedLeadId} onSelect={openLead} /><div className={styles.footer}><Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} /></div></>}
    </section>
    <AutomationLeadDetailDrawer isOpen={Boolean(selectedLeadId)} loading={detailLoading} error={detailError} detail={detail} onClose={closeLead} />
  </div>
}

export default function AutomatizacionPage() {
  return <Suspense fallback={<div className="flex justify-center py-20"><Spinner size="lg" /></div>}><AutomationDashboard /></Suspense>
}

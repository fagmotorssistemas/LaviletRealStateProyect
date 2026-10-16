'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Columns3, List, Plus, RefreshCw, SlidersHorizontal, UserPlus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useLeads } from '@/hooks/inmobiliaria/useLeads'
import { useLeadPipeline } from '@/hooks/inmobiliaria/useLeadPipeline'
import { LeadPipelineBoard, LeadPipelineTable } from '@/components/inmobiliaria/leads/LeadPipelineBoard'
import { LeadPipelineWarnings } from '@/components/inmobiliaria/leads/LeadPipelineWarnings'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import { CreateLeadModal } from '@/components/inmobiliaria/leads/CreateLeadModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { LEAD_TEMPERATURE_OPTIONS, UNASSIGNED_ASSIGNEE } from '@/types/inmobiliaria'
import { LEAD_PIPELINE_STAGE_OPTIONS, type LeadPipelineStage } from '@/types/leadPipeline'

type DatePreset = 'all' | 'today' | 'yesterday' | '7' | 'month' | 'exact' | 'custom'

function inputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function LeadsPage() {
  const { isLoading: authLoading, user } = useAuth()
  const { advisors, tenantId, reload: reloadLegacy } = useLeads()
  const {
    view, changeView, filters, updateFilter, resetFilters, page, setPage,
    setColumnPage, data, isLoading, error, reload,
  } = useLeadPipeline(!authLoading && Boolean(user))
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const lead = new URLSearchParams(window.location.search).get('lead')?.trim()
      if (!lead) return
      setSelectedLeadId(lead)
      setDetailOpen(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const openLead = useCallback((id: string) => {
    setSelectedLeadId(id)
    setDetailOpen(true)
  }, [])
  const closeLead = useCallback(() => setDetailOpen(false), [])
  const handleUpdated = useCallback(() => {
    reload()
    void reloadLegacy()
  }, [reload, reloadLegacy])

  const applyDatePreset = (preset: DatePreset) => {
    const now = new Date()
    let from = ''
    let to = ''
    if (preset === 'today' || preset === 'exact') from = to = preset === 'exact' ? filters.dateFrom || inputDate(now) : inputDate(now)
    if (preset === 'yesterday') {
      now.setDate(now.getDate() - 1)
      from = to = inputDate(now)
    }
    if (preset === '7') {
      to = inputDate(now)
      now.setDate(now.getDate() - 6)
      from = inputDate(now)
    }
    if (preset === 'month') {
      to = inputDate(now)
      from = inputDate(new Date(now.getFullYear(), now.getMonth(), 1))
    }
    if (preset === 'custom') return
    updateFilter('dateFrom', from)
    updateFilter('dateTo', to)
  }

  const hasFilters = Boolean(
    filters.search || filters.stage || filters.nutrition || filters.appointment
    || filters.assignedTo || filters.temperature || filters.dateFrom || filters.dateTo
    || filters.outcome !== 'open',
  )
  const total = data?.total ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cartera comercial"
        title="Leads"
        description="Avance comercial, atención y próximas acciones"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="shrink-0" disabled={!tenantId}>
            <Plus size={16} className="mr-2" />Nuevo lead
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Vista de leads" className="inline-flex rounded-xl border border-[#787D62]/20 bg-white p-1">
          {([
            { value: 'list', label: 'Lista', icon: List },
            { value: 'board', label: 'Embudo', icon: Columns3 },
          ] as const).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => changeView(value)}
              className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62]', view === value ? 'bg-[#787D62] text-white' : 'text-[#6e716b] hover:bg-[#f7f3ee]')}
            >
              <Icon size={16} aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[#6e716b]" aria-live="polite">{isLoading ? 'Actualizando leads…' : `${total} ${total === 1 ? 'lead' : 'leads'}`}</p>
          <Button variant="outline" size="sm" aria-expanded={advancedFiltersOpen} onClick={() => setAdvancedFiltersOpen((open) => !open)}>
            <SlidersHorizontal size={14} className="mr-2" />{advancedFiltersOpen ? 'Menos filtros' : 'Más filtros'}
          </Button>
          <Button variant="outline" size="sm" onClick={reload} disabled={isLoading} aria-label="Actualizar leads">
            <RefreshCw size={14} className={cn('mr-2', isLoading && 'animate-spin')} />Actualizar
          </Button>
        </div>
      </div>

      <InmobiliariaFiltersToolbar
        searchValue={filters.search || ''}
        onSearchChange={(value) => updateFilter('search', value)}
        searchPlaceholder="Nombre o teléfono…"
        resultsTotal={data?.total}
        hasActiveFilters={hasFilters}
        onReset={() => { resetFilters(); setDatePreset('all') }}
      >
        <Select label="Etapa comercial" options={[...LEAD_PIPELINE_STAGE_OPTIONS]} placeholder="Todas" value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value as LeadPipelineStage | '')} />
        <Select label="Nutrición" options={[{ value: 'active', label: 'Activa' }, { value: 'inactive', label: 'No activa' }]} placeholder="Todas" value={filters.nutrition} onChange={(event) => updateFilter('nutrition', event.target.value as 'active' | 'inactive' | '')} />
        <Select label="Citas" options={[{ value: 'pending', label: 'Por coordinar' }, { value: 'confirmed', label: 'Confirmadas' }, { value: 'completed', label: 'Realizadas' }, { value: 'cancelled', label: 'Canceladas' }]} placeholder="Todas" value={filters.appointment} onChange={(event) => updateFilter('appointment', event.target.value as typeof filters.appointment)} />
        <Select label="Oportunidad" options={[{ value: 'open', label: 'Abiertas' }, { value: 'won', label: 'Con venta' }, { value: 'lost', label: 'Cerradas sin venta' }, { value: 'all', label: 'Todas' }]} value={filters.outcome} onChange={(event) => updateFilter('outcome', event.target.value as typeof filters.outcome)} />
        {advancedFiltersOpen && <>
        <Select label="Responsable" options={[{ value: UNASSIGNED_ASSIGNEE, label: 'Sin asignar' }, ...advisors.map((advisor) => ({ value: advisor.id, label: advisor.full_name || 'Sin nombre' }))]} placeholder="Todos" value={filters.assignedTo} onChange={(event) => updateFilter('assignedTo', event.target.value)} />
        <Select label="Temperatura" options={LEAD_TEMPERATURE_OPTIONS} placeholder="Todas" value={filters.temperature} onChange={(event) => updateFilter('temperature', event.target.value)} />
        <Select label="Creado" options={[{ value: 'all', label: 'Todo' }, { value: 'today', label: 'Hoy' }, { value: 'yesterday', label: 'Ayer' }, { value: '7', label: 'Últimos 7 días' }, { value: 'month', label: 'Este mes' }, { value: 'exact', label: 'Fecha exacta' }, { value: 'custom', label: 'Intervalo' }]} value={datePreset} onChange={(event) => { const next = event.target.value as DatePreset; setDatePreset(next); applyDatePreset(next) }} />
        <Select label="Ordenar por" options={[{ value: 'actividad', label: 'Actividad reciente' }, { value: 'creado', label: 'Fecha de creación' }]} value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value as 'actividad' | 'creado')} />
        {(datePreset === 'exact' || datePreset === 'custom') && (
          <>
            <label className="flex min-w-0 flex-col gap-1.5"><span className="crm-field-label">{datePreset === 'exact' ? 'Fecha exacta' : 'Desde'}</span><input type="date" value={filters.dateFrom} onChange={(event) => { updateFilter('dateFrom', event.target.value); if (datePreset === 'exact') updateFilter('dateTo', event.target.value) }} className="crm-field" /></label>
            {datePreset === 'custom' && <label className="flex min-w-0 flex-col gap-1.5"><span className="crm-field-label">Hasta</span><input type="date" value={filters.dateTo} min={filters.dateFrom} onChange={(event) => updateFilter('dateTo', event.target.value)} className="crm-field" /></label>}
          </>
        )}
        </>}
      </InmobiliariaFiltersToolbar>

      <LeadPipelineWarnings warnings={data?.warnings} issues={data?.issues} onRetry={reload} loading={isLoading} />

      {error ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div><p className="font-semibold">No se pudieron cargar los leads</p><p className="mt-1">{error}</p><Button variant="outline" size="sm" onClick={reload} className="mt-3">Reintentar</Button></div>
        </div>
      ) : !data && (isLoading || authLoading) ? (
        <div className="flex justify-center py-20" role="status" aria-label="Cargando leads"><Spinner size="lg" /></div>
      ) : view === 'board' ? (
        <LeadPipelineBoard columns={data?.columns || []} coverage={data?.coverage} stageFilter={filters.stage || ''} isLoading={isLoading} onPageChange={setColumnPage} onSelect={openLead} />
      ) : total === 0 ? (
        <EmptyState icon={UserPlus} title="No hay leads en esta vista" description={hasFilters ? 'Pruebe con otros filtros para encontrar el contacto.' : 'Los nuevos contactos aparecerán aquí para comenzar su atención.'} />
      ) : (
        <div aria-busy={isLoading} className={cn('space-y-4', isLoading && 'pointer-events-none opacity-60')}>
          <LeadPipelineTable items={data?.items || []} onSelect={openLead} />
          <Pagination page={data?.page || page} pageSize={data?.pageSize || 25} total={total} onPageChange={setPage} />
        </div>
      )}

      <LeadDetailModal leadId={selectedLeadId} isOpen={detailOpen} onClose={closeLead} onUpdated={handleUpdated} tenantId={tenantId} advisors={advisors} />
      <CreateLeadModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleUpdated} tenantId={tenantId} advisors={advisors} />
    </div>
  )
}

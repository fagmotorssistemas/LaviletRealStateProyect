'use client'

import { Suspense } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useLeadAutomationDashboard } from '@/hooks/inmobiliaria/useLeadAutomationDashboard'
import { AutomationKpiCards } from '@/components/inmobiliaria/automation/AutomationKpiCards'
import { AutomationLeadsTable } from '@/components/inmobiliaria/automation/AutomationLeadsTable'
import { AutomationLeadDetailDrawer } from '@/components/inmobiliaria/automation/AutomationLeadDetailDrawer'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { LEAD_TEMPERATURE_OPTIONS, UNASSIGNED_ASSIGNEE } from '@/types/inmobiliaria'
import {
  BOT_STATUS_OPTIONS,
  HANDOFF_STATUS_OPTIONS,
  LEAD_STAGE_OPTIONS,
  SLA_STATUS_OPTIONS,
  sourceLabel,
} from '@/lib/inmobiliaria/leadAutomation'

function AutomationDashboard() {
  const {
    rows,
    kpis,
    projects,
    advisors,
    isLoading,
    error,
    total,
    page,
    pageSize,
    filters,
    hasFilters,
    selectedLeadId,
    detail,
    detailLoading,
    detailError,
    updateFilter,
    resetFilters,
    setPage,
    openLead,
    closeLead,
    reload,
  } = useLeadAutomationDashboard()

  const sourceOptions = kpis.leads_by_source
    .map((item) => item.source)
    .filter((value): value is string => Boolean(value) && value !== 'sin_origen')
  const uniqueSources = Array.from(new Set([
    ...sourceOptions,
    filters.source,
  ].filter(Boolean)))

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Monitoreo comercial"
        title="Automatización"
        description={
          <>
            Estado de leads, bot, traspaso y SLA
            {total > 0 && <span className="text-[#BDA27E]"> · {total} registros</span>}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void reload()} className="shrink-0">
            <RefreshCw size={16} className="mr-2" />
            Actualizar
          </Button>
        }
      />

      <AutomationSectionTabs active="monitoreo" />

      <AutomationKpiCards kpis={kpis} />

      <InmobiliariaFiltersToolbar
        searchValue={filters.search}
        onSearchChange={(value) => updateFilter('search', value)}
        searchPlaceholder="Buscar por nombre, teléfono o Kommo ID"
        resultsTotal={total}
        hasActiveFilters={hasFilters}
        onReset={resetFilters}
      >
        <Input
          id="automation-from"
          label="Desde"
          type="date"
          value={filters.from}
          onChange={(event) => updateFilter('from', event.target.value)}
        />
        <Input
          id="automation-to"
          label="Hasta"
          type="date"
          value={filters.to}
          onChange={(event) => updateFilter('to', event.target.value)}
        />
        <Select
          label="Proyecto"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          placeholder="Todos"
          value={filters.projectId}
          onChange={(event) => updateFilter('projectId', event.target.value)}
        />
        <Select
          label="Origen"
          options={uniqueSources.map((source) => ({ value: source, label: sourceLabel(source) }))}
          placeholder="Todos"
          value={filters.source}
          onChange={(event) => updateFilter('source', event.target.value)}
        />
        <Select
          label="Etapa"
          options={LEAD_STAGE_OPTIONS}
          placeholder="Todas"
          value={filters.stage}
          onChange={(event) => updateFilter('stage', event.target.value)}
        />
        <Select
          label="Temperatura"
          options={LEAD_TEMPERATURE_OPTIONS}
          placeholder="Todas"
          value={filters.temperature}
          onChange={(event) => updateFilter('temperature', event.target.value)}
        />
        <Select
          label="Responsable"
          options={[
            { value: UNASSIGNED_ASSIGNEE, label: 'Sin asignar' },
            ...advisors.map((advisor) => ({ value: advisor.id, label: advisor.full_name || 'Sin nombre' })),
          ]}
          placeholder="Todos"
          value={filters.assignedTo}
          onChange={(event) => updateFilter('assignedTo', event.target.value)}
        />
        <Select
          label="Traspaso"
          options={HANDOFF_STATUS_OPTIONS}
          placeholder="Todos"
          value={filters.handoff}
          onChange={(event) => updateFilter('handoff', event.target.value)}
        />
        <Select
          label="Bot"
          options={BOT_STATUS_OPTIONS}
          placeholder="Todos"
          value={filters.bot}
          onChange={(event) => updateFilter('bot', event.target.value)}
        />
        <Select
          label="SLA"
          options={SLA_STATUS_OPTIONS}
          placeholder="Todos"
          value={filters.sla}
          onChange={(event) => updateFilter('sla', event.target.value)}
        />
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <EmptyState
          icon={Activity}
          title="No se pudo cargar el monitoreo"
          description={error}
        >
          <Button variant="outline" onClick={() => void reload()}>
            Reintentar
          </Button>
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState
          icon={Activity}
          title="No hay leads para estos filtros"
          description="Ajusta el rango, el proyecto o la búsqueda por teléfono."
        />
      ) : (
        <>
          <AutomationLeadsTable
            rows={rows}
            selectedLeadId={selectedLeadId}
            onSelect={openLead}
          />
          <div className="pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      <AutomationLeadDetailDrawer
        isOpen={Boolean(selectedLeadId)}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onClose={closeLead}
      />
    </div>
  )
}

export default function AutomatizacionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      }
    >
      <AutomationDashboard />
    </Suspense>
  )
}

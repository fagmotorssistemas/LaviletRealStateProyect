'use client'

import { useState } from 'react'
import { UserPlus, Plus } from 'lucide-react'
import { useLeads } from '@/hooks/inmobiliaria/useLeads'
import { LeadsList } from '@/components/inmobiliaria/leads/LeadsList'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import { CreateLeadModal } from '@/components/inmobiliaria/leads/CreateLeadModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { Lead } from '@/types/inmobiliaria'
import { LEAD_STATUS_OPTIONS, LEAD_TEMPERATURE_OPTIONS, UNASSIGNED_ASSIGNEE } from '@/types/inmobiliaria'

type DatePreset = 'all' | 'today' | 'yesterday' | '7' | 'month' | 'exact' | 'custom'

function toInputDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDays(d: Date, deltaDays: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + deltaDays)
  return next
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export default function LeadsPage() {
  const { leads, advisors, isLoading, tenantId, filters, updateFilter, resetFilters, reload, page, pageSize, total, setPage } = useLeads()
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('all')

  const applyDatePreset = (preset: DatePreset) => {
    const now = new Date()
    if (preset === 'all') {
      updateFilter('dateFrom', '')
      updateFilter('dateTo', '')
      return
    }
    if (preset === 'today') {
      const t = toInputDate(now)
      updateFilter('dateFrom', t)
      updateFilter('dateTo', t)
      return
    }
    if (preset === 'yesterday') {
      const y = toInputDate(shiftDays(now, -1))
      updateFilter('dateFrom', y)
      updateFilter('dateTo', y)
      return
    }
    if (preset === '7') {
      updateFilter('dateFrom', toInputDate(shiftDays(now, -6)))
      updateFilter('dateTo', toInputDate(now))
      return
    }
    if (preset === 'month') {
      updateFilter('dateFrom', toInputDate(startOfMonth(now)))
      updateFilter('dateTo', toInputDate(now))
      return
    }
    if (preset === 'exact') {
      const t = filters.dateFrom || toInputDate(now)
      updateFilter('dateFrom', t)
      updateFilter('dateTo', t)
    }
  }

  const handleSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id)
    setDetailOpen(true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Cartera comercial"
        title="Leads"
        description={
          <>
            Prospectos y su avance comercial
            {total > 0 && <span className="text-[#BDA27E]"> · {total} registros</span>}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus size={16} className="mr-2" />
            Nuevo lead
          </Button>
        }
      />

      <div>
        <InmobiliariaFiltersToolbar
          searchValue={filters.search}
          onSearchChange={(value) => updateFilter('search', value)}
          searchPlaceholder="Buscar lead..."
          resultsTotal={total}
          hasActiveFilters={Boolean(
            filters.search
            || filters.status
            || filters.temperature
            || filters.assignedTo
            || filters.dateFrom
            || filters.dateTo,
          )}
          onReset={() => {
            resetFilters()
            setDatePreset('all')
          }}
        >
          <Select
            label="Fecha"
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'today', label: 'Hoy' },
              { value: 'yesterday', label: 'Ayer' },
              { value: '7', label: 'Últimos 7 días' },
              { value: 'month', label: 'Este mes' },
              { value: 'exact', label: 'Fecha exacta' },
              { value: 'custom', label: 'Intervalo' },
            ]}
            placeholder="Fecha"
            value={datePreset}
            onChange={(e) => {
              const next = e.target.value as DatePreset
              setDatePreset(next)
              applyDatePreset(next)
            }}
          />
          {(datePreset === 'exact' || datePreset === 'custom') && (
            <>
              <div className="flex min-w-0 w-full flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
                  {datePreset === 'exact' ? 'Fecha exacta' : 'Desde'}
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => {
                    updateFilter('dateFrom', e.target.value)
                    if (datePreset === 'exact') updateFilter('dateTo', e.target.value)
                  }}
                  className="crm-field"
                />
              </div>
              {datePreset === 'custom' && (
                <div className="flex min-w-0 w-full flex-col gap-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => updateFilter('dateTo', e.target.value)}
                    className="crm-field"
                  />
                </div>
              )}
            </>
          )}
          <Select
            label="Estado"
            options={LEAD_STATUS_OPTIONS}
            placeholder="Todos"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
          />
          <Select
            label="Temperatura"
            options={LEAD_TEMPERATURE_OPTIONS}
            placeholder="Todas"
            value={filters.temperature}
            onChange={(e) => updateFilter('temperature', e.target.value)}
          />
          <Select
            label="Responsable"
            options={[
              { value: UNASSIGNED_ASSIGNEE, label: 'Sin asignar' },
              ...advisors.map((a) => ({ value: a.id, label: a.full_name || 'Sin nombre' })),
            ]}
            placeholder="Todos"
            value={filters.assignedTo}
            onChange={(e) => updateFilter('assignedTo', e.target.value)}
          />
        </InmobiliariaFiltersToolbar>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : total === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No hay leads"
          description="Aún no se han registrado prospectos. Agrega tu primer lead para comenzar."
        />
      ) : (
        <>
          <LeadsList leads={leads} onSelect={handleSelect} />
          <div className="pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      <LeadDetailModal
        leadId={selectedLeadId}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdated={reload}
        tenantId={tenantId}
        advisors={advisors}
      />

      <CreateLeadModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
        advisors={advisors}
      />
    </div>
  )
}

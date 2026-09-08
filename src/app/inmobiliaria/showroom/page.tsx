'use client'

import { useState, useEffect } from 'react'
import { Landmark, Plus } from 'lucide-react'
import { useShowroom } from '@/hooks/inmobiliaria/useShowroom'
import { useAuth } from '@/contexts/AuthContext'
import { listProjects } from '@/services/inmobiliaria.service'
import { ShowroomVisitsTable } from '@/components/inmobiliaria/showroom/ShowroomVisitsTable'
import { CreateVisitModal } from '@/components/inmobiliaria/showroom/CreateVisitModal'
import { VisitDetailModal } from '@/components/inmobiliaria/showroom/VisitDetailModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Pagination } from '@/components/ui/Pagination'
import type { Project, ShowroomVisit } from '@/types/inmobiliaria'

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

export default function ShowroomPage() {
  const { supabase } = useAuth()
  const {
    visits,
    advisors,
    isLoading,
    tenantId,
    filters,
    updateFilter,
    reload,
    page,
    pageSize,
    total,
    search,
    updateSearch,
    dateFrom,
    dateTo,
    updateDateFrom,
    updateDateTo,
    reset,
    setPage,
  } = useShowroom()
  const [projects, setProjects] = useState<Project[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedVisit, setSelectedVisit] = useState<ShowroomVisit | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [startInEdit, setStartInEdit] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('all')

  const sourceOptions = [
    { value: 'organica', label: 'Showroom' },
    { value: 'redes_sociales', label: 'Redes sociales' },
    { value: 'referido', label: 'Referido' },
    { value: 'agendada', label: 'Cita agendada' },
    { value: 'otro', label: 'Otro' },
    { value: 'oficina', label: 'Oficina (histórico)' },
    { value: 'proyecto', label: 'Proyecto (histórico)' },
    { value: 'mixto', label: 'Mixto (histórico)' },
  ]

  const applyDatePreset = (preset: DatePreset) => {
    const now = new Date()
    if (preset === 'all') {
      updateDateFrom('')
      updateDateTo('')
      return
    }
    if (preset === 'today') {
      const t = toInputDate(now)
      updateDateFrom(t)
      updateDateTo(t)
      return
    }
    if (preset === 'yesterday') {
      const y = toInputDate(shiftDays(now, -1))
      updateDateFrom(y)
      updateDateTo(y)
      return
    }
    if (preset === '7') {
      updateDateFrom(toInputDate(shiftDays(now, -6)))
      updateDateTo(toInputDate(now))
      return
    }
    if (preset === 'month') {
      updateDateFrom(toInputDate(startOfMonth(now)))
      updateDateTo(toInputDate(now))
      return
    }
    if (preset === 'exact') {
      const t = dateFrom || toInputDate(now)
      updateDateFrom(t)
      updateDateTo(t)
      return
    }
  }

  useEffect(() => {
    if (tenantId) {
      listProjects(supabase, tenantId).then(setProjects).catch(console.error)
    }
  }, [supabase, tenantId])

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Tráfico presencial"
        title="Showroom"
        description={
          <>
            Visitas de asesores con clientes
            {total > 0 && <span className="text-[#9a7d55]"> · {total} visitas</span>}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-2" />
            Nueva visita
          </Button>
        }
      />

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={updateSearch}
        searchPlaceholder="Buscar cliente o nota..."
        resultsTotal={total}
        hasActiveFilters={Boolean(
          search || filters.projectId || filters.source || filters.salespersonId || dateFrom || dateTo,
        )}
        onReset={() => {
          reset()
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
                value={dateFrom}
                onChange={(e) => {
                  updateDateFrom(e.target.value)
                  if (datePreset === 'exact') updateDateTo(e.target.value)
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
                  value={dateTo}
                  onChange={(e) => updateDateTo(e.target.value)}
                  className="crm-field"
                />
              </div>
            )}
          </>
        )}
        <Select
          label="Proyecto"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Todos"
          value={filters.projectId}
          onChange={(e) => updateFilter('projectId', e.target.value)}
        />
        <Select
          label="Origen"
          options={sourceOptions}
          placeholder="Todos"
          value={filters.source}
          onChange={(e) => updateFilter('source', e.target.value)}
        />
        <Select
          label="Asesor"
          options={advisors.map((a) => ({ value: a.id, label: a.full_name || 'Sin nombre' }))}
          placeholder="Todos"
          value={filters.salespersonId}
          onChange={(e) => updateFilter('salespersonId', e.target.value)}
        />
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : visits.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No hay visitas registradas"
          description="Registra la primera visita de showroom para comenzar a llevar el tráfico."
        />
      ) : (
        <>
          <ShowroomVisitsTable
            visits={visits}
            onSelect={(v) => {
              setSelectedVisit(v)
              setStartInEdit(false)
              setDetailOpen(true)
            }}
            onEdit={(v) => {
              setSelectedVisit(v)
              setStartInEdit(true)
              setDetailOpen(true)
            }}
          />
          {total > 0 && (
            <div className="pt-4">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <VisitDetailModal
        visit={selectedVisit}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedVisit(null)
          setStartInEdit(false)
        }}
        projects={projects}
        tenantId={tenantId}
        onVisitUpdated={reload}
        startInEdit={startInEdit}
      />

      <CreateVisitModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        projects={projects}
        tenantId={tenantId}
      />
    </div>
  )
}

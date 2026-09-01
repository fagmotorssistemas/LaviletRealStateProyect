'use client'

import { useState } from 'react'
import { CalendarDays, Plus } from 'lucide-react'
import { useAgenda } from '@/hooks/inmobiliaria/useAgenda'
import { updateAppointmentStatus } from '@/services/inmobiliaria.service'
import { useAuth } from '@/contexts/AuthContext'
import { AppointmentCard } from '@/components/inmobiliaria/agenda/AppointmentCard'
import { AppointmentDetailModal } from '@/components/inmobiliaria/agenda/AppointmentDetailModal'
import { CreateAppointmentModal } from '@/components/inmobiliaria/agenda/CreateAppointmentModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import type { Appointment, AppointmentStatus } from '@/types/inmobiliaria'
import { toast } from 'sonner'
import { AgendaAppointmentsTable } from '@/components/inmobiliaria/agenda/AgendaAppointmentsTable'

export default function AgendaPage() {
  const { supabase } = useAuth()
  const {
    appointments,
    isLoading,
    tenantId,
    tab,
    setTab,
    search,
    updateSearch,
    dateFrom,
    updateDateFrom,
    dateTo,
    updateDateTo,
    reload,
    page,
    pageSize,
    total,
    setPage,
  } = useAgenda()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [datePreset, setDatePreset] = useState<'all' | 'today' | '7' | '30' | 'exact' | 'custom'>('all')

  const toInputDate = (d: Date) => d.toISOString().slice(0, 10)
  const shiftDays = (d: Date, deltaDays: number) => new Date(d.getTime() + deltaDays * 86400000)

  const applyDatePreset = (preset: typeof datePreset) => {
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
    if (preset === '7') {
      const to = toInputDate(now)
      const from = toInputDate(shiftDays(now, -6))
      updateDateFrom(from)
      updateDateTo(to)
      return
    }
    if (preset === '30') {
      const to = toInputDate(now)
      const from = toInputDate(shiftDays(now, -29))
      updateDateFrom(from)
      updateDateTo(to)
      return
    }
    if (preset === 'exact') {
      const t = dateFrom || toInputDate(now)
      updateDateFrom(t)
      updateDateTo(t)
      return
    }
    // custom: no fuerza el rango, solo muestra inputs
  }

  const handleSelect = (appt: Appointment) => {
    setSelectedAppt(appt)
    setDetailOpen(true)
  }

  const handleStatusChange = async (id: string, status: AppointmentStatus) => {
    try {
      await updateAppointmentStatus(supabase, id, status)
      toast.success('Estado actualizado')
      setDetailOpen(false)
      reload()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Citas y seguimiento"
        title="Agenda"
        description={
          <>
            Agendamientos con clientes
            {total > 0 && <span className="text-[#9a7d55]"> · {total} citas</span>}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-2" />
            Nueva cita
          </Button>
        }
      />

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={updateSearch}
        searchPlaceholder="Buscar por título o nota..."
        resultsTotal={total}
        hasActiveFilters={Boolean(search || dateFrom || dateTo)}
        onReset={() => {
          updateSearch('')
          updateDateFrom('')
          updateDateTo('')
          setDatePreset('all')
        }}
      >
        <Select
          options={[
            { value: 'all', label: 'Fecha: Todo' },
            { value: 'today', label: 'Fecha: Hoy' },
            { value: '7', label: 'Fecha: Últimos 7 días' },
            { value: '30', label: 'Fecha: Últimos 30 días' },
            { value: 'exact', label: 'Fecha: Exacta' },
            { value: 'custom', label: 'Fecha: Rango' },
          ]}
          placeholder="Fecha"
          value={datePreset}
          onChange={(e) => {
            const v = e.target.value as typeof datePreset
            setDatePreset(v)
            applyDatePreset(v)
          }}
          className="w-full"
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
                className="box-border h-10 w-full min-w-0 max-w-full border border-[#c5c8bc] bg-[#f7f7f3] px-3 text-base text-[#3a3d36] focus:border-[#8b917c] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30 sm:text-sm"
              />
            </div>
            {datePreset === 'custom' && (
              <div className="flex min-w-0 w-full flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => updateDateTo(e.target.value)}
                  className="box-border h-10 w-full min-w-0 max-w-full border border-[#c5c8bc] bg-[#f7f7f3] px-3 text-base text-[#3a3d36] focus:border-[#8b917c] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30 sm:text-sm"
                />
              </div>
            )}
          </>
        )}
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="grid w-full grid-cols-2 gap-1">
              <Button
                variant={tab === 'pending' ? 'secondary' : 'outline'}
                size="sm"
                className="w-full px-2 text-xs sm:text-sm"
                onClick={() => setTab('pending')}
              >
                <span className="sm:hidden">Pendientes{tab === 'pending' ? ` (${total})` : ''}</span>
                <span className="hidden sm:inline">Por atender{tab === 'pending' ? ` (${total})` : ''}</span>
              </Button>
              <Button
                variant={tab === 'history' ? 'secondary' : 'outline'}
                size="sm"
                className="w-full px-2 text-xs sm:text-sm"
                onClick={() => setTab('history')}
              >
                <span className="sm:hidden">Historial{tab === 'history' ? ` (${total})` : ''}</span>
                <span className="hidden sm:inline">Atendidas / Canceladas{tab === 'history' ? ` (${total})` : ''}</span>
              </Button>
            </div>

          {appointments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={tab === 'pending' ? 'Sin citas por atender' : 'Sin citas atendidas/canceladas'}
              description="Aún no hay registros para esta vista. Ajusta filtros o crea una nueva cita."
            />
          ) : tab === 'history' ? (
            <>
              <div className="hidden min-w-0 md:block">
                <AgendaAppointmentsTable appointments={appointments} onSelect={handleSelect} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {appointments.map((appt) => (
                  <AppointmentCard key={appt.id} appointment={appt} onSelect={handleSelect} />
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {appointments.map((appt) => (
                <AppointmentCard key={appt.id} appointment={appt} onSelect={handleSelect} />
              ))}
            </div>
          )}

          {total > 0 && (
            <div className="pt-4">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <AppointmentDetailModal
        appointment={selectedAppt}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setSelectedAppt(null)
        }}
        onStatusChange={handleStatusChange}
        tenantId={tenantId}
        onAppointmentUpdated={reload}
      />

      <CreateAppointmentModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
      />
    </div>
  )
}

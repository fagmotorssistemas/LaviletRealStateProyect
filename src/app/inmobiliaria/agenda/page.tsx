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
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>
          <p className="text-sm text-gray-500 mt-1">
            Citas y agendamientos con clientes
            {total > 0 && <span className="ml-2 text-gray-400">• {total} citas</span>}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} className="mr-2" />
          Nueva Cita
        </Button>
      </div>

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
            <div className="flex flex-col gap-1.5 w-full">
              <label className="text-sm font-medium text-gray-700">{datePreset === 'exact' ? 'Fecha exacta' : 'Desde'}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  updateDateFrom(e.target.value)
                  if (datePreset === 'exact') updateDateTo(e.target.value)
                }}
                className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#2B1A18] transition-colors"
              />
            </div>
            {datePreset === 'custom' && (
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-gray-700">Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => updateDateTo(e.target.value)}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#2B1A18] transition-colors"
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
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <Button
                variant={tab === 'pending' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setTab('pending')}
              >
                Por atender{tab === 'pending' ? ` (${total})` : ''}
              </Button>
              <Button
                variant={tab === 'history' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setTab('history')}
              >
                Atendidas / Canceladas{tab === 'history' ? ` (${total})` : ''}
              </Button>
            </div>
          </div>

          {appointments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={tab === 'pending' ? 'Sin citas por atender' : 'Sin citas atendidas/canceladas'}
              description="Aún no hay registros para esta vista. Ajusta filtros o crea una nueva cita."
            />
          ) : tab === 'pending' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {appointments.map((appt) => (
                <AppointmentCard key={appt.id} appointment={appt} onSelect={handleSelect} />
              ))}
            </div>
          ) : (
            <AgendaAppointmentsTable appointments={appointments} onSelect={handleSelect} />
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

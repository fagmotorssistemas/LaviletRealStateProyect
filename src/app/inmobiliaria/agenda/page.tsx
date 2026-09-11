'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarDays, Plus } from 'lucide-react'
import { useAgenda } from '@/hooks/inmobiliaria/useAgenda'
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
import type { AgendaCoordinationStats, AgendaTab, Appointment } from '@/types/inmobiliaria'
import { AgendaAppointmentsTable } from '@/components/inmobiliaria/agenda/AgendaAppointmentsTable'
import {
  lastDaysPresetRange,
  nextDaysPresetRange,
  todayPresetRange,
} from '@/lib/inmobiliaria/agendaTime'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { countAgendaCoordinationStats } from '@/services/inmobiliaria.service'

const TABS: { id: AgendaTab; label: string; short: string }[] = [
  { id: 'solicitudes', label: 'Solicitudes', short: 'Solicitudes' },
  { id: 'esperando', label: 'Esperando al cliente', short: 'Esperando' },
  { id: 'proximas', label: 'Confirmadas', short: 'Confirmadas' },
  { id: 'canceladas', label: 'Canceladas', short: 'Canceladas' },
  { id: 'historial', label: 'Historial', short: 'Historial' },
]

const EMPTY: Record<AgendaTab, { title: string; description: string }> = {
  solicitudes: {
    title: 'Sin solicitudes pendientes',
    description: 'Visitas nuevas y reprogramaciones que esperan revisión del asesor, incluida coordinación si no hay responsable.',
  },
  esperando: {
    title: 'Nada esperando al cliente',
    description: 'Aquí aparecen propuestas de horario enviadas al cliente que todavía no acepta.',
  },
  proximas: {
    title: 'Sin citas confirmadas',
    description: 'Las citas aceptadas o reprogramadas pendientes de atención aparecen aquí, incluidas las vencidas.',
  },
  canceladas: { title: 'Sin citas canceladas', description: 'Las visitas canceladas aparecen aquí con su historial.' },
  historial: {
    title: 'Sin historial',
    description: 'Visitas realizadas e inasistencias registradas.',
  },
}

export default function AgendaPage() {
  const searchParams = useSearchParams()
  const {
    appointments,
    isLoading,
    tenantId,
    tenantIds,
    tab,
    setTab,
    counts,
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
  const { supabase, user, profile } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [startInConfirm, setStartInConfirm] = useState(false)
  const [datePreset, setDatePreset] = useState<'all' | 'today' | '7' | 'next7' | '30' | 'exact' | 'custom'>('all')
  const [stats, setStats] = useState<AgendaCoordinationStats | null>(null)

  useEffect(() => {
    const appointmentId = searchParams.get('appointment')
    if (!appointmentId) return
    const match = appointments.find((row) => row.id === appointmentId)
    setSelectedAppt(match ?? ({ id: appointmentId } as Appointment))
    setDetailOpen(true)
  }, [appointments, searchParams])

  useEffect(() => {
    if (!user) return
    const scope = getDataAccessScope(user.id, profile?.role)
    if (!scope) return
    void getAccessibleTenantIds(supabase)
      .then((ids) => {
        if (!ids.length) return
        return countAgendaCoordinationStats(supabase, {
          tenantIds: ids,
          userId: scope.userId,
          isAdmin: scope.isAdmin,
        }).then(setStats)
      })
      .catch(console.error)
  }, [profile?.role, supabase, user])

  const dateFilterLabel =
    tab === 'solicitudes'
      ? 'Fecha de recepción'
      : tab === 'proximas'
        ? 'Fecha de la visita'
        : 'Fecha de visita o recepción'

  const applyDatePreset = (preset: typeof datePreset) => {
    if (preset === 'all') {
      updateDateFrom('')
      updateDateTo('')
      return
    }
    if (preset === 'today') {
      const range = todayPresetRange()
      updateDateFrom(range.from)
      updateDateTo(range.to)
      return
    }
    if (preset === '7') {
      const range = lastDaysPresetRange(7)
      updateDateFrom(range.from)
      updateDateTo(range.to)
      return
    }
    if (preset === 'next7') {
      const range = nextDaysPresetRange(7)
      updateDateFrom(range.from)
      updateDateTo(range.to)
      return
    }
    if (preset === '30') {
      const range = lastDaysPresetRange(30)
      updateDateFrom(range.from)
      updateDateTo(range.to)
      return
    }
    if (preset === 'exact') {
      const t = dateFrom || todayPresetRange().from
      updateDateFrom(t)
      updateDateTo(t)
    }
  }

  const openDetail = (appt: Appointment, confirm = false) => {
    setSelectedAppt(appt)
    setStartInConfirm(confirm)
    setDetailOpen(true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Citas y seguimiento"
        title="Agenda"
        description={
          <>
            Solicitudes de visita, confirmación y asistencia
            {total > 0 && <span className="text-[#9a7d55]"> · {total} en esta vista</span>}
          </>
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-2" />
            Nueva cita
          </Button>
        }
      />

      <div className="crm-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-active={tab === item.id}
            onClick={() => setTab(item.id)}
            className="crm-tab"
          >
            <span className="sm:hidden">{item.short}</span>
            <span className="hidden sm:inline">{item.label}</span>
            <span className="ml-1 text-[11px] opacity-70">({counts[item.id] ?? 0})</span>
          </button>
        ))}
      </div>

      {stats ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: 'Citas recibidas del bot', value: stats.botReceived },
            { label: 'Solicitudes pendientes', value: stats.pendingReview },
            { label: 'Esperando al cliente', value: stats.waitingClient },
            { label: 'Citas confirmadas', value: stats.confirmed },
            { label: 'Citas canceladas', value: stats.cancelled },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-[#e2e4dc] bg-[#f7f7f3] px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-[#7a7e70]">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-[#3a3d36]">{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={updateSearch}
        searchPlaceholder="Buscar por cliente, teléfono, título o nota..."
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
            { value: 'all', label: `${dateFilterLabel}: Todo` },
            { value: 'today', label: `${dateFilterLabel}: Hoy` },
            { value: '7', label: `${dateFilterLabel}: Últimos 7 días` },
            { value: 'next7', label: `${dateFilterLabel}: Próximos 7 días` },
            { value: '30', label: `${dateFilterLabel}: Últimos 30 días` },
            { value: 'exact', label: `${dateFilterLabel}: Exacta` },
            { value: 'custom', label: `${dateFilterLabel}: Rango` },
          ]}
          placeholder="Fecha"
          value={datePreset}
          onChange={(e) => {
            const value = e.target.value as typeof datePreset
            setDatePreset(value)
            applyDatePreset(value)
          }}
          className="w-full"
        />

        {(datePreset === 'exact' || datePreset === 'custom') && (
          <>
            <div className="flex w-full min-w-0 flex-col gap-1.5">
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
              <div className="flex w-full min-w-0 flex-col gap-1.5">
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
          {appointments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={EMPTY[tab].title}
              description={EMPTY[tab].description}
            />
          ) : ['historial', 'canceladas'].includes(tab) ? (
            <>
              <div className="hidden min-w-0 md:block">
                <AgendaAppointmentsTable
                  appointments={appointments}
                  onSelect={(appt) => openDetail(appt)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {appointments.map((appt) => (
                  <AppointmentCard key={appt.id} appointment={appt} onSelect={(item) => openDetail(item)} />
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {appointments.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appointment={appt}
                  onSelect={(item) => openDetail(item)}
                  onConfirm={(item) => openDetail(item, true)}
                />
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
        startInConfirm={startInConfirm}
        onClose={() => {
          setDetailOpen(false)
          setSelectedAppt(null)
          setStartInConfirm(false)
        }}
        tenantId={tenantId}
        onAppointmentUpdated={reload}
      />

      <CreateAppointmentModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        tenantId={tenantId}
        tenantIds={tenantIds}
      />
    </div>
  )
}

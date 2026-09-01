'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listAppointments } from '@/services/inmobiliaria.service'
import type { Appointment, AppointmentStatus } from '@/types/inmobiliaria'

interface Filters {
  status: string
  responsibleId: string
}

type AgendaTab = 'pending' | 'history'

const PENDING_STATUSES: AppointmentStatus[] = ['pendiente', 'aceptado', 'reprogramado']
const HISTORY_STATUSES: AppointmentStatus[] = ['atendido', 'cancelado']

export function useAgenda() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<AgendaTab>('pending')
  const [filters, setFilters] = useState<Filters>({
    status: '',
    responsibleId: '',
  })

  const statusIn: AppointmentStatus[] = tab === 'pending' ? PENDING_STATUSES : HISTORY_STATUSES

  const loadAppointments = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setAppointments([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const tenantIds = await getAccessibleTenantIds(supabase)
      if (!tenantIds.length) {
        setAppointments([])
        setTotal(0)
        return
      }
      setTenantId(tenantIds[0])

      const res = await listAppointments(supabase, {
        tenantId: tenantIds[0],
        tenantIds,
        statuses: statusIn,
        responsibleId: filters.responsibleId || undefined,
        search: search || undefined,
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
        page,
        pageSize,
      })
      setAppointments(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'No se pudieron cargar las citas'
      toast.error(message)
      setAppointments([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, search, dateFrom, dateTo, statusIn, authLoading, user])

  useEffect(() => { loadAppointments() }, [loadAppointments])

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const setTabAndReset = (next: AgendaTab) => {
    setTab(next)
    setPage(1)
  }

  const updateSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const updateDateFrom = (value: string) => {
    setDateFrom(value)
    setPage(1)
  }

  const updateDateTo = (value: string) => {
    setDateTo(value)
    setPage(1)
  }

  const pending = appointments
  const history = appointments

  return {
    appointments,
    pending,
    history,
    isLoading,
    tenantId,
    filters,
    tab,
    setTab: setTabAndReset,
    updateFilter,
    search,
    updateSearch,
    dateFrom,
    updateDateFrom,
    dateTo,
    updateDateTo,
    reload: loadAppointments,
    page,
    pageSize,
    total,
    setPage,
  }
}

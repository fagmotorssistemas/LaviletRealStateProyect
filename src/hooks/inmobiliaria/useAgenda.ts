'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
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
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<AgendaTab>('pending')
  const [filters, setFilters] = useState<Filters>({
    status: '',
    responsibleId: '',
  })

  const statusIn: AppointmentStatus[] = tab === 'pending' ? PENDING_STATUSES : HISTORY_STATUSES

  const loadAppointments = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single()
      if (!tenant) { setIsLoading(false); return }
      setTenantId(tenant.id)

      const res = await listAppointments(supabase, {
        tenantId: tenant.id,
        statuses: statusIn,
        responsibleId: filters.responsibleId || undefined,
        search: search || undefined,
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
        page,
        pageSize,
        scope,
      })
      setAppointments(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, search, dateFrom, dateTo, statusIn, scope])

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

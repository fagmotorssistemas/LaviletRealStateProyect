'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { countAgendaTabs, listAppointments } from '@/services/inmobiliaria.service'
import type { AgendaTab, Appointment } from '@/types/inmobiliaria'

export function useAgenda() {
  const { supabase, user, profile, isLoading: authLoading } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [tenantIds, setTenantIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<AgendaTab>('solicitudes')
  const [counts, setCounts] = useState({ solicitudes: 0, esperando: 0, proximas: 0, historial: 0 })
  const requestId = useRef(0)

  const scope = useMemo(
    () => getDataAccessScope(user?.id, profile?.role),
    [user?.id, profile?.role],
  )

  const loadAppointments = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setAppointments([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    const current = ++requestId.current
    setIsLoading(true)
    try {
      const ids = await getAccessibleTenantIds(supabase)
      if (current !== requestId.current) return
      if (!ids.length) {
        setAppointments([])
        setTotal(0)
        setCounts({ solicitudes: 0, esperando: 0, proximas: 0, historial: 0 })
        return
      }
      setTenantIds(ids)
      setTenantId(ids[0])

      const [res, nextCounts] = await Promise.all([
        listAppointments(supabase, {
          tenantId: ids[0],
          tenantIds: ids,
          tab,
          search: search || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize,
          scope,
        }),
        countAgendaTabs(supabase, {
          tenantId: ids[0],
          tenantIds: ids,
          scope,
          search: search || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      ])
      if (current !== requestId.current) return
      setAppointments(res.data)
      setTotal(res.total)
      setCounts(nextCounts)
    } catch (err) {
      if (current !== requestId.current) return
      console.error(err)
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message?: unknown }).message)
            : 'No se pudieron cargar las citas'
      toast.error(message)
      setAppointments([])
      setTotal(0)
    } finally {
      if (current === requestId.current) setIsLoading(false)
    }
  }, [supabase, page, pageSize, search, dateFrom, dateTo, tab, authLoading, user, scope])

  useEffect(() => {
    void loadAppointments()
  }, [loadAppointments])

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

  return {
    appointments,
    isLoading,
    tenantId,
    tenantIds,
    tab,
    setTab: setTabAndReset,
    counts,
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

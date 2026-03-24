'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { listShowroomVisits } from '@/services/inmobiliaria.service'
import type { ShowroomVisit, ShowroomVisitSource } from '@/types/inmobiliaria'

interface Filters {
  projectId: string
  salespersonId: string
  source: ShowroomVisitSource | ''
}

export function useShowroom() {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [visits, setVisits] = useState<ShowroomVisit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    projectId: '',
    salespersonId: '',
    source: '',
  })

  const loadVisits = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single()
      if (!tenant) { setIsLoading(false); return }
      setTenantId(tenant.id)

      const res = await listShowroomVisits(supabase, {
        tenantId: tenant.id,
        projectId: filters.projectId || undefined,
        salespersonId: filters.salespersonId || undefined,
        source: filters.source ? filters.source : undefined,
        search: search || undefined,
        page,
        pageSize,
        scope,
      })
      setVisits(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, search, scope])

  useEffect(() => { loadVisits() }, [loadVisits])

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const reset = () => {
    setSearch('')
    setFilters({ projectId: '', salespersonId: '', source: '' })
    setPage(1)
  }

  const updateSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  return {
    visits,
    isLoading,
    tenantId,
    filters,
    search,
    updateSearch,
    updateFilter,
    reset,
    reload: loadVisits,
    page,
    pageSize,
    total,
    setPage,
  }
}

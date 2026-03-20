'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { listShowroomVisits } from '@/services/inmobiliaria.service'
import type { LocationType, ShowroomVisit } from '@/types/inmobiliaria'

interface Filters {
  projectId: string
  salespersonId: string
  source: string
}

export function useShowroom() {
  const { supabase } = useAuth()
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
        source: (filters.source || undefined) as LocationType | undefined,
        search: search || undefined,
        page,
        pageSize,
      })
      setVisits(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, search])

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

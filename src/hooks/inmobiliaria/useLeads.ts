'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { listLeads } from '@/services/inmobiliaria.service'
import type { Lead, LeadStatus } from '@/types/inmobiliaria'

interface Filters {
  status: string
  search: string
  assignedTo: string
}

export function useLeads() {
  const { supabase } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    status: '',
    search: '',
    assignedTo: '',
  })

  const loadLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single()
      if (!tenant) { setIsLoading(false); return }
      setTenantId(tenant.id)

      const res = await listLeads(supabase, {
        tenantId: tenant.id,
        status: (filters.status || undefined) as LeadStatus | undefined,
        search: filters.search || undefined,
        assignedTo: filters.assignedTo || undefined,
        page,
        pageSize,
      })
      setLeads(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize])

  useEffect(() => { loadLeads() }, [loadLeads])

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters({ status: '', search: '', assignedTo: '' })
    setPage(1)
  }

  return {
    leads,
    isLoading,
    tenantId,
    filters,
    updateFilter,
    resetFilters,
    reload: loadLeads,
    page,
    pageSize,
    total,
    setPage,
  }
}

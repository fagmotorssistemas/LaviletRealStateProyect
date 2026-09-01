'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listShowroomVisits } from '@/services/inmobiliaria.service'
import type { ShowroomVisit, ShowroomVisitSource, TeamProfile } from '@/types/inmobiliaria'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'

interface Filters {
  projectId: string
  salespersonId: string
  source: ShowroomVisitSource | ''
}

export function useShowroom() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [visits, setVisits] = useState<ShowroomVisit[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    projectId: '',
    salespersonId: '',
    source: '',
  })

  const loadVisits = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setVisits([])
      setAdvisors([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [tenantIds, profiles] = await Promise.all([
        getAccessibleTenantIds(supabase),
        listTeamProfilesAction().catch(() => [] as TeamProfile[]),
      ])
      setAdvisors(profiles)

      if (!tenantIds.length) {
        setVisits([])
        setTotal(0)
        return
      }
      setTenantId(tenantIds[0])

      const res = await listShowroomVisits(supabase, {
        tenantId: tenantIds[0],
        tenantIds,
        projectId: filters.projectId || undefined,
        salespersonId: filters.salespersonId || undefined,
        source: filters.source ? filters.source : undefined,
        search: search || undefined,
        page,
        pageSize,
      })

      const byId = new Map(profiles.map((p) => [p.id, p]))
      for (const visit of res.data) {
        if (!visit.salesperson_id) continue
        const advisor = byId.get(visit.salesperson_id)
        if (advisor) {
          visit.salesperson = { full_name: advisor.full_name, avatar_url: advisor.avatar_url }
        }
      }

      setVisits(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'No se pudieron cargar las visitas'
      toast.error(message)
      setVisits([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, search, authLoading, user])

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
    advisors,
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

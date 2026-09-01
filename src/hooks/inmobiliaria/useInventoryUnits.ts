'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { listUnits, listProjects } from '@/services/inmobiliaria.service'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import type { Unit, Project, UnitStatus, InventorySortOption } from '@/types/inmobiliaria'

interface Filters {
  search: string
  projectId: string
  status: string
  category: string
  sortBy: InventorySortOption
}

export function useInventoryUnits() {
  const { supabase } = useAuth()
  const [units, setUnits] = useState<Unit[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tenantIds, setTenantIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    search: '',
    projectId: '',
    status: '',
    category: '',
    sortBy: 'unit_natural',
  })

  const tenantId = tenantIds[0] ?? projects[0]?.tenant_id ?? ''

  const loadProjects = useCallback(async () => {
    try {
      const tenantIds = await getAccessibleTenantIds(supabase)
      if (tenantIds.length) {
        setTenantIds(tenantIds)
        const projectList = await listProjects(supabase, tenantIds[0], tenantIds)
        setProjects(projectList)
        return { tenantId: tenantIds[0], tenantIds }
      }
    } catch { /* no tenant yet */ }
    return { tenantId: '', tenantIds: [] as string[] }
  }, [supabase])

  const loadUnits = useCallback(async (tId: string, tenantIds?: string[]) => {
    if (!tId) { setIsLoading(false); return }
    setIsLoading(true)
    try {
      const res = await listUnits(supabase, {
        tenantId: tId,
        tenantIds: tenantIds?.length ? tenantIds : [tId],
        projectId: filters.projectId || undefined,
        status: (filters.status || undefined) as UnitStatus | undefined,
        category: filters.category || undefined,
        search: filters.search.trim() || undefined,
        page,
        pageSize,
        sort: filters.sortBy,
      })
      setUnits(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize])

  useEffect(() => {
    loadProjects().then(({ tenantId: tId }) => {
      if (!tId) setIsLoading(false)
    })
  }, [loadProjects])

  useEffect(() => {
    if (tenantId) loadUnits(tenantId, tenantIds)
  }, [tenantId, tenantIds, loadUnits])

  const reload = () => {
    if (tenantId) loadUnits(tenantId, tenantIds)
  }

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters({ search: '', projectId: '', status: '', category: '', sortBy: 'unit_natural' })
    setPage(1)
  }

  return {
    units,
    projects,
    isLoading,
    filters,
    tenantId,
    updateFilter,
    resetFilters,
    reload,
    page,
    pageSize,
    total,
    setPage,
  }
}

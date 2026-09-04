'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listInventoryAction } from '@/app/inmobiliaria/inventario/actions'
import type { InventorySortOption, Project, Unit } from '@/types/inmobiliaria'

interface Filters {
  search: string
  projectId: string
  status: string
  category: string
  sortBy: InventorySortOption
}

export function useInventoryUnits() {
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

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await listInventoryAction({
        projectId: filters.projectId || undefined,
        status: filters.status || undefined,
        category: filters.category || undefined,
        search: filters.search.trim() || undefined,
        sortBy: filters.sortBy,
        page,
        pageSize,
      })
      setTenantIds(res.tenantIds)
      setProjects(res.projects)
      setUnits(res.units)
      setTotal(res.total)
      if (res.error) toast.error(res.error)
    } catch (err) {
      console.error(err)
      toast.error('No se pudo cargar el inventario')
    } finally {
      setIsLoading(false)
    }
  }, [filters, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

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
    reload: load,
    page,
    pageSize,
    total,
    setPage,
  }
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import type { InventorySortOption, Project, Unit } from '@/types/inmobiliaria'

interface Filters {
  search: string
  projectId: string
  status: string
  category: string
  sortBy: InventorySortOption
}

type InventoryPayload = {
  tenantIds?: string[]
  projects?: Project[]
  units?: Unit[]
  unitTypes?: { id: string; name: string }[]
  total?: number
  error?: string
}

async function fetchInventory(params: URLSearchParams): Promise<InventoryPayload> {
  const res = await fetch(`/api/inmobiliaria/inventory?${params}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(20_000),
  })
  const payload = (await res.json().catch(() => ({}))) as InventoryPayload
  if (!res.ok && !payload.error) {
    throw new Error(payload.error || `No se pudo cargar el inventario (${res.status})`)
  }
  return payload
}

export function useInventoryUnits() {
  const { user } = useAuth()
  const [units, setUnits] = useState<Unit[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [unitTypes, setUnitTypes] = useState<{ id: string; name: string }[]>([])
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
    if (!user) {
      setUnits([])
      setProjects([])
      setUnitTypes([])
      setTenantIds([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const query = new URLSearchParams()
    if (filters.projectId) query.set('projectId', filters.projectId)
    if (filters.status) query.set('status', filters.status)
    if (filters.category) query.set('category', filters.category)
    if (filters.search.trim()) query.set('search', filters.search.trim())
    if (filters.sortBy) query.set('sortBy', filters.sortBy)
    query.set('page', String(page))
    query.set('pageSize', String(pageSize))

    try {
      let payload = await fetchInventory(query)
      if (payload.error && /autenticado|acceso/i.test(payload.error)) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        payload = await fetchInventory(query)
      }
      setTenantIds(payload.tenantIds ?? [])
      setProjects(payload.projects ?? [])
      setUnitTypes(payload.unitTypes ?? [])
      setUnits(payload.units ?? [])
      setTotal(payload.total ?? 0)
      if (payload.error && !(payload.units ?? []).length) toast.error(payload.error)
    } catch (err) {
      console.error(err)
      toast.error('No se pudo cargar el inventario')
      setUnits([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [user, filters, page, pageSize])

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
    unitTypes,
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

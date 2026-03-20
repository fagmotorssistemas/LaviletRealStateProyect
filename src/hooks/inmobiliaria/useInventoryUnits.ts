'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { listUnits, listProjects } from '@/services/inmobiliaria.service'
import type { Unit, Project, UnitStatus } from '@/types/inmobiliaria'

interface Filters {
  projectId: string
  status: string
  category: string
  search: string
}

export function useInventoryUnits() {
  const { supabase } = useAuth()
  const [units, setUnits] = useState<Unit[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    projectId: '',
    status: '',
    category: '',
    search: '',
  })

  // TODO: replace with real tenant from auth context
  const tenantId = projects[0]?.tenant_id ?? ''

  const loadProjects = useCallback(async () => {
    try {
      const { data } = await supabase.from('tenants').select('id').limit(1).single()
      if (data) {
        const projectList = await listProjects(supabase, data.id)
        setProjects(projectList)
        return data.id
      }
    } catch { /* no tenant yet */ }
    return ''
  }, [supabase])

  const loadUnits = useCallback(async (tId: string) => {
    if (!tId) { setIsLoading(false); return }
    setIsLoading(true)
    try {
      const res = await listUnits(supabase, {
        tenantId: tId,
        projectId: filters.projectId || undefined,
        status: (filters.status || undefined) as UnitStatus | undefined,
        category: filters.category || undefined,
        search: filters.search || undefined,
        page,
        pageSize,
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
    loadProjects().then((tId) => {
      if (tId) loadUnits(tId)
      else setIsLoading(false)
    })
  }, [loadProjects])

  useEffect(() => {
    if (tenantId) loadUnits(tenantId)
  }, [tenantId, loadUnits])

  const reload = () => {
    if (tenantId) loadUnits(tenantId)
  }

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters({ projectId: '', status: '', category: '', search: '' })
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

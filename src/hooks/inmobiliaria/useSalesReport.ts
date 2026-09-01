'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects } from '@/services/inmobiliaria.service'
import { listSalesClosingsAction } from '@/app/inmobiliaria/ventas/actions'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'
import type { Project, TeamProfile, UnitSalesClosing } from '@/types/inmobiliaria'

export function useSalesReport() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [closings, setClosings] = useState<UnitSalesClosing[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [soldById, setSoldById] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setClosings([])
      setProjects([])
      setAdvisors([])
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
        setClosings([])
        setProjects([])
        return
      }
      setTenantId(tenantIds[0])

      const [projectRows, closingRows] = await Promise.all([
        listProjects(supabase, tenantIds[0], tenantIds),
        listSalesClosingsAction({
          tenantIds,
          projectId: projectId || undefined,
          soldById: soldById || undefined,
          from: from || undefined,
          to: to || undefined,
          search: search || undefined,
        }),
      ])

      setProjects(projectRows)
      setClosings(closingRows)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el reporte de ventas')
      setClosings([])
    } finally {
      setIsLoading(false)
    }
  }, [supabase, user, authLoading, projectId, soldById, from, to, search])

  useEffect(() => {
    load()
  }, [load])

  const summary = useMemo(() => {
    const count = closings.length
    const total = closings.reduce((sum, row) => sum + (row.sale_price_final || 0), 0)
    const published = closings.reduce((sum, row) => sum + (row.published_price_snapshot || 0), 0)
    const discount = closings.reduce((sum, row) => {
      if (row.published_price_snapshot == null) return sum
      return sum + (row.published_price_snapshot - row.sale_price_final)
    }, 0)
    const avg = count ? total / count : 0
    return { count, total, published, discount, avg }
  }, [closings])

  const reset = () => {
    setSearch('')
    setProjectId('')
    setSoldById('')
    setFrom('')
    setTo('')
  }

  return {
    closings,
    summary,
    projects,
    advisors,
    isLoading,
    tenantId,
    search,
    setSearch,
    projectId,
    setProjectId,
    soldById,
    setSoldById,
    from,
    setFrom,
    to,
    setTo,
    reset,
    reload: load,
  }
}

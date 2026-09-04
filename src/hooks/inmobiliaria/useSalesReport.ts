'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import type { Project, TeamProfile, UnitSalesClosing } from '@/types/inmobiliaria'

type SalesPayload = {
  tenantId?: string
  closings?: UnitSalesClosing[]
  projects?: Project[]
  advisors?: TeamProfile[]
  error?: string
}

async function fetchSales(params: URLSearchParams): Promise<SalesPayload> {
  const res = await fetch(`/api/inmobiliaria/sales?${params}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(20_000),
  })
  const payload = (await res.json().catch(() => ({}))) as SalesPayload
  if (!res.ok && !payload.error) {
    throw new Error(payload.error || `No se pudo cargar ventas (${res.status})`)
  }
  return payload
}

export function useSalesReport() {
  const { user } = useAuth()
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
    if (!user) {
      setClosings([])
      setProjects([])
      setAdvisors([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const query = new URLSearchParams()
    if (projectId) query.set('projectId', projectId)
    if (soldById) query.set('soldById', soldById)
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (search.trim()) query.set('search', search.trim())

    try {
      let payload = await fetchSales(query)
      if (payload.error && /autenticado|acceso/i.test(payload.error)) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        payload = await fetchSales(query)
      }
      setTenantId(payload.tenantId ?? '')
      setProjects(payload.projects ?? [])
      setAdvisors(payload.advisors ?? [])
      setClosings(payload.closings ?? [])
      if (payload.error && !(payload.closings ?? []).length) toast.error(payload.error)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el reporte de ventas')
      setClosings([])
    } finally {
      setIsLoading(false)
    }
  }, [user, projectId, soldById, from, to, search])

  useEffect(() => {
    void load()
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

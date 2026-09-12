'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects } from '@/services/inmobiliaria.service'
import {
  getLeadAutomationDetail,
  getLeadAutomationKpis,
  listLeadAutomationDashboard,
} from '@/services/leadAutomation.service'
import {
  EMPTY_AUTOMATION_FILTERS,
  EMPTY_AUTOMATION_KPIS,
  filtersFromSearchParams,
  hasActiveAutomationFilters,
  searchParamsFromFilters,
  toInclusiveRange,
} from '@/lib/inmobiliaria/leadAutomation'
import type { Project, TeamProfile } from '@/types/inmobiliaria'
import type { LeadAutomationDetail, LeadAutomationFilters, LeadAutomationRow } from '@/types/leadAutomation'

const PAGE_SIZE = 25

export function useLeadAutomationDashboard() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()

  const filters = useMemo(
    () => filtersFromSearchParams(new URLSearchParams(searchKey)),
    [searchKey],
  )
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const selectedLeadId = searchParams.get('lead')

  const [rows, setRows] = useState<LeadAutomationRow[]>([])
  const [kpis, setKpis] = useState(EMPTY_AUTOMATION_KPIS)
  const [projects, setProjects] = useState<Project[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [tenantIds, setTenantIds] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const loadSequence = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<LeadAutomationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const tenantId = tenantIds[0] ?? ''

  const replaceParams = useCallback(
    (nextFilters: LeadAutomationFilters, nextPage: number, leadId: string | null) => {
      const params = searchParamsFromFilters(nextFilters, nextPage, leadId)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router],
  )

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    if (authLoading) return
    if (!user) {
      setRows([])
      setKpis(EMPTY_AUTOMATION_KPIS)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const ids = await getAccessibleTenantIds(supabase)
      if (sequence !== loadSequence.current) return
      setTenantIds(ids)
      if (!ids.length) {
        setRows([])
        setKpis(EMPTY_AUTOMATION_KPIS)
        setProjects([])
        setTotal(0)
        return
      }

      const range = toInclusiveRange(filters.from, filters.to)
      const [projectRows, profileRows, list, kpiRows] = await Promise.all([
        listProjects(supabase, ids[0], ids),
        supabase.from('profiles').select('id, full_name, role, avatar_url, is_active').order('full_name', { ascending: true }),
        listLeadAutomationDashboard(supabase, {
          tenantId: ids[0],
          tenantIds: ids,
          filters,
          page,
          pageSize: PAGE_SIZE,
        }),
        getLeadAutomationKpis(supabase, {
          tenantId: ids[0],
          projectId: filters.projectId || undefined,
          from: range.from,
          to: range.to,
        }),
      ])

      if (sequence !== loadSequence.current) return
      if (profileRows.error) throw profileRows.error

      setProjects(projectRows)
      setAdvisors(((profileRows.data ?? []) as TeamProfile[]).filter((profile) => profile.is_active !== false))
      setRows(list.data)
      setTotal(list.total)
      setKpis(kpiRows)
      setUpdatedAt(new Date().toISOString())
    } catch (err) {
      if (sequence !== loadSequence.current) return
      const message = err instanceof Error ? err.message : 'No se pudo cargar el monitoreo'
      setError(message)
      setRows([])
      setKpis(EMPTY_AUTOMATION_KPIS)
      toast.error(message)
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false)
    }
  }, [authLoading, filters, page, supabase, user])

  useEffect(() => {
    void load()
    return () => { loadSequence.current++ }
  }, [load])

  useEffect(() => {
    if (!selectedLeadId || !tenantIds.length) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    getLeadAutomationDetail(supabase, selectedLeadId, tenantIds)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'No se pudo cargar el detalle'
        if (!cancelled) {
          setDetail(null)
          setDetailError(message)
          toast.error(message)
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedLeadId, supabase, tenantIds])

  const updateFilter = (key: keyof LeadAutomationFilters, value: string) => {
    replaceParams({ ...filters, [key]: value }, 1, selectedLeadId)
  }

  const updateFilters = (patch: Partial<LeadAutomationFilters>) => {
    replaceParams({ ...filters, ...patch }, 1, selectedLeadId)
  }

  const resetFilters = () => {
    replaceParams(EMPTY_AUTOMATION_FILTERS, 1, selectedLeadId)
  }

  const setPage = (nextPage: number) => {
    replaceParams(filters, nextPage, selectedLeadId)
  }

  const openLead = (leadId: string) => {
    replaceParams(filters, page, leadId)
  }

  const closeLead = () => {
    replaceParams(filters, page, null)
  }

  return {
    rows,
    kpis,
    projects,
    advisors,
    tenantId,
    isLoading,
    updatedAt,
    error,
    total,
    page,
    pageSize: PAGE_SIZE,
    filters,
    hasFilters: hasActiveAutomationFilters(filters),
    selectedLeadId,
    detail,
    detailLoading,
    detailError,
    updateFilter,
    updateFilters,
    resetFilters,
    setPage,
    openLead,
    closeLead,
    reload: load,
  }
}

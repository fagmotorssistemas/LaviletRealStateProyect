'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listLeads } from '@/services/inmobiliaria.service'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'
import type { Lead, LeadStatus, LeadTemperature, TeamProfile } from '@/types/inmobiliaria'

interface Filters {
  status: string
  temperature: string
  search: string
  assignedTo: string
}

export function useLeads() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    status: '',
    temperature: '',
    search: '',
    assignedTo: '',
  })

  const loadLeads = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setLeads([])
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
        setLeads([])
        setTotal(0)
        return
      }
      setTenantId(tenantIds[0])

      const res = await listLeads(supabase, {
        tenantId: tenantIds[0],
        tenantIds,
        status: (filters.status || undefined) as LeadStatus | undefined,
        temperature: (filters.temperature || undefined) as LeadTemperature | undefined,
        search: filters.search || undefined,
        assignedTo: filters.assignedTo || undefined,
        page,
        pageSize,
      })

      const byId = new Map(profiles.map((p) => [p.id, p]))
      for (const lead of res.data) {
        if (!lead.assigned_to) continue
        const advisor = byId.get(lead.assigned_to)
        if (advisor) {
          lead.assigned_profile = {
            full_name: advisor.full_name,
            avatar_url: advisor.avatar_url,
          }
        }
      }

      setLeads(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'No se pudieron cargar los leads'
      toast.error(message)
      setLeads([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }, [supabase, filters, page, pageSize, authLoading, user])

  useEffect(() => { loadLeads() }, [loadLeads])

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters({ status: '', temperature: '', search: '', assignedTo: '' })
    setPage(1)
  }

  return {
    leads,
    advisors,
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

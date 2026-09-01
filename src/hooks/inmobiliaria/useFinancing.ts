'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import {
  listLeads,
  listPaymentPlans,
  listProjects,
} from '@/services/inmobiliaria.service'
import {
  listAsesoriasFinanciamientoAction,
  listFinancingPartnersAction,
  listLeadFinancingAction,
} from '@/app/inmobiliaria/financiamiento/actions'
import type {
  AsesoriaFinanciamiento,
  FinancingPartner,
  Lead,
  LeadFinancing,
  PaymentPlan,
  Project,
} from '@/types/inmobiliaria'

export type FinancingTab = 'planes' | 'solicitudes' | 'asesorias' | 'interesados'

export function useFinancing() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [tab, setTab] = useState<FinancingTab>('solicitudes')
  const [tenantId, setTenantId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [requests, setRequests] = useState<LeadFinancing[]>([])
  const [asesorias, setAsesorias] = useState<AsesoriaFinanciamiento[]>([])
  const [interestedLeads, setInterestedLeads] = useState<Lead[]>([])
  const [partners, setPartners] = useState<FinancingPartner[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    if (authLoading) return
    if (!user) {
      setPlans([])
      setRequests([])
      setAsesorias([])
      setInterestedLeads([])
      setPartners([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const tenantIds = await getAccessibleTenantIds(supabase)
      if (!tenantIds.length) {
        setPlans([])
        setRequests([])
        setAsesorias([])
        setInterestedLeads([])
        setPartners([])
        return
      }
      setTenantId(tenantIds[0])

      const projectList = await listProjects(supabase, tenantIds[0], tenantIds)
      setProjects(projectList)
      const projectIds = projectList.map((p) => p.id)

      const [planRows, requestRows, asesoriaRows, leadRows, partnerRows] = await Promise.all([
        projectIds.length
          ? listPaymentPlans(supabase, {
              projectIds,
              projectId: projectId || undefined,
              search: search || undefined,
            })
          : Promise.resolve([] as PaymentPlan[]),
        listLeadFinancingAction({
          status: status || undefined,
          search: tab === 'solicitudes' ? search || undefined : undefined,
        }),
        listAsesoriasFinanciamientoAction({
          search: tab === 'asesorias' ? search || undefined : undefined,
        }),
        listLeads(supabase, {
          tenantId: tenantIds[0],
          tenantIds,
          financing: true,
          search: tab === 'interesados' ? search || undefined : undefined,
          page: 1,
          pageSize: 100,
        }),
        listFinancingPartnersAction(),
      ])

      setPlans(planRows)
      setRequests(requestRows)
      setAsesorias(asesoriaRows)
      setInterestedLeads(leadRows.data)
      setPartners(partnerRows)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar financiamiento')
      setPlans([])
      setRequests([])
      setAsesorias([])
      setInterestedLeads([])
      setPartners([])
    } finally {
      setIsLoading(false)
    }
  }, [supabase, user, authLoading, search, projectId, status, tab])

  useEffect(() => {
    load()
  }, [load])

  const resetFilters = () => {
    setSearch('')
    setProjectId('')
    setStatus('')
  }

  return {
    tab,
    setTab,
    tenantId,
    projects,
    plans,
    requests,
    asesorias,
    interestedLeads,
    partners,
    isLoading,
    search,
    setSearch,
    projectId,
    setProjectId,
    status,
    setStatus,
    resetFilters,
    reload: load,
  }
}

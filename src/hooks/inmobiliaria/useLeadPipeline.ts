'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listLeadPipelineAction } from '@/app/inmobiliaria/leads/pipeline-actions'
import type { Lead } from '@/types/inmobiliaria'
import type { LeadPipelineSnapshot, LeadPipelineStage, LeadPipelineIssue, LeadPipelineCoverage } from '@/types/leadPipeline'

export type LeadPipelineView = 'board' | 'list'

export interface LeadPipelineCard {
  lead: Lead
  pipeline: LeadPipelineSnapshot
}

export interface ListLeadPipelineInput {
  view?: LeadPipelineView
  search?: string
  stage?: LeadPipelineStage | ''
  nutrition?: 'active' | 'inactive' | ''
  appointment?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | ''
  outcome?: 'open' | 'lost' | 'won' | 'all'
  assignedTo?: string
  temperature?: string
  dateFrom?: string
  dateTo?: string
  sort?: 'actividad' | 'creado'
  page?: number
  pageSize?: number
  pages?: Partial<Record<LeadPipelineStage, number>>
}

export interface LeadPipelineColumn {
  stage: LeadPipelineStage
  total: number
  page: number
  pageSize: number
  leads: LeadPipelineCard[]
}

export interface LeadPipelineListData {
  columns: LeadPipelineColumn[]
  total: number
  items?: LeadPipelineCard[]
  page?: number
  pageSize?: number
  warnings?: string[]
  issues?: LeadPipelineIssue[]
  coverage?: LeadPipelineCoverage
}

export type ListLeadPipelineResult =
  | { ok: true; data: LeadPipelineListData; error?: never }
  | { ok: false; error: string; data?: never }

export type LeadPipelineFilters = Omit<ListLeadPipelineInput, 'view' | 'page' | 'pages' | 'pageSize'>

const INITIAL_FILTERS: LeadPipelineFilters = {
  search: '', stage: '', nutrition: '', appointment: '', outcome: 'open',
  assignedTo: '', temperature: '', dateFrom: '', dateTo: '', sort: 'actividad',
}

export function useLeadPipeline(enabled: boolean) {
  const [view, setView] = useState<LeadPipelineView>('board')
  const [filters, setFilters] = useState<LeadPipelineFilters>(INITIAL_FILTERS)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState<Partial<Record<LeadPipelineStage, number>>>({})
  const [data, setData] = useState<LeadPipelineListData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const requestId = useRef(0)
  const inFlight = useRef<number | null>(null)
  const hasData = useRef(false)

  const load = useCallback(async (background: boolean) => {
    if (!enabled) return
    if (background && inFlight.current !== null) return
    const id = ++requestId.current
    inFlight.current = id
    const preserve = background && hasData.current
    if (preserve) setIsRefreshing(true)
    else { setIsLoading(true); setError(null) }
    setRefreshError(null)
    try {
      const result: ListLeadPipelineResult = await listLeadPipelineAction({
        ...filters, view, page, pages, pageSize: view === 'board' ? 12 : 25,
      })
      if (id !== requestId.current) return
      if (!result.ok) throw Error(result.error)
      hasData.current = true
      setData(result.data)
      setError(null)
    } catch (reason) {
      if (id !== requestId.current) return
      const message = reason instanceof Error ? reason.message : 'No se pudo cargar el embudo de leads.'
      if (preserve) setRefreshError(message)
      else { setError(message); setData(null); hasData.current = false }
    } finally {
      if (inFlight.current === id) inFlight.current = null
      if (id === requestId.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [enabled, filters, view, page, pages])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => { void load(false) }, filters.search ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      requestId.current += 1
      inFlight.current = null
    }
  }, [enabled, filters.search, load])

  const updateFilter = useCallback(<K extends keyof LeadPipelineFilters>(key: K, value: LeadPipelineFilters[K]) => {
    setIsLoading(true)
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(1)
    setPages({})
  }, [])

  const resetFilters = useCallback(() => {
    setIsLoading(true)
    setFilters(INITIAL_FILTERS)
    setPage(1)
    setPages({})
  }, [])

  const changeView = useCallback((next: LeadPipelineView) => {
    setIsLoading(true)
    setView(next)
    setPage(1)
    setPages({})
  }, [])

  const setColumnPage = useCallback((stage: LeadPipelineStage, next: number) => {
    setIsLoading(true)
    setPages((previous) => ({ ...previous, [stage]: Math.max(1, next) }))
  }, [])

  const reload = useCallback(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [enabled, reload])

  return {
    view, changeView, filters, updateFilter, resetFilters, page, setPage,
    setColumnPage, data, isLoading, isRefreshing, error, refreshError, reload,
  }
}

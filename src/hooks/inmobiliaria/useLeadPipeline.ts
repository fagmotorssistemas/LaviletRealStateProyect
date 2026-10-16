'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listLeadPipelineAction } from '@/app/inmobiliaria/leads/pipeline-actions'
import type { Lead } from '@/types/inmobiliaria'
import type { LeadPipelineSnapshot, LeadPipelineStage } from '@/types/leadPipeline'

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
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const id = ++requestId.current
    const timer = window.setTimeout(async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result: ListLeadPipelineResult = await listLeadPipelineAction({
          ...filters, view, page, pages, pageSize: view === 'board' ? 12 : 25,
        })
        if (id !== requestId.current) return
        if (!result.ok) {
          setError(result.error)
          setData(null)
          return
        }
        setData(result.data)
      } catch (reason) {
        if (id !== requestId.current) return
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el embudo de leads.')
        setData(null)
      } finally {
        if (id === requestId.current) setIsLoading(false)
      }
    }, filters.search ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      if (requestId.current === id) requestId.current += 1
    }
  }, [enabled, filters, view, page, pages, refresh])

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
    setIsLoading(true)
    setRefresh((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [enabled, reload])

  return {
    view, changeView, filters, updateFilter, resetFilters, page, setPage,
    setColumnPage, data, isLoading, error, reload,
  }
}

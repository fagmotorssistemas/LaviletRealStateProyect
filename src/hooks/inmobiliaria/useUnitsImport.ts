'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { UnitImport } from '@/types/inmobiliaria'

interface Filters {
  search: string
  category: string
  floorNumber: string
  status: string
}

type UnitsImportResponse = {
  data?: UnitImport[]
  total?: number
  categories?: string[]
  floors?: { number: number; label: string }[]
  error?: string
}

export function useUnitsImport() {
  const [rows, setRows] = useState<UnitImport[]>([])
  const [floors, setFloors] = useState<{ number: number; label: string }[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<Filters>({
    search: '',
    category: '',
    floorNumber: '',
    status: '',
  })

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (filters.search.trim()) params.set('search', filters.search.trim())
      if (filters.category) params.set('category', filters.category)
      if (filters.floorNumber) params.set('floorNumber', filters.floorNumber)
      if (filters.status) params.set('status', filters.status)

      const response = await fetch(`/api/inmobiliaria/units-import?${params}`, { cache: 'no-store' })
      const json = (await response.json()) as UnitsImportResponse
      setRows(json.data ?? [])
      setTotal(json.total ?? 0)
      setCategories(json.categories ?? [])
      setFloors(json.floors ?? [])
      if (json.error) toast.error(json.error)
    } catch (err) {
      console.error(err)
      toast.error('No se pudo leer el inventario 2')
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
    setFilters({ search: '', category: '', floorNumber: '', status: '' })
    setPage(1)
  }

  return {
    rows,
    floors,
    categories,
    isLoading,
    filters,
    updateFilter,
    resetFilters,
    reload: load,
    page,
    pageSize,
    total,
    setPage,
  }
}

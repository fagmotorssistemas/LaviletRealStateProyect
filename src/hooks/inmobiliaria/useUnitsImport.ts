'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  listUnitsImportAction,
  listUnitsImportFacetsAction,
} from '@/app/inmobiliaria/inventario-2/actions'
import type { UnitImport } from '@/types/inmobiliaria'

interface Filters {
  search: string
  category: string
  floorNumber: string
  status: string
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

  const loadFacets = useCallback(async () => {
    try {
      const facets = await listUnitsImportFacetsAction()
      setCategories(facets.categories)
      setFloors(facets.floors)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const loadRows = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await listUnitsImportAction({
        search: filters.search.trim() || undefined,
        category: filters.category || undefined,
        floorNumber: filters.floorNumber || undefined,
        status: filters.status || undefined,
        page,
        pageSize,
      })
      setRows(res.data)
      setTotal(res.total)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [filters, page, pageSize])

  useEffect(() => {
    void loadFacets()
  }, [loadFacets])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

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
    reload: () => {
      void loadFacets()
      void loadRows()
    },
    page,
    pageSize,
    total,
    setPage,
  }
}

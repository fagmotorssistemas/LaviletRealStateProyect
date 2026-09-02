'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { searchUnitsByNumber } from '@/services/inmobiliaria.service'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import type { Unit } from '@/types/inmobiliaria'

interface UnitNumberSearchInputProps {
  tenantId: string
  projectId?: string
  excludeIds?: string[]
  onSelect: (unit: Unit) => void
  placeholder?: string
  autoFocus?: boolean
}

export function UnitNumberSearchInput({
  tenantId,
  projectId,
  excludeIds,
  onSelect,
  placeholder = 'Buscar unidad por número...',
  autoFocus = true,
}: UnitNumberSearchInputProps) {
  const { supabase } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Unit[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const excludeRef = useRef(excludeIds)
  excludeRef.current = excludeIds

  useEffect(() => {
    setQuery('')
    setResults([])
  }, [projectId])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const runSearch = (value: string) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!value.trim()) {
      setResults([])
      return
    }

    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const rows = await searchUnitsByNumber(supabase, {
          tenantId,
          projectId: projectId || undefined,
          query: value,
          excludeIds: excludeRef.current,
          pageSize: 20,
        })
        setResults(rows)
      } catch (err) {
        console.error(err)
        setResults([])
        toast.error('No se pudieron buscar unidades')
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const handleSelect = (unit: Unit) => {
    onSelect(unit)
    setQuery('')
    setResults([])
  }

  return (
    <div className="mb-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition-all focus:ring-2 focus:ring-[#8b917c]/30"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => handleSelect(unit)}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-slate-50"
            >
              <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium text-slate-700">{unit.unit_number}</span>
                <span className="text-xs text-slate-400">
                  {unit.project?.name ? `${unit.project.name} • ` : ''}
                  {unit.category}
                </span>
              </div>
              <StatusBadge status={unit.status} type="unit" className="shrink-0" />
            </button>
          ))}
        </div>
      )}

      {query.trim() && !searching && results.length === 0 && (
        <div className="mt-1 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-center text-xs text-slate-400">
            {projectId
              ? 'Sin resultados en este proyecto. Prueba otro número o cambia el proyecto.'
              : 'Sin resultados'}
          </p>
        </div>
      )}
    </div>
  )
}

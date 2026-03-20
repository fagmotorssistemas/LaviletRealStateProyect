'use client'

import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface InmobiliariaFiltersToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  resultsTotal?: number
  hasActiveFilters: boolean
  onReset: () => void
  children: ReactNode
}

export function InmobiliariaFiltersToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  resultsTotal,
  hasActiveFilters,
  onReset,
  children,
}: InmobiliariaFiltersToolbarProps) {
  const totalText = resultsTotal == null ? null : `${resultsTotal} resultados`

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none group-focus-within:text-[#BDA27E] transition-colors">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="text"
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#BDA27E]"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-gray-100 transition-colors text-gray-500"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {totalText && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50">
              <span className="text-xs font-medium text-gray-700">{totalText}</span>
            </div>
          )}

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="border-gray-300 hover:border-red-200 hover:text-red-600"
            >
              <X size={14} className="mr-2" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {children}
      </div>
    </div>
  )
}


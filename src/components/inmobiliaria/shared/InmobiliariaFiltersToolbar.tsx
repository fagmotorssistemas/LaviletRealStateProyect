'use client'

import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface InmobiliariaFiltersToolbarProps {
  showSearch?: boolean
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  resultsTotal?: number
  hasActiveFilters: boolean
  onReset: () => void
  children: ReactNode
}

export function InmobiliariaFiltersToolbar({
  showSearch = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = '',
  resultsTotal,
  hasActiveFilters,
  onReset,
  children,
}: InmobiliariaFiltersToolbarProps) {
  const totalText = resultsTotal == null ? null : `${resultsTotal} resultados`

  return (
    <div className="crm-filters-panel bg-white p-0">
      <div className="crm-filters">
        {showSearch ? (
          <div className="crm-filters-search flex min-w-0 flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
                Buscar
              </label>
              <div className="flex items-center gap-2">
                {totalText && (
                  <span className="text-[11px] tabular-nums text-[#5c6156]">{totalText}</span>
                )}
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={onReset}>
                    <X size={14} className="mr-1" />
                    Limpiar
                  </Button>
                )}
              </div>
            </div>
            <div className="relative min-w-0">
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a806c]">
                <Search className="h-4 w-4" />
              </div>
              <input
                type="text"
                placeholder={searchPlaceholder}
                className="h-9 w-full min-w-0 border border-[#c5c8bc] bg-[#f7f7f3] pl-9 pr-9 text-sm text-[#3a3d36] placeholder:text-[#8a8d82] focus:border-[#8b917c] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30"
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange?.('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#5c6156] transition-colors hover:bg-[#e8e9e3]"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {totalText && (
              <span className="text-[11px] tabular-nums text-[#5c6156]">{totalText}</span>
            )}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={onReset}>
                <X size={14} className="mr-1" />
                Limpiar
              </Button>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}

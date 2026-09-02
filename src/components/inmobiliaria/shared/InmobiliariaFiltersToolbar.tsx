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
    <div className="crm-filters-panel">
      <div className="crm-filters">
        {showSearch ? (
          <div className="crm-filters-search flex min-w-0 flex-col gap-1.5">
            <div className="flex h-4 items-center justify-between gap-2">
              <label className="text-[10px] font-medium tracking-[0.22em] text-[#787D62] uppercase">
                Buscar
              </label>
              <div className="flex items-center gap-2">
                {totalText && (
                  <span className="text-[11px] tabular-nums tracking-wide text-[#787D62]/80">
                    {totalText}
                  </span>
                )}
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={onReset} className="h-6 px-2 text-[11px]">
                    <X size={12} className="mr-1" />
                    Limpiar
                  </Button>
                )}
              </div>
            </div>
            <div className="relative min-w-0">
              <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#787D62]">
                <Search className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <input
                type="text"
                placeholder={searchPlaceholder}
                className="h-10 w-full min-w-0 rounded-xl border border-[#787D62]/20 bg-[#f7f3ee]/60 pl-10 pr-9 text-sm text-[#2B1A18] placeholder:text-[#787D62]/50 transition-colors focus:border-[#787D62] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#787D62]/20"
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange?.('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#787D62]/50 transition-colors hover:text-[#787D62]"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-4 items-center justify-end gap-2">
            {totalText && (
              <span className="text-[11px] tabular-nums tracking-wide text-[#787D62]/80">
                {totalText}
              </span>
            )}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={onReset} className="h-6 px-2 text-[11px]">
                <X size={12} className="mr-1" />
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

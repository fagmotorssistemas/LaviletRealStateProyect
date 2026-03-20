'use client'

import { Search, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { LEAD_STATUS_OPTIONS } from '@/types/inmobiliaria'

interface LeadsToolbarProps {
  filters: { status: string; search: string; assignedTo: string }
  onFilterChange: (key: 'status' | 'search' | 'assignedTo', value: string) => void
  onReset: () => void
  onAdd: () => void
}

export function LeadsToolbar({ filters, onFilterChange, onReset, onAdd }: LeadsToolbarProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-1 flex-wrap gap-3">
        <div className="relative w-full sm:w-56">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar lead..."
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#2B1A18] transition-colors"
          />
        </div>
        <Select
          options={LEAD_STATUS_OPTIONS}
          placeholder="Todos los estados"
          value={filters.status}
          onChange={(e) => onFilterChange('status', e.target.value)}
          className="w-full sm:w-44"
        />
        <Button variant="ghost" size="icon" onClick={onReset} title="Limpiar filtros">
          <RotateCcw size={16} />
        </Button>
      </div>
      <Button onClick={onAdd} className="shrink-0">
        <Plus size={16} className="mr-2" />
        Nuevo Lead
      </Button>
    </div>
  )
}

'use client'

import { Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Project } from '@/types/inmobiliaria'

interface InventoryToolbarProps {
  filters: {
    projectId: string
    status: string
    category: string
  }
  projects: Project[]
  onFilterChange: (key: 'projectId' | 'status' | 'category', value: string) => void
  onReset: () => void
  onAdd: () => void
}

const categoryOptions = [
  { value: 'Departamento', label: 'Departamento' },
  { value: 'Local Comercial', label: 'Local Comercial' },
  // { value: 'Suite', label: 'Suite' },
  // { value: 'Oficina', label: 'Oficina' },
  // { value: 'Parqueadero', label: 'Parqueadero' },
]

export function InventoryToolbar({ filters, projects, onFilterChange, onReset, onAdd }: InventoryToolbarProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-1 flex-wrap gap-3">
        <Select
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Todos los proyectos"
          value={filters.projectId}
          onChange={(e) => onFilterChange('projectId', e.target.value)}
          className="w-full sm:w-48"
        />
        <Select
          options={UNIT_STATUS_OPTIONS}
          placeholder="Todos los estados"
          value={filters.status}
          onChange={(e) => onFilterChange('status', e.target.value)}
          className="w-full sm:w-40"
        />
        <Select
          options={categoryOptions}
          placeholder="Categoría"
          value={filters.category}
          onChange={(e) => onFilterChange('category', e.target.value)}
          className="w-full sm:w-40"
        />
        <Button variant="ghost" size="icon" onClick={onReset} title="Limpiar filtros">
          <RotateCcw size={16} />
        </Button>
      </div>
      <Button onClick={onAdd} className="shrink-0">
        <Plus size={16} className="mr-2" />
        Nueva Unidad
      </Button>
    </div>
  )
}

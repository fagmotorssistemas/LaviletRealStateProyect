'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { Project } from '@/types/inmobiliaria'

interface ShowroomToolbarProps {
  filters: { projectId: string; salespersonId: string }
  projects: Project[]
  onFilterChange: (key: 'projectId' | 'salespersonId', value: string) => void
  onAdd: () => void
}

export function ShowroomToolbar({ filters, projects, onFilterChange, onAdd }: ShowroomToolbarProps) {
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
      </div>
      <Button onClick={onAdd} className="shrink-0">
        <Plus size={16} className="mr-2" />
        Nueva Visita
      </Button>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Landmark } from 'lucide-react'
import { useShowroom } from '@/hooks/inmobiliaria/useShowroom'
import { useAuth } from '@/contexts/AuthContext'
import { listProjects } from '@/services/inmobiliaria.service'
import { ShowroomVisitsTable } from '@/components/inmobiliaria/showroom/ShowroomVisitsTable'
import { CreateVisitModal } from '@/components/inmobiliaria/showroom/CreateVisitModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Pagination } from '@/components/ui/Pagination'
import type { Project } from '@/types/inmobiliaria'
import { Plus } from 'lucide-react'

export default function ShowroomPage() {
  const { supabase } = useAuth()
  const { visits, isLoading, tenantId, filters, updateFilter, reload, page, pageSize, total, search, updateSearch, reset, setPage } = useShowroom()
  const [projects, setProjects] = useState<Project[]>([])
  const [createOpen, setCreateOpen] = useState(false)

  const sourceOptions = [
    { value: 'oficina', label: 'Oficina' },
    { value: 'proyecto', label: 'Proyecto' },
    { value: 'mixto', label: 'Mixto' },
  ]

  useEffect(() => {
    if (tenantId) {
      listProjects(supabase, tenantId).then(setProjects).catch(console.error)
    }
  }, [supabase, tenantId])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Showroom & Tráfico</h1>
          <p className="text-sm text-gray-500 mt-1">
            Registra y consulta las visitas de asesores con clientes
            {total > 0 && <span className="ml-2 text-gray-400">• {total} visitas</span>}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} className="mr-2" />
          Nueva Visita
        </Button>
      </div>

      <InmobiliariaFiltersToolbar
        searchValue={search}
        onSearchChange={updateSearch}
        searchPlaceholder="Buscar cliente o nota..."
        resultsTotal={total}
        hasActiveFilters={Boolean(search || filters.projectId || filters.source)}
        onReset={reset}
      >
        <Select
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Todos los proyectos"
          value={filters.projectId}
          onChange={(e) => updateFilter('projectId', e.target.value)}
          className="w-full"
        />
        <Select
          options={sourceOptions}
          placeholder="Fuente"
          value={filters.source}
          onChange={(e) => updateFilter('source', e.target.value)}
          className="w-full"
        />
      </InmobiliariaFiltersToolbar>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : visits.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No hay visitas registradas"
          description="Registra la primera visita de showroom para comenzar a llevar el tráfico."
        />
      ) : (
        <>
          <ShowroomVisitsTable visits={visits} onSelect={() => {}} />
          {total > 0 && (
            <div className="pt-4">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <CreateVisitModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        projects={projects}
        tenantId={tenantId}
      />
    </div>
  )
}

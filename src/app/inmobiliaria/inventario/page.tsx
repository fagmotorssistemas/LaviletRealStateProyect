'use client'

import { useState } from 'react'
import { LayoutGrid, Plus } from 'lucide-react'
import { useInventoryUnits } from '@/hooks/inmobiliaria/useInventoryUnits'
import { updateUnitStatus } from '@/services/inmobiliaria.service'
import { useAuth } from '@/contexts/AuthContext'
import { InventoryUnitsTable } from '@/components/inmobiliaria/inventory/InventoryUnitsTable'
import { UnitDetailModal } from '@/components/inmobiliaria/inventory/UnitDetailModal'
import { CreateUnitModal } from '@/components/inmobiliaria/inventory/CreateUnitModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { InventorySortOption, Unit, UnitStatus } from '@/types/inmobiliaria'
import { INVENTORY_SORT_OPTIONS, UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import { toast } from 'sonner'

export default function InventarioPage() {
  const { supabase } = useAuth()
  const categoryOptions = [
    { value: 'Departamento', label: 'Departamento' },
    { value: 'Local Comercial', label: 'Local Comercial' },
    // { value: 'Suite', label: 'Suite' },
    // { value: 'Oficina', label: 'Oficina' },
    // { value: 'Parqueadero', label: 'Parqueadero' },
  ]

  const {
    units,
    projects,
    isLoading,
    filters,
    tenantId,
    updateFilter,
    resetFilters,
    reload,
    page,
    pageSize,
    total,
    setPage,
  } = useInventoryUnits()
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const handleSelectUnit = (unit: Unit) => {
    setSelectedUnit(unit)
    setDetailOpen(true)
  }

  const handleStatusChange = async (unitId: string, status: UnitStatus) => {
    try {
      await updateUnitStatus(supabase, unitId, status)
      toast.success('Estado actualizado')
      setDetailOpen(false)
      reload()
    } catch {
      toast.error('Error al actualizar estado')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona las unidades de tus proyectos inmobiliarios
            {total > 0 && <span className="ml-2 text-gray-400">• {total} unidades</span>}
          </p>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus size={16} className="mr-2" />
          Nueva Unidad
        </Button>
      </div>

      <div>
        <InmobiliariaFiltersToolbar
          searchValue={filters.search}
          onSearchChange={(value) => updateFilter('search', value)}
          searchPlaceholder="Buscar unidad..."
          resultsTotal={total}
          hasActiveFilters={Boolean(
            filters.search
            || filters.projectId
            || filters.status
            || filters.category
            || filters.sortBy !== 'unit_natural',
          )}
          onReset={resetFilters}
        >
          <Select
            label="Ordenar por"
            options={INVENTORY_SORT_OPTIONS}
            value={filters.sortBy}
            onChange={(e) => updateFilter('sortBy', e.target.value as InventorySortOption)}
            className="w-full sm:w-64"
          />
          <Select
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Todos los proyectos"
            value={filters.projectId}
            onChange={(e) => updateFilter('projectId', e.target.value)}
            className="w-full sm:w-56"
          />
          <Select
            options={UNIT_STATUS_OPTIONS}
            placeholder="Todos los estados"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="w-full sm:w-44"
          />
          <Select
            options={categoryOptions}
            placeholder="Categoría"
            value={filters.category}
            onChange={(e) => updateFilter('category', e.target.value)}
            className="w-full sm:w-44"
          />
        </InmobiliariaFiltersToolbar>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : total === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No hay unidades"
          description="Aún no se han registrado unidades en el inventario. Crea tu primer proyecto y agrega unidades."
        />
      ) : (
        <>
          <InventoryUnitsTable units={units} onSelect={handleSelectUnit} />
          <div className="pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      <UnitDetailModal
        unit={selectedUnit}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onStatusChange={handleStatusChange}
      />

      <CreateUnitModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        projects={projects}
        tenantId={tenantId}
      />
    </div>
  )
}

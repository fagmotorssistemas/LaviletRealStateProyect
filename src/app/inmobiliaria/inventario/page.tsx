'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Download, LayoutGrid, Plus } from 'lucide-react'
import { useInventoryUnits } from '@/hooks/inmobiliaria/useInventoryUnits'
import { updateUnitStatus } from '@/services/inmobiliaria.service'
import { useAuth } from '@/contexts/AuthContext'
import { InventoryUnitsTable } from '@/components/inmobiliaria/inventory/InventoryUnitsTable'
import { UnitDetailModal } from '@/components/inmobiliaria/inventory/UnitDetailModal'
import { CreateUnitModal } from '@/components/inmobiliaria/inventory/CreateUnitModal'
const ExportInventoryModal = dynamic(
  () =>
    import('@/components/inmobiliaria/inventory/ExportInventoryModal').then((m) => m.ExportInventoryModal),
  { ssr: false },
)
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
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
  const [exportOpen, setExportOpen] = useState(false)

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
    <div className="space-y-4">
      <PageHeader
        eyebrow="Catálogo de unidades"
        title="Inventario"
        description={
          <>
            Unidades publicadas de tus proyectos
            {total > 0 && <span className="text-[#9a7d55]"> · {total} registros</span>}
          </>
        }
        actions={
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportOpen(true)}
              className="gap-2"
              disabled={!tenantId}
              title={!tenantId ? 'Carga un proyecto para exportar' : undefined}
            >
              <Download size={16} aria-hidden />
              Exportar
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus size={16} aria-hidden />
              Nueva unidad
            </Button>
          </div>
        }
      />

      <div>
        <InmobiliariaFiltersToolbar
          searchValue={filters.search}
          onSearchChange={(value) => updateFilter('search', value)}
          searchPlaceholder="Buscar por número o descripción..."
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
          />
          <Select
            label="Proyecto"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Todos"
            value={filters.projectId}
            onChange={(e) => updateFilter('projectId', e.target.value)}
          />
          <Select
            label="Estado"
            options={UNIT_STATUS_OPTIONS}
            placeholder="Todos"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
          />
          <Select
            label="Categoría"
            options={categoryOptions}
            placeholder="Todas"
            value={filters.category}
            onChange={(e) => updateFilter('category', e.target.value)}
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
        projects={projects}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onStatusChange={handleStatusChange}
        onUnitUpdated={(u) => {
          setSelectedUnit(u)
          reload()
        }}
      />

      <CreateUnitModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        projects={projects}
        tenantId={tenantId}
      />

      <ExportInventoryModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        tenantId={tenantId}
        projects={projects}
        categoryOptions={categoryOptions}
        tableFilters={{
          projectId: filters.projectId,
          status: filters.status,
          category: filters.category,
          sortBy: filters.sortBy,
        }}
      />
    </div>
  )
}

'use client'

import { useState } from 'react'
import { ImagePlus, Plus, Table2 } from 'lucide-react'
import { TypologyAssetsModal } from '@/components/inmobiliaria/inventory/TypologyAssetsModal'
import { UnitsImportModal } from '@/components/inmobiliaria/inventory/UnitsImportModal'
import { UnitsImportTable } from '@/components/inmobiliaria/inventory/UnitsImportTable'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { InmobiliariaFiltersToolbar } from '@/components/inmobiliaria/shared/InmobiliariaFiltersToolbar'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { useUnitsImport } from '@/hooks/inmobiliaria/useUnitsImport'
import { UNIT_STATUS_OPTIONS, unitImportCategoryLabel, type UnitImport } from '@/types/inmobiliaria'

export default function Inventario2Page() {
  const {
    rows,
    floors,
    categories,
    isLoading,
    filters,
    updateFilter,
    resetFilters,
    reload,
    page,
    pageSize,
    total,
    setPage,
  } = useUnitsImport()
  const { canWrite } = useRoleAccess()
  const [modalOpen, setModalOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [selected, setSelected] = useState<UnitImport | null>(null)

  const openCreate = () => {
    setSelected(null)
    setModalOpen(true)
  }

  const openEdit = (row: UnitImport) => {
    setSelected(row)
    setModalOpen(true)
  }

  const hasActiveFilters = Boolean(
    filters.search || filters.category || filters.floorNumber || filters.status,
  )

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Carga importada"
        title="Inventario 2"
        description={
          <>
            Unidades desde units_import
            {total > 0 && <span className="text-[#9a7d55]"> · {total} registros</span>}
          </>
        }
        actions={
          canWrite ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAssetsOpen(true)} className="gap-2">
                <ImagePlus size={16} aria-hidden />
                Imágenes tipología
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <Plus size={16} aria-hidden />
                Nueva unidad
              </Button>
            </div>
          ) : undefined
        }
      />

      <div>
        <InmobiliariaFiltersToolbar
          searchValue={filters.search}
          onSearchChange={(value) => updateFilter('search', value)}
          searchPlaceholder="Buscar por código, grupo o piso..."
          resultsTotal={total}
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
        >
          <Select
            label="Categoría"
            options={categories.map((value) => ({
              value,
              label: unitImportCategoryLabel(value),
            }))}
            placeholder="Todas"
            value={filters.category}
            onChange={(e) => updateFilter('category', e.target.value)}
          />
          <Select
            label="Piso"
            options={floors.map((f) => ({
              value: String(f.number),
              label: f.label,
            }))}
            placeholder="Todos"
            value={filters.floorNumber}
            onChange={(e) => updateFilter('floorNumber', e.target.value)}
          />
          <Select
            label="Estado"
            options={UNIT_STATUS_OPTIONS}
            placeholder="Todos"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
          />
        </InmobiliariaFiltersToolbar>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Table2}
          title="No hay unidades importadas"
          description={
            hasActiveFilters
              ? 'Ningún registro coincide con los filtros.'
              : 'La tabla units_import no tiene registros. Crea la primera unidad.'
          }
        >
          {!hasActiveFilters && canWrite && (
            <Button onClick={openCreate} className="gap-2">
              <Plus size={16} aria-hidden />
              Nueva unidad
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          <UnitsImportTable rows={rows} onSelect={canWrite ? openEdit : undefined} />
          <div className="pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </>
      )}

      {canWrite && (
        <>
          <UnitsImportModal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            onSaved={reload}
            row={selected}
          />
          <TypologyAssetsModal isOpen={assetsOpen} onClose={() => setAssetsOpen(false)} />
        </>
      )}
    </div>
  )
}

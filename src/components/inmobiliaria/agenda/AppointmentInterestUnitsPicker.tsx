'use client'

import { useEffect, useState } from 'react'
import type { Unit } from '@/types/inmobiliaria'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'
import { Building2, Plus, Trash2 } from 'lucide-react'

interface AppointmentInterestUnitsPickerProps {
  tenantId: string
  /** Sin proyecto no se puede buscar unidades */
  projectId: string
  selectedUnits: Unit[]
  onChange: (units: Unit[]) => void
  /** Título de la sección (ej. contratos vs citas) */
  sectionLabel?: string
  helperText?: string
  emptyProjectMessage?: string
}

/**
 * Mismo patrón que el modal de showroom: buscador con debounce, dropdown de resultados y tarjetas con quitar.
 */
export function AppointmentInterestUnitsPicker({
  tenantId,
  projectId,
  selectedUnits,
  onChange,
  sectionLabel = 'Unidad(es) de interés *',
  helperText = 'Busca por número de unidad. Selecciona al menos una para guardar la cita.',
  emptyProjectMessage = 'Selecciona un proyecto para buscar y añadir unidades de interés.',
}: AppointmentInterestUnitsPickerProps) {
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)

  useEffect(() => {
    setUnitSearchOpen(false)
  }, [projectId])

  const handleAddUnit = (unit: Unit) => {
    if (selectedUnits.some((u) => u.id === unit.id)) return
    onChange([...selectedUnits, unit])
    setUnitSearchOpen(false)
  }

  const handleRemoveUnit = (unitId: string) => {
    onChange(selectedUnits.filter((u) => u.id !== unitId))
  }

  if (!projectId) {
    return (
      <div className="border border-[#2B1A18]/12 bg-[#fcfbf9] p-4">
        <p className="text-sm text-slate-500 italic">{emptyProjectMessage}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <label className="min-w-0 text-xs font-bold uppercase tracking-wider text-slate-500">{sectionLabel}</label>
        <button
          type="button"
          onClick={() => setUnitSearchOpen(!unitSearchOpen)}
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b917c] transition-colors hover:text-[#a88d6a]"
        >
          <Plus size={12} /> Agregar
        </button>
      </div>

      <p className="text-xs text-slate-400 -mt-2 mb-4">{helperText}</p>

      {unitSearchOpen && (
        <UnitNumberSearchInput
          tenantId={tenantId}
          projectId={projectId}
          excludeIds={selectedUnits.map((u) => u.id)}
          onSelect={handleAddUnit}
        />
      )}

      {selectedUnits.length > 0 ? (
        <div className="space-y-3">
          {selectedUnits.map((unit) => (
            <div
              key={unit.id}
              className="flex items-center gap-3 border border-[#2B1A18]/12 bg-white p-3 group"
            >
              <div className="p-2 bg-slate-100 rounded-lg">
                <Building2 className="h-4 w-4 text-slate-600" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-sm text-slate-800 block truncate">{unit.unit_number}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-400">{unit.project?.name ?? unit.category}</span>
                </div>
              </div>
              <StatusBadge status={unit.status} type="unit" className="shrink-0" />
              <button
                type="button"
                onClick={() => handleRemoveUnit(unit.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer md:opacity-0 md:group-hover:opacity-100"
                title="Quitar unidad"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-[#2B1A18]/12 bg-white p-3 text-center text-sm italic text-[#8a8d87]">
          Sin unidades seleccionadas.
        </p>
      )}
    </div>
  )
}

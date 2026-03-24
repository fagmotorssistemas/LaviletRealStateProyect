'use client'

import { useEffect, useRef, useState } from 'react'
import type { Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { listUnits } from '@/services/inmobiliaria.service'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Building2, Loader2, Plus, Search, Trash2 } from 'lucide-react'

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
  const { supabase } = useAuth()
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)
  const [unitSearchQuery, setUnitSearchQuery] = useState('')
  const [unitSearchResults, setUnitSearchResults] = useState<Unit[]>([])
  const [searchingUnits, setSearchingUnits] = useState(false)
  const unitSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedRef = useRef(selectedUnits)
  selectedRef.current = selectedUnits

  useEffect(() => {
    setUnitSearchOpen(false)
    setUnitSearchQuery('')
    setUnitSearchResults([])
  }, [projectId])

  const handleUnitSearch = (query: string) => {
    setUnitSearchQuery(query)
    if (unitSearchTimerRef.current) clearTimeout(unitSearchTimerRef.current)
    if (!query.trim() || !projectId) {
      setUnitSearchResults([])
      return
    }

    unitSearchTimerRef.current = setTimeout(async () => {
      setSearchingUnits(true)
      try {
        const res = await listUnits(supabase, {
          tenantId,
          projectId,
          search: query,
          pageSize: 20,
        })
        const existingIds = new Set(selectedRef.current.map((u) => u.id))
        setUnitSearchResults((res.data ?? []).filter((u) => !existingIds.has(u.id)))
      } catch {
        setUnitSearchResults([])
      } finally {
        setSearchingUnits(false)
      }
    }, 300)
  }

  const handleAddUnit = (unit: Unit) => {
    if (selectedUnits.some((u) => u.id === unit.id)) return
    onChange([...selectedUnits, unit])
    setUnitSearchQuery('')
    setUnitSearchResults([])
    setUnitSearchOpen(false)
  }

  const handleRemoveUnit = (unitId: string) => {
    onChange(selectedUnits.filter((u) => u.id !== unitId))
  }

  if (!projectId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="text-sm text-slate-500 italic">{emptyProjectMessage}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{sectionLabel}</label>
        <button
          type="button"
          onClick={() => setUnitSearchOpen(!unitSearchOpen)}
          className="flex items-center gap-1 text-[10px] font-semibold text-[#BDA27E] hover:text-[#a88d6a] cursor-pointer transition-colors uppercase tracking-wider"
        >
          <Plus size={12} /> Agregar
        </button>
      </div>

      <p className="text-xs text-slate-400 -mt-2 mb-4">{helperText}</p>

      {unitSearchOpen && (
        <div className="mb-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={unitSearchQuery}
            onChange={(e) => handleUnitSearch(e.target.value)}
            placeholder="Buscar unidad por número..."
            autoFocus
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-[#BDA27E]/30 outline-none transition-all"
          />

          {searchingUnits && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
          )}

          {unitSearchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
              {unitSearchResults.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => handleAddUnit(unit)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1 text-left">
                    <span className="font-medium text-slate-700 block truncate">{unit.unit_number}</span>
                    <span className="text-xs text-slate-400">
                      {unit.project?.name ? `${unit.project.name} • ` : ''}
                      {unit.category}
                    </span>
                  </div>
                  <StatusBadge status={unit.status} type="unit" className="shrink-0" />
                </button>
              ))}
            </div>
          )}

          {unitSearchQuery.trim() && !searchingUnits && unitSearchResults.length === 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 p-3">
              <p className="text-xs text-slate-400 text-center">Sin resultados</p>
            </div>
          )}
        </div>
      )}

      {selectedUnits.length > 0 ? (
        <div className="space-y-3">
          {selectedUnits.map((unit) => (
            <div
              key={unit.id}
              className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 group"
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
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                title="Quitar unidad"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic bg-white p-3 rounded-xl border border-dashed border-slate-200 text-center">
          Sin unidades seleccionadas.
        </p>
      )}
    </div>
  )
}

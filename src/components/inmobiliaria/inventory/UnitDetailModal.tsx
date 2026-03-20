'use client'

import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Unit, UnitStatus } from '@/types/inmobiliaria'
import { useState } from 'react'
import {
  Building2,
  Layers,
  Tag,
  Ruler,
  SquareDashed,
  Sun,
  Umbrella,
  Car,
  DollarSign,
  FileText,
  RefreshCw,
} from 'lucide-react'

interface UnitDetailModalProps {
  unit: Unit | null
  isOpen: boolean
  onClose: () => void
  onStatusChange: (unitId: string, status: UnitStatus) => void
}

export function UnitDetailModal({ unit, isOpen, onClose, onStatusChange }: UnitDetailModalProps) {
  const [newStatus, setNewStatus] = useState('')

  if (!unit) return null

  const handleSaveStatus = () => {
    if (newStatus && newStatus !== unit.status) {
      onStatusChange(unit.id, newStatus as UnitStatus)
    }
    setNewStatus('')
  }

  const projectName = (unit.project as unknown as { name: string })?.name ?? '—'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Unidad ${unit.unit_number}`} size="lg">
      <div className="space-y-5">
        {/* Header: estado + categoría */}
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={unit.status} type="unit" />
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Tag size={14} className="text-gray-800" />
            {unit.category}
          </div>
          {unit.unit_subtype && (
            <span className="text-sm text-gray-400">• {unit.unit_subtype}</span>
          )}
        </div>

        {/* Información general */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Información general</h4>
          <div className="grid grid-cols-2 gap-4">
            <InfoRow icon={<Building2 size={15} className="text-gray-800" />} label="Proyecto" value={projectName} />
            <InfoRow icon={<Layers size={15} className="text-gray-800" />} label="Piso" value={unit.floor ?? '—'} />
            <InfoRow icon={<Car size={15} className="text-gray-800" />} label="Parqueos asignados" value={String(unit.parking_assigned ?? 0)} />
            <InfoRow icon={<DollarSign size={15} className="text-gray-800" />} label="Costo / m²" value={unit.cost_per_m2_internal ? `$${Number(unit.cost_per_m2_internal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'} />
          </div>
        </div>

        {/* Áreas */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Superficies</h4>
          <div className="grid grid-cols-2 gap-4">
            <InfoRow
              icon={<Ruler size={15} className="text-gray-800" />}
              label="Área del departamento"
              value={unit.area_internal_m2 ? `${Number(unit.area_internal_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
            />
            <InfoRow
              icon={<Umbrella size={15} className="text-gray-800" />}
              label="Terraza cubierta"
              value={unit.area_terrace_covered_m2 ? `${Number(unit.area_terrace_covered_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
            />
            <InfoRow
              icon={<Sun size={15} className="text-gray-800" />}
              label="Terraza descubierta"
              value={unit.area_terrace_open_m2 ? `${Number(unit.area_terrace_open_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
            />
            <InfoRow
              icon={<SquareDashed size={15} className="text-gray-800" />}
              label="Área total"
              value={unit.area_total_m2 ? `${Number(unit.area_total_m2).toLocaleString('en-US', { minimumFractionDigits: 2 })} m²` : '—'}
            />
          </div>
        </div>

        {/* Precio comercial */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Precio comercial</h4>
          </div>
          <PriceText value={unit.published_commercial_price} size="lg" />
        </div>

        {/* Descripción */}
        {unit.description && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={15} className="text-gray-800" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Descripción</h4>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{unit.description}</p>
          </div>
        )}

        {/* Cambiar estado */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <RefreshCw size={15} className="text-gray-800" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cambiar estado</h4>
          </div>
          <div className="flex gap-3">
            <Select
              options={UNIT_STATUS_OPTIONS}
              value={newStatus || unit.status}
              onChange={(e) => setNewStatus(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleSaveStatus} disabled={!newStatus || newStatus === unit.status}>
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 leading-tight">{label}</p>
        <p className="text-sm font-medium leading-snug text-gray-800">{value}</p>
      </div>
    </div>
  )
}

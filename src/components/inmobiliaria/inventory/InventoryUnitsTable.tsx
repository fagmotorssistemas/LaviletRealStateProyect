'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { formatNumber } from '@/lib/utils'
import { unitImportCategoryLabel, type Unit } from '@/types/inmobiliaria'

interface InventoryUnitsTableProps {
  units: Unit[]
  onSelect: (unit: Unit) => void
}

export function InventoryUnitsTable({ units, onSelect }: InventoryUnitsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">Unidad</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Proyecto</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Tipología</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Categoría</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Grupo</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Piso</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Hab.</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Baños completos</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Baños sociales</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Park.</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Int. (m²)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Ext. (m²)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Precio</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Estado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Espacios</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr
              key={unit.id}
              onClick={() => onSelect(unit)}
              className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">{unit.unit_number}</td>
              <td className="px-4 py-3 text-gray-600">{(unit.project as unknown as { name: string })?.name ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{unit.typology_code ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{unitImportCategoryLabel(unit.category)}</td>
              <td className="px-4 py-3 text-gray-600">{unit.plan_group ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{unit.floor ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{unit.bedrooms ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{unit.bathrooms_full ?? unit.bathrooms ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{unit.bathrooms_half ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{unit.parking_assigned ?? '—'}</td>
              <td className="px-4 py-3 text-right crm-num text-gray-600">{formatNumber(unit.area_internal_m2)}</td>
              <td className="px-4 py-3 text-right crm-num text-gray-600">{formatNumber(unit.area_exterior_m2)}</td>
              <td className="px-4 py-3 text-right">
                <PriceText value={unit.published_commercial_price} size="sm" />
              </td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={unit.status} type="unit" />
              </td>
              <td className="max-w-[220px] truncate px-4 py-3 text-gray-600" title={(unit.spaces ?? []).join(', ')}>
                {(unit.spaces ?? []).length ? unit.spaces.join(' · ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

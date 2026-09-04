'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { formatNumber } from '@/lib/utils'
import { unitImportCategoryLabel, type UnitImport } from '@/types/inmobiliaria'

interface UnitsImportTableProps {
  rows: UnitImport[]
  onSelect?: (row: UnitImport) => void
}

export function UnitsImportTable({ rows, onSelect }: UnitsImportTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">Unidad</th>
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
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelect?.(row)}
              className={
                onSelect
                  ? 'cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50/50'
                  : 'border-b border-gray-50'
              }
            >
              <td className="px-4 py-3 font-medium text-gray-900">{row.unit_code}</td>
              <td className="px-4 py-3 text-gray-600">{row.typology_code ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{unitImportCategoryLabel(row.category)}</td>
              <td className="px-4 py-3 text-gray-600">{row.plan_group ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{row.floor_label ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{row.bedrooms ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{row.bathrooms_full ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{row.bathrooms_half ?? '—'}</td>
              <td className="px-4 py-3 text-center crm-num text-gray-600">{row.parking ?? '—'}</td>
              <td className="px-4 py-3 text-right crm-num text-gray-600">{formatNumber(row.area_internal_m2)}</td>
              <td className="px-4 py-3 text-right crm-num text-gray-600">{formatNumber(row.area_exterior_m2)}</td>
              <td className="px-4 py-3 text-right">
                <PriceText value={row.price} size="sm" />
              </td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={row.status} type="unit" />
              </td>
              <td className="max-w-[220px] truncate px-4 py-3 text-gray-600" title={(row.spaces ?? []).join(', ')}>
                {(row.spaces ?? []).length ? row.spaces.join(' · ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

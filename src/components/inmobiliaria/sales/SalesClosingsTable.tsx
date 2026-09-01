'use client'

import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { formatDate } from '@/lib/utils'
import type { UnitSalesClosing } from '@/types/inmobiliaria'

interface SalesClosingsTableProps {
  closings: UnitSalesClosing[]
}

function discountLabel(row: UnitSalesClosing): { text: string; className: string } | null {
  if (row.published_price_snapshot == null || row.published_price_snapshot <= 0) return null
  const amount = row.published_price_snapshot - row.sale_price_final
  const pct = (amount / row.published_price_snapshot) * 100
  if (Math.abs(amount) < 1) return { text: 'Sin descuento', className: 'text-slate-400' }
  if (amount > 0) {
    return {
      text: `−${pct.toFixed(1)}%`,
      className: 'text-emerald-700',
    }
  }
  return {
    text: `+${Math.abs(pct).toFixed(1)}%`,
    className: 'text-amber-700',
  }
}

export function SalesClosingsTable({ closings }: SalesClosingsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#3a3d36] text-white">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Fecha</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Unidad</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Cliente</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Asesor</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Lista</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Cierre</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider">Dto.</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Contrato</th>
          </tr>
        </thead>
        <tbody>
          {closings.map((row) => {
            const discount = discountLabel(row)
            return (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(row.sale_at)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{row.unit?.unit_number ?? '—'}</p>
                  <p className="text-xs text-slate-400">{row.unit?.project?.name ?? 'Sin proyecto'}</p>
                </td>
                <td className="px-4 py-3 text-slate-700">{row.lead?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <PersonCell
                    name={row.sold_by?.full_name}
                    avatarUrl={row.sold_by?.avatar_url}
                    emptyLabel="Sin asesor"
                    size="sm"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  {row.published_price_snapshot != null ? (
                    <PriceText value={row.published_price_snapshot} size="sm" className="font-normal text-slate-500" />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <PriceText value={row.sale_price_final} size="sm" />
                </td>
                <td className="px-4 py-3 text-right">
                  {discount ? (
                    <span className={`text-xs font-medium ${discount.className}`}>{discount.text}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.contract?.contract_number ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

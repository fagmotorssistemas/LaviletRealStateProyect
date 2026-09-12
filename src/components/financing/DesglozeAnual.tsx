'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney } from '@/lib/financing/calculator'

export function DesglozeAnual({ preview }: { preview: InvestmentPreview }) {
  const rows = [
    { label: 'Alquiler al año (con vacancia)', value: preview.annualGrossRental },
    { label: 'Gastos al año', value: -preview.annualExpenses },
    { label: 'Saldo al año', value: preview.annualNetCashFlow, strong: true },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc]">
      <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Desglose anual
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#f0ebe3]">
              <td className={`px-4 py-2.5 text-[#4a433c] ${row.strong ? 'font-semibold' : ''}`}>
                {row.label}
              </td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums ${
                  row.strong ? 'font-semibold text-[#1f1a14]' : 'text-[#6b645c]'
                }`}
              >
                {formatMoney(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

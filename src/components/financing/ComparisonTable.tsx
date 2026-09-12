'use client'

import type { FinancingPartner, InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney, formatPercent } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function ComparisonTable({
  rows,
}: {
  rows: { partner: FinancingPartner; preview: InvestmentPreview }[]
}) {
  const bestRoi = rows.reduce((best, row) => {
    const roi = row.preview.roiPercent ?? -Infinity
    return roi > best ? roi : best
  }, -Infinity)

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ece6dc]">
      <table className="min-w-full text-sm">
        <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          <tr>
            <th className="px-3 py-2.5">Banco</th>
            <th className="px-3 py-2.5">Tasa</th>
            <th className="px-3 py-2.5">Cuota</th>
            <th className="px-3 py-2.5">Saldo al año</th>
            <th className="px-3 py-2.5">Retorno</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ partner, preview }) => {
            const highlight = (preview.roiPercent ?? -Infinity) === bestRoi && bestRoi > -Infinity
            return (
              <tr
                key={partner.id}
                className={cn('border-t border-[#f0ebe3]', highlight && 'bg-emerald-50/70')}
              >
                <td className="px-3 py-2.5 font-medium text-[#1f1a14]">
                  {partner.partner_name}
                  {highlight ? (
                    <span className="ml-2 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                      Mejor opción
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{formatPercent(partner.annual_interest_rate)}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatMoney(preview.monthlyPayment)}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatMoney(preview.annualNetCashFlow)}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatPercent(preview.roiPercent)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

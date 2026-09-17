'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney, formatMoneyExact } from '@/lib/financing/calculator'

export function DesglozeAnual({ preview }: { preview: InvestmentPreview }) {
  const rows: { label: string; value: number; strong?: boolean; muted?: boolean }[] = [
    { label: 'Alquiler potencial', value: preview.annualPotentialRental },
    { label: 'Alquiler efectivo (tras vacancia)', value: preview.annualEffectiveRental },
    { label: 'Gastos operativos', value: -preview.annualOperatingExpenses },
    { label: 'Gestión', value: -preview.annualManagement },
    { label: 'Resultado operativo', value: preview.annualOperatingResult, strong: true },
  ]

  if (preview.mode !== 'cash') {
    rows.push(
      { label: 'Cuotas (capital + intereses)', value: -preview.annualMortgagePaid },
      { label: 'Cargos adicionales del crédito', value: -preview.annualExtraCharges },
      { label: 'Otros costos financieros', value: -preview.annualOtherFinancialCosts },
    )
  }

  rows.push({ label: 'Flujo de caja (antes de IR)', value: preview.annualNetCashFlow, strong: true })

  if (preview.annualIncomeTaxEstimate > 0) {
    rows.push(
      { label: 'IR estimado (manual)', value: -preview.annualIncomeTaxEstimate, muted: true },
      {
        label: 'Flujo después de IR estimado',
        value: preview.annualCashFlowAfterTax,
        strong: true,
        muted: true,
      },
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc]">
      <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Desglose anual
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#f0ebe3]">
              <td
                className={`px-4 py-2.5 text-[#4a433c] ${row.strong ? 'font-semibold' : ''} ${row.muted ? 'text-[#8a8176]' : ''}`}
              >
                {row.label}
              </td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums ${
                  row.strong ? 'font-semibold text-[#1f1a14]' : 'text-[#6b645c]'
                }`}
              >
                {row.strong ? formatMoneyExact(row.value) : formatMoney(row.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.mode !== 'cash' ? (
        <div className="border-t border-[#ece6dc] bg-[#fcfbf9] px-4 py-2.5 text-[11px] text-[#8a8176]">
          Cuota mensual (capital + intereses): {formatMoneyExact(preview.monthlyPayment)}
          {preview.monthlyExtraCharges > 0
            ? ` · extras ${formatMoneyExact(preview.monthlyExtraCharges)}`
            : ''}
          {' · '}
          Tasa {preview.rateType === 'effective_annual' ? 'efectiva' : 'nominal'} anual{' '}
          {preview.interestRate.toFixed(2)}% (configuración de simulación; no es oferta bancaria
          verificada).
        </div>
      ) : null}
    </div>
  )
}

'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney, formatMoneyExact } from '@/lib/financing/calculator'

export function DesglozeAnual({ preview }: { preview: InvestmentPreview }) {
  const rows: { label: string; value: number; strong?: boolean; muted?: boolean }[] = [
    { label: 'Alquiler anual (bruto)', value: preview.annualPotentialRental },
    { label: 'Vacancia / desocupación', value: -preview.annualVacancyCost },
    { label: 'Alquiler efectivo', value: preview.annualEffectiveRental, strong: true },
    { label: 'Gastos operativos (predial, mant., seguro…)', value: -preview.annualOperatingExpenses },
  ]

  // Desglose operativo ya viene agregado; la UI de sliders muestra líneas. Aquí el total ops.
  rows.push(
    { label: 'Impuesto a la renta', value: -preview.annualIncomeTaxEstimate },
    { label: 'Comisión gestor', value: -preview.annualManagement },
  )

  if (preview.mode !== 'cash') {
    rows.push(
      { label: 'Cuotas anuales (capital + intereses)', value: -preview.annualMortgagePaid },
      { label: 'Cargos adicionales del crédito', value: -preview.annualExtraCharges },
      { label: 'Otros costos financieros', value: -preview.annualOtherFinancialCosts },
    )
  }

  rows.push(
    { label: 'Total costos (ops + IR + gestor + deuda)', value: -preview.totalAnnualCosts, muted: true },
    { label: 'Saldo anual real', value: preview.annualNetCashFlow, strong: true },
  )

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
      <div className="border-t border-[#ece6dc] bg-[#fcfbf9] px-4 py-2.5 text-[11px] text-[#8a8176]">
        IR {(preview.incomeTaxRate * 100).toFixed(0)}% y gestor{' '}
        {(preview.managementFeeRate * 100).toFixed(0)}% se calculan sobre el alquiler efectivo (tras
        vacancia)
        {preview.mode !== 'cash'
          ? ` · Cuota ${formatMoneyExact(preview.monthlyPayment)}/mes · tasa ${preview.rateType === 'effective_annual' ? 'efectiva' : 'nominal'} ${preview.interestRate.toFixed(2)}%`
          : ''}
        . No es oferta bancaria verificada.
      </div>
    </div>
  )
}

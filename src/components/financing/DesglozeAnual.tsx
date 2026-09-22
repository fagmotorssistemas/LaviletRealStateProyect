'use client'

import { useState } from 'react'
import type { InvestmentPreview } from '@/types/financingSimulator'
import {
  formatMoney,
  formatMoneyExact,
  paymentInterestAndPrincipal,
  roundMoney,
} from '@/lib/financing/calculator'

export function DesglozeAnual({ preview }: { preview: InvestmentPreview }) {
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')
  const factor = period === 'monthly' ? 1 / 12 : 1
  const label = period === 'monthly' ? '/mes' : '/año'

  const firstPayment =
    preview.mode !== 'cash' && preview.financedAmount > 0
      ? paymentInterestAndPrincipal(
          preview.financedAmount,
          preview.interestRate,
          preview.financingYears,
          1,
          preview.rateType,
        )
      : null

  const annualNetAvailable = roundMoney(
    preview.annualEffectiveRental -
      preview.annualOperatingExpenses -
      preview.annualManagement -
      preview.annualIncomeTaxEstimate,
  )
  const netAvailable = roundMoney(annualNetAvailable * factor)
  const topUpOrSurplus = roundMoney(annualNetAvailable / 12 - preview.monthlyPayment)
  const scaledTopUp =
    period === 'monthly' ? topUpOrSurplus : roundMoney(topUpOrSurplus * 12)

  const rows: { label: string; value: number; strong?: boolean; note?: string }[] = [
    { label: 'Alquiler bruto', value: roundMoney(preview.annualPotentialRental * factor) },
    { label: 'Vacancia', value: roundMoney(-preview.annualVacancyCost * factor) },
    {
      label: 'Alquiler efectivo',
      value: roundMoney(preview.annualEffectiveRental * factor),
      strong: true,
    },
    {
      label: 'Gastos de la propiedad',
      value: roundMoney(-preview.annualOperatingExpenses * factor),
    },
    {
      label: 'Servicio de administración del alquiler (supuesto)',
      value: roundMoney(-preview.annualManagement * factor),
    },
    {
      label: 'Impuesto estimado (supuesto configurado)',
      value: roundMoney(-preview.annualIncomeTaxEstimate * factor),
    },
    {
      label: 'Alquiler neto disponible',
      value: netAvailable,
      strong: true,
    },
  ]

  if (preview.mode !== 'cash' && firstPayment) {
    const interest = period === 'monthly' ? firstPayment.interest : roundMoney(firstPayment.interest * 12)
    const capital =
      period === 'monthly' ? firstPayment.principalPaid : roundMoney(firstPayment.principalPaid * 12)
    rows.push(
      {
        label: 'Pago del crédito — intereses (1.ª cuota × período)',
        value: -interest,
        note: 'Ilustrativo: la proporción capital/interés cambia con el tiempo',
      },
      {
        label: 'Pago del crédito — capital (1.ª cuota × período)',
        value: -capital,
      },
      {
        label: 'Cuota total',
        value: roundMoney(-preview.monthlyPayment * (period === 'monthly' ? 1 : 12)),
      },
    )
  }

  rows.push({
    label:
      scaledTopUp < 0
        ? 'Tu aporte mensual estimado'
        : scaledTopUp > 0
          ? 'Dinero que te queda cada mes'
          : 'Los ingresos cubren gastos y cuota',
    value: scaledTopUp,
    strong: true,
    note:
      scaledTopUp < 0
        ? 'Tras aplicar el alquiler neto a la cuota. No es solo capital amortizado.'
        : undefined,
  })

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Cómo se distribuyen ingresos y pagos
        </p>
        <div className="flex gap-1">
          {(
            [
              ['monthly', 'Mensual'],
              ['annual', 'Anual'],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.1em] uppercase ${
                period === id
                  ? 'bg-[#1a2744] text-white'
                  : 'border border-[#d9d0c3] bg-white text-[#6b645c]'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#f0ebe3]">
              <td className={`px-4 py-2.5 text-[#4a433c] ${row.strong ? 'font-semibold' : ''}`}>
                {row.label}
                {row.note ? (
                  <span className="mt-0.5 block text-[10px] font-normal text-[#8a8176]">
                    {row.note}
                  </span>
                ) : null}
              </td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums ${
                  row.strong ? 'font-semibold text-[#1f1a14]' : 'text-[#6b645c]'
                }`}
              >
                {row.strong ? formatMoneyExact(row.value) : formatMoney(row.value)}
                <span className="ml-1 text-[10px] text-[#8a8176]">{label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-[#ece6dc] bg-[#fcfbf9] px-4 py-2.5 text-[11px] text-[#8a8176]">
        Vacancia una sola vez. IR {(preview.incomeTaxRate * 100).toFixed(0)}% y gestor{' '}
        {(preview.managementFeeRate * 100).toFixed(0)}% son supuestos configurados (no una tasa legal
        universal). Las cifras del horizonte patrimonial están en el análisis principal.
      </div>
    </div>
  )
}

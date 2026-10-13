'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useState } from 'react'
import type { InvestmentPreview } from '@/types/financingSimulator'
import type { TaxProfile } from '@/lib/financing/ecuadorTax'
import {
  formatMoneyExact,
  paymentInterestAndPrincipal,
  roundMoney,
} from '@/lib/financing/calculator'

const taxProfileLabels: Record<TaxProfile, string> = {
  none_other: 'Solo este arriendo',
  lt12: 'Menos de $12.000 al año',
  '12_25': '$12.000 – $25.000',
  '25_45': '$25.000 – $45.000',
  '45_80': '$45.000 – $80.000',
  '80_120': '$80.000 – $120.000',
  gt120: 'Más de $120.000',
  company: 'Compro como empresa',
}

export function DesglozeAnual({ preview }: { preview: InvestmentPreview }) {
  const { t } = useTourLanguage()

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
    period === 'monthly' ? topUpOrSurplus : roundMoney(annualNetAvailable - preview.monthlyPayment * 12)

  const rows: { label: string; value: number; strong?: boolean; note?: string; tax?: boolean }[] = [
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
      label: 'Impuesto a la renta',
      tax: true,
      value: roundMoney(-preview.annualIncomeTaxEstimate * factor),
      note: 'Base: arriendo − deducibles SRI',
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

  if (preview.mode !== 'cash') rows.push({
    label:
      scaledTopUp < 0
        ? period === 'annual' ? 'Tu aporte anual estimado' : 'Tu aporte mensual estimado'
        : scaledTopUp > 0
          ? period === 'annual' ? 'Dinero que te queda al año' : 'Dinero que te queda cada mes'
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
          {t(" Cómo se distribuyen ingresos y pagos ")}</p>
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
              {t(text)}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#f0ebe3]">
              <td className={`px-4 py-2.5 text-[#4a433c] ${row.strong ? 'font-semibold' : ''}`}>
                {row.tax ? <>{t(preview.taxProfile === 'company' ? 'Impuesto a la renta (empresa ' : 'Impuesto a la renta estimado (tabla SRI ')}{t(preview.taxProfile === 'company' ? `${Number((preview.companyIncomeTaxRate * 100).toFixed(1))}%` : preview.incomeTaxTableYear)})</> : t(row.label)}
                {row.note ? (
                  <span className="mt-0.5 block text-[10px] font-normal text-[#8a8176]">
                    {t(row.note)}
                  </span>
                ) : null}
              </td>
              <td
                className={`px-4 py-2.5 text-right tabular-nums ${
                  row.strong ? 'font-semibold text-[#1f1a14]' : 'text-[#6b645c]'
                }`}
              >
                {t(row.value < 0 ? `−${formatMoneyExact(-row.value)}` : formatMoneyExact(row.value))}
                <span className="ml-1 text-[10px] text-[#8a8176]">{t(label)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-[#ece6dc] bg-[#fcfbf9] px-4 py-2.5 text-[11px] text-[#8a8176]">
        {t('Perfil tributario: ')}{t(taxProfileLabels[preview.taxProfile])}{t(' · gestor ')}{t((preview.managementFeeRate * 100).toFixed(1))}{t('%. Deducibles del arriendo según SRI.')}{preview.isCommercial ? t(' El arriendo comercial lleva IVA 15% que paga el inquilino; no es ingreso del propietario.') : null}</div>
    </div>
  )
}

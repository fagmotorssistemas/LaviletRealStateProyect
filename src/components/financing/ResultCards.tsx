'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney, formatMoneyExact, formatPercent } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function ResultCards({ preview }: { preview: InvestmentPreview }) {
  const cards = [
    {
      label: 'Alquiler efectivo / año',
      value: formatMoney(preview.annualEffectiveRental),
    },
    {
      label: 'Resultado operativo / año',
      value: formatMoney(preview.annualOperatingResult),
    },
    {
      label: 'Flujo de caja / año',
      value: formatMoneyExact(preview.annualNetCashFlow),
      tone: preview.annualNetCashFlow >= 0 ? 'good' : 'bad',
    },
    {
      label: 'Flujo / mes',
      value: formatMoneyExact(preview.monthlyCashFlow),
      tone: preview.monthlyCashFlow >= 0 ? 'good' : 'bad',
    },
    {
      label: 'Retorno de caja',
      value: formatPercent(preview.cashOnCashReturn),
      tone: (preview.cashOnCashReturn ?? 0) >= 0 ? 'good' : 'bad',
      hint: 'Flujo anual ÷ efectivo inicial aportado',
    },
    {
      label: 'Rendimiento operativo',
      value: formatPercent(preview.operatingYieldOnPrice),
      hint: 'Resultado operativo ÷ precio',
    },
  ] as const

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[#8a8176]">
        Flujo de caja y retorno mostrados <strong>antes de impuesto a la renta</strong>
        {preview.annualIncomeTaxEstimate > 0
          ? ` · IR estimado anual: ${formatMoney(preview.annualIncomeTaxEstimate)} → flujo después IR ${formatMoneyExact(preview.annualCashFlowAfterTax)}`
          : ' (IR no incluido salvo que lo indique)'}
        .
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.label}
            className={cn(
              'rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3',
              'tone' in card && card.tone === 'good' && 'border-emerald-200/80',
              'tone' in card && card.tone === 'bad' && 'border-rose-200/80',
            )}
          >
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
              {card.label}
            </p>
            <p
              className={cn(
                'mt-1 text-xl font-semibold text-[#1f1a14]',
                'tone' in card && card.tone === 'good' && 'text-emerald-700',
                'tone' in card && card.tone === 'bad' && 'text-rose-700',
              )}
            >
              {card.value}
            </p>
            {'hint' in card && card.hint ? (
              <p className="mt-1 text-[10px] text-[#8a8176]">{card.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      {preview.buyerTopUpMonthly > 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          El comprador debería complementar aprox.{' '}
          <strong>{formatMoneyExact(preview.buyerTopUpMonthly)}</strong> / mes con el flujo actual.
          {preview.debtCoverageRatio != null ? (
            <span className="mt-1 block text-[11px] text-rose-800/80">
              Cobertura (resultado operativo ÷ servicio de deuda):{' '}
              {preview.debtCoverageRatio.toFixed(2)}×
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
          Recuperación (simple)
        </p>
        <p className="mt-1 text-sm font-semibold text-[#1f1a14]">
          {preview.paybackLabel ||
            (preview.paybackYears != null
              ? `${preview.paybackYears.toFixed(1)} años`
              : 'No recuperable con el flujo actual')}
        </p>
        <p className="mt-1 text-[10px] text-[#8a8176]">
          Supuesto: flujo constante; sin apreciación ni venta. No extrapola cuotas más allá del
          plazo del crédito.
          {preview.breakevenMonth != null
            ? ` Equilibrio estimado: mes ${preview.breakevenMonth}.`
            : preview.paybackYears == null && preview.annualNetCashFlow > 0
              ? ' El mes de equilibrio queda fuera del plazo del crédito (o no aplica).'
              : ''}
        </p>
      </div>
    </div>
  )
}

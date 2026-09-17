'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoneyExact, formatPercent } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function ResultCards({ preview }: { preview: InvestmentPreview }) {
  const entradaLabel =
    preview.mode === 'cash'
      ? 'ROI sobre precio (contado)'
      : `ROI sobre entrada (${preview.downPaymentPercent.toFixed(0)}%)`

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-[#fcfbf9]">
        <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Retorno estimado
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                {entradaLabel}
              </p>
              <p
                className={cn(
                  'mt-1 text-2xl font-semibold tabular-nums',
                  (preview.cashOnCashReturn ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700',
                )}
              >
                {formatPercent(preview.cashOnCashReturn)}
              </p>
              <p className="mt-0.5 text-[10px] text-[#8a8176]">Saldo anual ÷ efectivo aportado</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                ROI sobre precio total
              </p>
              <p
                className={cn(
                  'mt-1 text-2xl font-semibold tabular-nums',
                  (preview.roiOnTotalPrice ?? 0) >= 0 ? 'text-[#1f1a14]' : 'text-rose-700',
                )}
              >
                {formatPercent(preview.roiOnTotalPrice)}
              </p>
              <p className="mt-0.5 text-[10px] text-[#8a8176]">Saldo anual ÷ precio</p>
            </div>
          </div>
          <div className="border-t border-[#ece6dc] pt-3">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
              Período de recuperación de la entrada
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1f1a14]">
              {preview.paybackLabel ||
                (preview.paybackYears != null
                  ? `${preview.paybackYears.toFixed(1)} años`
                  : 'No recuperable con el flujo actual')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Saldo anual real
          </p>
          <p
            className={cn(
              'mt-1 text-xl font-semibold tabular-nums',
              preview.annualNetCashFlow >= 0 ? 'text-emerald-700' : 'text-rose-700',
            )}
          >
            {formatMoneyExact(preview.annualNetCashFlow)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Saldo / mes
          </p>
          <p
            className={cn(
              'mt-1 text-xl font-semibold tabular-nums',
              preview.monthlyCashFlow >= 0 ? 'text-emerald-700' : 'text-rose-700',
            )}
          >
            {formatMoneyExact(preview.monthlyCashFlow)}
          </p>
        </div>
      </div>

      {preview.buyerTopUpMonthly > 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Complemento estimado del comprador:{' '}
          <strong>{formatMoneyExact(preview.buyerTopUpMonthly)}</strong> / mes.
        </div>
      ) : null}
    </div>
  )
}

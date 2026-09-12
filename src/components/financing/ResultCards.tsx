'use client'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoney, formatPercent } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function ResultCards({ preview }: { preview: InvestmentPreview }) {
  const cards = [
    {
      label: 'Alquiler al año',
      value: formatMoney(preview.annualGrossRental),
    },
    {
      label: 'Saldo al año',
      value: formatMoney(preview.annualNetCashFlow),
      tone: preview.annualNetCashFlow >= 0 ? 'good' : 'bad',
    },
    {
      label: 'Retorno estimado',
      value: formatPercent(preview.roiPercent),
      tone: (preview.roiPercent ?? 0) >= 0 ? 'good' : 'bad',
    },
    {
      label: 'Recupera la inversión',
      value: preview.paybackYears != null ? `${preview.paybackYears.toFixed(1)} años` : '—',
    },
  ] as const

  return (
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
        </div>
      ))}
    </div>
  )
}

'use client'

import type { MonthlyCoverage } from '@/types/financingSimulator'
import { formatMoneyExact } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function CoberturaMensual({
  coverage,
  showPayment,
}: {
  coverage: MonthlyCoverage
  /** En contado la cuota es 0; aún se muestra el bloque. */
  showPayment?: boolean
}) {
  const badge =
    coverage.status === 'covers'
      ? { label: 'CUBRE', tone: 'good' as const }
      : coverage.status === 'borderline'
        ? { label: 'BORDERLINE', tone: 'warn' as const }
        : { label: 'INSUFICIENTE', tone: 'bad' as const }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-[#fcfbf9]">
      <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Análisis de cobertura mensual
      </div>
      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between gap-3 tabular-nums">
          <span className="text-[#4a433c]">Alquiler mensual</span>
          <span className="font-medium text-[#1f1a14]">{formatMoneyExact(coverage.monthlyRent)}</span>
        </div>
        {showPayment !== false ? (
          <div className="flex justify-between gap-3 tabular-nums">
            <span className="text-[#4a433c]">Cuota mensual</span>
            <span className="font-medium text-rose-700">
              −{formatMoneyExact(coverage.monthlyPayment)}
            </span>
          </div>
        ) : null}
        <div className="border-t border-[#ece6dc] pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
              Superávit / déficit
            </span>
            <span
              className={cn(
                'text-base font-semibold tabular-nums',
                coverage.difference >= 0 ? 'text-emerald-700' : 'text-rose-700',
              )}
            >
              {formatMoneyExact(coverage.difference)}
            </span>
          </div>
          <div className="mt-2 flex justify-end">
            <span
              className={cn(
                'inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] uppercase',
                badge.tone === 'good' && 'bg-emerald-100 text-emerald-800',
                badge.tone === 'warn' && 'bg-amber-100 text-amber-900',
                badge.tone === 'bad' && 'bg-rose-100 text-rose-800',
              )}
            >
              {badge.label}
            </span>
          </div>
        </div>
        {coverage.status !== 'covers' ? (
          <p className="text-[11px] text-rose-800/90">
            El alquiler no cubre la cuota
            {coverage.status === 'borderline' ? ' (margen estrecho)' : ''}.
          </p>
        ) : null}
      </div>
    </div>
  )
}

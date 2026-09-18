'use client'

import type { RentCoverageAnalysis } from '@/lib/financing/calculator'
import { formatMoneyExact } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

export function CoberturaMensual({
  coverage,
  showPayment,
}: {
  coverage: RentCoverageAnalysis
  showPayment?: boolean
}) {
  const needsTopUp = coverage.monthlyTopUpOrSurplus < 0
  const surplus = coverage.monthlyTopUpOrSurplus >= 0

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-[#fcfbf9]">
      <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Cobertura del alquiler vs cuota
      </div>
      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between gap-3 tabular-nums">
          <span className="text-[#4a433c]">Alquiler bruto estimado</span>
          <span className="font-medium text-[#1f1a14]">
            {formatMoneyExact(coverage.monthlyGrossRent)}
          </span>
        </div>
        {showPayment !== false ? (
          <div className="flex justify-between gap-3 tabular-nums">
            <span className="text-[#4a433c]">Cuota del crédito</span>
            <span className="font-medium text-[#1f1a14]">
              {formatMoneyExact(coverage.monthlyPayment)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 border-t border-[#ece6dc] pt-2 tabular-nums">
          <span className="text-[#4a433c]">Diferencia antes de gastos</span>
          <span
            className={cn(
              'font-medium',
              coverage.grossDifference >= 0 ? 'text-[#1f1a14]' : 'text-amber-800',
            )}
          >
            {formatMoneyExact(coverage.grossDifference)}
          </span>
        </div>
        <p className="text-[11px] text-[#8a8176]">
          {coverage.coversGrossBeforeExpenses
            ? 'Cubre la cuota antes de gastos (alquiler bruto).'
            : 'El alquiler bruto no alcanza la cuota.'}
        </p>

        <div className="mt-2 space-y-2 rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5">
          <div className="flex justify-between gap-3 tabular-nums">
            <span className="text-[#4a433c]">Alquiler neto disponible</span>
            <span className="font-medium text-[#1f1a14]">
              {formatMoneyExact(coverage.monthlyNetRentAvailable)}
            </span>
          </div>
          <p className="text-[10px] text-[#8a8176]">
            Tras tiempo sin inquilino, gastos de la propiedad, administración del alquiler e impuesto
            estimado · {formatMoneyExact(coverage.annualNetRentAvailable)}/año
          </p>
          <div className="flex justify-between gap-3 border-t border-[#f0ebe3] pt-2 tabular-nums">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-[#6b645c] uppercase">
              {needsTopUp ? 'Aporte adicional necesario' : 'Excedente mensual'}
            </span>
            <span
              className={cn(
                'text-base font-semibold',
                surplus ? 'text-emerald-700' : 'text-amber-800',
              )}
            >
              {formatMoneyExact(Math.abs(coverage.monthlyTopUpOrSurplus))}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-[11px] text-[#8a8176]">
            <span>Flujo anual</span>
            <span className="tabular-nums">{formatMoneyExact(coverage.annualCashFlow)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

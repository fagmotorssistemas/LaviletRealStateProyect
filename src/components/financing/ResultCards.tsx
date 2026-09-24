'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import type { InvestmentPreview } from '@/types/financingSimulator'
import { formatMoneyExact, formatPercent } from '@/lib/financing/calculator'
import { cn } from '@/lib/utils'

function monthlyFlowLabel(monthlyCashFlow: number) {
  if (monthlyCashFlow > 0) return 'Dinero que te queda cada mes'
  if (monthlyCashFlow < 0) return 'Monto que debes completar cada mes'
  return 'Los ingresos cubren los gastos y la cuota incluidos'
}

/** Resumen compacto; el detalle de aporte/patrimonio vive en Análisis de tu inversión. */
export function ResultCards({ preview }: { preview: InvestmentPreview }) {
  const { t } = useTourLanguage()

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
          {t(" Resultado anual (caja) ")}</p>
        <p
          className={cn(
            'mt-1 text-xl font-semibold tabular-nums',
            preview.annualNetCashFlow >= 0 ? 'text-emerald-700' : 'text-amber-800',
          )}
        >
          {t(formatMoneyExact(preview.annualNetCashFlow))}
        </p>
        <p className="mt-0.5 text-[10px] text-[#8a8176]">
          {t(" Rendimiento anual de flujo sobre entrada:")}{t(' ')}
          {t(formatPercent(
            preview.initialCashOutlay > 0
              ? (preview.annualNetCashFlow / preview.initialCashOutlay) * 100
              : null,
          ))}
        </p>
      </div>
      <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
          {t(monthlyFlowLabel(preview.monthlyCashFlow))}
        </p>
        <p
          className={cn(
            'mt-1 text-xl font-semibold tabular-nums',
            preview.monthlyCashFlow >= 0 ? 'text-emerald-700' : 'text-amber-800',
          )}
        >
          {t(formatMoneyExact(Math.abs(preview.monthlyCashFlow)))}
        </p>
        <p className="text-[10px] text-[#8a8176]">
          {t(" Cifra mensual del primer año (el signo se interpreta con el título). Distinto del acumulado del horizonte. ")}</p>
      </div>
    </div>
  )
}

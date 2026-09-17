'use client'

import type { BuildInvestmentInput } from '@/lib/financing/calculator'
import {
  buildViabilityAlternatives,
  formatMoney,
  formatMoneyExact,
} from '@/lib/financing/calculator'
import type { InvestmentPreview } from '@/types/financingSimulator'
import { cn } from '@/lib/utils'

export function ViabilidadAlerta({
  preview,
  input,
}: {
  preview: InvestmentPreview
  input: BuildInvestmentInput
}) {
  if (preview.viabilityLevel === 'viable') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        Flujo anual positivo con estos parámetros · saldo{' '}
        <strong>{formatMoneyExact(preview.annualNetCashFlow)}</strong>
      </div>
    )
  }

  const alts = buildViabilityAlternatives(input)
  const critical = preview.viabilityLevel === 'critical'

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border px-4 py-4',
        critical ? 'border-rose-300 bg-rose-50 text-rose-950' : 'border-amber-300 bg-amber-50 text-amber-950',
      )}
    >
      <p className="text-[11px] font-semibold tracking-[0.14em] uppercase">
        {critical ? 'Alerta crítica' : 'Alerta de viabilidad'}
      </p>
      <p className="text-sm">
        Este departamento <strong>no es viable como inversión de flujo positivo</strong> con estos
        parámetros.
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-[10px] uppercase opacity-70">Déficit anual</p>
          <p className="font-semibold tabular-nums">{formatMoneyExact(preview.annualNetCashFlow)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase opacity-70">Déficit mensual</p>
          <p className="font-semibold tabular-nums">{formatMoneyExact(preview.monthlyCashFlow)}</p>
        </div>
      </div>

      {preview.mode !== 'cash' ? (
        <div className="space-y-2 border-t border-black/10 pt-3 text-sm">
          <p className="text-[10px] font-semibold tracking-[0.12em] uppercase opacity-80">
            Opciones para viabilidad
          </p>
          <ul className="space-y-2 text-[13px]">
            <li>
              Aumentar entrada a 50% → cuota {formatMoneyExact(alts.altDown50.monthlyPayment)} · saldo{' '}
              {formatMoneyExact(alts.altDown50.annualNetCashFlow)}
            </li>
            <li>
              Plazo a 20 años → cuota {formatMoneyExact(alts.altYears20.monthlyPayment)} · saldo{' '}
              {formatMoneyExact(alts.altYears20.annualNetCashFlow)}
            </li>
            <li>
              Buscar alquiler de {formatMoney(alts.targetRent)}/mes (ahora{' '}
              {formatMoney(input.estimatedMonthlyRent)}) → saldo{' '}
              {formatMoneyExact(alts.altRent.annualNetCashFlow)}
            </li>
            <li>
              Estrategia de apreciación (no flujo): a{' '}
              {(alts.appreciation.annualRate * 100).toFixed(0)}% anual en {alts.appreciation.years}{' '}
              años → valor {formatMoney(alts.appreciation.futureValue)} · ganancia potencial{' '}
              {formatMoney(alts.appreciation.gain)}
            </li>
          </ul>
        </div>
      ) : (
        <div className="space-y-2 border-t border-black/10 pt-3 text-sm">
          <p className="text-[10px] font-semibold tracking-[0.12em] uppercase opacity-80">
            Opciones para viabilidad
          </p>
          <ul className="space-y-2 text-[13px]">
            <li>
              Buscar alquiler de {formatMoney(alts.targetRent)}/mes → saldo{' '}
              {formatMoneyExact(alts.altRent.annualNetCashFlow)}
            </li>
            <li>
              Estrategia de apreciación: a {(alts.appreciation.annualRate * 100).toFixed(0)}% anual en{' '}
              {alts.appreciation.years} años → valor {formatMoney(alts.appreciation.futureValue)} ·
              ganancia {formatMoney(alts.appreciation.gain)}
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

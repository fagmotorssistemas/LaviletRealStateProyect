'use client'

import { useMemo } from 'react'
import type { BuildInvestmentInput } from '@/lib/financing/calculator'
import {
  buildRentCoverageAnalysis,
  buildViabilityAlternatives,
  buildWealthProjection,
  formatMoney,
  formatMoneyExact,
  formatPercent,
} from '@/lib/financing/calculator'
import type { InvestmentPreview } from '@/types/financingSimulator'
import { cn } from '@/lib/utils'

export function ViabilidadAlerta({
  preview,
  input,
  horizonYears,
  appreciationRateAnnual,
  onHorizonYearsChange,
  onAppreciationRateChange,
}: {
  preview: InvestmentPreview
  input: BuildInvestmentInput
  horizonYears: number
  appreciationRateAnnual: number
  onHorizonYearsChange?: (years: number) => void
  onAppreciationRateChange?: (rate: number) => void
}) {
  const coverage = useMemo(() => buildRentCoverageAnalysis(preview), [preview])
  const wealth = useMemo(
    () =>
      buildWealthProjection({
        preview,
        horizonYears,
        appreciationRateAnnual,
        saleCosts: input.saleCosts,
      }),
    [preview, horizonYears, appreciationRateAnnual, input.saleCosts],
  )
  const alts = useMemo(
    () =>
      buildViabilityAlternatives({
        ...input,
        wealthHorizonYears: horizonYears,
        appreciationRateAnnual,
      }),
    [input, horizonYears, appreciationRateAnnual],
  )

  const needsTopUp = coverage.monthlyTopUpOrSurplus < 0

  return (
    <div className="space-y-4 rounded-2xl border border-[#ece6dc] bg-white px-4 py-4 shadow-[0_8px_24px_rgba(40,30,20,0.04)]">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Análisis de tu inversión
        </p>
        <p className="mt-1 text-sm text-[#4a433c]">
          Cuánto aporta el alquiler, cuánto completarías tú y qué patrimonio podría acumularse con
          estos supuestos.
        </p>
      </div>

      {/* A. Aporte mensual */}
      <div className="space-y-2 rounded-xl border border-[#ece6dc] bg-[#fcfbf9] px-3 py-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
          A. Tu aporte mensual
        </p>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Metric
            label="Alquiler neto disponible"
            value={formatMoneyExact(coverage.monthlyNetRentAvailable)}
          />
          <Metric label="Cuota" value={formatMoneyExact(coverage.monthlyPayment)} />
          <Metric
            label={needsTopUp ? 'Aporte adicional requerido' : 'Excedente mensual'}
            value={formatMoneyExact(Math.abs(coverage.monthlyTopUpOrSurplus))}
            tone={needsTopUp ? 'amber' : 'good'}
          />
          <Metric
            label="Entrada inicial"
            value={formatMoneyExact(preview.downPaymentAmount)}
          />
        </div>
        <p className="text-[12px] leading-relaxed text-[#4a433c]">
          {needsTopUp ? (
            <>
              El alquiler neto aporta aproximadamente{' '}
              <strong>{formatMoney(coverage.monthlyNetRentAvailable)}</strong> al pago de la cuota.
              Necesitarías completar aproximadamente{' '}
              <strong>{formatMoney(Math.abs(coverage.monthlyTopUpOrSurplus))}</strong> mensuales con
              estos supuestos.
            </>
          ) : (
            <>
              Con estos supuestos, el alquiler neto cubriría la cuota y dejaría un excedente de
              aproximadamente <strong>{formatMoney(coverage.monthlyTopUpOrSurplus)}</strong> al mes.
            </>
          )}
        </p>
        <p className="text-[11px] text-[#8a8176]">
          Flujo anual estimado: {formatMoneyExact(preview.annualNetCashFlow)}. Rendimiento anual de
          flujo sobre la entrada:{' '}
          {formatPercent(wealth.annualCashFlowYieldPercent)} (no es un retorno acumulado del
          horizonte).
        </p>
      </div>

      {/* B. Patrimonio */}
      <div className="space-y-3 rounded-xl border border-[#ece6dc] bg-[#fcfbf9] px-3 py-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
          B. Valor estimado de tu propiedad menos la deuda
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-[11px]">
            <span className="text-[#6b645c]">Horizonte (años)</span>
            <input
              type="number"
              min={1}
              max={40}
              value={horizonYears}
              onChange={(e) => onHorizonYearsChange?.(Number(e.target.value) || 10)}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-[11px]">
            <span className="text-[#6b645c]">Aumento estimado del valor de la propiedad (%/año, hipótesis)</span>
            <input
              type="number"
              step={0.1}
              value={Math.round(appreciationRateAnnual * 1000) / 10}
              onChange={(e) =>
                onAppreciationRateChange?.((Number(e.target.value) || 0) / 100)
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Metric label="Valor futuro estimado" value={formatMoney(wealth.futurePropertyValue)} />
          <Metric label="Deuda pendiente" value={formatMoney(wealth.remainingDebt)} />
          <Metric
            label="Valor estimado de tu propiedad menos la deuda"
            value={formatMoney(wealth.endingEquity)}
            emphasize
          />
          <Metric
            label="Efectivo aportado acumulado"
            value={formatMoney(wealth.totalCashInvested)}
            hint={`Entrada/precio + aportes por déficit (${formatMoney(wealth.cumulativeTopUps)})`}
          />
          <Metric
            label="Ganancia o pérdida proyectada"
            value={formatMoneyExact(wealth.projectedGainOrLoss)}
            tone={wealth.projectedGainOrLoss >= 0 ? 'good' : 'amber'}
          />
          <Metric
            label={`Rentabilidad estimada en ${horizonYears} años`}
            value={formatPercent(wealth.cumulativeReturnOnCashPercent)}
            hint="No es un retorno anualizado ni una rentabilidad garantizada"
          />
        </div>
        <p className="text-[11px] text-[#8a8176]">
          Comparación sin aumento de valor: valor neto{' '}
          {formatMoney(wealth.zeroAppreciation.endingEquity)} · ganancia/pérdida{' '}
          {formatMoneyExact(wealth.zeroAppreciation.projectedGainOrLoss)} · rentabilidad{' '}
          {formatPercent(wealth.zeroAppreciation.cumulativeReturnOnCashPercent)}.
        </p>
        {!wealth.saleCostsIncluded ? (
          <p className="text-[11px] text-[#8a8176]">
            Sin costos de venta/salida modelados en este escenario.
          </p>
        ) : null}
        <p className="text-[11px] text-[#8a8176]">
          El aumento estimado del valor no es ingreso disponible para pagar cuotas.
        </p>
      </div>

      {/* Alternativas */}
      {(alts.suggestions.length > 0 || alts.breakEvenGrossRent > 0) && (
        <div className="space-y-2 border-t border-[#f0ebe3] pt-3 text-sm">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">
            Alternativas útiles
          </p>
          <ul className="space-y-2 text-[13px] text-[#4a433c]">
            {alts.suggestions.map((s) => (
              <li key={s.id}>
                {s.label} → cuota {formatMoneyExact(s.preview.monthlyPayment)}
                {s.topUpDeltaMonthly != null ? (
                  <>
                    {' '}
                    · cambio en aporte ≈ {formatMoneyExact(s.topUpDeltaMonthly)}/mes
                  </>
                ) : null}
              </li>
            ))}
            {alts.breakEvenGrossRent > 0 ? (
              <li>
                Alquiler bruto de equilibrio (objetivo matemático, no respaldo de mercado):{' '}
                {formatMoney(alts.breakEvenGrossRent)}/mes
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  tone,
  emphasize,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'amber'
  emphasize?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-semibold tabular-nums text-[#1f1a14]',
          emphasize ? 'text-lg' : 'text-base',
          tone === 'good' && 'text-emerald-700',
          tone === 'amber' && 'text-amber-800',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

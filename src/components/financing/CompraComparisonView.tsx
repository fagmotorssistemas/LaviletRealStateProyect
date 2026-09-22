'use client'

import { useMemo, useState, type ReactNode } from 'react'
import type { BuildInvestmentInput } from '@/lib/financing/calculator'
import {
  buildCashVsFinancedComparison,
  buildRentCoverageAnalysis,
  buildWealthProjection,
  formatMoney,
  formatMoneyExact,
  formatPercent,
  roundMoney,
} from '@/lib/financing/calculator'
import { coverageBarSegments } from '@/components/financing/CoberturaMensual'
import type { InvestmentPreview } from '@/types/financingSimulator'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

type AccordionId = 'rent' | 'debt' | 'calc' | null

/** Montos de las cards KPI: sin marcas bidi de Intl y siempre centrados. */
function formatStatValue(value: string) {
  return value.replace(/[\u200e\u200f\u061c\u2066-\u2069\u00a0\u202f]/g, '').trim()
}

function StatValue({ value }: { value: string }) {
  const clean = formatStatValue(value)
  return (
    <span className="inline-flex max-w-full items-baseline justify-center whitespace-nowrap text-[1.25rem] font-bold leading-none tracking-tight text-[#1f1a14] sm:text-[1.5rem]">
      {clean}
    </span>
  )
}

function Accordion({
  id,
  openId,
  onToggle,
  title,
  children,
}: {
  id: Exclude<AccordionId, null>
  openId: AccordionId
  onToggle: (id: Exclude<AccordionId, null>) => void
  title: string
  children: ReactNode
}) {
  const open = openId === id
  return (
    <div className="overflow-hidden rounded-xl border border-[#e4ddd3]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-sm font-medium transition-colors',
          open
            ? 'border-b-2 border-[#1a2744] bg-[#1a2744] text-white'
            : 'bg-[#fcfbf9] text-[#1f1a14] hover:bg-[#f7f3ee]',
        )}
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="space-y-4 bg-[#f4f1eb] px-4 py-5">{children}</div> : null}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'accent' | 'good' | 'muted'
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 border-b border-[#e4ddd3]/80 pb-2.5 text-[12px] last:border-b-0 last:pb-0 sm:gap-3 sm:pb-3 sm:text-[13px]',
        strong && 'font-semibold text-[#1f1a14]',
      )}
    >
      <span className={cn('min-w-0 flex-1 leading-snug', strong ? 'text-[#1f1a14]' : 'text-[#6b645c]')}>
        {label}
      </span>
      <span
        className={cn(
          'max-w-[58%] shrink-0 text-right tabular-nums leading-snug break-words',
          tone === 'accent' && 'font-semibold text-[#1a2744]',
          tone === 'good' && 'font-semibold text-emerald-700',
          tone === 'muted' && 'max-w-[62%] text-[#6b645c]',
          !tone && (strong ? 'text-[#1f1a14]' : 'text-[#1f1a14]'),
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** Presentación principal del simulador (tour drawer y página). Cifras del motor, no fijas. */
export function CompraComparisonView({
  preview,
  input,
  horizonYears,
  appreciationRateAnnual,
  onHorizonYearsChange,
  onAppreciationRateChange,
  unitLabel,
  onRequestInfo,
}: {
  preview: InvestmentPreview
  input: BuildInvestmentInput
  horizonYears: number
  appreciationRateAnnual: number
  onHorizonYearsChange?: (years: number) => void
  onAppreciationRateChange?: (rate: number) => void
  unitLabel?: string
  onRequestInfo?: () => void
}) {
  const [openAccordion, setOpenAccordion] = useState<AccordionId>(null)

  const comparison = useMemo(
    () =>
      buildCashVsFinancedComparison({
        shared: {
          unitPrice: input.unitPrice,
          estimatedMonthlyRent: input.estimatedMonthlyRent,
          vacancyRate: input.vacancyRate,
          annualOperatingExpenses: input.annualOperatingExpenses,
          includeIncomeTax: input.includeIncomeTax,
          includePropertyManager: input.includePropertyManager,
          incomeTaxRate: input.incomeTaxRate,
          managementFeeRate: input.managementFeeRate,
          financingYears: input.financingYears,
          interestRate: input.interestRate,
          rateType: input.rateType,
          acquisitionCosts: input.acquisitionCosts,
          annualOtherFinancialCosts: input.annualOtherFinancialCosts,
          monthlyExtraCharges: input.monthlyExtraCharges,
          saleCosts: input.saleCosts,
        },
        downPaymentPercent: input.downPaymentPercent ?? 30,
        horizonYears,
        appreciationRateAnnual,
        saleCosts: input.saleCosts,
      }),
    [input, horizonYears, appreciationRateAnnual],
  )

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

  const isCash = preview.mode === 'cash'
  const unitTitle = unitLabel?.trim() || 'Unidad'
  const monthlyFlow = coverage.monthlyTopUpOrSurplus
  const payment = coverage.monthlyPayment
  const net = coverage.monthlyNetRentAvailable
  const bar = coverageBarSegments(net, !isCash && payment > 0 ? payment : 0)
  const rentPctLabel = bar.rentPct != null ? Math.round(bar.rentPct) : null
  const buyerPctLabel = bar.buyerPct != null ? Math.round(bar.buyerPct) : null

  const vacancyMo = roundMoney(preview.annualVacancyCost / 12)
  const opsMo = roundMoney(preview.annualOperatingExpenses / 12)
  const mgmtMo = roundMoney(preview.annualManagement / 12)
  const taxMo = roundMoney(preview.annualIncomeTaxEstimate / 12)
  const adminTaxMo = roundMoney(mgmtMo + taxMo)
  const grossMo = roundMoney(preview.annualPotentialRental / 12)
  const principalAmortized = !isCash
    ? roundMoney(Math.max(0, preview.financedAmount - wealth.remainingDebt))
    : 0
  const downPct = roundMoney(preview.downPaymentPercent)
  const financedPct =
    preview.unitPrice > 0 && !isCash
      ? roundMoney((preview.financedAmount / preview.unitPrice) * 100)
      : 0

  const heroSubtitle = isCash
    ? `Desembolso ${formatMoney(wealth.initialOutlay)} · patrimonio estimado ${formatMoney(wealth.endingEquity)} en ${horizonYears} años`
    : `Entrada ${formatMoney(wealth.initialOutlay)} + ${formatMoneyExact(Math.abs(Math.min(0, monthlyFlow)))}/mes → patrimonio estimado ${formatMoney(wealth.endingEquity)} en ${horizonYears} años`

  const toggleAccordion = (id: Exclude<AccordionId, null>) => {
    setOpenAccordion((prev) => (prev === id ? null : id))
  }

  return (
    <div className="space-y-5">
      {/* 1. HERO */}
      <div
        className="rounded-xl px-3.5 py-4 text-white sm:px-5 sm:py-6"
        style={{
          background: 'linear-gradient(135deg, #1a2744 0%, #2a3f66 55%, #BDA27E 100%)',
        }}
      >
        <h3 className="text-lg font-semibold leading-snug sm:text-[22px]">
          {unitTitle} · {isCash ? 'Compra sin crédito' : 'Compra con financiamiento'}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/95 sm:text-sm">{heroSubtitle}</p>
      </div>

      {/* Controles de horizonte */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-[11px]">
          <span className="text-[#6b645c]">Horizonte (años)</span>
          <input
            type="number"
            min={1}
            max={40}
            value={horizonYears}
            onChange={(e) => onHorizonYearsChange?.(Number(e.target.value) || 10)}
            className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        <label className="block space-y-1 text-[11px]">
          <span className="text-[#6b645c]">Apreciación %/año</span>
          <input
            type="number"
            step={0.1}
            value={Math.round(appreciationRateAnnual * 1000) / 10}
            onChange={(e) => onAppreciationRateChange?.((Number(e.target.value) || 0) / 100)}
            className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
      </div>

      {/* 2. CARDS */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {(
          [
            {
              label: 'Entrada hoy',
              value: formatMoney(wealth.initialOutlay),
              hint: isCash
                ? 'Precio (+ costos iniciales si hay)'
                : `${formatPercent(downPct, 0)} del precio`,
            },
            {
              label: isCash ? 'Flujo mensual' : 'Tu aporte/mes',
              value: formatMoneyExact(Math.abs(monthlyFlow)),
              hint: isCash
                ? monthlyFlow >= 0
                  ? 'Alquiler neto estimado · año 1'
                  : 'Déficit estimado · año 1'
                : 'Promedio del primer año',
            },
            {
              label: `Ganancia ${horizonYears} años`,
              value: formatMoney(wealth.projectedGainOrLoss),
              hint: 'Ganancia proyectada (≠ patrimonio)',
            },
            {
              label: 'Retorno acumulado',
              value: formatPercent(wealth.cumulativeReturnOnCashPercent),
              hint: `Sobre capital aportado · ${horizonYears} años`,
            },
          ] as const
        ).map((card) => (
          <div
            key={card.label}
            className="flex min-h-[8.5rem] min-w-0 flex-col items-center justify-between gap-2 rounded-xl border border-[#e4ddd3] bg-[#fcfbf9] px-2.5 py-3 sm:min-h-[9.25rem] sm:px-4 sm:py-4"
          >
            <p className="w-full text-center text-[10px] font-medium tracking-[0.1em] text-[#8a8176] uppercase sm:text-[11px]">
              {card.label}
            </p>
            <div className="flex w-full flex-1 items-center justify-center">
              <StatValue value={card.value} />
            </div>
            <p className="w-full text-center text-[10px] leading-snug text-[#8a8176] sm:text-[11px]">
              {card.hint}
            </p>
          </div>
        ))}
      </div>

      {/* 3. ACORDEONES */}
      <div className="space-y-3">
        <Accordion
          id="rent"
          openId={openAccordion}
          onToggle={toggleAccordion}
          title="¿Cómo el alquiler ayuda con la cuota?"
        >
          <div className="space-y-3">
            <Row label="Alquiler bruto" value={formatMoneyExact(grossMo)} />
            <Row
              label={`Vacancia (${formatPercent(preview.vacancyRate * 100, 0)})`}
              value={`−${formatMoneyExact(vacancyMo)}`}
            />
            <Row label="Gastos de la propiedad" value={`−${formatMoneyExact(opsMo)}`} />
            {adminTaxMo > 0 ? (
              <Row
                label={[
                  mgmtMo > 0
                    ? `Admin (${formatPercent(preview.managementFeeRate * 100, 0)})`
                    : null,
                  taxMo > 0 ? `IR (${formatPercent(preview.incomeTaxRate * 100, 0)})` : null,
                ]
                  .filter(Boolean)
                  .join(' + ')}
                value={`−${formatMoneyExact(adminTaxMo)}`}
              />
            ) : null}
            <Row
              label="Alquiler neto"
              value={formatMoneyExact(net)}
              strong
              tone="accent"
            />
          </div>

          {!isCash && payment > 0 && rentPctLabel != null && buyerPctLabel != null ? (
            <div className="space-y-2">
              <p className="text-[12px] text-[#6b645c]">
                Cobertura de la cuota ({formatMoneyExact(payment)})
              </p>
              <div className="flex h-6 overflow-hidden rounded">
                {rentPctLabel > 0 ? (
                  <div
                    className="flex items-center justify-center bg-emerald-600 text-[11px] font-bold text-white"
                    style={{ width: `${Math.min(100, rentPctLabel)}%` }}
                  >
                    {rentPctLabel >= 18 ? `${rentPctLabel}% Alquiler` : null}
                  </div>
                ) : null}
                {buyerPctLabel > 0 ? (
                  <div
                    className="flex items-center justify-center bg-[#1a2744] text-[11px] font-bold text-white"
                    style={{ width: `${Math.min(100, buyerPctLabel)}%` }}
                  >
                    {buyerPctLabel >= 18 ? `${buyerPctLabel}% Tú` : null}
                  </div>
                ) : null}
              </div>
              <p className="rounded-lg bg-emerald-50 px-3 py-3 text-[13px] font-medium text-emerald-800">
                El alquiler neto cubre {formatMoneyExact(bar.rentApplied)} (
                {formatPercent(bar.rentPct ?? 0)}) de la cuota. Tú completas{' '}
                {formatMoneyExact(monthlyFlow < 0 ? Math.abs(monthlyFlow) : 0)}.
              </p>
              {bar.surplusOverPayment > 0 ? (
                <p className="text-[12px] text-[#6b645c]">
                  Excedente tras la cuota: {formatMoneyExact(bar.surplusOverPayment)}/mes
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg bg-[#eef1f6] px-3 py-3 text-[13px] text-[#1a2744]">
              {isCash
                ? `Sin cuota bancaria. Alquiler neto estimado: ${formatMoneyExact(net)}/mes.`
                : 'Sin cuota modelada en este escenario.'}
            </p>
          )}
          {(mgmtMo > 0 || taxMo > 0) && (
            <p className="text-[11px] text-[#8a8176]">
              Admin e IR son supuestos del escenario; no son tasas legales universales.
            </p>
          )}
        </Accordion>

        <Accordion
          id="debt"
          openId={openAccordion}
          onToggle={toggleAccordion}
          title={`Tu deuda y patrimonio (${horizonYears} años)`}
        >
          {!isCash ? (
            <div className="space-y-3 rounded-lg bg-[#1a2744] p-4">
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['Préstamo inicial', formatMoney(preview.financedAmount)],
                    ['Amortizado', formatMoney(principalAmortized)],
                    ['Deuda restante', formatMoney(wealth.remainingDebt)],
                    ['Propiedad vale', formatMoney(wealth.futurePropertyValue)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md bg-white/10 px-3 py-3">
                    <p className="text-[11px] tracking-[0.08em] text-white/70 uppercase">{label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-[#1a2744] p-4 text-sm text-white/90">
              Compra al contado: no hay deuda bancaria. Valor estimado de la propiedad:{' '}
              <strong className="text-white">{formatMoney(wealth.futurePropertyValue)}</strong>.
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-[#e4ddd3] bg-[#fcfbf9] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-[#6b645c]">Tu patrimonio neto</span>
              <span className="text-sm font-bold tabular-nums text-[#1f1a14]">
                {formatMoney(wealth.endingEquity)}
              </span>
            </div>
            <p className="text-[12px] text-[#6b645c]">
              Propiedad ({formatMoney(wealth.futurePropertyValue)})
              {!isCash ? ` − Deuda (${formatMoney(wealth.remainingDebt)})` : ''}
              {wealth.saleCostsIncluded ? ` − Salida (${formatMoney(wealth.saleCosts)})` : ''} =
              patrimonio. No es la ganancia: aún incluye lo que aportaste.
            </p>
          </div>

          {!isCash ? (
            <div className="rounded border-l-[3px] border-[#c4a574] bg-[#faf3e8] px-3 py-3 text-[12px] text-[#7a5c2e]">
              La deuda no desaparece sola. Con cada cuota pagas intereses y capital que reduce el
              préstamo. Al final del plazo ({preview.financingYears} años), si se cumplen las cuotas,
              la deuda programada llega a cero.
            </div>
          ) : null}
        </Accordion>

        <Accordion
          id="calc"
          openId={openAccordion}
          onToggle={toggleAccordion}
          title="¿Cómo se calcula todo esto?"
        >
          <div className="space-y-3">
            <Row
              label="Ganancia total"
              value="Patrimonio + excedentes − capital aportado"
              tone="muted"
            />
            <Row label="Retorno acumulado" value="(Ganancia ÷ capital aportado) × 100" tone="muted" />
            <Row
              label={`Capital aportado (${horizonYears} años)`}
              value={`${formatMoney(wealth.initialOutlay)} + ${formatMoney(wealth.cumulativeTopUps)} = ${formatMoney(wealth.totalCashInvested)}`}
            />
            <Row
              label="Amortización"
              value="Cada cuota paga intereses y reduce el préstamo"
              tone="muted"
            />
          </div>
          <div className="rounded border-l-[3px] border-[#c4a574] bg-[#faf3e8] px-3 py-3 text-[12px] text-[#7a5c2e]">
            Estimaciones educativas. Alquiler {formatMoneyExact(grossMo)}, tasa{' '}
            {Number(preview.interestRate).toFixed(2)}%, plazo {preview.financingYears || '—'} años,
            apreciación {formatPercent(appreciationRateAnnual * 100, 1)}/año, ocupación{' '}
            {formatPercent((1 - preview.vacancyRate) * 100, 0)}. No constituyen asesoría financiera.
          </div>
        </Accordion>
      </div>

      {/* 4. COMPARATIVA — filas alineadas (evita desfase y recortes en panel estrecho) */}
      <div className="space-y-3 pt-2">
        <h4 className="text-base font-semibold text-[#1f1a14]">
          Compara: Contado vs Financiamiento
        </h4>
        {(() => {
          const cashFlow = comparison.cash.coverage.monthlyTopUpOrSurplus
          const finFlow = comparison.financed.coverage.monthlyTopUpOrSurplus
          const rows: Array<{
            key: string
            label: string
            cash: string
            financed: string
            cashGood?: boolean
          }> = [
            {
              key: 'capital',
              label: 'Capital inicial',
              cash: formatMoney(comparison.cash.wealth.initialOutlay),
              financed: formatMoney(comparison.financed.wealth.initialOutlay),
            },
            {
              key: 'flujo',
              label: cashFlow >= 0 && finFlow >= 0 ? 'Flujo/mes' : 'Aporte o flujo/mes',
              cash: formatMoneyExact(Math.abs(cashFlow)),
              financed: formatMoneyExact(Math.abs(finFlow)),
              cashGood: cashFlow >= 0,
            },
            {
              key: 'total',
              label: `Total ${horizonYears} años`,
              cash: formatMoney(comparison.cash.wealth.totalCashInvested),
              financed: formatMoney(comparison.financed.wealth.totalCashInvested),
            },
            {
              key: 'ganancia',
              label: 'Ganancia',
              cash: formatMoney(comparison.cash.wealth.projectedGainOrLoss),
              financed: formatMoney(comparison.financed.wealth.projectedGainOrLoss),
            },
            {
              key: 'retorno',
              label: 'Retorno acum.',
              cash: formatPercent(comparison.cash.wealth.cumulativeReturnOnCashPercent),
              financed: formatPercent(comparison.financed.wealth.cumulativeReturnOnCashPercent),
            },
          ]

          return (
            <div className="overflow-hidden rounded-xl border border-[#e4ddd3] bg-[#fcfbf9]">
              <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-[#e4ddd3] bg-[#f4f1eb]">
                <div className="px-2 py-2.5 sm:px-3" />
                  <div
                    className={cn(
                      'border-l border-[#e4ddd3] px-2 py-2.5 text-center sm:px-3',
                      isCash && 'bg-[#1a2744]/5',
                    )}
                  >
                    <p className="text-[10px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase sm:text-[11px]">
                      Contado
                    </p>
                    {isCash ? (
                      <p className="mt-0.5 text-[9px] font-medium tracking-wide text-[#6b645c] uppercase">
                        Vista actual
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[9px] text-transparent uppercase select-none" aria-hidden>
                        —
                      </p>
                    )}
                  </div>
                  <div
                    className={cn(
                      'border-l-2 border-[#1a2744] px-2 py-2.5 text-center sm:px-3',
                      !isCash && 'bg-[#1a2744]/5',
                    )}
                  >
                    <p className="text-[10px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase sm:text-[11px]">
                      Financiado
                    </p>
                    {!isCash ? (
                      <p className="mt-0.5 text-[9px] font-medium tracking-wide text-[#6b645c] uppercase">
                        Vista actual
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[9px] text-transparent uppercase select-none" aria-hidden>
                        —
                      </p>
                    )}
                  </div>
                </div>
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-[#e4ddd3]/80 last:border-b-0"
                  >
                    <div className="flex items-center px-2 py-2.5 text-[11px] leading-snug text-[#6b645c] sm:px-3 sm:text-[12px]">
                      {row.label}
                    </div>
                    <div
                      className={cn(
                        'flex min-w-0 items-center justify-center border-l border-[#e4ddd3] px-1.5 py-2.5 sm:px-3',
                        isCash && 'bg-[#1a2744]/5',
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 text-center text-[11px] font-semibold tabular-nums leading-tight break-all sm:text-[12px]',
                          row.cashGood ? 'text-emerald-700' : 'text-[#1f1a14]',
                        )}
                      >
                        {row.cash}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'flex min-w-0 items-center justify-center border-l-2 border-[#1a2744] px-1.5 py-2.5 sm:px-3',
                        !isCash && 'bg-[#1a2744]/5',
                      )}
                    >
                      <span className="min-w-0 text-center text-[11px] font-semibold tabular-nums leading-tight break-all text-[#1a2744] sm:text-[12px]">
                        {row.financed}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        <div className="rounded border-l-[3px] border-[#c4a574] bg-[#faf3e8] px-3 py-3 text-[12px] text-[#7a5c2e]">
          {!isCash ? (
            <>
              Con entrada del {formatPercent(downPct, 0)}, desembolsas un {formatPercent(financedPct, 0)}{' '}
              menos del precio al inicio y asumes pagos mensuales apoyándote en el alquiler neto. Los
              calendarios de aportes son distintos; un retorno acumulado mayor no demuestra por sí
              solo que una opción sea mejor.
            </>
          ) : (
            <>
              Contado: mayor desembolso inicial y sin cuotas. Financiamiento: menor desembolso inicial
              y compromiso mensual. Un retorno acumulado mayor no demuestra por sí solo qué opción
              conviene.
            </>
          )}
        </div>
      </div>

      {/* 5. CTA */}
      {onRequestInfo ? (
        <button
          type="button"
          onClick={onRequestInfo}
          className="mt-2 w-full rounded-md bg-[#1a2744] px-6 py-3.5 text-sm font-medium text-white transition-colors hover:bg-[#243552]"
        >
          Quiero más información
        </button>
      ) : null}

      {/* 6. DISCLAIMER */}
      <p className="text-center text-[11px] leading-relaxed text-[#8a8176]">
        Estos cálculos son estimaciones educativas. No constituyen asesoría financiera. Consulta con
        un asesor antes de decidir.
      </p>
    </div>
  )
}

/** @deprecated Prefer CompraComparisonView */
export function ViabilidadAlerta(props: {
  preview: InvestmentPreview
  input: BuildInvestmentInput
  horizonYears: number
  appreciationRateAnnual: number
  onHorizonYearsChange?: (years: number) => void
  onAppreciationRateChange?: (rate: number) => void
  unitLabel?: string
  onRequestInfo?: () => void
}) {
  return <CompraComparisonView {...props} />
}

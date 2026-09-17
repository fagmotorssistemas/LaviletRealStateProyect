'use client'

import { useEffect, useRef } from 'react'
import { useFinancingCalculator } from '@/hooks/useFinancingCalculator'
import { ParameterSliders } from '@/components/financing/ParameterSliders'
import { ResultCards } from '@/components/financing/ResultCards'
import { DesglozeAnual } from '@/components/financing/DesglozeAnual'
import { Disclaimer } from '@/components/financing/Disclaimer'
import { formatMoney, formatMoneyExact } from '@/lib/financing/calculator'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import type { SimulationMode } from '@/types/financingSimulator'

export function InvestmentConfigurator({
  unitParam,
  onOpenSaved,
  stacked = false,
  initialMode,
  initialSection,
  initialScenario,
  onConsumedInitialScenario,
}: {
  unitParam: string
  onOpenSaved?: () => void
  stacked?: boolean
  initialMode?: SimulationMode
  initialSection?: 'financing' | 'rent' | null
  initialScenario?: import('@/types/financingSimulator').FinancingScenario | null
  onConsumedInitialScenario?: () => void
}) {
  const calc = useFinancingCalculator(unitParam, { initialMode, initialSection })
  const financingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!initialScenario || calc.loading) return
    calc.loadFromScenario(initialScenario)
    onConsumedInitialScenario?.()
    // Solo al recibir un escenario a reabrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScenario?.id, calc.loading])

  useEffect(() => {
    if (calc.focusSection === 'financing' && financingRef.current) {
      financingRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [calc.focusSection, calc.loading])

  if (calc.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (calc.error || !calc.config) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        {calc.error || 'No pudimos cargar el simulador'}
      </div>
    )
  }

  const modality: 'cash' | 'financed' = calc.mode === 'cash' ? 'cash' : 'financed'
  const downPaymentAmount =
    calc.unitPrice > 0 ? Math.round(((calc.unitPrice * calc.downPaymentPercent) / 100) * 100) / 100 : 0

  return (
    <div
      className={cn(
        'grid gap-8',
        stacked ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]',
      )}
    >
      <section className="space-y-5">
        <header className="space-y-2">
          <h2 className="font-serif text-2xl text-[#1f1a14] sm:text-3xl">
            Unidad {calc.unit?.unit_number ?? unitParam}
          </h2>
          <p className="text-sm text-[#6b645c]">
            {calc.priceMissing ? 'Sin precio publicado' : `Precio ${formatMoney(calc.unitPrice)}`}
          </p>
          {calc.fidelityMessage ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              {calc.fidelityMessage}
            </p>
          ) : null}
          {calc.priceDiffersFromPublished ? (
            <div className="rounded-xl border border-[#BDA27E]/40 bg-[#BDA27E]/10 px-3 py-2.5 text-sm text-[#4a433c]">
              <p>
                Escenario histórico con precio {formatMoney(calc.scenarioUnitPrice)}. Publicado ahora:{' '}
                {formatMoney(calc.unit?.published_commercial_price)}.
              </p>
              <button
                type="button"
                onClick={() => calc.applyCurrentPublishedPrice()}
                className="mt-2 text-[11px] font-semibold tracking-[0.12em] text-[#1a2744] uppercase"
              >
                Actualizar al precio publicado
              </button>
            </div>
          ) : null}
        </header>

        {/* 1. Unidad y precio */}
        <div className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            1. Unidad y precio
          </p>
          {calc.priceMissing ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Sin precio publicado. Indique un valor hipotético para simular.
            </div>
          ) : null}
          {calc.priceMissing || !calc.hasPublishedPrice ? (
            <label className="block space-y-1.5">
              <span className="text-[11px] text-[#6b645c]">Precio hipotético</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={calc.unitPrice > 0 ? calc.unitPrice : ''}
                placeholder="Sin precio"
                onChange={(event) => calc.setUnitPrice(Number(event.target.value) || 0)}
                className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
              />
            </label>
          ) : (
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5">
              <p className="text-lg font-semibold text-[#1f1a14]">{formatMoney(calc.unitPrice)}</p>
            </div>
          )}
        </div>

        {/* 2–3. Modalidad + financiamiento */}
        <div
          ref={financingRef}
          className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]"
        >
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            2. Modalidad
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['cash', 'Contado'],
                ['financed', 'Con financiamiento'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => calc.setMode(value === 'cash' ? 'cash' : 'financed')}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-[11px] font-semibold tracking-[0.1em] uppercase',
                  modality === value
                    ? 'border-[#1a2744] bg-[#1a2744] text-white'
                    : 'border-[#e4ddd3] bg-white text-[#1f1a14] hover:border-[#BDA27E]/60',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {modality !== 'cash' ? (
            <div className="space-y-4 border-t border-[#f0ebe3] pt-4">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
                3. Financiamiento
              </p>
              <label className="block space-y-1.5">
                <span className="text-[11px] text-[#6b645c]">Institución</span>
                <select
                  value={calc.state.partnerId ?? ''}
                  onChange={(event) => {
                    const id = event.target.value || null
                    if (!id) {
                      calc.setMode('manual')
                      return
                    }
                    calc.setPartnerId(id)
                    calc.setMode('financed')
                  }}
                  className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
                >
                  <option value="">Simulación manual (sin institución)</option>
                  {calc.partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partner_name} · {Number(p.annual_interest_rate).toFixed(2)}%
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#8a8176]">
                  Tasas de configuración; no son ofertas bancarias vigentes verificadas.
                </p>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#6b645c]">
                    Entrada % ({calc.limits.downPaymentMin}–{calc.limits.downPaymentMax})
                  </span>
                  <input
                    type="number"
                    min={calc.limits.downPaymentMin}
                    max={calc.limits.downPaymentMax}
                    step={1}
                    value={calc.downPaymentPercent}
                    onChange={(event) => calc.setDownPaymentPercent(Number(event.target.value))}
                    className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
                  />
                  <span className="text-[11px] text-[#8a8176]">{formatMoney(downPaymentAmount)}</span>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#6b645c]">Plazo (años)</span>
                  <input
                    type="number"
                    min={calc.limits.yearsMin}
                    max={calc.limits.yearsMax}
                    step={1}
                    value={calc.financingYears}
                    onChange={(event) => calc.setFinancingYears(Number(event.target.value))}
                    className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#6b645c]">Tasa anual (%)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={calc.interestRate}
                    onChange={(event) => calc.setInterestRate(Number(event.target.value))}
                    className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#6b645c]">Tipo de tasa</span>
                  <select
                    value={calc.rateType}
                    onChange={(event) =>
                      calc.setRateType(event.target.value as 'nominal_annual' | 'effective_annual')
                    }
                    className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
                  >
                    <option value="nominal_annual">Nominal anual</option>
                    <option value="effective_annual">Efectiva anual</option>
                  </select>
                </label>
              </div>
              {calc.mode === 'manual' ? (
                <p className="rounded-xl bg-[#f7f3ee] px-3 py-2 text-[11px] text-[#6b645c]">
                  Simulación manual: se conserva la tasa indicada al guardar.
                </p>
              ) : null}
              {calc.preview && calc.preview.mode !== 'cash' ? (
                <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5 text-sm text-[#4a433c]">
                  Crédito {formatMoney(calc.preview.financedAmount)} · Cuota{' '}
                  {formatMoneyExact(calc.preview.monthlyPayment)} / mes
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 4. Alquiler, vacancia y gastos */}
        <div className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            4. Alquiler, vacancia y gastos
          </p>
          <ParameterSliders
            monthlyRent={calc.monthlyRent}
            onRentChange={calc.setMonthlyRent}
            suggestedRent={calc.suggestedRent}
            rentSuggestionLabel={calc.rentSuggestion.label}
            onUseSuggestedRent={() => calc.setMonthlyRent(calc.suggestedRent)}
            vacancyRate={calc.vacancyRate}
            onVacancyChange={calc.setVacancyRate}
            expenses={calc.state.expenses}
            onExpensesChange={calc.setExpenses}
            suggestedExpenses={calc.suggestedExpenses}
            onUseSuggestedExpenses={calc.useSuggestedExpenses}
            annualManagement={calc.state.annualManagement}
            onManagementChange={(v) => calc.patchState({ annualManagement: v })}
            unitPrice={calc.unitPrice}
            onUnitPriceChange={calc.setUnitPrice}
            priceEditable={false}
            priceMissing={false}
            showPrice={false}
          />
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
              IR estimado anual (opcional)
            </span>
            <input
              type="number"
              min={0}
              step={50}
              value={calc.state.annualIncomeTaxEstimate || ''}
              placeholder="0 = solo antes de IR"
              onChange={(event) =>
                calc.patchState({ annualIncomeTaxEstimate: Number(event.target.value) || 0 })
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
            />
            <p className="text-[11px] text-[#8a8176]">
              No se impone un 25% automático. Por defecto: antes de impuesto a la renta.
            </p>
          </label>
        </div>

        {/* 6. Guardar */}
        {calc.identified || onOpenSaved ? (
          <div className="flex flex-wrap gap-3">
            {calc.identified ? (
              <button
                type="button"
                disabled={calc.saving || calc.priceMissing || !calc.preview}
                onClick={() => void calc.saveScenario()}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase disabled:cursor-not-allowed disabled:opacity-45"
              >
                {calc.saving ? 'Guardando…' : 'Guardar escenario'}
              </button>
            ) : null}
            {onOpenSaved ? (
              <button
                type="button"
                onClick={onOpenSaved}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#d9d0c3] bg-white px-5 text-[11px] font-semibold tracking-[0.14em] text-[#1f1a14] uppercase"
              >
                Ver guardados
              </button>
            ) : null}
          </div>
        ) : null}
        {calc.saveMessage ? <p className="text-sm text-[#4a433c]">{calc.saveMessage}</p> : null}
      </section>

      {/* 5. Resultados */}
      <section className="space-y-5">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          5. Resultado
        </p>
        {calc.preview ? (
          <>
            <ResultCards preview={calc.preview} />
            <DesglozeAnual preview={calc.preview} />
          </>
        ) : (
          <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-6 text-sm text-[#6b645c]">
            {calc.priceMissing
              ? 'Sin precio. Ingrese un valor hipotético para ver resultados.'
              : 'Complete los parámetros para ver el resultado.'}
          </div>
        )}
        <Disclaimer text={calc.config.disclaimer_text} />
      </section>
    </div>
  )
}

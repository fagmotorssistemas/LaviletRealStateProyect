'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useFinancingCalculator } from '@/hooks/useFinancingCalculator'
import { ParameterSliders } from '@/components/financing/ParameterSliders'
import { DesglozeAnual } from '@/components/financing/DesglozeAnual'
import { CompraComparisonView } from '@/components/financing/CompraComparisonView'
import { Disclaimer } from '@/components/financing/Disclaimer'
import { formatMoney, formatMoneyExact, formatPercent } from '@/lib/financing/calculator'
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
  onRequestInfo,
}: {
  unitParam: string
  onOpenSaved?: () => void
  /** Panel del tour / móvil: resultados primero, mismos cálculos. */
  stacked?: boolean
  initialMode?: SimulationMode
  initialSection?: 'financing' | 'rent' | null
  initialScenario?: import('@/types/financingSimulator').FinancingScenario | null
  onConsumedInitialScenario?: () => void
  onRequestInfo?: () => void
}) {
  const calc = useFinancingCalculator(unitParam, { initialMode, initialSection })
  const financingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!initialScenario || calc.loading) return
    calc.loadFromScenario(initialScenario)
    onConsumedInitialScenario?.()
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
  const financedAmount =
    modality === 'cash' ? 0 : Math.max(0, Math.round((calc.unitPrice - downPaymentAmount) * 100) / 100)

  const header = (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl text-[#1f1a14] sm:text-3xl">
            Unidad {calc.unit?.unit_number ?? unitParam} ·{' '}
            {modality === 'cash' ? 'Compra sin crédito' : 'Compra con financiamiento'}
          </h2>
          <p className="mt-1 text-sm text-[#6b645c]">
            {modality === 'cash'
              ? 'Sin cuota bancaria, con ingresos estimados por alquiler'
              : 'Menor desembolso inicial, con una parte de la cuota cubierta por el alquiler'}
          </p>
        </div>
        <span className="inline-flex shrink-0 rounded-full border border-[#1a2744]/25 bg-[#1a2744]/5 px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#1a2744] uppercase">
          {modality === 'cash' ? 'Contado' : 'Financiamiento'}
        </span>
      </div>
      {!calc.priceMissing && calc.unitPrice > 0 ? (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-3 py-3 sm:grid-cols-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">
              Precio
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[#1f1a14]">
              {formatMoney(calc.unitPrice)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">
              Entrada
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[#1f1a14]">
              {modality === 'cash'
                ? formatMoney(calc.unitPrice)
                : `${formatMoney(downPaymentAmount)} · ${formatPercent(calc.downPaymentPercent)}`}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">
              Monto financiado
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[#1f1a14]">
              {modality === 'cash' ? 'Sin crédito' : formatMoney(financedAmount)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">
              Cuota estimada
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[#1f1a14]">
              {modality === 'cash'
                ? 'Sin cuota'
                : calc.preview && calc.preview.mode !== 'cash'
                  ? `${formatMoneyExact(calc.preview.monthlyPayment)}/mes`
                  : '—'}
            </p>
          </div>
        </div>
      ) : null}
      {calc.fidelityMessage ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
          <p>{calc.fidelityMessage}</p>
          <button
            type="button"
            onClick={() => calc.applyCurrentFormulas()}
            className="mt-2 text-[11px] font-semibold tracking-[0.12em] text-[#1a2744] uppercase"
          >
            Recalcular con gastos y fórmulas actuales
          </button>
          <p className="mt-1 text-[11px] text-amber-900/80">
            Se usarán predial y alícuota vigentes; seguro y otros gastos del bloque de propiedad
            quedarán fuera del cálculo.
          </p>
        </div>
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
  )

  const modalityCard = (
    <div className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-4 shadow-[0_12px_40px_rgba(40,30,20,0.06)] sm:p-5">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Modalidad
      </p>
      {calc.priceMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          Sin precio publicado. Indique un valor hipotético para simular (no modifica el precio
          comercial en la base de datos).
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
      ) : null}

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
    </div>
  )

  const financingCard = (
    <div
      ref={financingRef}
      className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-4 shadow-[0_12px_40px_rgba(40,30,20,0.06)] sm:p-5"
    >
      <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Financiamiento
      </p>

      {modality === 'cash' ? (
        <p className="text-sm text-[#6b645c]">Compra al contado: no hay cuota de crédito.</p>
      ) : (
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[#6b645c]">Institución</span>
            <select
              value={calc.state.partnerId ?? ''}
              onChange={(event) => {
                const id = event.target.value || null
                if (!id) return
                calc.setPartnerId(id)
              }}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
            >
              <option value="" disabled>
                Elija una institución
              </option>
              {calc.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partner_name} · {Number(p.annual_interest_rate).toFixed(2)}%
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#8a8176]">
              La tasa proviene de la configuración administrada; no es editable aquí.
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
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2">
              <p className="text-[10px] text-[#8a8176] uppercase">Tasa anual</p>
              <p className="text-sm font-semibold tabular-nums text-[#1f1a14]">
                {Number(calc.interestRate).toFixed(2)}%
              </p>
            </div>
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2">
              <p className="text-[10px] text-[#8a8176] uppercase">Tipo de tasa</p>
              <p className="text-sm font-semibold text-[#1f1a14]">
                {calc.rateType === 'effective_annual' ? 'Efectiva anual' : 'Nominal anual'}
              </p>
            </div>
          </div>
          {calc.preview && calc.preview.mode !== 'cash' ? (
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5 text-sm text-[#4a433c]">
              Crédito {formatMoney(calc.preview.financedAmount)} · Cuota capital/intereses{' '}
              {formatMoneyExact(calc.preview.monthlyPayment)} / mes
              {calc.preview.monthlyExtraCharges > 0 ? (
                <>
                  {' '}
                  · Cargos adicionales del financiamiento{' '}
                  {formatMoneyExact(calc.preview.monthlyExtraCharges)}/mes (separados de la cuota)
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )

  const rentCard = (
    <div className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-4 shadow-[0_12px_40px_rgba(40,30,20,0.06)] sm:p-5">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Alquiler, tiempo sin inquilino y gastos
      </p>
      <ParameterSliders
        monthlyRent={calc.monthlyRent}
        onRentChange={calc.setMonthlyRent}
        suggestedRent={calc.suggestedRent}
        rentSuggestionLabel={calc.rentSuggestion.label}
        onUseSuggestedRent={() => calc.setMonthlyRent(calc.suggestedRent)}
        vacancyRate={calc.vacancyRate}
        onVacancyChange={calc.setVacancyRate}
        financingConfig={calc.config}
        includePropertyManager={calc.state.includePropertyManager}
        onIncludePropertyManagerChange={(v) =>
          calc.patchState({ includePropertyManager: v, savedResults: null, fidelityMessage: null })
        }
        includeIncomeTax={calc.state.includeIncomeTax}
        onIncludeIncomeTaxChange={(v) =>
          calc.patchState({ includeIncomeTax: v, savedResults: null, fidelityMessage: null })
        }
        incomeTaxRate={calc.incomeTaxRate}
        onIncomeTaxRateChange={calc.setIncomeTaxRate}
        managementFeeRate={calc.managementFeeRate}
        onManagementFeeRateChange={calc.setManagementFeeRate}
        unitPrice={calc.unitPrice}
        onUnitPriceChange={calc.setUnitPrice}
        priceEditable={false}
        priceMissing={false}
        showPrice={false}
        assumptionsReadOnly
      />
    </div>
  )

  const results = (
    <section className="space-y-5">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Resultado
      </p>
      {calc.preview ? (
        <>
          <CompraComparisonView
            preview={calc.preview}
            unitLabel={`Unidad ${calc.unit?.unit_number ?? unitParam}`}
            onRequestInfo={onRequestInfo}
            input={{
              mode: calc.preview.mode,
              unitPrice: calc.unitPrice,
              estimatedMonthlyRent: calc.monthlyRent,
              vacancyRate: calc.vacancyRate,
              annualOperatingExpenses: calc.state.expenses.total,
              includeIncomeTax: calc.state.includeIncomeTax,
              includePropertyManager: calc.state.includePropertyManager,
              incomeTaxRate: calc.incomeTaxRate,
              managementFeeRate: calc.managementFeeRate,
              downPaymentPercent: calc.downPaymentPercent,
              financingYears: calc.financingYears,
              interestRate: calc.interestRate,
              rateType: calc.rateType,
              acquisitionCosts: calc.state.acquisitionCosts,
              annualOtherFinancialCosts: calc.state.annualOtherFinancialCosts,
              monthlyExtraCharges: calc.state.monthlyExtraCharges,
              wealthHorizonYears: calc.wealthHorizonYears,
              appreciationRateAnnual: calc.appreciationRateAnnual,
              saleCosts: calc.state.saleCosts,
            }}
            horizonYears={calc.wealthHorizonYears}
            appreciationRateAnnual={calc.appreciationRateAnnual}
            onHorizonYearsChange={calc.setWealthHorizonYears}
            onAppreciationRateChange={calc.setAppreciationRateAnnual}
          />
          <details className="rounded-2xl border border-[#ece6dc] bg-white open:shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
              Ver desglose de ingresos y pagos
            </summary>
            <div className="border-t border-[#ece6dc] px-1 pb-1">
              <DesglozeAnual preview={calc.preview} />
            </div>
          </details>
        </>
      ) : (
        <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-6 text-sm text-[#6b645c]">
          {calc.priceMissing
            ? 'Sin precio. Ingrese un valor hipotético para ver resultados.'
            : 'Complete los parámetros para ver el resultado.'}
        </div>
      )}

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
      {calc.saveMessage ? <p className="text-sm text-[#4a433c]">{calc.saveMessage}</p> : null}
      <Disclaimer text={calc.config.disclaimer_text} />
    </section>
  )

  if (stacked) {
    return (
      <div className="flex flex-col gap-5">
        {calc.fidelityMessage || calc.priceDiffersFromPublished ? (
          <div className="space-y-2">
            {calc.fidelityMessage ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
                <p>{calc.fidelityMessage}</p>
                <button
                  type="button"
                  onClick={() => calc.applyCurrentFormulas()}
                  className="mt-2 text-[11px] font-semibold tracking-[0.12em] text-[#1a2744] uppercase"
                >
                  Recalcular con gastos y fórmulas actuales
                </button>
              </div>
            ) : null}
            {calc.priceDiffersFromPublished ? (
              <div className="rounded-xl border border-[#BDA27E]/40 bg-[#BDA27E]/10 px-3 py-2.5 text-sm text-[#4a433c]">
                <p>
                  Escenario histórico con precio {formatMoney(calc.scenarioUnitPrice)}. Publicado
                  ahora: {formatMoney(calc.unit?.published_commercial_price)}.
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
          </div>
        ) : null}
        {modalityCard}
        {results}
        <details
          className="rounded-3xl border border-[#ece6dc] bg-white open:shadow-sm"
          open={calc.focusSection === 'financing' || undefined}
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Ajustar financiamiento
          </summary>
          <div className="space-y-4 border-t border-[#ece6dc] px-4 py-3" ref={financingRef}>
            {modality === 'cash' ? (
              <p className="text-sm text-[#6b645c]">Compra al contado: no hay cuota de crédito.</p>
            ) : (
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-[#6b645c]">Institución</span>
                  <select
                    value={calc.state.partnerId ?? ''}
                    onChange={(event) => {
                      const id = event.target.value || null
                      if (!id) return
                      calc.setPartnerId(id)
                    }}
                    className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
                  >
                    <option value="" disabled>
                      Elija una institución
                    </option>
                    {calc.partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partner_name} · {Number(p.annual_interest_rate).toFixed(2)}%
                      </option>
                    ))}
                  </select>
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
                {calc.preview && calc.preview.mode !== 'cash' ? (
                  <p className="text-sm text-[#4a433c]">
                    Crédito {formatMoney(calc.preview.financedAmount)} · Cuota{' '}
                    {formatMoneyExact(calc.preview.monthlyPayment)}/mes
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </details>
        <details className="rounded-3xl border border-[#ece6dc] bg-white open:shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Ver alquiler y gastos administrados
          </summary>
          <div className="border-t border-[#ece6dc] px-4 py-3">
            <ParameterSliders
              monthlyRent={calc.monthlyRent}
              onRentChange={calc.setMonthlyRent}
              suggestedRent={calc.suggestedRent}
              rentSuggestionLabel={calc.rentSuggestion.label}
              onUseSuggestedRent={() => calc.setMonthlyRent(calc.suggestedRent)}
              vacancyRate={calc.vacancyRate}
              onVacancyChange={calc.setVacancyRate}
              financingConfig={calc.config}
              includePropertyManager={calc.state.includePropertyManager}
              onIncludePropertyManagerChange={(v) =>
                calc.patchState({
                  includePropertyManager: v,
                  savedResults: null,
                  fidelityMessage: null,
                })
              }
              includeIncomeTax={calc.state.includeIncomeTax}
              onIncludeIncomeTaxChange={(v) =>
                calc.patchState({ includeIncomeTax: v, savedResults: null, fidelityMessage: null })
              }
              incomeTaxRate={calc.incomeTaxRate}
              onIncomeTaxRateChange={calc.setIncomeTaxRate}
              managementFeeRate={calc.managementFeeRate}
              onManagementFeeRateChange={calc.setManagementFeeRate}
              unitPrice={calc.unitPrice}
              onUnitPriceChange={calc.setUnitPrice}
              priceEditable={false}
              priceMissing={false}
              showPrice={false}
              assumptionsReadOnly
            />
          </div>
        </details>
      </div>
    )
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="space-y-5">
        {header}
        {modalityCard}
        {financingCard}
        {rentCard}
      </section>
      {results}
    </div>
  )
}

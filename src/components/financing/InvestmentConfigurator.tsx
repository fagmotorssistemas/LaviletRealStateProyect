'use client'

import { useFinancingCalculator } from '@/hooks/useFinancingCalculator'
import { ParameterSliders } from '@/components/financing/ParameterSliders'
import { ResultCards } from '@/components/financing/ResultCards'
import { DesglozeAnual } from '@/components/financing/DesglozeAnual'
import { Disclaimer } from '@/components/financing/Disclaimer'
import { formatMoney, defaultAnnualExpenses } from '@/lib/financing/calculator'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'

export function InvestmentConfigurator({
  unitParam,
  onOpenSaved,
  stacked = false,
}: {
  unitParam: string
  onOpenSaved?: () => void
  /** Una columna (p. ej. drawer del showroom). */
  stacked?: boolean
}) {
  const calc = useFinancingCalculator(unitParam)

  if (calc.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (calc.error || !calc.config || !calc.preview) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        {calc.error || 'No pudimos cargar el simulador'}
      </div>
    )
  }

  const priceMissing = !calc.unit?.published_commercial_price

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
            Depto. {calc.unit?.unit_number ?? unitParam}
          </h2>
          <p className="text-sm text-[#6b645c]">
            Precio {formatMoney(calc.unitPrice)}
            {priceMissing ? ' · estimado, puede ajustarlo' : ''}
          </p>
        </header>

        <div className="space-y-5 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <ParameterSliders
            monthlyRent={calc.monthlyRent}
            onRentChange={calc.setMonthlyRent}
            suggestedRent={calc.suggestedRent}
            onUseSuggestedRent={() => calc.setMonthlyRent(calc.suggestedRent)}
            annualExpenses={calc.annualExpenses}
            onExpensesChange={calc.setAnnualExpenses}
            suggestedExpenses={calc.suggestedExpenses}
            onUseSuggestedExpenses={() => calc.setAnnualExpenses(calc.suggestedExpenses)}
            unitPrice={calc.unitPrice}
            onUnitPriceChange={(value) => {
              calc.setUnitPrice(value)
              if (calc.config) {
                calc.setAnnualExpenses(defaultAnnualExpenses(value, calc.config))
              }
            }}
            priceEditable={priceMissing}
          />
        </div>

        {calc.identified || onOpenSaved ? (
          <div className="flex flex-wrap gap-3">
            {calc.identified ? (
              <button
                type="button"
                disabled={calc.saving}
                onClick={() => void calc.saveScenario()}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase disabled:cursor-not-allowed disabled:opacity-45"
              >
                {calc.saving ? 'Guardando…' : 'Guardar cálculo'}
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

      <section className="space-y-5">
        <ResultCards preview={calc.preview} />
        <DesglozeAnual preview={calc.preview} />
        <Disclaimer text={calc.config.disclaimer_text} />
      </section>
    </div>
  )
}

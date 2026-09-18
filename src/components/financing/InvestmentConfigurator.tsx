'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFinancingCalculator } from '@/hooks/useFinancingCalculator'
import { Disclaimer } from '@/components/financing/Disclaimer'
import { formatMoney, formatMoneyExact } from '@/lib/financing/calculator'
import {
  PROPERTY_DEFAULTS,
  buildSimpleInvestmentResult,
  detectPropertyType,
  estimateMonthlyRentFromDefaults,
  type PropertyType,
  type RentalKind,
} from '@/lib/financing/simpleInvestment'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import type { SimulationMode } from '@/types/financingSimulator'

type Step = 1 | 2 | 3 | 4

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: 'Propiedad' },
  { id: 2, label: 'Financiamiento' },
  { id: 3, label: 'Alquiler' },
  { id: 4, label: 'Resultado' },
]

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
  const [step, setStep] = useState<Step>(1)
  const [rents, setRents] = useState(true)
  const [rentalKind, setRentalKind] = useState<RentalKind>('residential')
  const [propertyType, setPropertyType] = useState<PropertyType>('depto')
  const [defaultsAppliedFor, setDefaultsAppliedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!initialScenario || calc.loading) return
    calc.loadFromScenario(initialScenario)
    onConsumedInitialScenario?.()
    setStep(4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScenario?.id, calc.loading])

  useEffect(() => {
    if (calc.loading || !calc.unit) return
    const key = calc.unit.id || unitParam
    if (defaultsAppliedFor === key) return
    const type = detectPropertyType(calc.unit.category, calc.unit.bedrooms)
    setPropertyType(type)
    const d = PROPERTY_DEFAULTS[type]
    setRentalKind(d.rentalKind)
    const est = estimateMonthlyRentFromDefaults(type)
    calc.setMonthlyRent(est.monthlyRent)
    calc.setVacancyRate(est.vacancyRate)
    calc.setExpenses({
      propertyTax: 0,
      maintenance: roundTo(est.annualExpenses),
      insurance: 0,
      other: 0,
      total: roundTo(est.annualExpenses),
    })
    if (calc.mode === 'cash') calc.setMode('financed')
    setDefaultsAppliedFor(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc.loading, calc.unit?.id, unitParam])

  const result = useMemo(() => {
    if (!calc.unitPrice || calc.unitPrice <= 0) return null
    return buildSimpleInvestmentResult({
      unitPrice: calc.unitPrice,
      downPaymentPercent: calc.downPaymentPercent,
      financingYears: calc.financingYears,
      interestRate: calc.interestRate,
      rents,
      propertyType,
      monthlyRent: calc.monthlyRent,
      vacancyRate: calc.vacancyRate,
      annualOperatingExpenses: calc.state.expenses.total,
      rentalKind,
    })
  }, [
    calc.unitPrice,
    calc.downPaymentPercent,
    calc.financingYears,
    calc.interestRate,
    calc.monthlyRent,
    calc.vacancyRate,
    calc.state.expenses.total,
    rents,
    propertyType,
    rentalKind,
  ])

  const applyPropertyType = (type: PropertyType) => {
    setPropertyType(type)
    const d = PROPERTY_DEFAULTS[type]
    setRentalKind(d.rentalKind)
    const est = estimateMonthlyRentFromDefaults(type)
    calc.setMonthlyRent(est.monthlyRent)
    calc.setVacancyRate(est.vacancyRate)
    calc.setExpenses({
      propertyTax: 0,
      maintenance: roundTo(est.annualExpenses),
      insurance: 0,
      other: 0,
      total: roundTo(est.annualExpenses),
    })
  }

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

  const downPaymentAmount =
    calc.unitPrice > 0 ? Math.round(((calc.unitPrice * calc.downPaymentPercent) / 100) * 100) / 100 : 0

  return (
    <div className={cn('space-y-6', !stacked && 'mx-auto max-w-2xl')}>
      <header className="space-y-3">
        <h2 className="font-serif text-2xl text-[#1f1a14] sm:text-3xl">
          Unidad {calc.unit?.unit_number ?? unitParam}
        </h2>
        <nav className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={cn(
                'rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase',
                step === s.id
                  ? 'bg-[#1a2744] text-white'
                  : 'border border-[#d9d0c3] bg-white text-[#6b645c]',
              )}
            >
              {s.id}. {s.label}
            </button>
          ))}
        </nav>
      </header>

      {step === 1 ? (
        <section className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            1. Selecciona tipo de propiedad
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(PROPERTY_DEFAULTS) as PropertyType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => applyPropertyType(type)}
                className={cn(
                  'rounded-xl border px-3 py-3 text-[12px] font-semibold',
                  propertyType === type
                    ? 'border-[#1a2744] bg-[#1a2744] text-white'
                    : 'border-[#e4ddd3] bg-white text-[#1f1a14]',
                )}
              >
                {PROPERTY_DEFAULTS[type].label}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[#6b645c]">Precio</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={calc.unitPrice > 0 ? calc.unitPrice : ''}
              onChange={(e) => calc.setUnitPrice(Number(e.target.value) || 0)}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
            />
          </label>
          <button
            type="button"
            disabled={!(calc.unitPrice > 0)}
            onClick={() => setStep(2)}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#1a2744] text-[11px] font-semibold tracking-[0.14em] text-white uppercase disabled:opacity-45"
          >
            Continuar
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            2. Entrada, plazo y banco
          </p>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[#6b645c]">Institución / banco</span>
            <select
              value={calc.state.partnerId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null
                if (!id) {
                  calc.setMode('manual')
                  return
                }
                calc.setPartnerId(id)
                calc.setMode('financed')
              }}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Simulación manual</option>
              {calc.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partner_name} · {Number(p.annual_interest_rate).toFixed(2)}%
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] text-[#6b645c]">Entrada %</span>
              <input
                type="number"
                min={calc.limits.downPaymentMin}
                max={calc.limits.downPaymentMax}
                value={calc.downPaymentPercent}
                onChange={(e) => calc.setDownPaymentPercent(Number(e.target.value))}
                className="w-full rounded-xl border border-[#e4ddd3] px-3 py-2 text-sm"
              />
              <span className="text-[11px] text-[#8a8176]">{formatMoney(downPaymentAmount)}</span>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-[#6b645c]">Plazo (años)</span>
              <input
                type="number"
                min={calc.limits.yearsMin}
                max={calc.limits.yearsMax}
                value={calc.financingYears}
                onChange={(e) => calc.setFinancingYears(Number(e.target.value))}
                className="w-full rounded-xl border border-[#e4ddd3] px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">Tasa anual %</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={calc.interestRate}
              onChange={(e) => calc.setInterestRate(Number(e.target.value))}
              className="w-full rounded-xl border border-[#e4ddd3] px-3 py-2 text-sm"
            />
          </label>
          {result ? (
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5 text-sm text-[#4a433c]">
              Cuota automática: <strong>{formatMoneyExact(result.monthlyPayment)}</strong> / mes
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-[#d9d0c3] text-[11px] font-semibold tracking-[0.14em] uppercase"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-[#1a2744] text-[11px] font-semibold tracking-[0.14em] text-white uppercase"
            >
              Continuar
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            3. ¿Alquila?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [true, 'Sí'],
                [false, 'No'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setRents(value)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-[11px] font-semibold tracking-[0.1em] uppercase',
                  rents === value
                    ? 'border-[#1a2744] bg-[#1a2744] text-white'
                    : 'border-[#e4ddd3] bg-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {rents ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['residential', 'Residencial'],
                    ['airbnb', 'Airbnb'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setRentalKind(value)
                      if (value === 'airbnb') {
                        applyPropertyType('suite')
                      } else if (propertyType === 'suite') {
                        applyPropertyType('depto')
                      } else {
                        applyPropertyType(propertyType)
                      }
                    }}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-[11px] font-semibold tracking-[0.1em] uppercase',
                      rentalKind === value
                        ? 'border-[#1a2744] bg-[#1a2744] text-white'
                        : 'border-[#e4ddd3] bg-white',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {rentalKind === 'airbnb' ? (
                <p className="text-[12px] text-[#6b645c]">
                  Defaults suite: ${PROPERTY_DEFAULTS.suite.nightlyRate}/noche · ocupación{' '}
                  {Math.round(PROPERTY_DEFAULTS.suite.occupancy * 100)}% · comisión{' '}
                  {Math.round(PROPERTY_DEFAULTS.suite.commission * 100)}% → alquiler estimado{' '}
                  {formatMoney(calc.monthlyRent)}/mes
                </p>
              ) : (
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#6b645c]">Alquiler mensual</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={calc.monthlyRent || ''}
                    onChange={(e) => calc.setMonthlyRent(Number(e.target.value) || 0)}
                    className="w-full rounded-xl border border-[#e4ddd3] px-3 py-2 text-sm"
                  />
                </label>
              )}
            </>
          ) : (
            <p className="rounded-xl bg-[#f7f3ee] px-3 py-2 text-sm text-[#6b645c]">
              Sin alquiler: solo cuota y apreciación. No genera flujo operativo.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-[#d9d0c3] text-[11px] font-semibold tracking-[0.14em] uppercase"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-[#1a2744] text-[11px] font-semibold tracking-[0.14em] text-white uppercase"
            >
              Ver resultado
            </button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          {result ? (
            <div className="space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-5 shadow-[0_12px_40px_rgba(40,30,20,0.06)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
                  4. Resultado
                </p>
                <span
                  className={cn(
                    'inline-flex rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.1em] uppercase',
                    result.badge === 'viable'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-900',
                  )}
                >
                  {result.badge === 'viable' ? 'Viable ✅' : 'Revisar ⚠️'}
                </span>
              </div>

              <ResultRow
                label="Cuota mensual"
                value={formatMoneyExact(result.monthlyPayment)}
                hint={`Entrada ${formatMoney(result.preview.downPaymentAmount)} · ${result.preview.financingYears} años`}
              />
              <ResultRow
                label="Flujo si alquila"
                value={
                  result.rents
                    ? formatMoneyExact(result.monthlyCashFlow ?? 0) + ' / mes'
                    : 'No genera flujo'
                }
                hint={result.cashFlowNote}
              />
              <ResultRow
                label={`Apreciación ${result.appreciationYears} años`}
                value={formatMoney(result.appreciationGain)}
                hint={`Valor futuro est. ${formatMoney(result.futureValue)} (${Math.round(result.appreciationRate * 100)}%/año)`}
              />
              <ResultRow
                label="ROI total"
                value={
                  result.totalRoiPercent == null ? '—' : `${result.totalRoiPercent.toFixed(1)}%`
                }
                hint={result.totalRoiLabel}
                emphasize
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-6 text-sm text-[#6b645c]">
              Complete precio y financiamiento para ver el resultado.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#d9d0c3] px-5 text-[11px] font-semibold tracking-[0.14em] uppercase"
            >
              Atrás
            </button>
            {calc.identified ? (
              <button
                type="button"
                disabled={calc.saving || !result}
                onClick={() => void calc.saveScenario()}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase disabled:opacity-45"
              >
                {calc.saving ? 'Guardando…' : 'Guardar escenario'}
              </button>
            ) : null}
            {onOpenSaved ? (
              <button
                type="button"
                onClick={onOpenSaved}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#d9d0c3] px-5 text-[11px] font-semibold tracking-[0.14em] uppercase"
              >
                Ver guardados
              </button>
            ) : null}
          </div>
          {calc.saveMessage ? <p className="text-sm text-[#4a433c]">{calc.saveMessage}</p> : null}
          <Disclaimer text={calc.config.disclaimer_text} />
        </section>
      ) : null}
    </div>
  )
}

function ResultRow({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string
  value: string
  hint?: string
  emphasize?: boolean
}) {
  return (
    <div className="border-t border-[#f0ebe3] pt-3 first:border-t-0 first:pt-0">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums text-[#1f1a14]',
          emphasize && 'text-2xl text-[#1a2744]',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

function roundTo(n: number) {
  return Math.round(n * 100) / 100
}

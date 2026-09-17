'use client'

import {
  INCOME_TAX_RATE,
  MANAGEMENT_FEE_RATE,
  formatMoney,
  formatMoneyExact,
  roundMoney,
} from '@/lib/financing/calculator'
import type { ExpenseBreakdown } from '@/types/financingSimulator'
import { CoberturaMensual } from '@/components/financing/CoberturaMensual'
import type { MonthlyCoverage } from '@/types/financingSimulator'

export function ParameterSliders({
  monthlyRent,
  onRentChange,
  suggestedRent,
  rentSuggestionLabel,
  onUseSuggestedRent,
  vacancyRate,
  onVacancyChange,
  expenses,
  onExpensesChange,
  suggestedExpenses,
  onUseSuggestedExpenses,
  includePropertyManager,
  onIncludePropertyManagerChange,
  includeIncomeTax,
  onIncludeIncomeTaxChange,
  coverage,
  showCoveragePayment = true,
  unitPrice,
  onUnitPriceChange,
  priceEditable,
  priceMissing,
  showPrice = true,
}: {
  monthlyRent: number
  onRentChange: (value: number) => void
  suggestedRent: number
  rentSuggestionLabel?: string
  onUseSuggestedRent: () => void
  vacancyRate: number
  onVacancyChange: (value: number) => void
  expenses: ExpenseBreakdown
  onExpensesChange: (partial: Partial<ExpenseBreakdown>) => void
  suggestedExpenses: number
  onUseSuggestedExpenses: () => void
  includePropertyManager: boolean
  onIncludePropertyManagerChange: (value: boolean) => void
  includeIncomeTax: boolean
  onIncludeIncomeTaxChange: (value: boolean) => void
  coverage: MonthlyCoverage | null
  showCoveragePayment?: boolean
  unitPrice: number
  onUnitPriceChange: (value: number) => void
  priceEditable?: boolean
  priceMissing?: boolean
  showPrice?: boolean
}) {
  const vacancyPct = Math.round(vacancyRate * 1000) / 10
  const annualEffective = roundMoney(monthlyRent * 12 * (1 - vacancyRate))
  const estimatedManagement = roundMoney(annualEffective * MANAGEMENT_FEE_RATE)
  const estimatedIncomeTax = roundMoney(annualEffective * INCOME_TAX_RATE)

  return (
    <div className="space-y-5">
      {showPrice ? (
        <>
          {priceMissing && !priceEditable ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              Sin precio publicado. Indique un valor hipotético para simular.
            </div>
          ) : null}

          {priceEditable || priceMissing ? (
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
                Precio hipotético de la unidad
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                value={unitPrice > 0 ? unitPrice : ''}
                placeholder="Sin precio"
                onChange={(event) => onUnitPriceChange(Number(event.target.value) || 0)}
                className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
              />
            </label>
          ) : (
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                Precio de la unidad
              </p>
              <p className="mt-0.5 text-lg font-semibold text-[#1f1a14]">{formatMoney(unitPrice)}</p>
            </div>
          )}
        </>
      ) : null}

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Alquiler estimado / mes
          </span>
          {suggestedRent > 0 ? (
            <button
              type="button"
              onClick={onUseSuggestedRent}
              className="text-[10px] font-semibold tracking-[0.08em] text-[#7a6240] uppercase hover:underline"
            >
              Estimar · {formatMoney(suggestedRent)}
            </button>
          ) : null}
        </div>
        <input
          type="number"
          min={0}
          step={50}
          value={monthlyRent}
          onChange={(event) => onRentChange(Number(event.target.value))}
          className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
        />
        <p className="text-[11px] text-[#8a8176]">
          {rentSuggestionLabel || 'Ajuste el alquiler según su hipótesis de mercado.'}
        </p>
      </label>

      {coverage ? (
        <CoberturaMensual coverage={coverage} showPayment={showCoveragePayment} />
      ) : null}

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Vacancia / desocupación
          </span>
          <span className="text-[11px] tabular-nums text-[#6b645c]">{vacancyPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={vacancyPct}
          onChange={(event) => onVacancyChange(Number(event.target.value) / 100)}
          className="w-full accent-[#1a2744]"
        />
        <p className="text-[11px] text-[#8a8176]">
          Se aplica una sola vez sobre el alquiler potencial anual.
        </p>
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Gastos operativos anuales
          </span>
          <button
            type="button"
            onClick={onUseSuggestedExpenses}
            className="text-[10px] font-semibold tracking-[0.08em] text-[#7a6240] uppercase hover:underline"
          >
            Usar base · {formatMoney(suggestedExpenses)}
          </button>
        </div>
        {(
          [
            ['propertyTax', 'Impuesto predial / operacional'],
            ['maintenance', 'Mantenimiento / alícuota'],
            ['insurance', 'Seguro'],
            ['other', 'Otros gastos'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">{label}</span>
            <input
              type="number"
              min={0}
              step={10}
              value={expenses[key]}
              onChange={(event) => onExpensesChange({ [key]: Number(event.target.value) || 0 })}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm outline-none focus:border-[#BDA27E]"
            />
          </label>
        ))}
        <p className="text-[11px] text-[#8a8176]">
          Total operativo: {formatMoney(expenses.total)} (sin vacancia, IR ni gestor).
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Gestión del arrendamiento
        </p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#1f1a14]">
          <input
            type="radio"
            name="gestor-mode"
            className="mt-1 accent-[#1a2744]"
            checked={!includePropertyManager}
            onChange={() => onIncludePropertyManagerChange(false)}
          />
          <span>
            Auto-gestiono <span className="text-[#8a8176]">(sin comisión)</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#1f1a14]">
          <input
            type="radio"
            name="gestor-mode"
            className="mt-1 accent-[#1a2744]"
            checked={includePropertyManager}
            onChange={() => onIncludePropertyManagerChange(true)}
          />
          <span>
            Pago gestor inmobiliario ({(MANAGEMENT_FEE_RATE * 100).toFixed(0)}% del alquiler efectivo)
          </span>
        </label>
        <p className="text-[12px] tabular-nums text-[#4a433c]">
          Comisión estimada:{' '}
          <strong>
            {includePropertyManager ? formatMoneyExact(estimatedManagement) : formatMoneyExact(0)}
          </strong>
          /año
        </p>
      </div>

      <div className="space-y-2 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#1f1a14]">
          <input
            type="checkbox"
            className="mt-1 accent-[#1a2744]"
            checked={includeIncomeTax}
            onChange={(event) => onIncludeIncomeTaxChange(event.target.checked)}
          />
          <span>
            Impuesto a la renta ({(INCOME_TAX_RATE * 100).toFixed(0)}% sobre alquiler efectivo)
          </span>
        </label>
        <p className="text-[12px] tabular-nums text-[#4a433c]">
          IR estimado:{' '}
          <strong>
            {includeIncomeTax ? formatMoneyExact(estimatedIncomeTax) : formatMoneyExact(0)}
          </strong>
          /año · adicional al impuesto predial/operacional
        </p>
      </div>
    </div>
  )
}

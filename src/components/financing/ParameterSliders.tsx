'use client'

import { formatMoney } from '@/lib/financing/calculator'
import type { ExpenseBreakdown } from '@/types/financingSimulator'

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
  annualManagement,
  onManagementChange,
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
  annualManagement: number
  onManagementChange: (value: number) => void
  unitPrice: number
  onUnitPriceChange: (value: number) => void
  priceEditable?: boolean
  priceMissing?: boolean
  showPrice?: boolean
}) {
  const vacancyPct = Math.round(vacancyRate * 1000) / 10

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

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Vacancia
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
            ['propertyTax', 'Predial'],
            ['maintenance', 'Mantenimiento / alícuota (propietario)'],
            ['insurance', 'Seguros'],
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
          Total operativo: {formatMoney(expenses.total)} (sin gestión ni IR).
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Gestión anual
        </span>
        <input
          type="number"
          min={0}
          step={50}
          value={annualManagement}
          onChange={(event) => onManagementChange(Number(event.target.value) || 0)}
          className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
        />
      </label>
    </div>
  )
}

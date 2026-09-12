'use client'

import { formatMoney } from '@/lib/financing/calculator'

export function ParameterSliders({
  monthlyRent,
  onRentChange,
  suggestedRent,
  onUseSuggestedRent,
  annualExpenses,
  onExpensesChange,
  suggestedExpenses,
  onUseSuggestedExpenses,
  unitPrice,
  onUnitPriceChange,
  priceEditable,
}: {
  monthlyRent: number
  onRentChange: (value: number) => void
  suggestedRent: number
  onUseSuggestedRent: () => void
  annualExpenses: number
  onExpensesChange: (value: number) => void
  suggestedExpenses: number
  onUseSuggestedExpenses: () => void
  unitPrice: number
  onUnitPriceChange: (value: number) => void
  priceEditable?: boolean
}) {
  return (
    <div className="space-y-5">
      {priceEditable ? (
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Precio de la unidad
          </span>
          <input
            type="number"
            min={10000}
            step={1000}
            value={unitPrice}
            onChange={(event) => onUnitPriceChange(Number(event.target.value))}
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

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Alquiler estimado / mes
          </span>
          <button
            type="button"
            onClick={onUseSuggestedRent}
            className="text-[10px] font-semibold tracking-[0.08em] text-[#7a6240] uppercase hover:underline"
          >
            Estimar · {formatMoney(suggestedRent)}
          </button>
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
          Puede escribirlo o usar la estimación (~6% anual del precio).
        </p>
      </label>

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Gastos anuales
          </span>
          <button
            type="button"
            onClick={onUseSuggestedExpenses}
            className="text-[10px] font-semibold tracking-[0.08em] text-[#7a6240] uppercase hover:underline"
          >
            Usar base · {formatMoney(suggestedExpenses)}
          </button>
        </div>
        <input
          type="number"
          min={0}
          step={50}
          value={annualExpenses}
          onChange={(event) => onExpensesChange(Number(event.target.value))}
          className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
        />
        <p className="text-[11px] text-[#8a8176]">
          Impuesto predial, mantenimiento y seguro (ajustable).
        </p>
      </label>
    </div>
  )
}

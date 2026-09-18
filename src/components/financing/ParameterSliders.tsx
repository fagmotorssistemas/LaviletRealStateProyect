'use client'

import {
  INCOME_TAX_RATE,
  MANAGEMENT_FEE_RATE,
  formatMoney,
  formatMoneyExact,
  propertyExpenseLinesFromConfig,
  roundMoney,
  type RentCoverageAnalysis,
} from '@/lib/financing/calculator'
import type { FinancingConfig } from '@/types/financingSimulator'
import { CoberturaMensual } from '@/components/financing/CoberturaMensual'

export function ParameterSliders({
  monthlyRent,
  onRentChange,
  suggestedRent,
  rentSuggestionLabel,
  onUseSuggestedRent,
  vacancyRate,
  onVacancyChange,
  financingConfig,
  unitPrice,
  includePropertyManager,
  onIncludePropertyManagerChange,
  includeIncomeTax,
  onIncludeIncomeTaxChange,
  incomeTaxRate,
  onIncomeTaxRateChange,
  managementFeeRate,
  onManagementFeeRateChange,
  coverage,
  showCoveragePayment = true,
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
  financingConfig: FinancingConfig | null
  includePropertyManager: boolean
  onIncludePropertyManagerChange: (value: boolean) => void
  includeIncomeTax: boolean
  onIncludeIncomeTaxChange: (value: boolean) => void
  incomeTaxRate?: number
  onIncomeTaxRateChange?: (value: number) => void
  managementFeeRate?: number
  onManagementFeeRateChange?: (value: number) => void
  coverage: RentCoverageAnalysis | null
  showCoveragePayment?: boolean
  unitPrice: number
  onUnitPriceChange: (value: number) => void
  priceEditable?: boolean
  priceMissing?: boolean
  showPrice?: boolean
}) {
  const vacancyPct = Math.round(vacancyRate * 1000) / 10
  const taxRate = incomeTaxRate ?? INCOME_TAX_RATE
  const mgmtRate = managementFeeRate ?? MANAGEMENT_FEE_RATE
  const annualEffective = roundMoney(monthlyRent * 12 * (1 - vacancyRate))
  const estimatedManagement = roundMoney(annualEffective * mgmtRate)
  const estimatedIncomeTax = roundMoney(annualEffective * taxRate)
  const propertyExpenses = propertyExpenseLinesFromConfig(unitPrice, financingConfig)

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
              Usar referencia · {formatMoney(suggestedRent)}
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
          {rentSuggestionLabel ||
            'Referencia por tipología del proyecto (configurada por el encargado).'}
        </p>
      </label>

      {coverage ? (
        <CoberturaMensual coverage={coverage} showPayment={showCoveragePayment} />
      ) : null}

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Tiempo estimado sin inquilino
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
            Gastos de la propiedad
          </span>
        </div>
        {propertyExpenses.totalAnnual != null ? (
          <p className="text-sm text-[#4a433c]">
            Total: {formatMoneyExact(propertyExpenses.totalAnnual)}/año ·{' '}
            {formatMoneyExact(propertyExpenses.totalMonthly!)}/mes
          </p>
        ) : (
          <p className="text-sm text-amber-900">
            Faltan datos de configuración de gastos. No se asume un total en cero.
          </p>
        )}
        <p className="text-[11px] text-[#8a8176]">
          Los gastos de la propiedad incluyen impuesto predial y alícuota. No incluyen seguros ni
          otros gastos adicionales. Los montos vienen de la configuración del proyecto; no son
          tarifas tributarias legalmente verificadas por esta interfaz.
        </p>
        <details className="rounded-xl border border-[#ece6dc] bg-white px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.1em] text-[#6b645c] uppercase">
            Ver gastos de la propiedad
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold tracking-[0.1em] text-[#8a8176] uppercase">
                  <th className="pb-2 pr-3">Concepto</th>
                  <th className="pb-2 text-right">Anual</th>
                  <th className="pb-2 pl-3 text-right">Mensual</th>
                </tr>
              </thead>
              <tbody>
                {propertyExpenses.lines.map((line) => (
                  <tr key={line.key} className="border-t border-[#f0ebe3]">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-[#1f1a14]">{line.label}</p>
                      <p className="text-[11px] text-[#8a8176]">{line.description}</p>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[#1f1a14]">
                      {line.configured && line.annual != null
                        ? formatMoneyExact(line.annual)
                        : 'Sin dato'}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-[#1f1a14]">
                      {line.key === 'propertyTax'
                        ? '—'
                        : line.configured && line.annual != null
                          ? formatMoneyExact(roundMoney(line.annual / 12))
                          : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4ddd3]">
                  <td className="py-2 pr-3 font-semibold text-[#1f1a14]">Total</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {propertyExpenses.totalAnnual != null
                      ? formatMoneyExact(propertyExpenses.totalAnnual)
                      : '—'}
                  </td>
                  <td className="py-2 pl-3 text-right font-semibold tabular-nums">
                    {propertyExpenses.totalMonthly != null
                      ? formatMoneyExact(propertyExpenses.totalMonthly)
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-[#8a8176]">
              El impuesto predial se paga una vez al año; por eso no tiene equivalente mensual. La
              alícuota sí se muestra anual y mensual.
            </p>
          </div>
        </details>
      </div>

      <div className="space-y-3 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          Servicio de administración del alquiler (supuesto)
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
          <span>Pago gestor inmobiliario</span>
        </label>
        {includePropertyManager && onManagementFeeRateChange ? (
          <label className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">% comisión sobre alquiler efectivo</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={Math.round(mgmtRate * 1000) / 10}
              onChange={(e) => onManagementFeeRateChange((Number(e.target.value) || 0) / 100)}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
        ) : null}
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
          <span>Impuesto estimado sobre alquiler efectivo (supuesto configurado)</span>
        </label>
        {includeIncomeTax && onIncomeTaxRateChange ? (
          <label className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">% impuesto (no es tasa legal universal)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={Math.round(taxRate * 1000) / 10}
              onChange={(e) => onIncomeTaxRateChange((Number(e.target.value) || 0) / 100)}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
        ) : null}
        <p className="text-[12px] tabular-nums text-[#4a433c]">
          IR estimado:{' '}
          <strong>
            {includeIncomeTax ? formatMoneyExact(estimatedIncomeTax) : formatMoneyExact(0)}
          </strong>
          /año · adicional al impuesto predial
        </p>
      </div>
    </div>
  )
}

'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import {
  INCOME_TAX_RATE,
  MANAGEMENT_FEE_RATE,
  formatMoney,
  formatMoneyExact,
  propertyExpenseLinesFromConfig,
  roundMoney,
} from '@/lib/financing/calculator'
import type { FinancingConfig } from '@/types/financingSimulator'

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
  onUnitPriceChange,
  priceEditable,
  priceMissing,
  showPrice = true,
  /** Alquiler, vacancia y gastos administrados: solo lectura para el cliente. */
  assumptionsReadOnly = false,
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
  unitPrice: number
  onUnitPriceChange: (value: number) => void
  priceEditable?: boolean
  priceMissing?: boolean
  showPrice?: boolean
  assumptionsReadOnly?: boolean
}) {
  const { t } = useTourLanguage()

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
              {t(" Sin precio publicado. Indique un valor hipotético para simular. ")}</div>
          ) : null}

          {priceEditable || priceMissing ? (
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
                {t(" Precio hipotético de la unidad ")}</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={unitPrice > 0 ? unitPrice : ''}
                placeholder={t("Sin precio")}
                onChange={(event) => onUnitPriceChange(Number(event.target.value) || 0)}
                className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
              />
            </label>
          ) : (
            <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                {t(" Precio de la unidad ")}</p>
              <p className="mt-0.5 text-lg font-semibold text-[#1f1a14]">{t(formatMoney(unitPrice))}</p>
            </div>
          )}
        </>
      ) : null}

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            {t(" Alquiler estimado / mes ")}</span>
          {!assumptionsReadOnly && suggestedRent > 0 ? (
            <button
              type="button"
              onClick={onUseSuggestedRent}
              className="text-[10px] font-semibold tracking-[0.08em] text-[#7a6240] uppercase hover:underline"
            >
              {t(" Usar referencia · ")}{t(formatMoney(suggestedRent))}
            </button>
          ) : null}
        </div>
        {assumptionsReadOnly ? (
          <div className="rounded-xl bg-[#f7f3ee] px-3 py-2.5">
            <p className="text-lg font-semibold tabular-nums text-[#1f1a14]">
              {t(formatMoney(monthlyRent))}
            </p>
            <p className="text-[11px] text-[#8a8176]">
              {t(" Valor administrado (referencia del proyecto). No editable en el simulador. ")}</p>
          </div>
        ) : (
          <input
            type="number"
            min={0}
            step={50}
            value={monthlyRent}
            onChange={(event) => onRentChange(Number(event.target.value))}
            className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
          />
        )}
        {!assumptionsReadOnly ? (
          <p className="text-[11px] text-[#8a8176]">
            {t(rentSuggestionLabel ||
              'Referencia por tipología del proyecto (configurada por el encargado).')}
          </p>
        ) : null}
      </label>

      <label className="block space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            {t(" Tiempo estimado sin inquilino ")}</span>
          <span className="text-[11px] tabular-nums text-[#6b645c]">{t(vacancyPct)}%</span>
        </div>
        {assumptionsReadOnly ? (
          <p className="text-[11px] text-[#8a8176]">
            {t(" Configurado por el proyecto (")}{t(vacancyPct)}{t("%). No editable aquí. ")}</p>
        ) : (
          <>
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
              {t(" Se aplica una sola vez sobre el alquiler potencial anual. ")}</p>
          </>
        )}
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            {t(" Gastos de la propiedad ")}</span>
        </div>
        {propertyExpenses.totalAnnual != null ? (
          <p className="text-sm text-[#4a433c]">
            {t(" Total: ")}{t(formatMoneyExact(propertyExpenses.totalAnnual))}{t("/año ·")}{t(' ')}
            {t(formatMoneyExact(propertyExpenses.totalMonthly!))}{t("/mes ")}</p>
        ) : (
          <p className="text-sm text-amber-900">
            {t(" Faltan datos de configuración de gastos. No se asume un total en cero. ")}</p>
        )}
        <p className="text-[11px] text-[#8a8176]">
          {t(" Los gastos de la propiedad incluyen impuesto predial y alícuota. No incluyen seguros ni otros gastos adicionales. Los montos vienen de la configuración del proyecto; no son tarifas tributarias legalmente verificadas por esta interfaz. ")}</p>
        <details className="rounded-xl border border-[#ece6dc] bg-white px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.1em] text-[#6b645c] uppercase">
            {t(" Ver gastos de la propiedad ")}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-semibold tracking-[0.1em] text-[#8a8176] uppercase">
                  <th className="pb-2 pr-3">{t("Concepto")}</th>
                  <th className="pb-2 text-right">{t("Anual")}</th>
                  <th className="pb-2 pl-3 text-right">{t("Mensual")}</th>
                </tr>
              </thead>
              <tbody>
                {propertyExpenses.lines.map((line) => (
                  <tr key={line.key} className="border-t border-[#f0ebe3]">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-[#1f1a14]">{t(line.label)}</p>
                      <p className="text-[11px] text-[#8a8176]">{t(line.description)}</p>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[#1f1a14]">
                      {t(line.configured && line.annual != null
                        ? formatMoneyExact(line.annual)
                        : 'Sin dato')}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-[#1f1a14]">
                      {t(line.key === 'propertyTax'
                        ? '—'
                        : line.configured && line.annual != null
                          ? formatMoneyExact(roundMoney(line.annual / 12))
                          : '—')}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4ddd3]">
                  <td className="py-2 pr-3 font-semibold text-[#1f1a14]">{t("Total")}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {t(propertyExpenses.totalAnnual != null
                      ? formatMoneyExact(propertyExpenses.totalAnnual)
                      : '—')}
                  </td>
                  <td className="py-2 pl-3 text-right font-semibold tabular-nums">
                    {t(propertyExpenses.totalMonthly != null
                      ? formatMoneyExact(propertyExpenses.totalMonthly)
                      : '—')}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-[#8a8176]">
              {t(" El impuesto predial se paga una vez al año; por eso no tiene equivalente mensual. La alícuota sí se muestra anual y mensual. ")}</p>
          </div>
        </details>
      </div>

      <div className="space-y-3 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
          {t(" Servicio de administración del alquiler (supuesto) ")}</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#1f1a14]">
          <input
            type="radio"
            name="gestor-mode"
            className="mt-1 accent-[#1a2744]"
            checked={!includePropertyManager}
            onChange={() => onIncludePropertyManagerChange(false)}
          />
          <span>
            {t(" Auto-gestiono ")}<span className="text-[#8a8176]">{t("(sin comisión)")}</span>
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
          <span>{t("Pago gestor inmobiliario")}</span>
        </label>
        {includePropertyManager && onManagementFeeRateChange ? (
          <label className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">{t("% comisión sobre alquiler efectivo")}</span>
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
          {t(" Comisión estimada:")}{t(' ')}
          <strong>
            {t(includePropertyManager ? formatMoneyExact(estimatedManagement) : formatMoneyExact(0))}
          </strong>
          {t(" /año ")}</p>
      </div>

      <div className="space-y-2 rounded-2xl border border-[#ece6dc] bg-[#fcfbf9] px-4 py-3">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[#1f1a14]">
          <input
            type="checkbox"
            className="mt-1 accent-[#1a2744]"
            checked={includeIncomeTax}
            onChange={(event) => onIncludeIncomeTaxChange(event.target.checked)}
          />
          <span>{t("Impuesto estimado sobre alquiler efectivo (supuesto configurado)")}</span>
        </label>
        {includeIncomeTax && onIncomeTaxRateChange ? (
          <label className="block space-y-1">
            <span className="text-[11px] text-[#6b645c]">{t("% impuesto (no es tasa legal universal)")}</span>
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
          {t(" IR estimado:")}{t(' ')}
          <strong>
            {t(includeIncomeTax ? formatMoneyExact(estimatedIncomeTax) : formatMoneyExact(0))}
          </strong>
          {t(" /año · adicional al impuesto predial ")}</p>
      </div>
    </div>
  )
}

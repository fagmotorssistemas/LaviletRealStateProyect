'use client'

import {
  buildRentCoverageAnalysis,
  formatMoneyExact,
  formatPercent,
  roundMoney,
} from '@/lib/financing/calculator'
import type { InvestmentPreview } from '@/types/financingSimulator'
import { cn } from '@/lib/utils'

/** Cobertura de cuota: alquiler neto aplicado vs aporte (dinámico; sin cifras fijas). */
export function coverageBarSegments(net: number, payment: number) {
  const safePayment = Math.max(0, roundMoney(payment))
  const safeNet = roundMoney(net)
  if (safePayment <= 0) {
    return {
      rentApplied: 0,
      buyerOnPayment: 0,
      rentPct: null as number | null,
      buyerPct: null as number | null,
      surplusOverPayment: safeNet > 0 ? safeNet : 0,
      negativeNet: safeNet < 0 ? safeNet : 0,
    }
  }
  const rentApplied = roundMoney(Math.min(Math.max(0, safeNet), safePayment))
  const buyerOnPayment = roundMoney(safePayment - rentApplied)
  const rentPct = roundMoney((rentApplied / safePayment) * 100)
  const buyerPct = roundMoney((buyerOnPayment / safePayment) * 100)
  const surplusOverPayment = safeNet > safePayment ? roundMoney(safeNet - safePayment) : 0
  const negativeNet = safeNet < 0 ? safeNet : 0
  return { rentApplied, buyerOnPayment, rentPct, buyerPct, surplusOverPayment, negativeNet }
}

export function CoberturaMensual({
  preview,
  showPayment = true,
}: {
  preview: InvestmentPreview
  showPayment?: boolean
}) {
  const coverage = buildRentCoverageAnalysis(preview)
  const needsTopUp = coverage.monthlyTopUpOrSurplus < 0
  const hasSurplus = coverage.monthlyTopUpOrSurplus > 0
  const payment = coverage.monthlyPayment
  const net = coverage.monthlyNetRentAvailable
  const showCuota = showPayment !== false && payment > 0

  const gross = roundMoney(preview.annualPotentialRental / 12)
  const vacancy = roundMoney(preview.annualVacancyCost / 12)
  const ops = roundMoney(preview.annualOperatingExpenses / 12)
  const mgmt = roundMoney(preview.annualManagement / 12)
  const tax = roundMoney(preview.annualIncomeTaxEstimate / 12)

  const bar = coverageBarSegments(net, showCuota ? payment : 0)
  const buyerTopUp = needsTopUp ? roundMoney(Math.abs(coverage.monthlyTopUpOrSurplus)) : 0

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-[#fcfbf9]">
      <div className="border-b border-[#ece6dc] bg-[#f7f3ee] px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
        Cómo el alquiler ayuda con la cuota
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <ol className="space-y-2 text-[#4a433c]">
          <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
            <span>Alquiler bruto estimado</span>
            <span className="tabular-nums font-medium">{formatMoneyExact(gross)}</span>
          </li>
          <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
            <span>Tiempo estimado sin inquilino</span>
            <span className="tabular-nums font-medium">−{formatMoneyExact(vacancy)}</span>
          </li>
          <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
            <span>Gastos de la propiedad</span>
            <span className="tabular-nums font-medium">−{formatMoneyExact(ops)}</span>
          </li>
          {mgmt > 0 ? (
            <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
              <span>
                Administración del alquiler
                {preview.managementFeeRate > 0
                  ? ` (${formatPercent(preview.managementFeeRate * 100, 0)} del efectivo)`
                  : ''}
              </span>
              <span className="tabular-nums font-medium">−{formatMoneyExact(mgmt)}</span>
            </li>
          ) : null}
          {tax > 0 ? (
            <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
              <span>
                Impuesto estimado
                {preview.incomeTaxRate > 0
                  ? ` (${formatPercent(preview.incomeTaxRate * 100, 0)} del efectivo)`
                  : ''}
              </span>
              <span className="tabular-nums font-medium">−{formatMoneyExact(tax)}</span>
            </li>
          ) : null}
          <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2 font-semibold text-[#1f1a14]">
            <span>Alquiler neto disponible</span>
            <span className="tabular-nums">{formatMoneyExact(net)}</span>
          </li>
          {showCuota ? (
            <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2">
              <span>Cuota bancaria estimada</span>
              <span className="tabular-nums font-medium">−{formatMoneyExact(payment)}</span>
            </li>
          ) : showPayment !== false && payment === 0 ? (
            <li className="flex justify-between gap-3 border-b border-[#f0ebe3] pb-2 text-[#6b645c]">
              <span>Cuota bancaria</span>
              <span>Sin cuota</span>
            </li>
          ) : null}
        </ol>

        {mgmt > 0 || tax > 0 ? (
          <p className="text-[10px] leading-snug text-[#8a8176]">
            Administración e impuesto son supuestos del escenario configurado; no son tasas legales
            universales.
          </p>
        ) : null}

        {showCuota ? (
          <div className="space-y-2">
            <p className="text-[13px] leading-relaxed text-[#4a433c]">
              El alquiler neto cubre{' '}
              <strong className="tabular-nums">{formatMoneyExact(bar.rentApplied)}</strong> de una
              cuota estimada de{' '}
              <strong className="tabular-nums">{formatMoneyExact(payment)}</strong>. Tú completas{' '}
              <strong className="tabular-nums">{formatMoneyExact(buyerTopUp)}</strong>.
            </p>
            <div className="space-y-1.5">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#e8e2d8]">
                {bar.rentPct != null && bar.rentPct > 0 ? (
                  <div
                    className="h-full bg-[#1a2744] transition-[width]"
                    style={{ width: `${Math.min(100, bar.rentPct)}%` }}
                    title={`Alquiler neto aplicado: ${formatPercent(bar.rentPct)}`}
                  />
                ) : null}
                {bar.buyerPct != null && bar.buyerPct > 0 ? (
                  <div
                    className="h-full bg-[#9aa4b8] transition-[width]"
                    style={{ width: `${Math.min(100, bar.buyerPct)}%` }}
                    title={`Aporte del comprador: ${formatPercent(bar.buyerPct)}`}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#6b645c]">
                <span>
                  Alquiler neto aplicado:{' '}
                  <span className="tabular-nums font-medium text-[#1f1a14]">
                    {formatMoneyExact(bar.rentApplied)}
                  </span>
                  {bar.rentPct != null ? ` · ${formatPercent(bar.rentPct)}` : null}
                </span>
                <span>
                  Aporte a la cuota:{' '}
                  <span className="tabular-nums font-medium text-[#1f1a14]">
                    {formatMoneyExact(bar.buyerOnPayment)}
                  </span>
                  {bar.buyerPct != null ? ` · ${formatPercent(bar.buyerPct)}` : null}
                </span>
              </div>
              {bar.surplusOverPayment > 0 ? (
                <p className="text-[11px] text-emerald-800">
                  Excedente tras cubrir la cuota:{' '}
                  <span className="tabular-nums font-semibold">
                    {formatMoneyExact(bar.surplusOverPayment)}
                  </span>
                  /mes (cobertura limitada al 100% de la cuota).
                </p>
              ) : null}
              {bar.negativeNet < 0 ? (
                <p className="text-[11px] text-[#6b645c]">
                  Alquiler neto negativo ({formatMoneyExact(bar.negativeNet)}): no aporta a la cuota;
                  el aporte de bolsillo incluye ese déficit además de la cuota.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#dce3ef] bg-[#f4f6fa] px-3 py-2.5">
          <div className="flex justify-between gap-3">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-[#6b645c] uppercase">
              {needsTopUp
                ? 'Tu aporte mensual estimado'
                : hasSurplus
                  ? 'Dinero que te queda cada mes'
                  : 'Los ingresos cubren gastos y cuota'}
            </span>
            <span
              className={cn(
                'text-base font-semibold tabular-nums',
                needsTopUp ? 'text-[#1a2744]' : hasSurplus ? 'text-emerald-700' : 'text-[#1f1a14]',
              )}
            >
              {formatMoneyExact(Math.abs(coverage.monthlyTopUpOrSurplus))}
            </span>
          </div>
          {needsTopUp ? (
            <p className="mt-1.5 text-[11px] leading-snug text-[#6b645c]">
              Dinero que aportarías de tu bolsillo después de aplicar el alquiler neto al pago de la
              cuota. No es ingreso ni capital íntegramente amortizado.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

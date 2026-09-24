'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import type { FinancingPartner } from '@/types/financingSimulator'
import { formatPercent } from '@/lib/financing/calculator'

export function BankSelector({
  partners,
  value,
  onChange,
}: {
  partners: FinancingPartner[]
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useTourLanguage()

  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">{t("Banco")}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm text-[#1f1a14] outline-none focus:border-[#BDA27E]"
      >
        {partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {t(partner.partner_name)}
            {t(partner.is_recommended ? ' · recomendado' : '')} — {t(formatPercent(partner.annual_interest_rate))}
          </option>
        ))}
      </select>
    </label>
  )
}

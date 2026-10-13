'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingConfig, FinancingPartner } from '@/types/financingSimulator'
import { FINANCING_PROJECT_ID } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { useTourLanguage } from '@/lib/tour/tourLocale'
import { SRI_PERSONAL_INCOME_TAX_TABLE_2026, validIncomeTaxBrackets, isTaxProfile, type TaxProfile } from '@/lib/financing/ecuadorTax'

function SectionShell({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[#ece6dc] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece6dc] bg-[#f7f3ee]/70 px-3 py-2.5 sm:px-4">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">{title}</h2>
        {action}
      </header>
      <div className="min-w-0 flex-1 p-3 sm:p-4">{children}</div>
    </section>
  )
}

export function FinancingSettingsView({
  embedded = false,
  section,
}: {
  embedded?: boolean
  /** Si viene del panel unificado, no se muestran pestañas internas. */
  section?: 'partners' | 'config'
}) {
  const { supabase } = useAuth()
  const { t } = useTourLanguage()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [tab, setTab] = useState<'partners' | 'config'>(section ?? 'partners')
  const [partners, setPartners] = useState<FinancingPartner[]>([])
  const [config, setConfig] = useState<FinancingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const showAll = embedded && !section
  const activeTab = section ?? tab
  const showInternalTabs = !embedded && !section
  const showPartners = showAll || activeTab === 'partners'
  const showConfig = showAll || activeTab === 'config'

  useEffect(() => {
    if (section) setTab(section)
  }, [section])

  useEffect(() => {
    if (!embedded && !roleLoading && !isAdmin) router.replace('/inmobiliaria/financiamiento')
  }, [embedded, isAdmin, roleLoading, router])

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    const [partnersRes, configRes] = await Promise.all([
      supabase.from('financing_partners').select('*').order('annual_interest_rate', { ascending: true }),
      supabase.from('financing_config').select('*').eq('project_id', FINANCING_PROJECT_ID).maybeSingle(),
    ])
    if (partnersRes.error) setMessage(partnersRes.error.message)
    if (configRes.error) setMessage(configRes.error.message)
    setPartners((partnersRes.data ?? []) as FinancingPartner[])
    setConfig((configRes.data as FinancingConfig) ?? null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  async function savePartner(partner: FinancingPartner) {
    const rate = Number(partner.annual_interest_rate)
    if (!(rate >= 5 && rate <= 15)) {
      setMessage('La tasa debe estar entre 5% y 15%')
      return
    }
    const { error } = await supabase
      .from('financing_partners')
      .update({
        annual_interest_rate: rate,
        active: Boolean(partner.active),
        is_recommended: Boolean(partner.is_recommended),
        updated_at: new Date().toISOString(),
      })
      .eq('id', partner.id)
    setMessage(error ? error.message : `Tasa de ${partner.partner_name} actualizada`)
    if (!error) void load()
  }

  async function saveConfig() {
    if (!config) return
    if (!(config.annual_property_tax >= 0 && config.annual_property_tax <= 0.6)) {
      setMessage('Impuesto fuera de rango (0–0,6%)')
      return
    }
    const brackets = config.income_tax_brackets ?? SRI_PERSONAL_INCOME_TAX_TABLE_2026
    if (!validIncomeTaxBrackets(brackets)) {
      setMessage('Los tramos del IR deben ser continuos, estar ordenados y tener solo el último sin límite superior')
      return
    }
    const ranges = [
      [config.company_income_tax_rate ?? 0.25, 0, 1],
      [config.management_fee_rate ?? 0.08, 0, 1],
      [config.acquisition_cost_pct ?? 1.3, 0, 20],
      [config.acquisition_cost_fixed ?? 500, 0, 100000],
      [config.sale_commission_pct ?? 0, 0, 20],
      [config.default_appreciation_rate ?? 0.03, -0.5, 0.5],
      [config.rent_growth_rate ?? 0.02, -0.5, 0.5],
      [config.construction_share_pct ?? 80, 0, 100],
      [config.building_fee_per_m2_monthly ?? 0, 0, 1000],
    ]
    if (ranges.some(([value, min, max]) => !Number.isFinite(value) || value < min || value > max) || !Number.isInteger(config.income_tax_table_year) || Number(config.income_tax_table_year) < 2026) {
      setMessage('Revisa los rangos de la configuración tributaria y de los costos')
      return
    }
    if (!(config.annual_maintenance >= 0 && config.annual_maintenance <= 5000)) {
      setMessage('Alícuota fuera de rango')
      return
    }
    const vacancyStored =
      Number(config.vacancy_rate) > 1
        ? Number(config.vacancy_rate) / 100
        : Number(config.vacancy_rate)
    if (!(vacancyStored >= 0 && vacancyStored <= 1)) {
      setMessage('Desocupación fuera de rango (0–100%)')
      return
    }
    const { error } = await supabase
      .from('financing_config')
      .update({
        annual_property_tax: Number(config.annual_property_tax),
        annual_maintenance: Number(config.annual_maintenance),
        vacancy_rate: vacancyStored,
        avg_one_bed_rent: Number(config.avg_one_bed_rent),
        avg_two_bed_rent: Number(config.avg_two_bed_rent),
        avg_three_bed_rent: Number(config.avg_three_bed_rent),
        disclaimer_text: config.disclaimer_text,
        default_tax_profile: config.default_tax_profile ?? '45_80',
        income_tax_brackets: brackets,
        income_tax_table_year: config.income_tax_table_year,
        company_income_tax_rate: config.company_income_tax_rate,
        management_fee_rate: config.management_fee_rate,
        acquisition_cost_pct: config.acquisition_cost_pct,
        acquisition_cost_fixed: config.acquisition_cost_fixed,
        sale_commission_pct: config.sale_commission_pct,
        default_appreciation_rate: config.default_appreciation_rate,
        rent_growth_rate: config.rent_growth_rate,
        rental_depreciation_enabled: config.rental_depreciation_enabled,
        construction_share_pct: config.construction_share_pct,
        building_fee_per_m2_monthly: config.building_fee_per_m2_monthly,
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)
    setMessage(error ? error.message : 'Configuración guardada')
    if (!error) void load()
  }

  if (roleLoading || !isAdmin || loading) {
    return (
      <div className={`flex items-center justify-center ${embedded ? 'min-h-[12vh]' : 'min-h-[40vh]'}`}>
        <Spinner size="lg" />
      </div>
    )
  }

  const partnersTable = (
    <div className="-mx-3 overflow-x-auto sm:mx-0">
      <table className="min-w-[520px] w-full text-sm sm:min-w-full">
        <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
          <tr>
            <th className="px-3 py-2.5">Banco</th>
            <th className="px-3 py-2.5">Tasa %</th>
            <th className="px-3 py-2.5">Activo</th>
            <th className="px-3 py-2.5">Recomendado</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.id} className="border-t border-[#f0ebe3]">
              <td className="px-3 py-2.5 font-medium">{partner.partner_name}</td>
              <td className="px-3 py-2.5">
                <input
                  type="number"
                  step={0.1}
                  min={5}
                  max={15}
                  value={partner.annual_interest_rate}
                  onChange={(event) =>
                    setPartners((prev) =>
                      prev.map((row) =>
                        row.id === partner.id
                          ? { ...row, annual_interest_rate: Number(event.target.value) }
                          : row,
                      ),
                    )
                  }
                  className="w-20 rounded-lg border border-[#e4ddd3] px-2 py-1 sm:w-24"
                />
              </td>
              <td className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(partner.active)}
                  onChange={(event) =>
                    setPartners((prev) =>
                      prev.map((row) =>
                        row.id === partner.id ? { ...row, active: event.target.checked } : row,
                      ),
                    )
                  }
                />
              </td>
              <td className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(partner.is_recommended)}
                  onChange={(event) =>
                    setPartners((prev) =>
                      prev.map((row) =>
                        row.id === partner.id
                          ? { ...row, is_recommended: event.target.checked }
                          : row,
                      ),
                    )
                  }
                />
              </td>
              <td className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => void savePartner(partner)}
                  className="text-[11px] font-semibold tracking-wide text-[#1a2744] uppercase"
                >
                  Guardar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const fieldClass = 'flex min-w-0 flex-col gap-1.5'
  const labelClass = 'text-[11px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase'
  const helpClass = 'min-h-[2.75rem] text-[11px] leading-snug text-[#8a8176]'
  const inputClass = 'h-10 w-full rounded-xl border border-[#e4ddd3] px-3 text-sm'

  const configForm = config ? (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className={fieldClass}>
        <span className={labelClass}>Impuesto predial (%)</span>
        <p className={helpClass}>Porcentaje sobre el avalúo catastral (COOTAD: máx. 0,5% + tasas)</p>
        <input
          type="number"
          step="any"
          min={0}
          max={0.6}
          value={Number(config.annual_property_tax ?? 0)}
          onChange={(event) =>
            setConfig({ ...config, annual_property_tax: Number(event.target.value) })
          }
          className={inputClass}
        />
      </label>
      {([
        ['building_fee_per_m2_monthly', 'Alícuota por m² ($/mes)', 0, 1000, 'Si la unidad no tiene alícuota propia'],
        ['management_fee_rate', 'Comisión del gestor (%)', 0, 100, 'Valor por defecto del simulador; el cliente puede desactivarlo'],
        ['acquisition_cost_pct', 'Costos de compra (%)', 0, 20, 'Alcabala y registro'],
        ['acquisition_cost_fixed', 'Costos de compra fijos ($)', 0, 100000, 'Notaría'],
        ['sale_commission_pct', 'Comisión de venta (%)', 0, 20, 'Costo al vender'],
        ['default_appreciation_rate', 'Apreciación anual (%)', -50, 50, 'Valor inicial del simulador'],
        ['rent_growth_rate', 'Crecimiento anual del arriendo (%)', -50, 50, 'Se aplica desde el segundo año'],
        ['construction_share_pct', 'Porción de construcción (%)', 0, 100, 'Para depreciación tributaria opcional'],
      ] as const).map(([key, label, min, max, help]) => {
        const isRate = key === 'management_fee_rate' || key === 'default_appreciation_rate' || key === 'rent_growth_rate'
        return <label key={key} className={fieldClass}>
          <span className={labelClass}>{t(label)}</span><p className={helpClass}>{t(help)}</p>
          <input type="number" step="any" min={min} max={max}
            value={key === 'building_fee_per_m2_monthly' && config[key] == null ? '' : Number(config[key] ?? 0) * (isRate ? 100 : 1)}
            onChange={(event) => setConfig({ ...config, [key]: key === 'building_fee_per_m2_monthly' && event.target.value === '' ? null : Number(event.target.value) / (isRate ? 100 : 1) })}
            className={inputClass} />
        </label>
      })}
      <label className={fieldClass}><span className={labelClass}>{t('Depreciación del arriendo')}</span><p className={helpClass}>{t('Aplicar solo si corresponde según el SRI')}</p>
        <input type="checkbox" checked={Boolean(config.rental_depreciation_enabled)} onChange={(event) => setConfig({ ...config, rental_depreciation_enabled: event.target.checked })} /></label>
      <div className="space-y-3 sm:col-span-2 xl:col-span-3">
        <h3 className={labelClass}>{t('Impuesto a la renta')}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={fieldClass}><span className={labelClass}>{t('Año de la tabla')}</span><input type="number" min={2026} step={1} value={config.income_tax_table_year ?? 2026} onChange={(e) => setConfig({ ...config, income_tax_table_year: Number(e.target.value) })} className={inputClass} /></label>
          <label className={fieldClass}><span className={labelClass}>{t('Tarifa empresas (%)')}</span><input type="number" min={0} max={100} step="any" value={Number(config.company_income_tax_rate ?? 0.25) * 100} onChange={(e) => setConfig({ ...config, company_income_tax_rate: Number(e.target.value) / 100 })} className={inputClass} /></label>
          <label className={fieldClass}><span className={labelClass}>{t('Perfil inicial')}</span><select value={config.default_tax_profile ?? '45_80'} onChange={(e) => { if (isTaxProfile(e.target.value)) setConfig({ ...config, default_tax_profile: e.target.value as TaxProfile }) }} className={inputClass}>{([['none_other','Solo este arriendo'],['lt12','Menos de $12.000 al año'],['12_25','$12.000 – $25.000'],['25_45','$25.000 – $45.000'],['45_80','$45.000 – $80.000'],['80_120','$80.000 – $120.000'],['gt120','Más de $120.000'],['company','Compro como empresa']] as const).map(([profile, label]) => <option key={profile} value={profile}>{t(label)}</option>)}</select></label>
        </div>
        <p className={helpClass}>{t('Actualizar cada enero con la resolución del SRI')}</p>
        {Number(config.income_tax_table_year) < new Date().getFullYear() ? <p className="rounded border-l-[3px] border-[#c4a574] bg-[#faf3e8] px-3 py-3 text-[12px] text-[#7a5c2e]">{t('La tabla del IR es de ')}{config.income_tax_table_year}{t('; revisa si el SRI publicó una nueva')}</p> : null}
        <div className="max-w-full overflow-x-auto"><table className="min-w-[620px] w-full text-sm"><thead><tr className="text-left"><th>{t('Desde')}</th><th>{t('Hasta')}</th><th>{t('Impuesto fracción básica')}</th><th>{t('% excedente')}</th><th /></tr></thead><tbody>{(config.income_tax_brackets ?? SRI_PERSONAL_INCOME_TAX_TABLE_2026).map((bracket, index, all) => <tr key={index} className="border-t border-[#f0ebe3]">{(['from','to','baseTax','rate'] as const).map((key) => <td key={key} className="py-1 pr-2"><input type="number" min={0} step="any" placeholder={key === 'to' && index === all.length - 1 ? t('en adelante') : ''} value={key === 'to' && bracket.to == null ? '' : key === 'rate' ? bracket.rate * 100 : bracket[key] ?? ''} onChange={(e) => { const next = [...all]; next[index] = { ...bracket, [key]: key === 'to' && e.target.value === '' ? null : Number(e.target.value) / (key === 'rate' ? 100 : 1) }; setConfig({ ...config, income_tax_brackets: next }) }} className={inputClass} /></td>)}<td><button type="button" onClick={() => setConfig({ ...config, income_tax_brackets: all.filter((_, i) => i !== index) })}>{t('Quitar')}</button></td></tr>)}</tbody></table></div>
        <button type="button" onClick={() => setConfig({ ...config, income_tax_brackets: [...(config.income_tax_brackets ?? SRI_PERSONAL_INCOME_TAX_TABLE_2026), { from: 0, to: null, baseTax: 0, rate: 0 }] })} className="text-sm font-medium text-[#1a2744]">{t('Agregar tramo')}</button>
      </div>
      <label className={fieldClass}>
        <span className={labelClass}>Alícuota del edificio ($/año)</span>
        <p className={helpClass}>Administración y mantenimiento de áreas comunes</p>
        <input
          type="number"
          step="any"
          min={0}
          max={5000}
          value={Number(config.annual_maintenance ?? 0)}
          onChange={(event) =>
            setConfig({ ...config, annual_maintenance: Number(event.target.value) })
          }
          className={inputClass}
        />
      </label>
      <label className={fieldClass}>
        <span className={labelClass}>Sin inquilino (%)</span>
        <p className={helpClass}>Porcentaje estimado de vacancia (ej. 5 → 0,05 interno)</p>
        <input
          type="number"
          step={0.5}
          min={0}
          max={100}
          value={Math.round(Number(config.vacancy_rate ?? 0) * 1000) / 10}
          onChange={(event) => {
            const pct = Number(event.target.value)
            setConfig({
              ...config,
              vacancy_rate: Number.isFinite(pct) ? pct / 100 : config.vacancy_rate,
            })
          }}
          className={inputClass}
        />
      </label>
      {(
        [
          ['avg_one_bed_rent', 'Alquiler 1 dormitorio'],
          ['avg_two_bed_rent', 'Alquiler 2 dormitorios'],
          ['avg_three_bed_rent', 'Alquiler 3 o más'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className={fieldClass}>
          <span className={labelClass}>{label}</span>
          <p className={helpClass}>Referencia mensual sugerida en el simulador</p>
          <input
            type="number"
            step="any"
            min={0}
            value={Number(config[key] ?? 0)}
            onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })}
            className={inputClass}
          />
        </label>
      ))}
      <p className="rounded-xl bg-[#f7f3ee] px-3 py-2.5 text-[11px] leading-snug text-[#6b645c] sm:col-span-2 xl:col-span-3">
        Los gastos de la propiedad incluyen impuesto predial y alícuota. No incluyen seguros ni otros
        gastos adicionales en el simulador.
      </p>
      <label className={`${fieldClass} sm:col-span-2 xl:col-span-3`}>
        <span className={labelClass}>Disclaimer</span>
        <textarea
          value={config.disclaimer_text ?? ''}
          onChange={(event) => setConfig({ ...config, disclaimer_text: event.target.value })}
          rows={3}
          className="min-h-[5.5rem] w-full rounded-xl border border-[#e4ddd3] px-3 py-2 text-sm"
        />
      </label>
      <div className="sm:col-span-2 xl:col-span-3">
        <button
          type="button"
          onClick={() => void saveConfig()}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase sm:w-auto"
        >
          Guardar configuración
        </button>
      </div>
    </div>
  ) : (
    <p className="text-sm text-[#6b645c]">No hay financing_config para el proyecto.</p>
  )

  if (showAll) {
    return (
      <div className="grid gap-4 sm:gap-6">
        {message ? <p className="text-sm text-[#4a433c]">{t(message)}</p> : null}
        <SectionShell title="Bancos">{partnersTable}</SectionShell>
        <SectionShell title="Configuración">{configForm}</SectionShell>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader title="Simulador · Ajustes" description="Tasas de bancos y costos globales del proyecto." />
      ) : null}
      {showInternalTabs ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('partners')}
            className={`rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${
              activeTab === 'partners' ? 'bg-[#1a2744] text-white' : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3]'
            }`}
          >
            Bancos
          </button>
          <button
            type="button"
            onClick={() => setTab('config')}
            className={`rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${
              activeTab === 'config' ? 'bg-[#1a2744] text-white' : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3]'
            }`}
          >
            Configuración
          </button>
        </div>
      ) : null}

      {message ? <p className="text-sm text-[#4a433c]">{t(message)}</p> : null}

      {showPartners ? (
        embedded ? (
          <SectionShell title="Bancos">{partnersTable}</SectionShell>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">{partnersTable}</div>
        )
      ) : null}

      {showConfig ? (
        embedded ? (
          <SectionShell title="Configuración">{configForm}</SectionShell>
        ) : (
          <div className="rounded-2xl border border-[#ece6dc] bg-white p-4 sm:p-5">{configForm}</div>
        )
      ) : null}
    </div>
  )
}

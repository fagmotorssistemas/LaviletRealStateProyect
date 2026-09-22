'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingConfig, FinancingPartner } from '@/types/financingSimulator'
import { FINANCING_PROJECT_ID } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

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
    if (!(config.annual_property_tax >= 0 && config.annual_property_tax <= 10)) {
      setMessage('Impuesto fuera de rango (0–10%)')
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
        <p className={helpClass}>Pago único anual al Municipio por la propiedad</p>
        <input
          type="number"
          step="any"
          min={0}
          max={10}
          value={Number(config.annual_property_tax ?? 0)}
          onChange={(event) =>
            setConfig({ ...config, annual_property_tax: Number(event.target.value) })
          }
          className={inputClass}
        />
      </label>
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
        {message ? <p className="text-sm text-[#4a433c]">{message}</p> : null}
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

      {message ? <p className="text-sm text-[#4a433c]">{message}</p> : null}

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

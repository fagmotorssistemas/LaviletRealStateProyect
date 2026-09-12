'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingConfig, FinancingPartner } from '@/types/financingSimulator'
import { FINANCING_PROJECT_ID } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

export function FinancingSettingsView({ embedded = false }: { embedded?: boolean }) {
  const { supabase } = useAuth()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [tab, setTab] = useState<'partners' | 'config'>('partners')
  const [partners, setPartners] = useState<FinancingPartner[]>([])
  const [config, setConfig] = useState<FinancingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

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
      setMessage('Mantenimiento fuera de rango')
      return
    }
    const { error } = await supabase
      .from('financing_config')
      .update({
        annual_property_tax: Number(config.annual_property_tax),
        annual_maintenance: Number(config.annual_maintenance),
        annual_insurance: Number(config.annual_insurance),
        vacancy_rate: Number(config.vacancy_rate),
        avg_studio_rent: Number(config.avg_studio_rent),
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
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader title="Simulador · Ajustes" description="Tasas de bancos y costos globales del proyecto." />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('partners')}
          className={`rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${
            tab === 'partners' ? 'bg-[#1a2744] text-white' : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3]'
          }`}
        >
          Bancos
        </button>
        <button
          type="button"
          onClick={() => setTab('config')}
          className={`rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase ${
            tab === 'config' ? 'bg-[#1a2744] text-white' : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3]'
          }`}
        >
          Configuración
        </button>
      </div>

      {message ? <p className="text-sm text-[#4a433c]">{message}</p> : null}

      {tab === 'partners' ? (
        <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">
          <table className="min-w-full text-sm">
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
                      className="w-24 rounded-lg border border-[#e4ddd3] px-2 py-1"
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
      ) : config ? (
        <div className="grid max-w-2xl gap-4 rounded-2xl border border-[#ece6dc] bg-white p-5">
          {(
            [
              ['annual_property_tax', 'Impuesto predial (%)'],
              ['annual_maintenance', 'Mantenimiento anual ($)'],
              ['annual_insurance', 'Seguro anual ($)'],
              ['vacancy_rate', 'Desocupación (0–1)'],
              ['avg_studio_rent', 'Alquiler studio'],
              ['avg_one_bed_rent', 'Alquiler 1 dorm'],
              ['avg_two_bed_rent', 'Alquiler 2 dorm'],
              ['avg_three_bed_rent', 'Alquiler 3 dorm'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="grid gap-1 text-sm">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
                {label}
              </span>
              <input
                type="number"
                step="any"
                value={Number(config[key] ?? 0)}
                onChange={(event) =>
                  setConfig({ ...config, [key]: Number(event.target.value) })
                }
                className="rounded-xl border border-[#e4ddd3] px-3 py-2"
              />
            </label>
          ))}
          <label className="grid gap-1 text-sm">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
              Disclaimer
            </span>
            <textarea
              value={config.disclaimer_text ?? ''}
              onChange={(event) => setConfig({ ...config, disclaimer_text: event.target.value })}
              rows={3}
              className="rounded-xl border border-[#e4ddd3] px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveConfig()}
            className="inline-flex h-11 w-fit items-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase"
          >
            Guardar configuración
          </button>
        </div>
      ) : (
        <p className="text-sm text-[#6b645c]">No hay financing_config para el proyecto.</p>
      )}
    </div>
  )
}

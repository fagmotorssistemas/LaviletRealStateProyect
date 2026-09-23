'use client'

import { MetricHelp } from './MetricHelp'
import { labelMetaActionType } from '@/lib/meta/metaAdsActions'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Megaphone,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'
import {
  assignPromotedUnitAction,
  clearPromotedUnitsAction,
  listFunnelLeadDetails,
  type AdsConnectionProbe,
  type FunnelLeadDetailRow,
} from '@/app/inmobiliaria/marketing/metricas/actions'
import { cn } from '@/lib/utils'
import type { TeamProfile } from '@/types/inmobiliaria'
import type {
  AttributedAdFunnelRow,
  MarketingFunnelReport,
  PromotedUnitFunnelRow,
} from '@/services/marketingFunnel.service'

function formatAmount(value: number | null | undefined, currency?: string | null) {
  if (value == null) return 'No disponible'
  const code = (currency || 'USD').trim().toUpperCase() || 'USD'
  try {
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: /^[A-Z]{3}$/.test(code) ? code : 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value} ${code}`
  }
}

function formatFetchedAt(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('es-EC', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Guayaquil',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function TempInline({
  temperature,
}: {
  temperature: MarketingFunnelReport['totals']['temperature']
}) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 tabular-nums text-[#6b645c]">
      <span>Fríos: {temperature.frio}</span>
      <span>Tibios: {temperature.tibio}</span>
      <span>Calientes: {temperature.caliente}</span>
      <span>Sin clasificar: {temperature.sin_clasificar}</span>
    </span>
  )
}

function adLabel(row: AttributedAdFunnelRow) {
  const sourceId = row.adId || row.attributionKey || 'sin_id'
  const adName = row.adName?.trim()
  const campaign = row.campaignName?.trim()
  const parts = [
    adName ? `Anuncio ${adName}` : `Anuncio ${sourceId}`,
    campaign ? `Campaña ${campaign}` : null,
    row.adsetName ? `Conjunto ${row.adsetName}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

function resolutionStatusLabel(
  status: AttributedAdFunnelRow['resolutionStatus'],
): string {
  if (status === 'missing_ads_token') return 'Datos publicitarios no disponibles'
  if (status === 'graph_permission_denied') return 'Sin permiso para consultar los anuncios'
  if (status === 'not_found') return 'Anuncio no encontrado'
  if (status === 'resolved') return 'Identificado'
  return 'Sin identificar'
}

function spendReportedLabel(row: AttributedAdFunnelRow): string {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  if (row.adSpend == null) return 'No disponible'
  const base = formatAmount(row.adSpend, row.currency)
  return row.spendStale ? `${base} (último dato guardado)` : base
}

function cplLabel(row: {
  costPerLead: number | null
  currency?: string | null
}): string {
  if (row.costPerLead == null) return 'No disponible'
  return formatAmount(row.costPerLead, row.currency)
}

function metaResultDisplay(row: AttributedAdFunnelRow): string {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  if (row.metaReportedResults == null) return 'No disponible'
  const label = row.metaResultActionType ? labelMetaActionType(row.metaResultActionType) : 'Resultado sin tipo identificado'
  if (label) return `${label}: ${row.metaReportedResults}`
  return String(row.metaReportedResults)
}

type AdsInsightsBanner = {
  connected: boolean
  message: string
  note: string
  missing?: string[]
  currency?: string | null
  timezone?: string | null
  fetchedAt?: string | null
  adAccountId?: string
  liveVerified?: boolean
  error?: string | null
}

export function MarketingCommercialBoard({
  report,
  adsInsights,
  adsProbe,
}: {
  report: MarketingFunnelReport
  adsInsights?: AdsInsightsBanner | null
  adsProbe?: AdsConnectionProbe | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [filterCampaignId, setFilterCampaignId] = useState('')
  const [filterAdId, setFilterAdId] = useState('')
  const [filterUnitId, setFilterUnitId] = useState('')
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    () => new Set(),
  )

  const [assignAdId, setAssignAdId] = useState<string | null>(null)
  const [externalLabel, setExternalLabel] = useState('')

  const [leadPanelOpen, setLeadPanelOpen] = useState(false)
  const [leadPanelTitle, setLeadPanelTitle] = useState('')
  const [leadRows, setLeadRows] = useState<FunnelLeadDetailRow[]>([])
  const [leadLoading, setLeadLoading] = useState(false)
  const [leadError, setLeadError] = useState<string | null>(null)

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])

  const coverage = report.adsInsightsCoverage
  const insightsFetchedLabel = formatFetchedAt(
    coverage.insightsFetchedAt ||
      adsProbe?.fetchedAt ||
      adsInsights?.fetchedAt,
  )

  const filteredAds = useMemo(() => {
    return report.byAttributedAd.filter((row) => {
      if (filterCampaignId && row.campaignId !== filterCampaignId) return false
      if (filterAdId) {
        const q = filterAdId.trim().toLowerCase()
        const hay = `${row.adId || ''} ${row.adName || ''} ${row.attributionKey}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filterUnitId) {
        const uid = filterUnitId.trim()
        const match =
          row.promotedUnit.unambiguousUnitId === uid ||
          row.promotedUnit.links.some((l) => l.unitId === uid) ||
          row.promotedUnit.label.toLowerCase().includes(uid.toLowerCase())
        if (!match) return false
      }
      return true
    })
  }, [report.byAttributedAd, filterCampaignId, filterAdId, filterUnitId])

  const filteredCampaigns = useMemo(() => {
    const allowed = new Set(
      filteredAds.map((a) => a.campaignId).filter(Boolean) as string[],
    )
    return report.byCampaign.filter((c) => {
      if (filterCampaignId && c.campaignId !== filterCampaignId) return false
      if (filterAdId || filterUnitId) return allowed.has(c.campaignId)
      return true
    })
  }, [
    report.byCampaign,
    filteredAds,
    filterCampaignId,
    filterAdId,
    filterUnitId,
  ])

  const filteredPromoted = useMemo(() => {
    return report.byPromotedUnit.filter((row) => {
      if (filterUnitId) {
        const uid = filterUnitId.trim().toLowerCase()
        const match =
          (row.unitId && row.unitId === filterUnitId.trim()) ||
          row.unitLabel.toLowerCase().includes(uid)
        if (!match) return false
      }
      if (filterCampaignId || filterAdId) {
        const ads = filteredAds.filter(
          (a) => a.adId && row.adIds.includes(a.adId),
        )
        if (!ads.length) return false
      }
      return true
    })
  }, [
    report.byPromotedUnit,
    filteredAds,
    filterUnitId,
    filterCampaignId,
    filterAdId,
  ])

  const campaignOptions = useMemo(() => {
    return report.byCampaign.map((c) => ({
      id: c.campaignId,
      label: c.campaignName || c.campaignId,
    }))
  }, [report.byCampaign])

  function toggleCampaign(id: string) {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function openLeadsForAd(row: AttributedAdFunnelRow) {
    if (!row.leadIds.length) {
      toast.message('Sin contactos registrados en este anuncio')
      return
    }
    setLeadPanelTitle(adLabel(row))
    setLeadPanelOpen(true)
    setLeadLoading(true)
    setLeadError(null)
    setLeadRows([])

    const attributionByLeadId: Record<
      string,
      {
        attributedAdId?: string | null
        campaignId?: string | null
        campaignName?: string | null
      }
    > = {}
    for (const id of row.leadIds) {
      attributionByLeadId[id] = {
        attributedAdId: row.adId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
      }
    }

    const result = await listFunnelLeadDetails({
      leadIds: row.leadIds,
      tenantId: report.tenantId,
      projectId: report.projectId,
      attributionByLeadId,
    })
    setLeadLoading(false)
    if (!result.ok) {
      setLeadError(result.error)
      return
    }
    setLeadRows(result.rows)
  }

  async function openLeadDetail(leadId: string) {
    if (!advisors.length) {
      try {
        const list = await listTeamProfilesAction()
        setAdvisors(list)
      } catch {
        setAdvisors([])
      }
    }
    setDetailLeadId(leadId)
    setDetailOpen(true)
  }

  function refreshReport() {
    startTransition(() => {
      router.refresh()
    })
  }

  async function handleAssignUnit(unitId: string) {
    if (!assignAdId) return
    const result = await assignPromotedUnitAction({
      adId: assignAdId,
      unitId,
      projectId: report.projectId,
      tenantId: report.tenantId,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Unidad asignada al anuncio')
    setAssignAdId(null)
    setExternalLabel('')
    refreshReport()
  }

  async function handleAssignExternal() {
    if (!assignAdId || !externalLabel.trim()) return
    const result = await assignPromotedUnitAction({
      adId: assignAdId,
      externalLabel: externalLabel.trim(),
      projectId: report.projectId,
      tenantId: report.tenantId,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Etiqueta externa asignada')
    setAssignAdId(null)
    setExternalLabel('')
    refreshReport()
  }

  async function handleClearUnits(adId: string) {
    const result = await clearPromotedUnitsAction({
      adId,
      projectId: report.projectId,
      tenantId: report.tenantId,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(
      result.superseded
        ? `Se limpiaron ${result.superseded} vínculo(s)`
        : 'Sin vínculos vigentes',
    )
    setAssignAdId(null)
    refreshReport()
  }

  const bannerConnected = adsProbe?.connected ?? adsInsights?.connected
  const bannerCurrency =
    adsProbe?.currency ||
    adsInsights?.currency ||
    report.adsAccount?.currency ||
    coverage.accountAdSpendCurrency
  const bannerTz =
    adsProbe?.timezone ||
    adsInsights?.timezone ||
    report.adsAccountTimezone ||
    report.adsAccount?.timezoneName

  return (
    <div className="space-y-6">
      {/* Banner Ads */}
      <div
        className={cn(
          'rounded-2xl border px-4 py-3 text-sm',
          bannerConnected
            ? 'border-[#ece6dc] bg-[#faf8f5] text-[#5c5348]'
            : 'border-[#e8d9c4] bg-[#fff8ef] text-[#5c5348]',
        )}
      >
        <p className="font-semibold text-[#1f1a14]">
          {bannerConnected ? 'Datos de publicidad conectados con Meta' : 'Datos publicitarios no disponibles'}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#8a8176]">
          Los contactos registrados y los resultados que cuenta Meta son medidas diferentes.
          {bannerCurrency ? ` · Moneda ${bannerCurrency}` : ''}
          {bannerTz ? ` · Zona horaria ${bannerTz}` : ''}
          {adsProbe?.adAccountId || adsInsights?.adAccountId
            ? ` · ${adsProbe?.adAccountId || adsInsights?.adAccountId}`
            : ''}
          {insightsFetchedLabel
            ? ` · Última consulta ${insightsFetchedLabel}`
            : ''}
        </p>
        {coverage.insightsIncomplete ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            No se pudieron consultar todos los anuncios. Puede faltar información de gasto o resultados.
          </p>
        ) : null}
        {coverage.currencyStatus === 'unknown' ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            No se pudo actualizar la moneda de la cuenta. Los datos guardados conservan la moneda de la última consulta.
          </p>
        ) : null}
        {adsInsights?.missing?.length ? (
          <p className="mt-2 text-[11px] text-[#8a8176]">
            La conexión con Meta necesita configuración. Contacta al administrador.
          </p>
        ) : null}
        {!bannerConnected && adsProbe?.error ? (
          <p className="mt-2 text-[11px] text-amber-900">
            No se pudo verificar la conexión con Meta. Inténtalo de nuevo más tarde.
          </p>
        ) : null}
      </div>

      {/* Filtros cliente */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#ece6dc] bg-white p-4">
        <label className="flex min-w-[10rem] flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
          Campaña
          <select
            value={filterCampaignId}
            onChange={(e) => setFilterCampaignId(e.target.value)}
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          >
            <option value="">Todas</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
          Anuncio
          <input
            type="search"
            value={filterAdId}
            onChange={(e) => setFilterAdId(e.target.value)}
            placeholder="id o nombre"
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          />
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
          Unidad
          <input
            type="search"
            value={filterUnitId}
            onChange={(e) => setFilterUnitId(e.target.value)}
            placeholder="id o etiqueta"
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          />
        </label>
        {(filterCampaignId || filterAdId || filterUnitId) && (
          <button
            type="button"
            onClick={() => {
              setFilterCampaignId('')
              setFilterAdId('')
              setFilterUnitId('')
            }}
            className="rounded-xl border border-[#ece6dc] px-3 py-2 text-sm text-[#5c5348]"
          >
            Limpiar filtros
          </button>
        )}
        {pending ? (
          <span className="text-[11px] text-[#8a8176]">Actualizando…</span>
        ) : null}
      </div>

      {/* Por campaña */}
      <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[#1f1a14]">Por campaña</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8a8176]">
            Abre una campaña para ver sus anuncios. Dinero gastado de
            Meta; el presupuesto no se interpreta como gasto. Costo promedio por contacto = gasto ÷
            contactos registrados únicos.
          </p>
        </div>
        {filteredCampaigns.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="Sin campañas identificadas"
            description="Revisa los filtros y la conexión con Meta para consultar las campañas."
          />
        ) : (
          <ul className="space-y-2">
            {filteredCampaigns.map((camp) => {
              const open = expandedCampaigns.has(camp.campaignId)
              const adsInCampaign = filteredAds.filter(
                (a) => a.campaignId === camp.campaignId,
              )
              return (
                <li
                  key={camp.campaignId}
                  className="overflow-hidden rounded-xl border border-[#ece6dc]"
                >
                  <button
                    type="button"
                    onClick={() => toggleCampaign(camp.campaignId)}
                    className="flex w-full items-start gap-2 bg-[#faf8f5] px-3 py-2.5 text-left"
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[#8a8176]" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#8a8176]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1f1a14]">
                        {camp.campaignName || `Campaña ${camp.campaignId}`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#8a8176]">
                        Campaña {camp.campaignId} · {camp.adCount} anuncios ·{' '}
                        {camp.leadsUnique} contactos registrados
                        {camp.currency ? ` · ${camp.currency}` : ''}
                        {camp.spendStale ? ' · último dato guardado' : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[11px] tabular-nums text-[#6b645c]">
                      <div>
                        Dinero gastado:{' '}
                        {camp.adSpend == null
                          ? 'No disponible'
                          : formatAmount(camp.adSpend, camp.currency)}
                      </div>
                      <div>
                        Gasto de sus anuncios:{' '}
                        {camp.adSpendSum == null
                          ? 'No disponible'
                          : formatAmount(camp.adSpendSum, camp.currency)}
                      </div>
                      <div className={camp.spendCoherent === false ? 'text-amber-800' : ''}>
                        Comparación de gastos:{' '}
                        {camp.spendCoherent == null
                          ? camp.campaignInsightsSpend != null && !camp.spendComparisonCurrency
                            ? 'No comparable: moneda distinta o faltante'
                            : 'Pendiente'
                          : camp.spendCoherent
                            ? 'Coinciden'
                            : `Diferencia ${formatAmount(camp.spendDelta, camp.currency)}`}
                      </div>
                      <div title="Gasto dividido entre contactos únicos de la campaña. Es un promedio, no un costo individual.">Costo promedio por contacto: {cplLabel(camp)}</div>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t border-[#ece6dc] p-2">
                      {adsInCampaign.length === 0 ? (
                        <p className="px-2 py-3 text-[12px] text-[#8a8176]">
                          Sin anuncios en el filtro actual.
                        </p>
                      ) : (
                        <AdRowsTable
                          rows={adsInCampaign}
                          onOpenLeads={openLeadsForAd}
                          onAssign={(adId) => {
                            setAssignAdId(adId)
                            setExternalLabel('')
                          }}
                          onClear={handleClearUnits}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Todos los anuncios (si no hay campaña o insights-only) */}
      <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[#1f1a14]">
            Por anuncio
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8a8176]">
            Consulta el gasto de cada anuncio y los contactos que tiene asociados. El costo por contacto es un promedio, no un cobro individual. Los resultados de Meta pueden ser conversaciones, clics u otras acciones; no equivalen necesariamente a personas nuevas.
          </p>
        </div>
        {filteredAds.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Sin anuncios"
            description="No hay filas con el filtro actual."
          />
        ) : (
          <AdRowsTable
            rows={filteredAds}
            onOpenLeads={openLeadsForAd}
            onAssign={(adId) => {
              setAssignAdId(adId)
              setExternalLabel('')
            }}
            onClear={handleClearUnits}
          />
        )}
      </section>

      {/* Por inmueble anunciado */}
      <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[#1f1a14]">
            Por inmueble anunciado
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8a8176]">
            Se suma el gasto de los anuncios asignados a un solo inmueble. Si un anuncio muestra varios inmuebles, no se divide su gasto entre ellos. Puedes asignarlos desde cada anuncio.
          </p>
        </div>
        {filteredPromoted.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="Sin unidades promocionadas"
            description="Asigna un inmueble a cada anuncio para consultar su gasto acumulado."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
                <tr>
                  <th className="px-2 py-2 font-semibold">Unidad</th>
                  <th className="px-2 py-2 font-semibold">Anuncios</th>
                  <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Personas asociadas al anuncio, contadas una vez dentro de la fila. Pulsa el número del anuncio para ver sus fichas.">Contactos registrados</MetricHelp></th>
                  <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Clasificación guardada de los contactos: fríos, tibios, calientes o sin clasificar. No representa ventas confirmadas.">Nivel de interés</MetricHelp></th>
                  <th className="px-2 py-2 font-semibold">
                    Gasto reportado por Meta
                  </th>
                  <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Dinero gastado dividido entre los contactos únicos asociados. Por ejemplo: $20 entre 10 contactos son $2 por contacto. Es un promedio; no indica el costo exacto de una persona. Si faltan datos o no hay contactos, no se calcula.">Costo promedio por contacto</MetricHelp></th>
                  <th className="px-2 py-2 font-semibold">Citas confirmadas / realizadas</th>
                  <th className="px-2 py-2 font-semibold">Ventas</th>
                </tr>
              </thead>
              <tbody>
                {filteredPromoted.map((row: PromotedUnitFunnelRow) => (
                  <tr
                    key={row.unitId || row.unitLabel}
                    className="border-b border-[#f0ebe3] align-top"
                  >
                    <td className="px-2 py-2 font-medium text-[#1f1a14]">
                      {row.unitLabel}
                      {row.note ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-[#8a8176]">
                          {row.note}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{row.adCount}</td>
                    <td className="px-2 py-2 tabular-nums">{row.leadsUnique}</td>
                    <td className="px-2 py-2">
                      <TempInline temperature={row.temperature} />
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.adSpend == null
                        ? 'No disponible'
                        : formatAmount(row.adSpend, row.currency)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{cplLabel(row)}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.leadsWithAppointmentConfirmed} /{' '}
                      {row.leadsWithAppointmentDone}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.salesConfirmed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal asignar unidad */}
      {assignAdId ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-[#ece6dc] bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#1f1a14]">
                  Asignar unidad al anuncio
                </h3>
                <p className="mt-0.5 text-[11px] text-[#8a8176]">
                  ad {assignAdId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignAdId(null)}
                className="rounded-lg p-1 text-[#8a8176] hover:bg-[#faf8f5]"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <UnitNumberSearchInput
              tenantId={report.tenantId}
              projectId={report.projectId}
              onSelect={(unit) => handleAssignUnit(unit.id)}
              placeholder="Buscar unidad del proyecto…"
              autoFocus
            />
            <div className="mt-3 border-t border-[#ece6dc] pt-3">
              <label className="flex flex-col gap-1 text-[11px] font-semibold tracking-[0.08em] text-[#8a8176] uppercase">
                O escribe un nombre para identificarlo
                <input
                  value={externalLabel}
                  onChange={(e) => setExternalLabel(e.target.value)}
                  placeholder="Ej. Torre B · tipo A"
                  className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!externalLabel.trim()}
                  onClick={handleAssignExternal}
                  className="rounded-xl bg-[#2B1A18] px-3 py-2 text-sm font-semibold text-[#f7f2ea] disabled:opacity-40"
                >
                  Guardar etiqueta
                </button>
                <button
                  type="button"
                  onClick={() => handleClearUnits(assignAdId)}
                  className="rounded-xl border border-[#ece6dc] px-3 py-2 text-sm text-[#5c5348]"
                >
                  Quitar asignaciones
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Panel leads */}
      {leadPanelOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="flex h-full w-full max-w-md flex-col border-l border-[#ece6dc] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-2 border-b border-[#ece6dc] px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#1f1a14]">
                  Contactos del anuncio
                </h3>
                <p className="mt-0.5 truncate text-[11px] text-[#8a8176]">
                  {leadPanelTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLeadPanelOpen(false)}
                className="rounded-lg p-1 text-[#8a8176] hover:bg-[#faf8f5]"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {leadLoading ? (
                <p className="text-[12px] text-[#8a8176]">Cargando…</p>
              ) : null}
              {leadError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                  {leadError}
                </p>
              ) : null}
              {!leadLoading && !leadError && leadRows.length === 0 ? (
                <p className="text-[12px] text-[#8a8176]">Sin contactos.</p>
              ) : null}
              <ul className="space-y-2">
                {leadRows.map((lead) => (
                  <li
                    key={lead.id}
                    className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2"
                  >
                    <p className="text-sm font-medium text-[#1f1a14]">
                      {lead.name || 'Sin nombre'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#8a8176]">
                      {lead.phone || 'Sin teléfono'} · {lead.status || '—'} ·{' '}
                      {lead.temperature || 'Sin clasificar'}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[#8a8176]">
                      {lead.advisorName
                        ? `Asesor: ${lead.advisorName}`
                        : 'Sin asesor'}
                      {lead.created_at
                        ? ` · ${formatFetchedAt(lead.created_at)}`
                        : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => openLeadDetail(lead.id)}
                      className="mt-2 text-[12px] font-semibold text-[#5b4a9a] underline-offset-2 hover:underline"
                    >
                      Abrir ficha
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <LeadDetailModal
        leadId={detailLeadId}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          setDetailLeadId(null)
        }}
        onUpdated={() => {
          /* drill-down solo lectura; no mutamos el informe aquí */
        }}
        tenantId={report.tenantId}
        advisors={advisors}
      />
    </div>
  )
}

function AdRowsTable({
  rows,
  onOpenLeads,
  onAssign,
  onClear,
}: {
  rows: AttributedAdFunnelRow[]
  onOpenLeads: (row: AttributedAdFunnelRow) => void
  onAssign: (adId: string) => void
  onClear: (adId: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[11px]">
        <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
          <tr>
            <th className="px-2 py-2 font-semibold">Anuncio</th>
            <th className="px-2 py-2 font-semibold">Inmueble anunciado</th>
            <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Personas asociadas al anuncio, contadas una vez dentro de la fila. Pulsa el número del anuncio para ver sus fichas.">Contactos registrados</MetricHelp></th>
            <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Clasificación guardada de los contactos: fríos, tibios, calientes o sin clasificar. No representa ventas confirmadas.">Nivel de interés</MetricHelp></th>
            <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Dinero que Meta informa como gastado durante las fechas seleccionadas. No es el presupuesto que planificaste invertir.">Gasto reportado por Meta</MetricHelp></th>
            <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Dinero gastado dividido entre los contactos únicos asociados. Por ejemplo: $20 entre 10 contactos son $2 por contacto. Es un promedio; no indica el costo exacto de una persona. Si faltan datos o no hay contactos, no se calcula.">Costo promedio por contacto</MetricHelp></th>
            <th className="px-2 py-2 font-semibold"><MetricHelp explanation="Cantidad de la acción indicada junto al número, según Meta. Una conversación o un clic no equivale necesariamente a un contacto nuevo.">Resultado Meta</MetricHelp></th>
            <th className="px-2 py-2 font-semibold">Citas</th>
            <th className="px-2 py-2 font-semibold">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.attributionKey}
              className={cn(
                'border-b border-[#f0ebe3] align-top',
                row.insightsOnly && 'bg-[#faf8f5]',
              )}
            >
              <td className="max-w-[16rem] px-2 py-2 text-[#1f1a14]">
                <span className="font-medium">{adLabel(row)}</span>
                <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                  {row.adId ? `Anuncio ${row.adId}` : 'Sin anuncio de origen registrado'}
                  {row.campaignId ? ` · Campaña ${row.campaignId}` : ''}
                  {' · '}
                  {resolutionStatusLabel(row.resolutionStatus)}
                  {row.insightsOnly ? ' · sin contactos asociados' : ''}
                  {row.spendStale ? ' · último dato guardado' : ''}
                </span>
              </td>
              <td className="px-2 py-2">
                <span className="text-[#1f1a14]">
                  {row.promotedUnit?.label || 'Unidad no asignada'}
                </span>
                {row.adId ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => onAssign(row.adId!)}
                      className="rounded-lg border border-[#ece6dc] px-2 py-0.5 text-[10px] font-semibold text-[#5c5348] hover:bg-[#faf8f5]"
                    >
                      Asignar
                    </button>
                    {row.promotedUnit?.kind !== 'none' ? (
                      <button
                        type="button"
                        onClick={() => onClear(row.adId!)}
                        className="rounded-lg border border-[#ece6dc] px-2 py-0.5 text-[10px] text-[#8a8176] hover:bg-[#faf8f5]"
                      >
                        Limpiar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td className="px-2 py-2 tabular-nums">
                {row.leadsUnique > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenLeads(row)}
                    className="font-semibold text-[#5b4a9a] underline-offset-2 hover:underline"
                  >
                    {row.leadsUnique}
                  </button>
                ) : (
                  row.leadsUnique
                )}
              </td>
              <td className="px-2 py-2">
                <TempInline temperature={row.temperature} />
              </td>
              <td className="px-2 py-2 tabular-nums">
                {spendReportedLabel(row)}
              </td>
              <td className="px-2 py-2 tabular-nums">{cplLabel(row)}</td>
              <td className="max-w-[10rem] px-2 py-2 tabular-nums">
                {metaResultDisplay(row)}
              </td>
              <td className="px-2 py-2 tabular-nums text-[#6b645c]">
                Solicitadas: {row.leadsWithAppointmentRequested} · Confirmadas:
                {row.leadsWithAppointmentConfirmed} · Realizadas:
                {row.leadsWithAppointmentDone}
              </td>
              <td className="px-2 py-2 tabular-nums">{row.salesConfirmed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

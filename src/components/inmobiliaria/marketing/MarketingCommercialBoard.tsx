'use client'

import { MetricHelp } from './AccessibleMetricHelp'
import { MarketingInterestBreakdown } from './MarketingInterestBreakdown'
import type { InterestEvidence } from '@/services/marketingInterest.logic'
import { metricDescriptions } from './metricDescriptions'
import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { MarketingAttentionSummary } from './MarketingAttentionSummary'
import type { AttentionData } from '@/services/marketingAttention.logic'
import { ModalOverlay, Modal, Dialog } from 'react-aria-components'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  X,
} from 'lucide-react'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PropertyIdentificationDialog } from './PropertyIdentificationDialog'
import { propertyGroup, uniqueReportAds, summarizePropertyAds } from '@/lib/meta/adPropertyReporting'
import { rollupAttributedAdsByCampaign } from '@/lib/meta/adsCampaignRollup'
import { LeadDetailModal } from '@/components/inmobiliaria/leads/LeadDetailModal'
import { listTeamProfilesAction } from '@/app/inmobiliaria/leads/actions'
import {
  listFunnelLeadDetails,
  type AdsConnectionProbe,
  type FunnelLeadDetailRow,
} from '@/app/inmobiliaria/marketing/metricas/actions'
import { cn } from '@/lib/utils'
import type { TeamProfile } from '@/types/inmobiliaria'
import type {
  AttributedAdFunnelRow,
  MarketingFunnelReport,
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

function adLabel(row: AttributedAdFunnelRow) {
  const sourceId = row.adId || row.attributionKey || 'sin_id'
  const adName = row.adName?.trim()
  const campaign = row.campaignName?.trim()
  const parts = [
    adName ? `Anuncio ${adName}` : `Anuncio de WhatsApp (${sourceId})`,
    campaign ? `Campaña ${campaign}` : null,
    row.adsetName ? `Conjunto ${row.adsetName}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

function resolutionStatusLabel(
  status: AttributedAdFunnelRow['resolutionStatus'],
): string {
  if (status === 'missing_ads_token') return 'Datos publicitarios no disponibles'
  if (status === 'graph_permission_denied') return 'Sin permiso para consultar publicidad'
  if (status === 'not_found') return 'Anuncio no encontrado'
  if (status === 'resolved') return 'Anuncio identificado'
  return 'Anuncio sin identificar'
}

function spendReportedLabel(row: AttributedAdFunnelRow): string {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  if (row.adSpend == null) return 'No disponible'
  const base = formatAmount(row.adSpend, row.currency)
  return row.spendStale ? `${base} (pendiente de actualizar)` : base
}

function cplLabel(row: {
  costPerLead: number | null
  currency?: string | null
  adSpend?: number | null
  leadsUnique?: number
}): string {
  if (row.adSpend != null && row.leadsUnique === 0) return 'Sin contactos nuevos'
  if (row.costPerLead == null) return 'No disponible'
  return formatAmount(row.costPerLead, row.currency)
}

function metaResultDisplay(row: AttributedAdFunnelRow): string {
  if (row.resolutionStatus === 'missing_ads_token') {
    return 'Datos publicitarios no disponibles'
  }
  if (row.metaReportedResults == null) return 'No disponible'
  const labels: Record<string, string> = {
    'onsite_conversion.messaging_conversation_started_7d': 'Conversaciones iniciadas (Meta, 7 días)',
    'onsite_conversion.total_messaging_connection': 'Conexiones por mensajes (Meta)',
    'onsite_conversion.messaging_first_reply': 'Primeras respuestas por mensajes (Meta)',
    'onsite_conversion.messaging_conversation_started_7d_website': 'Conversaciones iniciadas desde la web (Meta, 7 días)',
    lead: 'Contactos interesados reportados por Meta',
    'onsite_conversion.lead_grouped': 'Contactos interesados agrupados por Meta',
    'offline_conversion.lead': 'Contactos interesados fuera de internet (Meta)',
    complete_registration: 'Registros completados (Meta)',
    omni_complete_registration: 'Registros completados en varios canales (Meta)',
    link_click: 'Clics en enlace (Meta)',
    landing_page_view: 'Visitas a la página de destino (Meta)',
  }
  const label = labels[row.metaResultActionType || ''] || 'Otra acción reportada por Meta'
  return `${label}: ${row.metaReportedResults}`
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
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    () => new Set(),
  )

  const [assignAdId, setAssignAdId] = useState<string | null>(null)

  const [leadPanelOpen, setLeadPanelOpen] = useState(false)
  const [leadPanelTitle, setLeadPanelTitle] = useState('')
  const [leadRows, setLeadRows] = useState<FunnelLeadDetailRow[]>([])
  const [leadLoading, setLeadLoading] = useState(false)
  const [leadError, setLeadError] = useState<string | null>(null)

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [advisors, setAdvisors] = useState<TeamProfile[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 60_000)
    return () => window.clearInterval(timer)
  }, [router])

  const coverage = report.adsInsightsCoverage
  const insightsFetchedLabel = formatFetchedAt(coverage.insightsFetchedAt)
  const catalogFailed = report.adsCatalog ? report.adsCatalog.status !== 'success' : coverage.insightsIncomplete
  const lastCatalogSuccess = formatFetchedAt(report.adsCatalog?.successfulAt)
  const lastAttempt = formatFetchedAt(report.adsCatalog?.attemptedAt)
  const lastSaved = formatFetchedAt(report.adsLastSavedAt)

  const filteredAds = useMemo(() => {
    return uniqueReportAds(report.byAttributedAd).filter((row) => {
      if (!row.adId) return false
      if (filterCampaignId && row.campaignId !== filterCampaignId) return false
      if (filterAdId) {
        const q = filterAdId.trim().toLowerCase()
        const hay = `${row.adId || ''} ${row.adName || ''} ${row.attributionKey}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [report.byAttributedAd, filterCampaignId, filterAdId])
  const advertisingSummary=summarizePropertyAds(filteredAds)

  const filteredCampaigns = useMemo(() => {
    const rows=rollupAttributedAdsByCampaign(filteredAds)
    for(const campaign of report.adsCatalog?.campaigns || []) {
      if(rows.some(c=>c.campaignId===campaign.id) || filterAdId || (filterCampaignId && filterCampaignId!==campaign.id)) continue
      rows.push(...rollupAttributedAdsByCampaign([{adId:null,campaignId:campaign.id,campaignName:campaign.name,resolutionStatus:'resolved',leadsUnique:0,leadIds:[],temperature:{frio:0,tibio:0,caliente:0,sin_clasificar:0},adSpend:null,currency:null,metaReportedResults:null,spendStale:catalogFailed,spendFetchedAt:null,costPerLead:null}]))
    }
    return rows
  }, [filteredAds,report.adsCatalog,filterAdId,filterCampaignId,catalogFailed])
  const campaignOptions = useMemo(() => {
    return [...new Map([...report.byAttributedAd.filter(row=>row.campaignId).map(row=>({id:row.campaignId!,label:row.campaignName || row.campaignId!})),...(report.adsCatalog?.campaigns || []).map(c=>({id:c.id,label:c.name}))].map(c=>[c.id,c])).values()]
  }, [report.byAttributedAd,report.adsCatalog])

  function toggleCampaign(id: string) {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function openLeadIds(ids:string[],title:string) {
    setLeadPanelTitle(title);setLeadPanelOpen(true);setLeadLoading(true);setLeadError(null);setLeadRows([])
    const unique=[...new Set(ids)], loaded:FunnelLeadDetailRow[]=[]
    const attributionByLeadId:Record<string,{attributedAdId?:string|null;campaignId?:string|null;campaignName?:string|null}>={}
    for(const row of report.byAttributedAd) for(const id of row.leadIds) attributionByLeadId[id]={attributedAdId:row.adId,campaignId:row.campaignId,campaignName:row.campaignName}
    for(let i=0;i<unique.length;i+=200) {
      const result=await listFunnelLeadDetails({leadIds:unique.slice(i,i+200),tenantId:report.tenantId,projectId:report.projectId,attributionByLeadId})
      if(!result.ok) {setLeadError(result.error);setLeadLoading(false);return}
      loaded.push(...result.rows)
    }
    setLeadRows(loaded);setLeadLoading(false)
  }
  function openLeadsForAd(row:AttributedAdFunnelRow) {void openLeadIds(row.leadIds,adLabel(row))}

  async function openLeadDetail(leadId: string) {
    if (!advisors.length) {
      try {
        const list = await listTeamProfilesAction()
        setAdvisors(list)
      } catch {
        setAdvisors([])
      }
    }
    setLeadPanelOpen(false)
    setDetailLeadId(leadId)
    setDetailOpen(true)
  }

  function refreshReport() {
    startTransition(() => {
      router.refresh()
    })
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
          {catalogFailed ? 'No se pudieron consultar las campañas' : 'Publicidad de Meta conectada'}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#8a8176]">
          {bannerConnected ? 'Gasto y resultados reportados por Meta para el período consultado.' : 'No se pudo consultar la publicidad. Pida al administrador revisar la conexión con Meta.'}
          {bannerCurrency ? ` · Moneda ${bannerCurrency}` : ''}
          {bannerTz ? ` · Zona horaria ${bannerTz}` : ''}
          {adsProbe?.adAccountId || adsInsights?.adAccountId
            ? ` · ${adsProbe?.adAccountId || adsInsights?.adAccountId}`
            : ''}
          {insightsFetchedLabel
            ? ` · Gasto consultado con éxito ${insightsFetchedLabel}`
            : ''}
        </p>
        <p className="mt-1 text-xs">{lastCatalogSuccess ? 'Última consulta completa de campañas: '+lastCatalogSuccess : 'Sin una consulta completa de campañas guardada.'} {lastAttempt ? 'Último intento: '+lastAttempt : ''} {lastSaved ? 'Último dato publicitario guardado: '+lastSaved : ''}</p>
        {coverage.insightsIncomplete ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            Datos publicitarios incompletos
            . Gasto
            o resultados pueden faltar en algunos anuncios.
          </p>
        ) : null}
        {coverage.currencyStatus === 'unknown' ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
            Moneda publicitaria sin confirmar; un dato pendiente de actualizar puede conservar la
            moneda histórica del período.
          </p>
        ) : null}
        {adsInsights?.missing?.length ? (
          <p className="mt-2 text-[11px] text-[#8a8176]">
            La configuración de la conexión publicitaria está incompleta.
          </p>
        ) : null}
        {!bannerConnected && adsProbe?.error ? (
          <p className="mt-2 text-[11px] text-amber-900">
            No se pudo verificar la conexión con la cuenta publicitaria.
          </p>
        ) : null}
      </div>

      {report.limitations?.filter(note=>note.startsWith('El historial adicional')).map(note=><p key={note} role="status" className="rounded-xl bg-amber-50 p-3 text-xs">{note}</p>)}

      <section aria-label="Publicidad de la cuenta conectada" className="rounded-xl border border-[#ece6dc] bg-white p-4 text-sm">
        <h2 className="font-semibold">Publicidad de la cuenta conectada<MetricHelp label="Publicidad de la cuenta conectada" description="Resumen de los anuncios que cumplen los filtros y las fechas elegidas. Cada anuncio aporta su gasto una vez y cada contacto su primera adquisición. Incluye propiedades externas y anuncios sin contactos; los resultados de Meta siguen separados del CRM." /></h2>
        <p>Gasto reportado por Meta: {formatAmount(advertisingSummary.adSpend,advertisingSummary.currency)} · Costo promedio por contacto: {cplLabel(advertisingSummary)}</p>
        {filteredAds.some(row=>row.spendStale)?<p className="text-xs">Incluye datos guardados pendientes de actualizar.</p>:null}
        <MarketingInterestBreakdown ids={filteredAds.flatMap(row=>row.leadIds)} evidence={report.interestByLead} onOpen={openLeadIds} />
      </section>
      {report.attention ? <>
        <MarketingAttentionSummary title="Resumen general de atención" people={report.attention.people} data={report.attention} onOpen={openLeadIds} />
        <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Dónde se acumulan pendientes</h3>
          {[...new Set(report.attention.people.map(p=>p.adId))].map(id=>({id,ids:report.attention!.people.filter(p=>p.adId===id && p.flags.anyPending===true).map(p=>p.leadId)})).filter(g=>g.ids.length).sort((a,b)=>b.ids.length-a.ids.length).map(group=>{
            const ad=report.byAttributedAd.find(a=>a.adId===group.id)
            const label=group.id?(ad?.adName || 'Anuncio '+group.id):'Sin anuncio conocido'
            return <p key={group.id || 'unknown'}>{label}: <button type="button" className="p-1 text-[#5b4a9a] underline" onClick={()=>openLeadIds(group.ids,'Pendientes: '+label)}>{group.ids.length} contactos</button>. Revisar las fichas y sus fechas límite.</p>
          })}
          {!report.attention.people.some(p=>p.flags.anyPending===true)?<p>No hay pendientes comprobados en los datos evaluables; revise la cobertura antes de concluir que todos están atendidos.</p>:null}
        </div>
      </> : null}

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
            placeholder="Identificador o nombre"
            className="rounded-xl border border-[#ece6dc] bg-[#faf8f5] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
          />
        </label>
        {(filterCampaignId || filterAdId) && (
          <button
            type="button"
            onClick={() => {
              setFilterCampaignId('')
              setFilterAdId('')
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
          <h2 className="text-sm font-semibold text-[#1f1a14]">Por campaña<MetricHelp label="Por campaña" description={metricDescriptions["Por campaña"]} /></h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8a8176]">
            Anuncios de toda la cuenta que cumplen los filtros elegidos. El gasto es la suma de esos anuncios,
            sin repetir gastos. El costo promedio usa esos anuncios y sus contactos nuevos únicos.
          </p>
        </div>
        {filteredCampaigns.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={catalogFailed ? "No se pudieron consultar las campañas" : "No hay campañas para estos filtros"}
            description={catalogFailed ? "Revise la conexión. Los datos guardados, si existen, se conservan sin presentarlos como una consulta nueva." : "La consulta terminó correctamente. Cambie los filtros para revisar otras campañas."}
          />
        ) : (
          <ul className="space-y-2">
            {filteredCampaigns.map((camp) => {
              const open = !expandedCampaigns.has(camp.campaignId)
              const adsInCampaign = filteredAds.filter(
                (a) => a.campaignId === camp.campaignId,
              )
              return (
                <li
                  key={camp.campaignId}
                  className="overflow-hidden rounded-xl border border-[#ece6dc]"
                >
                  <div className="flex flex-wrap items-start gap-3 bg-[#faf8f5] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleCampaign(camp.campaignId)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
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
                        {camp.leadsUnique} contactos interesados
                        {camp.currency ? ` · ${camp.currency}` : ''}
                        {camp.spendStale ? ' · pendiente de actualizar' : ''}
                      </p>
                    </div>
                  </button>
                    <div className="min-w-0 text-[11px] tabular-nums text-[#6b645c] sm:text-right">
                      <div>
                        Contactos interesados<MetricHelp label="Contactos interesados" description={metricDescriptions['Contactos interesados']} />: {camp.leadsUnique}
                        {' · '}Anuncios<MetricHelp label="Anuncios" description="Cantidad de anuncios agrupados en esta campaña para el período consultado. Permite conocer la cobertura del resumen; no cuenta personas ni clics." />: {camp.adCount}
                      </div>
                      <div>
                        Gasto de estos anuncios<MetricHelp label="Gasto de estos anuncios" description={metricDescriptions['Gasto reportado por Meta']} />:{' '}
                        {camp.adSpend == null
                          ? 'No disponible'
                          : formatAmount(camp.adSpend, camp.currency)}
                      </div>
                      <div>Costo promedio por contacto<MetricHelp label="Costo promedio por contacto" description={metricDescriptions['Costo promedio por contacto']} />: {cplLabel(camp)}</div>
                    </div>
                  </div>
                  {open ? (
                    <div className="border-t border-[#ece6dc] p-2">
                      {adsInCampaign.length === 0 ? (
                        <p className="px-2 py-3 text-[12px] text-[#8a8176]">
                          {catalogFailed ? 'No se pudieron consultar los anuncios de esta campaña.' : 'No hay anuncios para estos filtros.'}
                        </p>
                      ) : (
                        <AdRowsTable
                          interestByLead={report.interestByLead} attention={report.attention} onOpenIds={openLeadIds}
                          rows={adsInCampaign}
                          onOpenLeads={openLeadsForAd}
                          onAssign={(adId) => {
                            setAssignAdId(adId)
                          }}
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

      {filteredAds.some(row => !row.campaignId) ? (
        <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Anuncios sin campaña identificada<MetricHelp label="Anuncios sin campaña identificada" description="Anuncios del período cuya campaña no se pudo consultar. Su gasto conocido y sus contactos nuevos sí se incluyen en el total. Identificar la propiedad no cambia su campaña ni reparte el gasto." /></h2>
          <AdRowsTable interestByLead={report.interestByLead} attention={report.attention} onOpenIds={openLeadIds} rows={filteredAds.filter(row => !row.campaignId)} onOpenLeads={openLeadsForAd} onAssign={setAssignAdId} />
        </section>
      ) : null}

      {assignAdId && report.byAttributedAd.find(row=>row.adId===assignAdId) ? (
        <PropertyIdentificationDialog key={assignAdId} adId={assignAdId}
          property={report.byAttributedAd.find(row=>row.adId===assignAdId)!.promotedUnit}
          tenantId={report.tenantId} projectId={report.projectId}
          onClose={()=>setAssignAdId(null)} onSaved={()=>{setAssignAdId(null);refreshReport()}} />
      ) : null}

      {/* Panel leads */}
      {leadPanelOpen ? (
        <ModalOverlay isOpen={leadPanelOpen} onOpenChange={setLeadPanelOpen} isDismissable className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <Modal className="h-full w-full max-w-md"><Dialog aria-label="Contactos del indicador" className="flex h-full flex-col border-l border-[#ece6dc] bg-white shadow-xl outline-none">
            <div className="flex items-start justify-between gap-2 border-b border-[#ece6dc] px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#1f1a14]">
                  Contactos del indicador
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
                  No se pudieron cargar los contactos interesados. Cierre este panel y vuelva a intentarlo.
                </p>
              ) : null}
              {!leadLoading && !leadError && leadRows.length === 0 ? (
                <p className="text-[12px] text-[#8a8176]">Sin contactos interesados.</p>
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
                      {({frio:'Frío',tibio:'Tibio',caliente:'Caliente',sin_clasificar:'Sin evaluar'})[report.interestByLead?.[lead.id]?.bucket || 'sin_clasificar']}
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
                    <p className="mt-1 text-xs">{report.interestByLead?.[lead.id]?.reason || 'Sin evaluación disponible.'} · Evaluación: {formatFetchedAt(report.interestByLead?.[lead.id]?.evaluatedAt) || 'No registrada'}</p>
                    {report.attention?.people.find(p=>p.leadId===lead.id)?.kommoId ? <a className="text-xs underline" href={`https://lavilet.kommo.com/leads/detail/${report.attention.people.find(p=>p.leadId===lead.id)?.kommoId}`} target="_blank" rel="noopener noreferrer">Abrir Kommo</a> : null}
                  </li>
                ))}
              </ul>
            </div>
          </Dialog></Modal>
        </ModalOverlay>
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
  interestByLead, attention, onOpenIds,
  rows,
  onOpenLeads,
  onAssign,
}: {
  interestByLead?:Record<string,InterestEvidence>
  attention?: AttentionData
  onOpenIds?: (ids:string[],title:string)=>void
  rows: AttributedAdFunnelRow[]
  onOpenLeads: (row: AttributedAdFunnelRow) => void
  onAssign: (adId: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[11px]">
        <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
          <tr>
            <th className="px-2 py-2 font-semibold">Anuncio<MetricHelp label="Anuncio" description={metricDescriptions["Anuncio"]} /></th>
            <th className="px-2 py-2 font-semibold">Propiedad anunciada<MetricHelp label="Propiedad anunciada" description={metricDescriptions["Propiedad anunciada"]} /></th>
            <th className="px-2 py-2 font-semibold">Contactos interesados<MetricHelp label="Contactos interesados" description={metricDescriptions["Contactos interesados"]} /></th>
            <th className="px-2 py-2 font-semibold">Gasto reportado por Meta<MetricHelp label="Gasto reportado por Meta" description={metricDescriptions["Gasto reportado por Meta"]} /></th>
            <th className="px-2 py-2 font-semibold">Costo promedio por contacto<MetricHelp label="Costo promedio por contacto" description={metricDescriptions["Costo promedio por contacto"]} /></th>
            <th className="px-2 py-2 font-semibold">Resultado reportado por Meta<MetricHelp label="Resultado reportado por Meta" description={metricDescriptions["Resultado reportado por Meta"]} /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.attributionKey}><tr
              key={row.attributionKey}
              className={cn(
                'border-b border-[#f0ebe3] align-top',
                row.insightsOnly && 'bg-[#faf8f5]',
              )}
            >
              <td className="max-w-[16rem] px-2 py-2 text-[#1f1a14]">
                <span className="font-medium">{adLabel(row)}</span>
                <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                  {row.adId ? `Anuncio ${row.adId}` : 'sin anuncio identificado'}
                  {row.campaignId ? ` · Campaña ${row.campaignId}` : ''}
                  {' · '}
                  {resolutionStatusLabel(row.resolutionStatus)}
                  {row.insightsOnly ? ' · solo datos publicitarios' : ''}
                  {row.spendStale ? ' · pendiente de actualizar' : ''}
                </span>
              </td>
              <td className="px-2 py-2">
                <span className="text-[#1f1a14]">
                  {row.promotedUnit?.label || 'Propiedad sin identificar'}
                </span>
                <span className="mt-1 block text-[10px] text-[#6b645c]">
                  {propertyGroup(row)==='external'?'Propiedad externa':propertyGroup(row)==='multiple'?'Varias propiedades · gasto sin repartir':propertyGroup(row)==='inventory'?'Inventario del proyecto':'Propiedad sin identificar'}
                  {row.promotedUnit.evidence==='saved'?' · Confirmación guardada':row.promotedUnit.evidence==='ad_link'?' · Identificada por enlace del anuncio':''}
                </span>
                {row.promotedUnit.kind==='multi'?<ul className="mt-1 text-[10px]">{row.promotedUnit.links.map(l=><li key={l.unitId || l.externalLabel}>{l.unitLabel || l.externalLabel}{l.externalLabel?' · Propiedad externa':''}</li>)}</ul>:null}
                {row.promotedUnit.evidenceUrls?.map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[10px] text-[#5b4a9a] underline">Ver propiedad enlazada por el anuncio</a>)}
                {!row.adId?<span className="mt-1 block text-[10px] text-[#8a8176]">No hay un anuncio identificado al que guardar una propiedad.</span>:null}
                {row.adId ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => onAssign(row.adId!)}
                      className="rounded-lg border border-[#ece6dc] px-2 py-0.5 text-[10px] font-semibold text-[#5c5348] hover:bg-[#faf8f5]"
                    >
                      {row.promotedUnit.kind === 'none' ? 'Identificar propiedad' : 'Corregir propiedad'}
                    </button>

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
              <td className="px-2 py-2 tabular-nums">
                {spendReportedLabel(row)}
              </td>
              <td className="px-2 py-2 tabular-nums">{cplLabel(row)}</td>
              <td className="max-w-[10rem] px-2 py-2 tabular-nums">
                {metaResultDisplay(row)}
              </td>
            </tr>
            <tr><td colSpan={6} className="p-2"><MarketingInterestBreakdown ids={row.leadIds} evidence={interestByLead} onOpen={onOpenIds} /><details><summary className="cursor-pointer py-2 font-semibold">Atención y avance de {row.adName || row.adId}</summary>
              {attention && onOpenIds ? <MarketingAttentionSummary people={attention.people.filter(p=>p.adId===row.adId)} onOpen={onOpenIds} /> : <p>Sin información suficiente para consultar el avance.</p>}
            </details></td></tr></Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

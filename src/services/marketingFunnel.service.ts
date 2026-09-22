/**
 * Métricas internas de embudo inmobiliario (anuncios atribuidos CTWA first-touch + unidad).
 * No dispara CAPI ni cambia gates de envío Meta.
 * Zona horaria de informe: America/Guayaquil.
 *
 * Universos temporales (no mezclar en tasas):
 * - Cohorte leads: created_at ∈ período
 * - byAttributedAd citas: todas las citas de leads de la cohorte (sin filtro temporal)
 * - byAttributedAd ventas: sale_at ∈ período ∧ lead de la cohorte
 * - Totales citas del período: start_time ∈ período, clasificadas (no toda cita = realizada)
 * - Totales ventas: sale_at ∈ período
 * - Contratos anulados: snapshot de estado actual; fecha de anulación desconocida
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeCrmCostPerLead,
  fetchAdAccountSnapshot,
  fetchAdSpendForPeriod,
  fetchCampaignSpendForPeriod,
  readAdsMarketingCredentials,
  resolveAdHierarchy,
  type AdAccountSnapshot,
} from '@/lib/meta/adsMarketingClient'
import {
  hierarchyFromCache,
  readAdsInsightsCache,
  spendSnapshotFromCache,
  upsertAdsInsightsCache,
} from '@/lib/meta/adsInsightsCache'
import { rollupAttributedAdsByCampaign } from '@/lib/meta/adsCampaignRollup'
import type { CampaignFunnelRollupRow } from '@/lib/meta/adsCampaignRollup'
import {
  FUNNEL_UNIVERSES,
  bucketTemp,
  classifyAppointmentInPeriod,
  ecuadorDayBoundsUtc,
  emptyTemp,
  resolveAppointmentUnitIds,
  resolveReservationTitular,
  resolveReservedUnitIds,
  snapshotAnulledContracts,
  sumKnownAmounts,
  type TemperatureBucket,
} from '@/services/marketingFunnel.logic'

export {
  ecuadorDayBoundsUtc,
  FUNNEL_UNIVERSES,
  type TemperatureBucket,
} from '@/services/marketingFunnel.logic'

export const MARKETING_REPORT_TZ = 'America/Guayaquil'

export type MarketingFunnelPeriod = {
  from: string
  to: string
}

export type AttributedAdFunnelRow = {
  attributionKey: string
  adId: string | null
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  resolutionStatus:
    | 'unresolved'
    | 'resolved'
    | 'missing_ads_token'
    | 'graph_permission_denied'
    | 'not_found'
  sourceUrlPresent: boolean
  referralSourceType: string | null
  /** Universo: cohorte leads */
  leadsUnique: number
  temperature: Record<TemperatureBucket, number>
  /** Universo: citas de la cohorte sin filtro temporal */
  leadsWithAppointmentRequested: number
  leadsWithAppointmentConfirmed: number
  leadsWithAppointmentDone: number
  appointmentCancelCount: number
  appointmentNoShowCount: number
  appointmentReprogrammedCount: number
  leadsReserved: number
  /** Universo: ventas del período de leads de la cohorte */
  salesConfirmed: number
  salesAmount: number | null
  salesCurrency: 'USD' | 'no_disponible'
  adSpend: number | null
  /** Moneda Insights (account_currency). null si no hay gasto verificable. */
  currency: string | null
  costPerLead: number | null
  /** Resultados/contactos reportados por Meta Insights (no leads CRM). */
  metaReportedResults: number | null
  /** Conversiones CAPI meta_accepted de leads de esta cohorte/anuncio. */
  capiMetaAccepted: number | null
  spendFetchedAt: string | null
  /** true si gasto/jerarquía vienen de caché tras fallo Graph. */
  spendStale: boolean
  spendStaleFetchedAt: string | null
  /** CPL = adSpend / leadsUnique (CRM). null → UI “No disponible”. */
  costPerLeadDefinition: 'ad_spend_div_crm_leads_unique'
  note: string
}

/** @deprecated Use AttributedAdFunnelRow */
export type CampaignFunnelRow = AttributedAdFunnelRow

export type UnitFunnelRow = {
  unitId: string | null
  unitLabel: string
  category: string | null
  showroomViews: number
  commercialInterestLeads: number
  appointmentLeads: number
  /** 0 o 1: solo titular comprobado (status=reservado único en la unidad). */
  reservedLeads: number
  /** Sin titular único → UI “titular no determinado” (no atribuir a interesados). */
  reservationTitularUndetermined: boolean
  salesConfirmed: number
  salesAmount: number | null
  temperature: Record<TemperatureBucket, number>
}

export type AppointmentPeriodBreakdown = {
  scheduled: number
  completed: number
  cancelled: number
  noShow: number
  other: number
  /** Completadas (atendido ∧ ¬no_show). No incluye futuras ni canceladas. */
  leadsWithCompletedAppointment: number
}

export type MarketingFunnelReport = {
  timezone: typeof MARKETING_REPORT_TZ
  /** TZ de la cuenta Ads (Insights); puede diferir de America/Guayaquil. */
  adsAccountTimezone: string | null
  period: MarketingFunnelPeriod
  tenantId: string
  projectId: string
  universes: typeof FUNNEL_UNIVERSES
  adsAccount: AdAccountSnapshot | null
  totals: {
    leadsAcquiredInPeriod: number
    leadsWithAttribution: number
    leadsWithoutAttribution: number
    temperature: Record<TemperatureBucket, number>
    /** Desglose por start_time ∈ período (no usar completed como proxy de “todas”). */
    appointmentsInPeriod: AppointmentPeriodBreakdown
    /** @deprecated Prefer appointmentsInPeriod.completed */
    appointmentsOccurredInPeriod: number
    leadsWithAppointmentInPeriod: number
    salesOccurredInPeriod: number
    salesAmountInPeriod: number | null
    salesCurrency: 'USD' | 'no_disponible'
    /**
     * Snapshot de contratos anulado del project (no “en período”:
     * no hay annulled_at; signed_at/created_at no son fecha de anulación).
     */
    contractsCurrentlyAnulled: number
    contractsAnulledAnnulmentDateKnown: false
    /** @deprecated Prefer contractsCurrentlyAnulled */
    contractsAnulledInPeriod: number
  }
  byAttributedAd: AttributedAdFunnelRow[]
  /** Rollup por campaign_id resuelto (nunca source_id como campaign). */
  byCampaign: CampaignFunnelRollupRow[]
  byUnit: UnitFunnelRow[]
  undeterminedUnit: {
    appointmentLeads: number
    reservedLeads: number
  }
  /** Unidades reservadas sin titular único comprobado. */
  undeterminedTitularUnits: number
  limitations: string[]
  metaSendGatesUntouched: true
}

const PAGE = 1000
const IN_CHUNK = 200

async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const to = from + PAGE - 1
    const { data, error } = await fetchPage(from, to)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

async function fetchAllInChunks<T, Id>(
  ids: Id[],
  fetchChunk: (chunk: Id[]) => Promise<T[]>,
): Promise<T[]> {
  if (!ids.length) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(await fetchChunk(ids.slice(i, i + IN_CHUNK))))
  }
  return out
}

type LeadRow = {
  id: string
  temperature: string | null
  status: string | null
  contact_id: string | null
  kommo_id: number | null
  created_at: string
}

type AttrRow = {
  contact_id: string
  kommo_id: number | null
  source_id: string | null
  source_url: string | null
  referral_source_type: string | null
  captured_at: string
}

type ApptRow = {
  id: string
  lead_id: string
  status: string | null
  no_show: boolean | null
  requested_at: string | null
  confirmed_at: string | null
  start_time: string | null
  created_at: string
}

type SaleRow = {
  id: string
  lead_id: string | null
  unit_id: string
  sale_price_final: number | null
  sale_at: string
}

export async function buildMarketingFunnelReport(
  admin: SupabaseClient,
  input: {
    tenantId: string
    projectId: string
    period: MarketingFunnelPeriod
  },
): Promise<MarketingFunnelReport> {
  const { fromIso, toExclusiveIso } = ecuadorDayBoundsUtc(
    input.period.from,
    input.period.to,
  )
  const nowIso = new Date().toISOString()

  const limitations: string[] = [
    'byAttributedAd = CTWA source_id; no son campañas del planificador.',
    'Moneda: unit_sales_closings sin currency → salesCurrency=no_disponible.',
    'Importes null no se convierten a 0; salesAmount null si ningún importe conocido.',
    'Confirmación de cita exige confirmed_at; reprogramación solo por status.',
    'Cita→unidad solo vía appointment_units; reserva→unidad solo vía units.status=reservado + lead_units; si falta → “unidad no determinada”.',
    'Reserva por unidad: solo titular comprobado (exactamente 1 lead status=reservado vinculado); 0 o >1 → “titular no determinado” (no se atribuye a todos los interesados).',
    'Contratos anulados: snapshot actual; annulledAt desconocida (no usar signed_at/created_at).',
    'No mezclar universos al calcular tasas (ver report.universes).',
    'Aceptación técnica Meta (CAPI Graph) ≠ atribución a campaña/ads Insights.',
    'Gates Meta (Pixel/CAPI/WA) no se modifican.',
  ]

  // 1) Proyecto pertenece al tenant
  const projectRes = await admin
    .from('projects')
    .select('id,tenant_id')
    .eq('id', input.projectId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (projectRes.error) throw projectRes.error
  if (!projectRes.data) {
    throw new Error('project_not_in_authorized_tenant')
  }

  // Unidades del proyecto (aislamiento)
  const projectUnits = await fetchAllPages<{
    id: string
    unit_number: string | null
    category: string | null
    status: string | null
  }>((from, to) =>
    admin
      .from('units')
      .select('id,unit_number,category,status')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .range(from, to),
  )
  const projectUnitIds = new Set(projectUnits.map((u) => u.id))
  const unitsById = new Map(projectUnits.map((u) => [u.id, u]))
  const unitStatusById = new Map(
    projectUnits.map((u) => [u.id, u.status as string | null]),
  )

  // Cohorte leads
  const leads = await fetchAllPages<LeadRow>((from, to) =>
    admin
      .from('leads')
      .select('id,temperature,status,contact_id,kommo_id,created_at')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(from, to),
  )
  const leadIds = leads.map((l) => l.id)
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const contactIds = [
    ...new Set(
      leads.map((l) => l.contact_id).filter((c): c is string => Boolean(c)),
    ),
  ]

  // Attribution
  const attrs = await fetchAllInChunks(contactIds, (chunk) =>
    fetchAllPages<AttrRow>((from, to) =>
      admin
        .from('lv_whatsapp_ctwa_attribution')
        .select(
          'contact_id,kommo_id,source_id,source_url,referral_source_type,captured_at',
        )
        .eq('tenant_id', input.tenantId)
        .eq('project_id', input.projectId)
        .in('contact_id', chunk)
        .range(from, to),
    ),
  )
  const attrByContact = new Map<string, AttrRow>()
  for (const a of attrs) {
    if (!attrByContact.has(a.contact_id)) attrByContact.set(a.contact_id, a)
  }

  // Citas de la cohorte (sin filtro temporal) — universo byAttributedAd
  const cohortAppts = await fetchAllInChunks(leadIds, (chunk) =>
    fetchAllPages<ApptRow>((from, to) =>
      admin
        .from('appointments')
        .select(
          'id,lead_id,status,no_show,requested_at,confirmed_at,start_time,created_at',
        )
        .eq('tenant_id', input.tenantId)
        .eq('project_id', input.projectId)
        .in('lead_id', chunk)
        .range(from, to),
    ),
  )
  const apptsByLead = new Map<string, ApptRow[]>()
  for (const a of cohortAppts) {
    const list = apptsByLead.get(a.lead_id) || []
    list.push(a)
    apptsByLead.set(a.lead_id, list)
  }

  // Citas del período por start_time (totales) — clasificadas
  const periodAppts = await fetchAllPages<{
    id: string
    lead_id: string
    status: string | null
    no_show: boolean | null
    start_time: string | null
  }>((from, to) =>
    admin
      .from('appointments')
      .select('id,lead_id,status,no_show,start_time')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .gte('start_time', fromIso)
      .lt('start_time', toExclusiveIso)
      .range(from, to),
  )

  const apptBreakdown: AppointmentPeriodBreakdown = {
    scheduled: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    other: 0,
    leadsWithCompletedAppointment: 0,
  }
  const completedLeadIds = new Set<string>()
  for (const a of periodAppts) {
    const c = classifyAppointmentInPeriod(a, nowIso)
    if (c === 'scheduled') apptBreakdown.scheduled += 1
    else if (c === 'completed') {
      apptBreakdown.completed += 1
      completedLeadIds.add(a.lead_id)
    } else if (c === 'cancelled') apptBreakdown.cancelled += 1
    else if (c === 'no_show') apptBreakdown.noShow += 1
    else apptBreakdown.other += 1
  }
  apptBreakdown.leadsWithCompletedAppointment = completedLeadIds.size

  // Ventas del período aisladas por unidad∈project
  const salesRaw = await fetchAllPages<SaleRow>((from, to) =>
    admin
      .from('unit_sales_closings')
      .select('id,lead_id,unit_id,sale_price_final,sale_at')
      .eq('tenant_id', input.tenantId)
      .gte('sale_at', fromIso)
      .lt('sale_at', toExclusiveIso)
      .range(from, to),
  )
  const sales = salesRaw.filter((s) => projectUnitIds.has(s.unit_id))

  const salesByLead = new Map<string, SaleRow[]>()
  for (const s of sales) {
    if (!s.lead_id) continue
    const list = salesByLead.get(s.lead_id) || []
    list.push(s)
    salesByLead.set(s.lead_id, list)
  }

  // lead_units de cohorte, solo unidades del project
  const leadUnitsRaw = await fetchAllInChunks(leadIds, (chunk) =>
    fetchAllPages<{
      lead_id: string
      unit_id: string
      interest_level: string | null
      rejected: boolean | null
    }>((from, to) =>
      admin
        .from('lead_units')
        .select('lead_id,unit_id,interest_level,rejected')
        .in('lead_id', chunk)
        .range(from, to),
    ),
  )
  const leadUnits = leadUnitsRaw.filter((lu) => projectUnitIds.has(lu.unit_id))
  const leadUnitIdsByLead = new Map<string, string[]>()
  for (const lu of leadUnits) {
    if (lu.rejected) continue
    const list = leadUnitIdsByLead.get(lu.lead_id) || []
    list.push(lu.unit_id)
    leadUnitIdsByLead.set(lu.lead_id, list)
  }

  // appointment_units (relación real cita→unidad)
  const allApptIds = [
    ...new Set([
      ...cohortAppts.map((a) => a.id),
      ...periodAppts.map((a) => a.id),
    ]),
  ]
  const apptUnitLinksRaw = await fetchAllInChunks(allApptIds, (chunk) =>
    fetchAllPages<{ appointment_id: string; unit_id: string }>((from, to) =>
      admin
        .from('appointment_units')
        .select('appointment_id,unit_id')
        .in('appointment_id', chunk)
        .range(from, to),
    ),
  )
  const apptUnitLinks = apptUnitLinksRaw.filter((l) =>
    projectUnitIds.has(l.unit_id),
  )

  // Showroom del proyecto + fechas en consulta
  const showroomVisits = await fetchAllPages<{ id: string }>((from, to) =>
    admin
      .from('showroom_visits')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .gte('visit_start', fromIso)
      .lt('visit_start', toExclusiveIso)
      .range(from, to),
  )
  const showroomIds = showroomVisits.map((v) => v.id)
  const showroomUnitCounts = new Map<string, number>()
  const svu = await fetchAllInChunks(showroomIds, (chunk) =>
    fetchAllPages<{ showroom_visit_id: string; unit_id: string }>((from, to) =>
      admin
        .from('showroom_visit_units')
        .select('showroom_visit_id,unit_id')
        .in('showroom_visit_id', chunk)
        .range(from, to),
    ),
  )
  for (const row of svu) {
    if (!projectUnitIds.has(row.unit_id)) continue
    showroomUnitCounts.set(
      row.unit_id,
      (showroomUnitCounts.get(row.unit_id) || 0) + 1,
    )
  }

  // Contratos anulados: snapshot vía leads del project o contract_units→units
  const projectLeadIdsAll = await fetchAllPages<{ id: string }>((from, to) =>
    admin
      .from('leads')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .range(from, to),
  )
  const allProjectLeadIds = projectLeadIdsAll.map((l) => l.id)
  let anulledContracts: Array<{
    id: string
    status: string | null
    signed_at: string | null
    created_at: string
    lead_id: string | null
  }> = []
  anulledContracts = await fetchAllInChunks(allProjectLeadIds, (chunk) =>
    fetchAllPages((from, to) =>
      admin
        .from('contracts')
        .select('id,status,signed_at,created_at,lead_id')
        .eq('tenant_id', input.tenantId)
        .eq('status', 'anulado')
        .in('lead_id', chunk)
        .range(from, to),
    ),
  )

  // También vía contract_units → units del project
  const contractUnitRows = await fetchAllInChunks([...projectUnitIds], (chunk) =>
    fetchAllPages<{ contract_id: string; unit_id: string }>((from, to) =>
      admin
        .from('contract_units')
        .select('contract_id,unit_id')
        .in('unit_id', chunk)
        .range(from, to),
    ),
  )
  const contractIdsFromUnits = [
    ...new Set(contractUnitRows.map((c) => c.contract_id)),
  ]
  if (contractIdsFromUnits.length) {
    const known = new Set(anulledContracts.map((c) => c.id))
    const extra = await fetchAllInChunks(contractIdsFromUnits, (chunk) =>
      fetchAllPages<{
        id: string
        status: string | null
        signed_at: string | null
        created_at: string
        lead_id: string | null
      }>((from, to) =>
        admin
          .from('contracts')
          .select('id,status,signed_at,created_at,lead_id')
          .eq('tenant_id', input.tenantId)
          .eq('status', 'anulado')
          .in('id', chunk)
          .range(from, to),
      ),
    )
    for (const r of extra) {
      if (!known.has(r.id)) {
        known.add(r.id)
        anulledContracts.push(r)
      }
    }
  }
  const anulledSnapshot = snapshotAnulledContracts(anulledContracts)

  // ——— Agregación por anuncio ———
  const totalsTemp = emptyTemp()
  for (const l of leads) totalsTemp[bucketTemp(l.temperature)] += 1
  const withAttr = leads.filter(
    (l) => l.contact_id && attrByContact.has(l.contact_id),
  ).length

  type Agg = { leads: LeadRow[]; attr: AttrRow | null }
  const byKey = new Map<string, Agg>()
  for (const lead of leads) {
    const attr = lead.contact_id
      ? attrByContact.get(lead.contact_id) || null
      : null
    const key = attr?.source_id ? `ad:${attr.source_id}` : 'sin_atribucion'
    const bucket = byKey.get(key) || { leads: [], attr }
    bucket.leads.push(lead)
    if (!bucket.attr && attr) bucket.attr = attr
    byKey.set(key, bucket)
  }

  function summarizeAttributedAdBase(key: string, agg: Agg) {
    const temp = emptyTemp()
    let req = 0
    let conf = 0
    let done = 0
    let cancel = 0
    let noshow = 0
    let reprog = 0
    let reserved = 0
    let salesN = 0
    const saleAmounts: Array<number | null> = []
    for (const lead of agg.leads) {
      temp[bucketTemp(lead.temperature)] += 1
      if (String(lead.status || '').toLowerCase() === 'reservado') reserved += 1
      const list = apptsByLead.get(lead.id) || []
      if (list.some((a) => a.status === 'solicitada' || a.status === 'pendiente'))
        req += 1
      if (list.some((a) => Boolean(a.confirmed_at))) conf += 1
      if (list.some((a) => a.status === 'atendido' && !a.no_show)) done += 1
      cancel += list.filter((a) => a.status === 'cancelado').length
      noshow += list.filter((a) => a.no_show === true).length
      reprog += list.filter((a) => a.status === 'reprogramado').length
      const ls = salesByLead.get(lead.id) || []
      salesN += ls.length
      for (const s of ls) saleAmounts.push(s.sale_price_final)
    }
    const adId = agg.attr?.source_id || null
    return {
      attributionKey: key,
      adId,
      adName: null as string | null,
      adsetId: null as string | null,
      adsetName: null as string | null,
      campaignId: null as string | null,
      campaignName: null as string | null,
      resolutionStatus: (adId
        ? 'missing_ads_token'
        : 'unresolved') as AttributedAdFunnelRow['resolutionStatus'],
      sourceUrlPresent: Boolean(agg.attr?.source_url),
      referralSourceType: agg.attr?.referral_source_type || null,
      leadsUnique: agg.leads.length,
      temperature: temp,
      leadsWithAppointmentRequested: req,
      leadsWithAppointmentConfirmed: conf,
      leadsWithAppointmentDone: done,
      appointmentCancelCount: cancel,
      appointmentNoShowCount: noshow,
      appointmentReprogrammedCount: reprog,
      leadsReserved: reserved,
      salesConfirmed: salesN,
      salesAmount: sumKnownAmounts(saleAmounts),
      salesCurrency: 'no_disponible' as const,
      adSpend: null as number | null,
      currency: null as string | null,
      costPerLead: null as number | null,
      metaReportedResults: null as number | null,
      capiMetaAccepted: null as number | null,
      spendFetchedAt: null as string | null,
      spendStale: false,
      spendStaleFetchedAt: null as string | null,
      costPerLeadDefinition: 'ad_spend_div_crm_leads_unique' as const,
      note:
        key === 'sin_atribucion'
          ? 'Sin first-touch CTWA. Universos: leads cohorte; citas cohorte sin filtro temporal; ventas sale_at∈período.'
          : 'CTWA source_id (=ad_id). CPL = gasto Insights ÷ leadsUnique CRM. Aceptación CAPI Graph ≠ atribución campaña.',
    }
  }

  const adsCreds = readAdsMarketingCredentials()
  let adsAccount: AdAccountSnapshot | null = null
  if (adsCreds) {
    adsAccount = await fetchAdAccountSnapshot()
  }

  const byAttributedAdBase = [...byKey.entries()].map(([k, v]) =>
    summarizeAttributedAdBase(k, v),
  )

  // Resolución jerarquía + gasto (solo si hay credenciales Ads dedicadas).
  const byAttributedAd: AttributedAdFunnelRow[] = []
  for (const row of byAttributedAdBase) {
    if (!row.adId || !adsCreds) {
      if (row.adId && !adsCreds) {
        row.resolutionStatus = 'missing_ads_token'
        row.note =
          'CTWA source_id presente (ad_id). Falta META_AD_ACCOUNT_ID + META_ADS_ACCESS_TOKEN (ads_read). No se usan tokens CAPI/WA. No se trata source_id como campaign_id.'
      }
      byAttributedAd.push(row)
      continue
    }

    let hierarchy = await resolveAdHierarchy(row.adId)
    if (hierarchy.resolutionStatus !== 'resolved') {
      const cachedH = await readAdsInsightsCache(admin, {
        adAccountId: adsCreds.adAccountId,
        entityLevel: 'ad',
        entityId: row.adId,
        periodFrom: input.period.from,
        periodTo: input.period.to,
      })
      const fromCache = cachedH ? hierarchyFromCache(cachedH, row.adId) : null
      if (fromCache?.campaignId || fromCache?.adName) {
        hierarchy = {
          ...hierarchy,
          ...fromCache,
          resolutionStatus: 'resolved',
          error: hierarchy.error
            ? `${hierarchy.error}; hierarchy_from_stale_cache`
            : 'hierarchy_from_stale_cache',
        }
        row.spendStale = true
        row.spendStaleFetchedAt = cachedH?.fetched_at ?? null
      }
    }

    row.adName = hierarchy.adName
    row.adsetId = hierarchy.adsetId
    row.adsetName = hierarchy.adsetName
    row.campaignId = hierarchy.campaignId
    row.campaignName = hierarchy.campaignName
    row.resolutionStatus = hierarchy.resolutionStatus
    if (hierarchy.error) {
      row.note = `CTWA source_id (=ad_id). Resolución: ${hierarchy.error}`
    } else {
      row.note =
        'CTWA source_id (=ad_id) → adset/campaign vía Graph. CPL = gasto Insights ÷ leadsUnique CRM.'
    }

    let spendSnap = await fetchAdSpendForPeriod(row.adId, {
      from: input.period.from,
      to: input.period.to,
    })
    if (!spendSnap.error && spendSnap.spend != null) {
      await upsertAdsInsightsCache(admin, {
        adAccountId: adsCreds.adAccountId,
        entityLevel: 'ad',
        entityId: row.adId,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        spend: spendSnap.spend,
        currency: spendSnap.currency,
        impressions: spendSnap.impressions,
        clicks: spendSnap.clicks,
        metaReportedResults: spendSnap.metaReportedResults,
        hierarchy: {
          adName: row.adName,
          adsetId: row.adsetId,
          adsetName: row.adsetName,
          campaignId: row.campaignId,
          campaignName: row.campaignName,
        },
        fetchedAt: spendSnap.fetchedAt,
        lastError: null,
      })
    } else if (spendSnap.error) {
      const cached = await readAdsInsightsCache(admin, {
        adAccountId: adsCreds.adAccountId,
        entityLevel: 'ad',
        entityId: row.adId,
        periodFrom: input.period.from,
        periodTo: input.period.to,
      })
      if (cached && cached.spend != null) {
        spendSnap = spendSnapshotFromCache(cached, spendSnap.error)
        row.spendStale = true
        row.spendStaleFetchedAt = cached.fetched_at
      }
    }

    row.adSpend = spendSnap.spend
    row.currency = spendSnap.currency
    row.metaReportedResults = spendSnap.metaReportedResults
    row.spendFetchedAt = spendSnap.stale
      ? spendSnap.staleFetchedAt || spendSnap.fetchedAt
      : spendSnap.fetchedAt
    row.costPerLead = computeCrmCostPerLead(spendSnap.spend, row.leadsUnique)
    if (spendSnap.error) {
      row.note = `${row.note} Gasto: ${spendSnap.error}`
    }
    if (row.spendStale && row.spendStaleFetchedAt) {
      row.note = `${row.note} Datos Ads stale desde ${row.spendStaleFetchedAt}.`
    }
    byAttributedAd.push(row)
  }
  byAttributedAd.sort((a, b) => b.leadsUnique - a.leadsUnique)

  // Rollup por campaña + gasto campaign-level cuando hay campaignId resuelto.
  let byCampaign = rollupAttributedAdsByCampaign(
    byAttributedAd.map((r) => ({
      adId: r.adId,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      resolutionStatus: r.resolutionStatus,
      leadsUnique: r.leadsUnique,
      temperature: r.temperature,
      adSpend: r.adSpend,
      currency: r.currency,
      metaReportedResults: r.metaReportedResults,
      spendStale: r.spendStale,
      spendFetchedAt: r.spendFetchedAt,
      costPerLead: r.costPerLead,
    })),
  )

  if (adsCreds) {
    for (let i = 0; i < byCampaign.length; i += 1) {
      const camp = byCampaign[i]!
      let campSpend = await fetchCampaignSpendForPeriod(camp.campaignId, {
        from: input.period.from,
        to: input.period.to,
      })
      if (!campSpend.error && campSpend.spend != null) {
        await upsertAdsInsightsCache(admin, {
          adAccountId: adsCreds.adAccountId,
          entityLevel: 'campaign',
          entityId: camp.campaignId,
          periodFrom: input.period.from,
          periodTo: input.period.to,
          spend: campSpend.spend,
          currency: campSpend.currency,
          impressions: campSpend.impressions,
          clicks: campSpend.clicks,
          metaReportedResults: campSpend.metaReportedResults,
          hierarchy: { campaignName: camp.campaignName },
          fetchedAt: campSpend.fetchedAt,
        })
      } else if (campSpend.error) {
        const cached = await readAdsInsightsCache(admin, {
          adAccountId: adsCreds.adAccountId,
          entityLevel: 'campaign',
          entityId: camp.campaignId,
          periodFrom: input.period.from,
          periodTo: input.period.to,
        })
        if (cached && cached.spend != null) {
          campSpend = spendSnapshotFromCache(cached, campSpend.error)
          camp.spendStale = true
          camp.spendFetchedAt = cached.fetched_at
        }
      }
      // Preferir gasto campaign-level (completo) cuando Graph lo entrega.
      if (campSpend.spend != null && !campSpend.error?.includes('meta_error')) {
        camp.adSpend = campSpend.spend
        camp.currency = campSpend.currency
        if (campSpend.metaReportedResults != null) {
          camp.metaReportedResults = campSpend.metaReportedResults
        }
        camp.costPerLead = computeCrmCostPerLead(camp.adSpend, camp.leadsUnique)
        camp.spendFetchedAt = campSpend.stale
          ? campSpend.staleFetchedAt || campSpend.fetchedAt
          : campSpend.fetchedAt
        if (campSpend.stale) camp.spendStale = true
        camp.note =
          'Gasto Insights level=campaign (período). Leads CRM = únicos first-touch CTWA de anuncios resueltos a esta campaña. CPL = gasto campaña ÷ leads CRM. Resultados Meta ≠ leads CRM ≠ CAPI.'
      } else if (campSpend.stale && campSpend.spend != null) {
        camp.adSpend = campSpend.spend
        camp.currency = campSpend.currency
        camp.costPerLead = computeCrmCostPerLead(camp.adSpend, camp.leadsUnique)
        camp.note = `${camp.note} Campaña: sirviendo caché stale (${campSpend.staleFetchedAt}). Error live: ${campSpend.error}`
      }
    }
  }

  if (!adsCreds) {
    limitations.push(
      'Datos publicitarios no disponibles: faltan META_AD_ACCOUNT_ID y META_ADS_ACCESS_TOKEN (System User ads_read) en Vercel Production. No reutilizar META_CAPI_* ni META_WA_CAPI_*.',
    )
  } else {
    limitations.push(
      'CPL = gasto Insights (mismo período YYYY-MM-DD, TZ cuenta Ads) ÷ leadsUnique CRM atribuidos CTWA (cohorte created_at en America/Guayaquil). Sin leadsUnique>0 o sin gasto → “No disponible”. Resultados Meta (actions) aparte de leads CRM y de CAPI meta_accepted.',
    )
    if (adsAccount?.timezoneName) {
      limitations.push(
        `TZ Ads cuenta: ${adsAccount.timezoneName}. TZ informe CRM: ${MARKETING_REPORT_TZ}. Los días del filtro se envían a Insights como YYYY-MM-DD (calendario cuenta); los leads usan bounds Guayaquil.`,
      )
    }
    if (adsAccount?.error) {
      limitations.push(`Cuenta Ads: ${adsAccount.error}`)
    }
  }

  // ——— Por unidad (interés + cita real + reserva real + showroom + ventas) ———
  type UAgg = {
    interest: Set<string>
    appt: Set<string>
    reserved: Set<string>
    reservationTitularUndetermined: boolean
    sales: SaleRow[]
    temp: Record<TemperatureBucket, number>
  }
  const unitAgg = new Map<string, UAgg>()
  function ensureUnit(id: string): UAgg {
    let row = unitAgg.get(id)
    if (!row) {
      row = {
        interest: new Set(),
        appt: new Set(),
        reserved: new Set(),
        reservationTitularUndetermined: false,
        sales: [],
        temp: emptyTemp(),
      }
      unitAgg.set(id, row)
    }
    return row
  }

  let undeterminedApptLeads = 0
  let undeterminedReservedLeads = 0
  let undeterminedTitularUnits = 0

  for (const lu of leadUnits) {
    if (lu.rejected) continue
    const lead = leadById.get(lu.lead_id)
    if (!lead) continue
    const row = ensureUnit(lu.unit_id)
    row.interest.add(lu.lead_id)
    row.temp[bucketTemp(lead.temperature)] += 1
  }

  // Citas → solo unidades de appointment_units
  const undeterminedApptLeadSet = new Set<string>()
  for (const appt of cohortAppts) {
    const { unitIds, undetermined } = resolveAppointmentUnitIds(
      appt.id,
      apptUnitLinks,
    )
    if (undetermined) {
      undeterminedApptLeadSet.add(appt.lead_id)
      continue
    }
    for (const uid of unitIds) {
      ensureUnit(uid).appt.add(appt.lead_id)
    }
  }
  undeterminedApptLeads = undeterminedApptLeadSet.size

  // Reservas → leads cohorte sin unidad reservada real → “unidad no determinada”
  const undeterminedResLeadSet = new Set<string>()
  for (const lead of leads) {
    const { undetermined } = resolveReservedUnitIds({
      leadId: lead.id,
      leadStatus: lead.status,
      leadUnitIds: leadUnitIdsByLead.get(lead.id) || [],
      unitStatusById,
    })
    if (undetermined) undeterminedResLeadSet.add(lead.id)
  }
  undeterminedReservedLeads = undeterminedResLeadSet.size

  // Titular por unidad reservada (todos los vinculados, no solo cohorte)
  const reservedProjectUnits = projectUnits.filter(
    (u) => String(u.status || '').toLowerCase() === 'reservado',
  )
  const reservedUnitIdList = reservedProjectUnits.map((u) => u.id)
  const reservedUnitLinks = await fetchAllInChunks(reservedUnitIdList, (chunk) =>
    fetchAllPages<{ lead_id: string; unit_id: string; rejected: boolean | null }>(
      (from, to) =>
        admin
          .from('lead_units')
          .select('lead_id,unit_id,rejected')
          .in('unit_id', chunk)
          .range(from, to),
    ),
  )
  const activeReservedLinks = reservedUnitLinks.filter((l) => !l.rejected)
  const titularCandidateLeadIds = [
    ...new Set(activeReservedLinks.map((l) => l.lead_id)),
  ]
  const titularLeads = await fetchAllInChunks(titularCandidateLeadIds, (chunk) =>
    fetchAllPages<{ id: string; status: string | null }>((from, to) =>
      admin
        .from('leads')
        .select('id,status')
        .eq('tenant_id', input.tenantId)
        .eq('project_id', input.projectId)
        .in('id', chunk)
        .range(from, to),
    ),
  )
  const titularStatusByLead = new Map(
    titularLeads.map((l) => [l.id, l.status as string | null]),
  )
  const linkedUnitsByLead = new Map<string, string[]>()
  for (const link of activeReservedLinks) {
    const list = linkedUnitsByLead.get(link.lead_id) || []
    list.push(link.unit_id)
    linkedUnitsByLead.set(link.lead_id, list)
  }
  const titularCandidates = titularCandidateLeadIds.map((leadId) => ({
    leadId,
    leadStatus: titularStatusByLead.get(leadId) ?? null,
    linkedUnitIds: linkedUnitsByLead.get(leadId) || [],
  }))

  for (const unit of reservedProjectUnits) {
    const { titularLeadId, undeterminedTitular } = resolveReservationTitular({
      unitId: unit.id,
      unitStatus: unit.status,
      candidates: titularCandidates,
    })
    const row = ensureUnit(unit.id)
    if (undeterminedTitular) {
      row.reservationTitularUndetermined = true
      undeterminedTitularUnits += 1
      continue
    }
    if (titularLeadId) {
      row.reserved.add(titularLeadId)
    }
  }

  for (const s of sales) {
    ensureUnit(s.unit_id).sales.push(s)
  }

  // Incluir unidades solo showroom o solo cita (ya en unitAgg vía appt/showroom)
  for (const [uid, count] of showroomUnitCounts) {
    if (count > 0) ensureUnit(uid)
  }

  const byUnit: UnitFunnelRow[] = [...unitAgg.entries()].map(([unitId, agg]) => {
    const meta = unitsById.get(unitId)
    return {
      unitId,
      unitLabel: meta?.unit_number
        ? `${meta.category || 'unidad'} ${meta.unit_number}`
        : unitId
          ? `unidad:${unitId.slice(0, 8)}`
          : 'unidad no determinada',
      category: meta?.category || null,
      showroomViews: showroomUnitCounts.get(unitId) || 0,
      commercialInterestLeads: agg.interest.size,
      appointmentLeads: agg.appt.size,
      reservedLeads: agg.reservationTitularUndetermined
        ? 0
        : agg.reserved.size,
      reservationTitularUndetermined: agg.reservationTitularUndetermined,
      salesConfirmed: agg.sales.length,
      salesAmount: sumKnownAmounts(agg.sales.map((s) => s.sale_price_final)),
      temperature: agg.temp,
    }
  })
  byUnit.sort(
    (a, b) =>
      b.showroomViews +
        b.commercialInterestLeads +
        b.appointmentLeads +
        b.salesConfirmed -
        (a.showroomViews +
          a.commercialInterestLeads +
          a.appointmentLeads +
          a.salesConfirmed),
  )

  return {
    timezone: MARKETING_REPORT_TZ,
    adsAccountTimezone: adsAccount?.timezoneName ?? null,
    period: input.period,
    tenantId: input.tenantId,
    projectId: input.projectId,
    universes: FUNNEL_UNIVERSES,
    adsAccount,
    totals: {
      leadsAcquiredInPeriod: leads.length,
      leadsWithAttribution: withAttr,
      leadsWithoutAttribution: leads.length - withAttr,
      temperature: totalsTemp,
      appointmentsInPeriod: apptBreakdown,
      appointmentsOccurredInPeriod: apptBreakdown.completed,
      leadsWithAppointmentInPeriod: apptBreakdown.leadsWithCompletedAppointment,
      salesOccurredInPeriod: sales.length,
      salesAmountInPeriod: sumKnownAmounts(
        sales.map((s) => s.sale_price_final),
      ),
      salesCurrency: 'no_disponible',
      contractsCurrentlyAnulled: anulledSnapshot.length,
      contractsAnulledAnnulmentDateKnown: false,
      contractsAnulledInPeriod: 0,
    },
    byAttributedAd,
    byCampaign,
    byUnit,
    undeterminedUnit: {
      appointmentLeads: undeterminedApptLeads,
      reservedLeads: undeterminedReservedLeads,
    },
    undeterminedTitularUnits,
    limitations,
    metaSendGatesUntouched: true,
  }
}

import { currentInterest, type InterestEvidence } from './marketingInterest.logic'
import { internalContactIds } from './marketingEvidence.service'
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
import { loadMarketingAttention } from './marketingAttention.service'
import type { AttentionData } from './marketingAttention.logic'
import { fetchAdsCatalog, configuredAdsAccountId, type AdsCatalog } from '@/lib/meta/adsCatalog'
import { firstAdOrigins, type SavedAdOrigin } from '@/lib/meta/firstAdAcquisition'
import { identifyPropertyFromUrls, summarizePropertyLinks } from '@/lib/meta/adPropertyIdentification'
import { isAdAccountMatch } from '@/lib/meta/adsMarketingClient'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeCrmCostPerLead,
  fetchAdAccountSnapshot,
  fetchAdSpendForPeriod,
  fetchAccountAdInsightsForPeriod,
  fetchAdDestinationEvidence,
  readAdsMarketingCredentials,
  resolveAdHierarchy,
  type AdAccountSnapshot,
} from '@/lib/meta/adsMarketingClient'
import {
  hierarchyFromCache,
  readLatestAdsCache,
  readAdsInsightsCache,
  spendSnapshotFromCache,
  upsertAdsInsightsCache,
} from '@/lib/meta/adsInsightsCache'
import { rollupAttributedAdsByCampaign } from '@/lib/meta/adsCampaignRollup'
import type { CampaignFunnelRollupRow } from '@/lib/meta/adsCampaignRollup'
import {
  listActiveAdPromotedUnits,
  savedPropertyAccount,
  summarizePromotedUnit,
  type AdPromotedUnitSummary,
} from '@/lib/meta/adPromotedUnits'
import {
  FUNNEL_UNIVERSES,
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
  salesCurrency: string | 'no_disponible'
  adSpend: number | null
  /** Moneda Insights (account_currency). null si no hay gasto verificable. */
  currency: string | null
  costPerLead: number | null
  /**
   * Resultado Meta primario (un action_type etiquetado). No suma actions distintos.
   */
  metaReportedResults: number | null
  metaResultActionType: string | null
  metaResultLabel: string | null
  /** Conversiones CAPI meta_accepted de leads de esta cohorte/anuncio. */
  capiMetaAccepted: number | null
  spendFetchedAt: string | null
  /** true si gasto/jerarquía vienen de caché tras fallo Graph. */
  spendStale: boolean
  spendStaleFetchedAt: string | null
  /** IDs CRM para drill-down (mismo universo que leadsUnique). */
  leadIds: string[]
  /** Solo Insights (gasto>0) sin leads CTWA en la cohorte. */
  insightsOnly: boolean
  promotedUnit: AdPromotedUnitSummary
  /** CPL = adSpend / leadsUnique (CRM). null → UI “No disponible”. */
  costPerLeadDefinition: 'ad_spend_div_crm_leads_unique'
  note: string
}

/** @deprecated Use AttributedAdFunnelRow */
export type CampaignFunnelRow = AttributedAdFunnelRow

export type PromotedUnitFunnelRow = {
  unitId: string | null
  unitLabel: string
  adCount: number
  adIds: string[]
  adSpend: number | null
  currency: string | null
  leadsUnique: number
  temperature: Record<TemperatureBucket, number>
  costPerLead: number | null
  leadsWithAppointmentConfirmed: number
  leadsWithAppointmentDone: number
  salesConfirmed: number
  note: string
}

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
  interestByLead?: Record<string,InterestEvidence>
  attention?: AttentionData
  adsCatalog?: AdsCatalog
  adsLastSavedAt?: string|null
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
    salesCurrency: string | 'no_disponible'
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
  /** Campaigns for all ads in the connected account, independently of property classification. */
  byCampaign: CampaignFunnelRollupRow[]
  /** Gasto por unidad promocionada (solo anuncios con vínculo inequívoco). */
  byPromotedUnit: PromotedUnitFunnelRow[]
  adsInsightsCoverage: {
    adsWithSpend: number
    adsWithCrmLeads: number
    adsSpendWithoutLeads: number
    accountAdSpendSum: number | null
    accountAdSpendCurrency: string | null
    insightsIncomplete: boolean
    insightsFetchedAt: string | null
    insightsError: string | null
    currencyStatus: 'live' | 'stale' | 'unknown'
  }
  byUnit: UnitFunnelRow[]
  undeterminedUnit: {
    appointmentLeads: number
    reservedLeads: number
    /** Aclara: citas de la cohorte sin appointment_units (≠ totales del período). */
    note: string
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
  temperature_updated_at: string | null
  temperature_score: number | null
  status: string | null
  contact_id: string | null
  kommo_id: number | null
  created_at: string
}

type AttrRow = {
  external_message_id?: string | null
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
  currency: string | null
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
    'Moneda de ventas: unit_sales_closings.currency (ISO-4217); null histórico → no_disponible.',
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

  const internal=await internalContactIds(admin,input.tenantId)
  if(!internal.available) limitations.push('La clasificación persistente de contactos internos está pendiente de aplicar; todavía no se excluyeron personas.')
  // Cohorte leads
  const allProjectLeads = await fetchAllPages<LeadRow>((from, to) =>
    admin
      .from('leads')
      .select('id,temperature,temperature_updated_at,temperature_score,status,contact_id,kommo_id,created_at')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: true })
      .range(from, to),
  )
  const leads=allProjectLeads.filter(l=>!internal.ids.has(l.id))
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

  // Advertising spans the authorized business, independently of the selected property project.
  // Existing inbound registration reuses lead.id by (tenant_id, phone_normalized).
  const allAdvertisingLeads = await fetchAllPages<LeadRow>((from,to) => admin.from('leads')
    .select('id,temperature,temperature_updated_at,temperature_score,status,contact_id,kommo_id,created_at').eq('tenant_id',input.tenantId)
    .gte('created_at',fromIso).lt('created_at',toExclusiveIso).order('created_at').range(from,to))
  const advertisingLeads=allAdvertisingLeads.filter(l=>!internal.ids.has(l.id))
  const advertisingIds = advertisingLeads.map(l=>l.id)
  const scoreEvidence = await fetchAllInChunks(advertisingIds,chunk=>fetchAllPages<{lead_id:string;reason:string|null}>((from,to)=>admin.from('lead_score_events').select('lead_id,reason').in('lead_id',chunk).order('created_at').range(from,to)))
  const interestByLead:Record<string,InterestEvidence>=Object.fromEntries(advertisingLeads.map(lead=>[lead.id,currentInterest(lead,scoreEvidence.filter(e=>e.lead_id===lead.id).map(e=>e.reason).filter((r):r is string=>Boolean(r)))]))
  const threads = await fetchAllInChunks(advertisingIds,chunk=>fetchAllPages<{lead_id:string;external_thread_id:string|null}>((from,to)=>admin.from('conversations')
    .select('lead_id,external_thread_id').eq('tenant_id',input.tenantId).eq('channel','whatsapp').in('lead_id',chunk).range(from,to)))
  const owners = new Map<string,Set<string>>()
  for (const pair of [...advertisingLeads.map(l=>({lead_id:l.id,external_thread_id:l.contact_id})),...threads]) {
    if (!pair.external_thread_id) continue
    const ids = owners.get(pair.external_thread_id) || new Set<string>()
    ids.add(pair.lead_id); owners.set(pair.external_thread_id,ids)
  }
  const savedOrigins: SavedAdOrigin[] = []
  const advertisingAttrs = await fetchAllInChunks([...owners.keys()],chunk=>fetchAllPages<AttrRow>((from,to)=>admin.from('lv_whatsapp_ctwa_attribution')
    .select('contact_id,kommo_id,source_id,source_url,referral_source_type,captured_at,external_message_id').eq('tenant_id',input.tenantId)
    .in('contact_id',chunk).order('captured_at').range(from,to)))
  for (const attr of advertisingAttrs) {
    const ids = owners.get(attr.contact_id)
    if (ids?.size !== 1 || !attr.source_id || (attr.referral_source_type && attr.referral_source_type !== 'ad')) continue
    savedOrigins.push({leadId:[...ids][0],adId:attr.source_id,recordedAt:attr.captured_at,sourceUrl:attr.source_url,key:'legacy:'+attr.contact_id,externalMessageId:attr.external_message_id})
  }
  try {
    const interactions = await fetchAllInChunks(advertisingIds,chunk=>fetchAllPages<{id:string;lead_id:string;ad_id:string;recorded_at:string;source_url:string|null;external_message_id:string|null}>((from,to)=>admin.from('marketing_ad_interactions')
      .select('id,lead_id,ad_id,recorded_at,source_url,external_message_id').eq('tenant_id',input.tenantId).in('lead_id',chunk).order('recorded_at').order('id').range(from,to)))
    for (const row of interactions) savedOrigins.push({leadId:row.lead_id,adId:row.ad_id,recordedAt:row.recorded_at,sourceUrl:row.source_url,key:row.id,externalMessageId:row.external_message_id})
  } catch (error) {
    const code = (error as {code?:string})?.code
    if (code !== '42P01' && code !== 'PGRST205') throw error
    limitations.push('El historial adicional de interacciones aún no está disponible. Se usa el primer origen guardado disponible; no se reconstruyen interacciones ausentes.')
  }
  const acquisitionByLead = firstAdOrigins(savedOrigins)
  const attention = await loadMarketingAttention(admin,{tenantId:input.tenantId,leadIds:advertisingIds.filter(id=>acquisitionByLead.has(id)),origins:acquisitionByLead,asOf:nowIso})

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
  const advertisingAppts = await fetchAllInChunks(advertisingIds,chunk=>fetchAllPages<ApptRow>((from,to)=>admin.from('appointments')
    .select('id,lead_id,status,no_show,requested_at,confirmed_at,start_time,created_at')
    .eq('tenant_id',input.tenantId).in('lead_id',chunk).range(from,to)))
  const apptsByLead = new Map<string, ApptRow[]>()
  for (const a of advertisingAppts) {
    const list = apptsByLead.get(a.lead_id) || []
    list.push(a)
    apptsByLead.set(a.lead_id, list)
  }

  // Citas del período por start_time (totales) — clasificadas
  const allPeriodAppts = await fetchAllPages<{
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

  const periodAppts=allPeriodAppts.filter(a=>!internal.ids.has(a.lead_id))
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
      .select('id,lead_id,unit_id,sale_price_final,sale_at,currency')
      .eq('tenant_id', input.tenantId)
      .gte('sale_at', fromIso)
      .lt('sale_at', toExclusiveIso)
      .range(from, to),
  )
  const sales = salesRaw.filter((s) => projectUnitIds.has(s.unit_id) && (!s.lead_id || !internal.ids.has(s.lead_id)))
  const saleCurrencies = [
    ...new Set(
      sales
        .map((s) => (s.currency || '').trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c)),
    ),
  ]
  const salesCurrencyResolved: string | 'no_disponible' =
    saleCurrencies.length === 1 ? saleCurrencies[0]! : 'no_disponible'

  const salesByLead = new Map<string, SaleRow[]>()
  for (const s of salesRaw) {
    if (!s.lead_id || internal.ids.has(s.lead_id)) continue
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
  const allShowroomVisits = await fetchAllPages<{ id: string; lead_id: string|null }>((from, to) =>
    admin
      .from('showroom_visits')
      .select('id,lead_id')
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .gte('visit_start', fromIso)
      .lt('visit_start', toExclusiveIso)
      .range(from, to),
  )
  const showroomVisits=allShowroomVisits.filter(v=>!v.lead_id || !internal.ids.has(v.lead_id))
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
  const allProjectLeadIds = projectLeadIdsAll.filter(l=>!internal.ids.has(l.id)).map((l) => l.id)
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
      if (!known.has(r.id) && (!r.lead_id || !internal.ids.has(r.lead_id))) {
        known.add(r.id)
        anulledContracts.push(r)
      }
    }
  }
  const anulledSnapshot = snapshotAnulledContracts(anulledContracts)

  // ——— Agregación por anuncio ———
  const totalsTemp = emptyTemp()
  for (const l of leads) totalsTemp[currentInterest(l).bucket] += 1
  const withAttr = leads.filter(
    (l) => acquisitionByLead.has(l.id),
  ).length

  type Agg = { leads: LeadRow[]; attr: AttrRow | null }
  const byKey = new Map<string, Agg>()
  for (const lead of advertisingLeads) {
    const origin = acquisitionByLead.get(lead.id)
    const attr: AttrRow | null = origin ? {contact_id:lead.contact_id || '',kommo_id:lead.kommo_id,
      source_id:origin.adId,source_url:origin.sourceUrl,referral_source_type:'ad',captured_at:origin.recordedAt} : null
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
    const adSaleCurrencies = new Set<string>()
    for (const lead of agg.leads) {
      temp[currentInterest(lead).bucket] += 1
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
      for (const s of ls) {
        saleAmounts.push(s.sale_price_final)
        adSaleCurrencies.add(s.currency || 'unknown')
      }
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
      salesAmount: adSaleCurrencies.size === 1 && !adSaleCurrencies.has('unknown') ? sumKnownAmounts(saleAmounts) : null,
      salesCurrency: adSaleCurrencies.size === 1 && !adSaleCurrencies.has('unknown') ? [...adSaleCurrencies][0] : 'no_disponible',
      adSpend: null as number | null,
      currency: null as string | null,
      costPerLead: null as number | null,
      metaReportedResults: null as number | null,
      metaResultActionType: null as string | null,
      metaResultLabel: null as string | null,
      capiMetaAccepted: null as number | null,
      spendFetchedAt: null as string | null,
      spendStale: false,
      spendStaleFetchedAt: null as string | null,
      leadIds: agg.leads.map((l) => l.id),
      insightsOnly: false,
      promotedUnit: summarizePropertyLinks(adId || key, []),
      costPerLeadDefinition: 'ad_spend_div_crm_leads_unique' as const,
      note:
        key === 'sin_atribucion'
          ? 'Sin first-touch CTWA. Universos: leads cohorte; citas cohorte sin filtro temporal; ventas sale_at∈período.'
          : 'CTWA source_id (=ad_id). CPL = gasto Insights ÷ leadsUnique CRM. Aceptación CAPI Graph ≠ atribución campaña.',
    }
  }

  const adsCreds = readAdsMarketingCredentials()
  const accountId = configuredAdsAccountId() || await savedPropertyAccount(admin,{tenantId:input.tenantId,projectId:input.projectId,adIds:[...byKey.values()].map(v=>v.attr?.source_id).filter((id):id is string=>Boolean(id))})
  const adsCatalog = await fetchAdsCatalog()
  let adsLastSavedAt: string|null = null
  if (accountId) {
    const savedCatalog = await readLatestAdsCache(admin,accountId,'account',accountId+':catalog')
    if (adsCatalog.status==='success') {
      await upsertAdsInsightsCache(admin,{adAccountId:accountId,entityLevel:'account',entityId:accountId+':catalog',periodFrom:input.period.from,periodTo:input.period.to,spend:null,currency:null,hierarchy:{catalog:adsCatalog},fetchedAt:adsCatalog.successfulAt!})
    } else if (savedCatalog) {
      const previous=savedCatalog.hierarchy.catalog as AdsCatalog|undefined
      if (previous?.campaigns && previous.ads) {
        adsCatalog.campaigns=[...new Map([...previous.campaigns,...adsCatalog.campaigns].map(c=>[c.id,c])).values()]
        adsCatalog.ads=[...new Map([...previous.ads,...adsCatalog.ads].map(a=>[a.id,a])).values()]
        adsCatalog.successfulAt=savedCatalog.fetched_at
      }
    }
  }
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
        if (accountId) {
          const latest=await readLatestAdsCache(admin,accountId,'ad',row.adId)
          const cached=await readAdsInsightsCache(admin,{adAccountId:accountId,entityLevel:'ad',entityId:row.adId,periodFrom:input.period.from,periodTo:input.period.to})
          const hierarchy=latest?hierarchyFromCache(latest,row.adId):null
          if (hierarchy) Object.assign(row,{adName:hierarchy.adName,adsetId:hierarchy.adsetId,adsetName:hierarchy.adsetName,campaignId:hierarchy.campaignId,campaignName:hierarchy.campaignName,resolutionStatus:'resolved',spendStale:true})
          if (latest && (!adsLastSavedAt || latest.fetched_at>adsLastSavedAt)) adsLastSavedAt=latest.fetched_at
          if (cached && !cached.last_error) Object.assign(row,{adSpend:cached.spend==null?null:Number(cached.spend),currency:cached.currency,spendStale:true,spendStaleFetchedAt:cached.fetched_at,spendFetchedAt:cached.fetched_at,costPerLead:computeCrmCostPerLead(cached.spend==null?null:Number(cached.spend),row.leadsUnique)})
        }
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

    if (hierarchy.resolutionStatus === 'resolved' && hierarchy.adAccountId && !isAdAccountMatch(hierarchy.adAccountId, adsCreds.adAccountId)) {
      row.resolutionStatus = 'unresolved'
      row.note = 'El anuncio no pertenece a la cuenta configurada.'
      continue
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
          metaResultActionType: spendSnap.metaResultActionType,
          metaResultLabel: spendSnap.metaResultLabel,
          metaOtherActionTypes: spendSnap.metaOtherActionTypes,
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
    row.metaResultActionType = spendSnap.metaResultActionType ?? null
    row.metaResultLabel = spendSnap.metaResultLabel ?? null
    row.spendFetchedAt = spendSnap.stale
      ? spendSnap.staleFetchedAt || spendSnap.fetchedAt
      : spendSnap.fetchedAt
    row.costPerLead = computeCrmCostPerLead(spendSnap.spend, row.leadsUnique)
    if (spendSnap.adName && !row.adName) row.adName = spendSnap.adName
    if (spendSnap.adsetId && !row.adsetId) row.adsetId = spendSnap.adsetId
    if (spendSnap.adsetName && !row.adsetName) row.adsetName = spendSnap.adsetName
    if (spendSnap.campaignId && !row.campaignId) {
      row.campaignId = spendSnap.campaignId
      row.campaignName = spendSnap.campaignName ?? row.campaignName
      if (row.resolutionStatus === 'missing_ads_token') {
        row.resolutionStatus = 'resolved'
      }
    }
    if (spendSnap.error) {
      row.note = `${row.note} Gasto: ${spendSnap.error}`
    }
    if (row.spendStale && row.spendStaleFetchedAt) {
      row.note = `${row.note} Datos Ads stale desde ${row.spendStaleFetchedAt}.`
    }
    byAttributedAd.push(row)
  }
  byAttributedAd.sort((a, b) => b.leadsUnique - a.leadsUnique)

  // Insights cuenta completa: anuncios con gasto aunque leads CRM = 0.
  const accountInsights = await fetchAccountAdInsightsForPeriod(input.period, { onlyWithSpend: false })
  const adsInsightsCoverage = {
    adsWithSpend: accountInsights.ads.filter(ad => (ad.spend ?? 0) > 0).length,
    adsWithCrmLeads: byAttributedAd.filter((r) => r.adId && r.leadsUnique > 0)
      .length,
    adsSpendWithoutLeads: 0,
    accountAdSpendSum: accountInsights.spendSumSameCurrency,
    accountAdSpendCurrency: accountInsights.currency,
    insightsIncomplete: accountInsights.incomplete || Boolean(accountInsights.error),
    insightsFetchedAt: accountInsights.error || accountInsights.incomplete ? null : accountInsights.fetchedAt,
    insightsError: accountInsights.error,
    currencyStatus: accountInsights.error
      ? 'unknown' as const
      : 'live' as const,
  }
  if (adsCreds && accountInsights.ads.length > 0) {
    const known = new Set(
      byAttributedAd.map((r) => r.adId).filter(Boolean) as string[],
    )
    for (const snap of accountInsights.ads) {
      if (!snap.adId || known.has(snap.adId)) {
        // Actualizar gasto/nombres si la fila CTWA ya existe y aún no tiene spend.
        const existing = byAttributedAd.find((r) => r.adId === snap.adId)
        if (existing) {
          existing.spendStale = false
          existing.adSpend = snap.spend
          existing.currency = snap.currency
          existing.metaReportedResults = snap.metaReportedResults
          existing.metaResultActionType = snap.metaResultActionType
          existing.metaResultLabel = snap.metaResultLabel
          existing.costPerLead = computeCrmCostPerLead(
            snap.spend,
            existing.leadsUnique,
          )
          existing.spendFetchedAt = snap.fetchedAt
          if (snap.adName) existing.adName = snap.adName
          if (snap.campaignId) {
            existing.campaignId = snap.campaignId
            existing.campaignName = snap.campaignName ?? null
            existing.resolutionStatus = 'resolved'
          }
        }
        continue
      }
      known.add(snap.adId)
      byAttributedAd.push({
        attributionKey: `ad:${snap.adId}`,
        adId: snap.adId,
        adName: snap.adName ?? null,
        adsetId: snap.adsetId ?? null,
        adsetName: snap.adsetName ?? null,
        campaignId: snap.campaignId ?? null,
        campaignName: snap.campaignName ?? null,
        resolutionStatus: snap.campaignId ? 'resolved' : 'unresolved',
        sourceUrlPresent: false,
        referralSourceType: null,
        leadsUnique: 0,
        temperature: emptyTemp(),
        leadsWithAppointmentRequested: 0,
        leadsWithAppointmentConfirmed: 0,
        leadsWithAppointmentDone: 0,
        appointmentCancelCount: 0,
        appointmentNoShowCount: 0,
        appointmentReprogrammedCount: 0,
        leadsReserved: 0,
        salesConfirmed: 0,
        salesAmount: null,
        salesCurrency: 'no_disponible',
        adSpend: snap.spend,
        currency: snap.currency,
        costPerLead: null,
        metaReportedResults: snap.metaReportedResults,
        metaResultActionType: snap.metaResultActionType,
        metaResultLabel: snap.metaResultLabel,
        capiMetaAccepted: null,
        spendFetchedAt: snap.fetchedAt,
        spendStale: false,
        spendStaleFetchedAt: null,
        leadIds: [],
        insightsOnly: true,
        promotedUnit: summarizePropertyLinks(snap.adId, []),
        costPerLeadDefinition: 'ad_spend_div_crm_leads_unique',
        note:
          'Anuncio con gasto reportado por Meta (Insights) sin leads CRM first-touch CTWA en la cohorte del período. CPL No disponible.',
      })
    }
    adsInsightsCoverage.adsSpendWithoutLeads = byAttributedAd.filter(
      (r) => r.insightsOnly,
    ).length
    // Cache account-level rows best-effort
    for (const snap of accountInsights.ads.slice(0, 80)) {
      if (snap.spend == null) continue
      await upsertAdsInsightsCache(admin, {
        adAccountId: adsCreds.adAccountId,
        entityLevel: 'ad',
        entityId: snap.adId,
        periodFrom: input.period.from,
        periodTo: input.period.to,
        spend: snap.spend,
        currency: snap.currency,
        impressions: snap.impressions,
        clicks: snap.clicks,
        metaReportedResults: snap.metaReportedResults,
        hierarchy: {
          adName: snap.adName,
          adsetId: snap.adsetId,
          adsetName: snap.adsetName,
          campaignId: snap.campaignId,
          campaignName: snap.campaignName,
          metaResultActionType: snap.metaResultActionType,
          metaResultLabel: snap.metaResultLabel,
        },
        fetchedAt: snap.fetchedAt,
      })
    }
  } else if (accountInsights.error && adsCreds) {
    limitations.push(`Insights cuenta: ${accountInsights.error}`)
  }

  // Catalog ads appear even without CRM contacts or a spend row for the period.
  for (const ad of adsCatalog.ads) {
    let row=byAttributedAd.find(r=>r.adId===ad.id)
    if (!row) {
      row=summarizeAttributedAdBase('ad:'+ad.id,{leads:[],attr:{contact_id:'',kommo_id:null,source_id:ad.id,source_url:null,referral_source_type:'ad',captured_at:nowIso}})
      row.insightsOnly=true
      byAttributedAd.push(row)
    }
    row.adName=ad.name;row.adsetId=ad.adsetId;row.campaignId=ad.campaignId
    row.campaignName=adsCatalog.campaigns.find(c=>c.id===ad.campaignId)?.name || row.campaignName
    row.resolutionStatus='resolved'
    if (adsCatalog.status!=='success') row.spendStale=true
  }

  // Saved corrections take precedence; destination evidence never uses lead_units.
  const promotedMap = accountId ? await listActiveAdPromotedUnits(admin, {
    tenantId: input.tenantId, projectId: input.projectId, adAccountId: accountId!,
    adIds: byAttributedAd.map(r=>r.adId).filter((id):id is string=>Boolean(id)),
  }) : new Map<string, AdPromotedUnitSummary>()
  const pendingEvidence = byAttributedAd.filter(row=>row.adId && !promotedMap.has(row.adId))
  for (let i=0; adsCreds && i<pendingEvidence.length; i+=5) {
    await Promise.all(pendingEvidence.slice(i,i+5).map(async row=>{
      const evidence = await fetchAdDestinationEvidence(row.adId!)
      if (!evidence.verifiedAccount) return
      const urls = evidence.urls.length ? evidence.urls : [...new Set(attrs.filter(a=>a.source_id===row.adId).map(a=>a.source_url).filter((u):u is string=>Boolean(u)))]
      promotedMap.set(row.adId!,identifyPropertyFromUrls(row.adId!,urls,projectUnits))
    }))
  }
  for (const row of byAttributedAd) {
    row.promotedUnit = summarizePromotedUnit(row.adId || row.attributionKey,promotedMap)
  }

  byAttributedAd.sort((a, b) => {
    const sa = a.adSpend ?? -1
    const sb = b.adSpend ?? -1
    if (sb !== sa) return sb - sa
    return b.leadsUnique - a.leadsUnique
  })

  // Campaign totals include every property classification, counting each ad once.
  const byCampaign = rollupAttributedAdsByCampaign(
    byAttributedAd.map((r) => ({
      adId: r.adId,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      resolutionStatus: r.resolutionStatus,
      leadsUnique: r.leadsUnique,
      leadIds: r.leadIds,
      temperature: r.temperature,
      adSpend: r.adSpend,
      currency: r.currency,
      metaReportedResults: r.metaReportedResults,
      spendStale: r.spendStale,
      spendFetchedAt: r.spendFetchedAt,
      costPerLead: r.costPerLead,
    })),
  )

  // Classified subsets must never inherit the spend of an entire mixed campaign.
  if (!adsCreds) {
    limitations.push(
      'Datos publicitarios no disponibles: faltan META_AD_ACCOUNT_ID y META_ADS_ACCESS_TOKEN (System User ads_read) en Vercel Production. No reutilizar META_CAPI_* ni META_WA_CAPI_*.',
    )
  } else {
    limitations.push(
      'CPL = gasto Insights (YYYY-MM-DD, TZ cuenta Ads) ÷ leadsUnique CRM first-touch CTWA (cohorte Guayaquil). Sin leads>0 o sin gasto → “No disponible”. Resultado Meta = un action_type preferente (no suma de actions).',
    )
    limitations.push(
      'Gasto = reportado por Meta, no presupuesto. Cada grupo suma solo sus anuncios; no se incorpora el gasto completo de una campaña mixta.',
    )
    if (adsAccount?.timezoneName) {
      const aligned =
        adsAccount.timezoneName === MARKETING_REPORT_TZ ||
        adsAccount.timezoneName === 'America/Guayaquil'
      limitations.push(
        aligned
          ? `TZ Ads (${adsAccount.timezoneName}) alineada con informe CRM.`
          : `TZ Ads: ${adsAccount.timezoneName}. TZ CRM: ${MARKETING_REPORT_TZ}. Insights usa YYYY-MM-DD de la cuenta; leads usan bounds Guayaquil — validar bordes de día si difieren.`,
      )
    }
    if (adsAccount?.error) limitations.push(`Cuenta Ads: ${adsAccount.error}`)
    if (adsInsightsCoverage.insightsIncomplete) {
      limitations.push(
        'Insights de cuenta incompleto o con error; revisar paginación/caché.',
      )
    }
    if (adsInsightsCoverage.currencyStatus === 'unknown') {
      limitations.push(
        'Moneda de filas Ads no confirmada en vivo: si se sirve caché, puede reflejar la moneda histórica del período; no se convierten ni suman monedas distintas.',
      )
    }
  }

  // Gasto por unidad promocionada (solo vínculos inequívocos).
  type PAgg = {
    unitId: string
    unitLabel: string
    adIds: Set<string>
    spends: Array<{ spend: number; currency: string | null }>
    missingSpend: boolean
    leads: Set<string>
    temperature: Record<TemperatureBucket, number>
    conf: number
    done: number
    sales: number
  }
  const promotedAgg = new Map<string, PAgg>()
  for (const row of byAttributedAd) {
    const uid = row.promotedUnit.unambiguousUnitId
    if (!uid || !row.adId) continue
    let acc = promotedAgg.get(uid)
    if (!acc) {
      acc = {
        unitId: uid,
        unitLabel: row.promotedUnit.label,
        adIds: new Set(),
        spends: [],
        missingSpend: false,
        leads: new Set(),
        temperature: emptyTemp(),
        conf: 0,
        done: 0,
        sales: 0,
      }
      promotedAgg.set(uid, acc)
    }
    for (const lid of row.leadIds) acc.leads.add(lid)
    if (acc.adIds.has(row.adId)) continue
    acc.adIds.add(row.adId)
    if (row.adSpend == null || !row.currency) acc.missingSpend = true
    if (row.adSpend != null) acc.spends.push({ spend: row.adSpend, currency: row.currency })
    for (const k of Object.keys(acc.temperature) as TemperatureBucket[]) {
      acc.temperature[k] += row.temperature[k] || 0
    }
    acc.conf += row.leadsWithAppointmentConfirmed
    acc.done += row.leadsWithAppointmentDone
    acc.sales += row.salesConfirmed
  }
  const byPromotedUnit: PromotedUnitFunnelRow[] = [...promotedAgg.values()].map(
    (acc) => {
      const currencies = [
        ...new Set(
          acc.spends
            .map((s) => (s.currency || '').trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
      let adSpend: number | null = null
      let currency: string | null = null
      let note =
        'Suma de gasto de anuncios con vínculo inequívoco a esta unidad. Distinto de lead_units (interés del lead).'
      if (!acc.spends.length || acc.missingSpend) note += ' Falta gasto o moneda en alguno de los anuncios; no se calcula el total.'
      else if (currencies.length > 1) {
        note += ' Monedas distintas; gasto no sumado.'
      } else {
        adSpend =
          Math.round(acc.spends.reduce((s, x) => s + x.spend, 0) * 100) / 100
        currency = currencies[0] || acc.spends[0]?.currency || null
      }
      const leadsUnique = acc.leads.size
      return {
        unitId: acc.unitId,
        unitLabel: acc.unitLabel,
        adCount: acc.adIds.size,
        adIds: [...acc.adIds],
        adSpend,
        currency,
        leadsUnique,
        temperature: acc.temperature,
        costPerLead: computeCrmCostPerLead(adSpend, leadsUnique),
        leadsWithAppointmentConfirmed: acc.conf,
        leadsWithAppointmentDone: acc.done,
        salesConfirmed: acc.sales,
        note,
      }
    },
  )
  byPromotedUnit.sort((a, b) => (b.adSpend || 0) - (a.adSpend || 0))

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
    row.temp[currentInterest(lead).bucket] += 1
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
  const activeReservedLinks = reservedUnitLinks.filter((l) => !l.rejected && !internal.ids.has(l.lead_id))
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
    adsCatalog,
    attention,
    interestByLead,
    adsLastSavedAt,
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
      salesCurrency: salesCurrencyResolved,
      contractsCurrentlyAnulled: anulledSnapshot.length,
      contractsAnulledAnnulmentDateKnown: false,
      contractsAnulledInPeriod: 0,
    },
    byAttributedAd,
    byCampaign,
    byPromotedUnit,
    adsInsightsCoverage,
    byUnit,
    undeterminedUnit: {
      appointmentLeads: undeterminedApptLeads,
      reservedLeads: undeterminedReservedLeads,
      note:
        'Citas de la cohorte (leads acquired en período) sin filas en appointment_units — no son las “citas del período” del KPI total (start_time ∈ período).',
    },
    undeterminedTitularUnits,
    limitations,
    metaSendGatesUntouched: true,
  }
}

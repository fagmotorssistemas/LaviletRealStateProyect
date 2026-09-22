/**
 * Métricas internas de embudo inmobiliario (anuncios atribuidos CTWA first-touch + unidad).
 * No dispara CAPI ni cambia gates de envío Meta.
 * Zona horaria de informe: America/Guayaquil.
 *
 * Fechas por estado (no reconstruir desde estado actual sin historial):
 * - Lead adquirido: leads.created_at
 * - Cita solicitada (cohorte): appointments.requested_at || created_at (estado solicitada/pendiente)
 * - Cita confirmada: appointments.confirmed_at (si null, no se inventa desde status)
 * - Cita ocurrida / no-show: appointments.start_time (+ no_show al cierre atendido)
 * - Cancelación: filas con status=cancelado (sin cancelled_at dedicado en schema)
 * - Reprogramación: status=reprogramado (sin timestamp dedicado de reprogramación)
 * - Venta confirmada: unit_sales_closings.sale_at
 * - Anulación contractual: contracts.status=anulado + signed_at||created_at (no hay anulación de closing)
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export const MARKETING_REPORT_TZ = 'America/Guayaquil'

export type MarketingFunnelPeriod = {
  /** ISO date YYYY-MM-DD (día Ecuador inclusivo) */
  from: string
  to: string
}

export type TemperatureBucket = 'frio' | 'tibio' | 'caliente' | 'sin_clasificar'

export type AttributedAdFunnelRow = {
  attributionKey: string
  /** CTWA referral source_id — anuncio opaco hasta resolución Marketing API */
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
  sourceUrlPresent: boolean
  referralSourceType: string | null
  leadsUnique: number
  temperature: Record<TemperatureBucket, number>
  leadsWithAppointmentRequested: number
  leadsWithAppointmentConfirmed: number
  leadsWithAppointmentDone: number
  appointmentCancelCount: number
  appointmentNoShowCount: number
  appointmentReprogrammedCount: number
  leadsReserved: number
  salesConfirmed: number
  salesAmount: number | null
  salesCurrency: 'USD' | 'no_disponible'
  adSpend: number | null
  costPerLead: number | null
  note: string
}

/** @deprecated Use AttributedAdFunnelRow — no son “campañas” Meta. */
export type CampaignFunnelRow = AttributedAdFunnelRow

export type UnitFunnelRow = {
  unitId: string | null
  unitLabel: string
  category: string | null
  showroomViews: number
  commercialInterestLeads: number
  appointmentLeads: number
  reservedLeads: number
  salesConfirmed: number
  salesAmount: number | null
  temperature: Record<TemperatureBucket, number>
}

export type MarketingFunnelReport = {
  timezone: typeof MARKETING_REPORT_TZ
  period: MarketingFunnelPeriod
  tenantId: string
  projectId: string
  totals: {
    leadsAcquiredInPeriod: number
    leadsWithAttribution: number
    leadsWithoutAttribution: number
    temperature: Record<TemperatureBucket, number>
    appointmentsOccurredInPeriod: number
    leadsWithAppointmentInPeriod: number
    salesOccurredInPeriod: number
    salesAmountInPeriod: number | null
    salesCurrency: 'USD' | 'no_disponible'
    contractsAnulledInPeriod: number
  }
  /** Anuncios atribuidos (ad_id = CTWA source_id), no grupos planificador ni campaigns Ads. */
  byAttributedAd: AttributedAdFunnelRow[]
  byUnit: UnitFunnelRow[]
  limitations: string[]
  metaSendGatesUntouched: true
}

function emptyTemp(): Record<TemperatureBucket, number> {
  return { frio: 0, tibio: 0, caliente: 0, sin_clasificar: 0 }
}

function bucketTemp(raw: string | null | undefined): TemperatureBucket {
  const t = String(raw || '').trim().toLowerCase()
  if (t === 'frio' || t === 'tibio' || t === 'caliente') return t
  return 'sin_clasificar'
}

function isDateYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Límites UTC del día Ecuador inclusivo [from, to]. */
export function ecuadorDayBoundsUtc(fromYmd: string, toYmd: string): {
  fromIso: string
  toExclusiveIso: string
} {
  if (!isDateYmd(fromYmd) || !isDateYmd(toYmd)) {
    throw new Error('period_from_to_must_be_YYYY-MM-DD')
  }
  // Medianoche Ecuador = 05:00 UTC (sin DST).
  const fromIso = `${fromYmd}T05:00:00.000Z`
  const toDate = new Date(`${toYmd}T05:00:00.000Z`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { fromIso, toExclusiveIso: toDate.toISOString() }
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

/**
 * First-touch: una fila attribution por contact; no tratar source_id como campaign_id.
 */
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
  const limitations: string[] = [
    'Gasto publicitario / CPL: no disponible (sin Insights ni token Marketing API con ads_read).',
    'Resolución ad→adset→campaign: Graph con META_CAPI_* / META_WA_CAPI_* → error 100/33 (objeto inexistente o sin permisos ads). Falta System User token con ads_read sobre la cuenta publicitaria del anuncio.',
    'byAttributedAd agrupa por CTWA source_id (=ad_id opaco); no son “campañas” del planificador ni campaign_id Meta.',
    'Moneda de ventas: no hay currency en unit_sales_closings → salesCurrency=no_disponible.',
    'Anulación de venta: no hay cancelación de unit_sales_closings; solo contracts.status=anulado (fecha signed_at||created_at).',
    'Cita confirmada exige appointments.confirmed_at (no se deduce solo del status). Reprogramación: solo status=reprogramado sin timestamp dedicado.',
    'Cohorte leads = created_at Ecuador; citas ocurridas = start_time; ventas = sale_at.',
    'Sumar byUnit.commercialInterestLeads puede superar leads únicos globales.',
    'Paginación defensiva: hasta 10000 leads/attrs/citas por consulta.',
    'Gates de envío Meta (Pixel/CAPI/WA) no se modifican en este informe.',
  ]

  const leadsRes = await admin
    .from('leads')
    .select('id,temperature,status,contact_id,kommo_id,created_at')
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
    .gte('created_at', fromIso)
    .lt('created_at', toExclusiveIso)
    .order('created_at', { ascending: true })
    .limit(10000)

  if (leadsRes.error) throw leadsRes.error
  const leads = (leadsRes.data || []) as LeadRow[]

  // Paginación defensiva: si hay exactamente 10000, marcar truncación.
  if (leads.length >= 10000) {
    limitations.push(
      'Leads del período truncados a 10000 filas; ampliar paginación si el volumen crece.',
    )
  }

  const contactIds = [
    ...new Set(
      leads.map((l) => l.contact_id).filter((c): c is string => Boolean(c)),
    ),
  ]
  const leadIds = leads.map((l) => l.id)

  let attrs: AttrRow[] = []
  if (contactIds.length) {
    const attrRes = await admin
      .from('lv_whatsapp_ctwa_attribution')
      .select(
        'contact_id,kommo_id,source_id,source_url,referral_source_type,captured_at',
      )
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .in('contact_id', contactIds)
      .limit(10000)
    if (attrRes.error) throw attrRes.error
    attrs = (attrRes.data || []) as AttrRow[]
  }

  const attrByContact = new Map<string, AttrRow>()
  for (const a of attrs) {
    if (!attrByContact.has(a.contact_id)) attrByContact.set(a.contact_id, a)
  }

  let appts: ApptRow[] = []
  if (leadIds.length) {
    const apptRes = await admin
      .from('appointments')
      .select(
        'id,lead_id,status,no_show,requested_at,confirmed_at,start_time,created_at',
      )
      .eq('tenant_id', input.tenantId)
      .eq('project_id', input.projectId)
      .in('lead_id', leadIds)
      .limit(10000)
    if (apptRes.error) throw apptRes.error
    appts = (apptRes.data || []) as ApptRow[]
  }

  // Citas cuyo start_time cae en el período (ocurrencia), aparte de cohorte lead.
  const apptsOccurredRes = await admin
    .from('appointments')
    .select('id,lead_id,status,no_show,start_time')
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
    .gte('start_time', fromIso)
    .lt('start_time', toExclusiveIso)
    .limit(10000)
  if (apptsOccurredRes.error) throw apptsOccurredRes.error
  const apptsOccurred = (apptsOccurredRes.data || []) as Array<{
    id: string
    lead_id: string
    status: string | null
    no_show: boolean | null
    start_time: string | null
  }>

  let sales: SaleRow[] = []
  const salesRes = await admin
    .from('unit_sales_closings')
    .select('id,lead_id,unit_id,sale_price_final,sale_at')
    .eq('tenant_id', input.tenantId)
    .gte('sale_at', fromIso)
    .lt('sale_at', toExclusiveIso)
    .limit(5000)
  if (salesRes.error) throw salesRes.error
  sales = (salesRes.data || []) as SaleRow[]

  const leadUnitsRes = leadIds.length
    ? await admin
        .from('lead_units')
        .select('lead_id,unit_id,interest_level,rejected')
        .in('lead_id', leadIds)
        .limit(20000)
    : { data: [], error: null }
  if (leadUnitsRes.error) throw leadUnitsRes.error
  const leadUnits = (leadUnitsRes.data || []) as Array<{
    lead_id: string
    unit_id: string
    interest_level: string | null
    rejected: boolean | null
  }>

  const unitIds = [
    ...new Set([
      ...leadUnits.map((u) => u.unit_id),
      ...sales.map((s) => s.unit_id),
    ]),
  ]
  const unitsRes = unitIds.length
    ? await admin
        .from('units')
        .select('id,unit_number,category,project_id,tenant_id')
        .eq('tenant_id', input.tenantId)
        .in('id', unitIds)
        .limit(5000)
    : { data: [], error: null }
  if (unitsRes.error) throw unitsRes.error
  const unitsById = new Map(
    ((unitsRes.data || []) as Array<{
      id: string
      unit_number: string | null
      category: string | null
    }>).map((u) => [u.id, u]),
  )

  // Showroom: visitas en período → unidades
  const showroomRes = await admin
    .from('showroom_visits')
    .select('id,visit_start,created_at')
    .eq('tenant_id', input.tenantId)
    .limit(5000)
  const showroomVisits = ((showroomRes.data || []) as Array<{
    id: string
    visit_start?: string | null
    created_at?: string | null
  }>).filter((v) => {
    const ts = v.visit_start || v.created_at
    if (!ts) return false
    return ts >= fromIso && ts < toExclusiveIso
  })
  if (showroomRes.error) {
    limitations.push(`showroom_visits: ${showroomRes.error.message}`)
  }
  const showroomIds = showroomVisits.map((v) => v.id)
  const showroomUnitsRes = showroomIds.length
    ? await admin
        .from('showroom_visit_units')
        .select('showroom_visit_id,unit_id')
        .in('showroom_visit_id', showroomIds)
        .limit(20000)
    : { data: [], error: null }
  if (showroomUnitsRes.error) throw showroomUnitsRes.error
  const showroomUnitCounts = new Map<string, number>()
  for (const row of (showroomUnitsRes.data || []) as Array<{
    unit_id: string
  }>) {
    showroomUnitCounts.set(
      row.unit_id,
      (showroomUnitCounts.get(row.unit_id) || 0) + 1,
    )
  }

  const totalsTemp = emptyTemp()
  for (const l of leads) totalsTemp[bucketTemp(l.temperature)] += 1

  const withAttr = leads.filter(
    (l) => l.contact_id && attrByContact.has(l.contact_id),
  ).length

  // Agrupar por ad_id (source_id) o sin_atribucion
  type Agg = {
    leads: LeadRow[]
    attr: AttrRow | null
  }
  const byKey = new Map<string, Agg>()
  for (const lead of leads) {
    const attr = lead.contact_id
      ? attrByContact.get(lead.contact_id) || null
      : null
    const key = attr?.source_id
      ? `ad:${attr.source_id}`
      : 'sin_atribucion'
    const bucket = byKey.get(key) || { leads: [], attr }
    bucket.leads.push(lead)
    if (!bucket.attr && attr) bucket.attr = attr
    byKey.set(key, bucket)
  }

  const apptsByLead = new Map<string, ApptRow[]>()
  for (const a of appts) {
    const list = apptsByLead.get(a.lead_id) || []
    list.push(a)
    apptsByLead.set(a.lead_id, list)
  }

  const salesByLead = new Map<string, SaleRow[]>()
  for (const s of sales) {
    if (!s.lead_id) continue
    const list = salesByLead.get(s.lead_id) || []
    list.push(s)
    salesByLead.set(s.lead_id, list)
  }

  function summarizeAttributedAd(key: string, agg: Agg): AttributedAdFunnelRow {
    const temp = emptyTemp()
    let req = 0
    let conf = 0
    let done = 0
    let cancel = 0
    let noshow = 0
    let reprog = 0
    let reserved = 0
    let salesN = 0
    let salesAmt = 0
    for (const lead of agg.leads) {
      temp[bucketTemp(lead.temperature)] += 1
      const status = String(lead.status || '').toLowerCase()
      if (status === 'reservado') reserved += 1
      const list = apptsByLead.get(lead.id) || []
      if (list.some((a) => a.status === 'solicitada' || a.status === 'pendiente'))
        req += 1
      // Solo confirmed_at — no inventar confirmación desde status.
      if (list.some((a) => Boolean(a.confirmed_at))) conf += 1
      if (list.some((a) => a.status === 'atendido' && !a.no_show)) done += 1
      cancel += list.filter((a) => a.status === 'cancelado').length
      noshow += list.filter((a) => a.no_show === true).length
      reprog += list.filter((a) => a.status === 'reprogramado').length
      const ls = salesByLead.get(lead.id) || []
      salesN += ls.length
      for (const s of ls) salesAmt += Number(s.sale_price_final || 0)
    }
    const adId = agg.attr?.source_id || null
    return {
      attributionKey: key,
      adId,
      adName: null,
      adsetId: null,
      adsetName: null,
      campaignId: null,
      campaignName: null,
      resolutionStatus: adId ? 'graph_permission_denied' : 'unresolved',
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
      salesAmount: salesN > 0 ? salesAmt : null,
      salesCurrency: 'no_disponible',
      adSpend: null,
      costPerLead: null,
      note:
        key === 'sin_atribucion'
          ? 'Sin first-touch CTWA verificable'
          : 'Anuncio atribuido (CTWA source_id). adset/campaign no resueltos: falta token Marketing API ads_read (Graph 100/33 con tokens CAPI).',
    }
  }

  const byAttributedAd = [...byKey.entries()]
    .map(([k, v]) => summarizeAttributedAd(k, v))
    .sort((a, b) => b.leadsUnique - a.leadsUnique)

  // Por unidad
  const unitAgg = new Map<
    string,
    {
      leadIds: Set<string>
      interest: Set<string>
      appt: Set<string>
      reserved: Set<string>
      sales: SaleRow[]
      temp: Record<TemperatureBucket, number>
    }
  >()
  function ensureUnit(id: string) {
    let row = unitAgg.get(id)
    if (!row) {
      row = {
        leadIds: new Set(),
        interest: new Set(),
        appt: new Set(),
        reserved: new Set(),
        sales: [],
        temp: emptyTemp(),
      }
      unitAgg.set(id, row)
    }
    return row
  }

  const leadById = new Map(leads.map((l) => [l.id, l]))
  for (const lu of leadUnits) {
    if (lu.rejected) continue
    const lead = leadById.get(lu.lead_id)
    if (!lead) continue
    const row = ensureUnit(lu.unit_id)
    row.leadIds.add(lu.lead_id)
    row.interest.add(lu.lead_id)
    row.temp[bucketTemp(lead.temperature)] += 1
    if (String(lead.status || '').toLowerCase() === 'reservado') {
      row.reserved.add(lu.lead_id)
    }
    if ((apptsByLead.get(lu.lead_id) || []).length) row.appt.add(lu.lead_id)
  }
  for (const s of sales) {
    const row = ensureUnit(s.unit_id)
    row.sales.push(s)
    if (s.lead_id) row.leadIds.add(s.lead_id)
  }

  const byUnit: UnitFunnelRow[] = [...unitAgg.entries()].map(([unitId, agg]) => {
    const meta = unitsById.get(unitId)
    const salesAmt = agg.sales.reduce(
      (n, s) => n + Number(s.sale_price_final || 0),
      0,
    )
    return {
      unitId,
      unitLabel: meta?.unit_number
        ? `${meta.category || 'unidad'} ${meta.unit_number}`
        : `unidad:${unitId.slice(0, 8)}`,
      category: meta?.category || null,
      showroomViews: showroomUnitCounts.get(unitId) || 0,
      commercialInterestLeads: agg.interest.size,
      appointmentLeads: agg.appt.size,
      reservedLeads: agg.reserved.size,
      salesConfirmed: agg.sales.length,
      salesAmount: agg.sales.length ? salesAmt : null,
      temperature: agg.temp,
    }
  })
  byUnit.sort(
    (a, b) =>
      b.commercialInterestLeads + b.salesConfirmed -
      (a.commercialInterestLeads + a.salesConfirmed),
  )

  const salesAmountInPeriod = sales.length
    ? sales.reduce((n, s) => n + Number(s.sale_price_final || 0), 0)
    : null

  const contractsAnulRes = await admin
    .from('contracts')
    .select('id,status,signed_at,created_at')
    .eq('tenant_id', input.tenantId)
    .eq('status', 'anulado')
    .limit(5000)
  if (contractsAnulRes.error) throw contractsAnulRes.error
  const contractsAnulledInPeriod = (
    (contractsAnulRes.data || []) as Array<{
      signed_at: string | null
      created_at: string
    }>
  ).filter((c) => {
    const ts = c.signed_at || c.created_at
    return ts >= fromIso && ts < toExclusiveIso
  }).length

  return {
    timezone: MARKETING_REPORT_TZ,
    period: input.period,
    tenantId: input.tenantId,
    projectId: input.projectId,
    totals: {
      leadsAcquiredInPeriod: leads.length,
      leadsWithAttribution: withAttr,
      leadsWithoutAttribution: leads.length - withAttr,
      temperature: totalsTemp,
      appointmentsOccurredInPeriod: apptsOccurred.length,
      leadsWithAppointmentInPeriod: new Set(apptsOccurred.map((a) => a.lead_id))
        .size,
      salesOccurredInPeriod: sales.length,
      salesAmountInPeriod,
      salesCurrency: 'no_disponible',
      contractsAnulledInPeriod,
    },
    byAttributedAd,
    byUnit,
    limitations,
    metaSendGatesUntouched: true,
  }
}

import { matchTechnicalProbeMessage, type WaCrmTechnicalProbe } from './waCrmTechnicalProbes'

export type WaCrmAttributionStatus = 'confirmed' | 'not_confirmed'

export type WaCrmInboundMessageRow = {
  id: string
  conversationId: string
  leadId: string
  role: string
  sentAt: string
  externalMessageId: string | null
  contentPreview: string
}

export type WaCrmContactDetail = {
  leadId: string
  name: string | null
  phone: string | null
  kommoId: number | null
  contactId: string | null
  projectId: string | null
  tenantId: string
  source: string | null
  channelOrigin: string | null
  inboundCount: number
  lastInboundAt: string | null
  attributionStatus: WaCrmAttributionStatus
  /** Origen CRM (source/channel). Nunca prueba de ctwa_clid. */
  crmOriginLabel: string
  /** source_id del anuncio CTWA first-touch, solo si hay fila de atribución. */
  ctwaSourceId: string | null
  ctwaReferralSourceType: string | null
  /** Solo si algún mensaje del periodo coincide con huella explícita. */
  technicalProbe: { id: string; label: string } | null
  leadHref: string
}

export type WaCrmCtwaAttributionInfo = {
  sourceId: string | null
  referralSourceType: string | null
  capturedAt: string | null
}

export function maskPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`
}

export function periodBounds(dateFrom?: string | null, dateTo?: string | null): {
  fromIso: string | null
  toIso: string | null
} {
  let fromIso: string | null = null
  let toIso: string | null = null
  if (dateFrom) {
    const d = new Date(dateFrom)
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0)
      fromIso = d.toISOString()
    }
  }
  if (dateTo) {
    const d = new Date(dateTo)
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999)
      toIso = d.toISOString()
    }
  }
  return { fromIso, toIso }
}

export function inPeriod(iso: string, fromIso: string | null, toIso: string | null): boolean {
  if (fromIso && iso < fromIso) return false
  if (toIso && iso > toIso) return false
  return true
}

/** Deduplica inbound: preferir external_message_id; si falta, id de fila. */
export function dedupeInboundMessages<T extends { id: string; externalMessageId: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const key = row.externalMessageId?.trim()
      ? `ext:${row.externalMessageId.trim()}`
      : `id:${row.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Atribución CTWA confirmada = fila en lv_whatsapp_ctwa_attribution.
 * source/channel WHATSAPP o tarjeta de anuncio NO cuentan como prueba de ctwa_clid.
 */
export function attributionStatusForContact(input: {
  contactId: string | null
  projectId: string | null
  ctwaKeys: Set<string>
}): WaCrmAttributionStatus {
  if (!input.contactId || !input.projectId) return 'not_confirmed'
  return input.ctwaKeys.has(`${input.projectId}:${input.contactId}`) ? 'confirmed' : 'not_confirmed'
}

export function crmOriginLabel(source: string | null, channelOrigin: string | null): string {
  const parts = [source, channelOrigin].filter((v) => typeof v === 'string' && v.trim())
  if (!parts.length) return 'Sin origen CRM'
  return parts.join(' · ')
}

export function maskCtwaClid(clid: string | null | undefined): string | null {
  const value = typeof clid === 'string' ? clid.trim() : ''
  if (!value) return null
  if (value.length <= 12) return `${value.slice(0, 4)}…`
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function buildContactDetails(input: {
  leads: Array<{
    id: string
    name: string | null
    phone: string | null
    kommo_id: number | null
    contact_id: string | null
    project_id: string | null
    tenant_id: string
    source: string | null
    channel_origin: string | null
  }>
  inboundByLead: Map<string, WaCrmInboundMessageRow[]>
  ctwaKeys: Set<string>
  ctwaByKey?: Map<string, WaCrmCtwaAttributionInfo>
  probes?: WaCrmTechnicalProbe[]
}): WaCrmContactDetail[] {
  const details: WaCrmContactDetail[] = []
  for (const lead of input.leads) {
    const inbound = input.inboundByLead.get(lead.id) || []
    if (!inbound.length) continue
    const last = inbound.reduce((a, b) => (a.sentAt >= b.sentAt ? a : b))
    let technicalProbe: WaCrmContactDetail['technicalProbe'] = null
    for (const msg of inbound) {
      const hit = matchTechnicalProbeMessage({
        kommoId: lead.kommo_id,
        contactId: lead.contact_id,
        sentAt: msg.sentAt,
        probes: input.probes,
      })
      if (hit) {
        technicalProbe = { id: hit.id, label: hit.label }
        break
      }
    }
    const ctwaKey =
      lead.contact_id && lead.project_id
        ? `${lead.project_id}:${lead.contact_id}`
        : null
    const ctwaInfo = ctwaKey ? input.ctwaByKey?.get(ctwaKey) : undefined
    const attributionStatus = attributionStatusForContact({
      contactId: lead.contact_id,
      projectId: lead.project_id,
      ctwaKeys: input.ctwaKeys,
    })
    details.push({
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      kommoId: lead.kommo_id,
      contactId: lead.contact_id,
      projectId: lead.project_id,
      tenantId: lead.tenant_id,
      source: lead.source,
      channelOrigin: lead.channel_origin,
      inboundCount: inbound.length,
      lastInboundAt: last.sentAt,
      attributionStatus,
      crmOriginLabel: crmOriginLabel(lead.source, lead.channel_origin),
      ctwaSourceId:
        attributionStatus === 'confirmed' ? ctwaInfo?.sourceId ?? null : null,
      ctwaReferralSourceType:
        attributionStatus === 'confirmed'
          ? ctwaInfo?.referralSourceType ?? null
          : null,
      technicalProbe,
      leadHref: `/inmobiliaria/leads?lead=${encodeURIComponent(lead.id)}`,
    })
  }
  return details.sort((a, b) => String(b.lastInboundAt).localeCompare(String(a.lastInboundAt)))
}

export function summarizeWaCrmPeriod(details: WaCrmContactDetail[], inboundTotal: number) {
  const withCtwa = details.filter((d) => d.attributionStatus === 'confirmed').length
  const withoutCtwa = details.filter((d) => d.attributionStatus === 'not_confirmed').length
  const lastReception = details.reduce<string | null>((max, row) => {
    if (!row.lastInboundAt) return max
    if (!max || row.lastInboundAt > max) return row.lastInboundAt
    return max
  }, null)
  return {
    inboundMessages: inboundTotal,
    uniqueContacts: details.length,
    contactsWithCtwa: withCtwa,
    contactsWithoutCtwa: withoutCtwa,
    lastReceptionAt: lastReception,
  }
}

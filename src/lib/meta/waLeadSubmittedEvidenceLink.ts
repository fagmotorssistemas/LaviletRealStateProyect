import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCommercialInterestEvidence } from '@/lib/meta/waLeadSubmittedEligibility'
import { WA_RECENT_COMMERCIAL_INTEREST_MS } from '@/lib/meta/waLeadSubmittedEligibility'

/**
 * Enlaza evidencia Kommo huérfana al lead (contact + kommo exactos) y, si aún no
 * hay sello de interés comercial, lo deriva del historial entrante reciente.
 * No convierte por sí solo: solo repara el sello que no se pudo escribir cuando
 * el mensaje llegó antes de existir el lead CRM.
 */
export async function linkOrphanEvidenceAndStampCommercialInterest(input: {
  admin: SupabaseClient
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  leadId: string
  contactId?: string | number | null
  kommoId?: number | null
  recentOfferText?: string | null
  verifiedAdContext?: boolean
  nowMs?: number
}): Promise<{ linked: number; stampedAt: string | null }> {
  let linked = 0
  if (input.rpc) {
    try {
      const n = await input.rpc('lv_link_kommo_message_evidence_for_lead', {
        p_lead_id: input.leadId,
      })
      linked = typeof n === 'number' ? n : Number(n) || 0
    } catch {
      /* soft-fail: la consulta de evidencia abajo aún puede usar fallback */
    }
  }

  const { data: leadRow } = await input.admin
    .from('leads')
    .select('meta_wa_commercial_interest_at, contact_id, kommo_id, tenant_id')
    .eq('id', input.leadId)
    .maybeSingle()

  const existingStamp = leadRow?.meta_wa_commercial_interest_at
    ? String(leadRow.meta_wa_commercial_interest_at)
    : null
  if (existingStamp) {
    return { linked, stampedAt: existingStamp }
  }

  const nowMs = input.nowMs ?? Date.now()
  const sinceIso = new Date(nowMs - WA_RECENT_COMMERCIAL_INTEREST_MS).toISOString()
  const tenantId = leadRow?.tenant_id as string | undefined
  const contactId = String(
    input.contactId ?? leadRow?.contact_id ?? '',
  ).trim()
  const kommoId =
    typeof input.kommoId === 'number' && input.kommoId > 0
      ? input.kommoId
      : typeof leadRow?.kommo_id === 'number' && leadRow.kommo_id > 0
        ? leadRow.kommo_id
        : null

  type EvidenceMsg = { content: string | null; sent_at: string }
  const rows: EvidenceMsg[] = []

  const linkedRead = await input.admin
    .from('kommo_message_evidence')
    .select('content,sent_at')
    .eq('lead_id', input.leadId)
    .eq('direction', 'incoming')
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(40)
  if (!linkedRead.error && linkedRead.data) {
    rows.push(...(linkedRead.data as EvidenceMsg[]))
  }

  // Fallback read-only: evidencias aún sin lead_id (misma identidad exacta).
  if (tenantId && contactId) {
    let q = input.admin
      .from('kommo_message_evidence')
      .select('content,sent_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .is('lead_id', null)
      .eq('direction', 'incoming')
      .gte('sent_at', sinceIso)
      .order('sent_at', { ascending: false })
    if (kommoId) q = q.eq('kommo_lead_id', kommoId)
    const orphanRead = await q.limit(40)
    if (!orphanRead.error && orphanRead.data) {
      rows.push(...(orphanRead.data as EvidenceMsg[]))
    }
  }

  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.sent_at}:${row.content || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const content = String(row.content || '').trim()
    if (!content) continue
    if (
      !isCommercialInterestEvidence({
        currentMessage: content,
        recentOfferText: input.recentOfferText,
        verifiedAdContext: input.verifiedAdContext === true,
      })
    ) {
      continue
    }
    const sentMs = Date.parse(row.sent_at)
    if (!Number.isFinite(sentMs)) continue
    if (nowMs - sentMs > WA_RECENT_COMMERCIAL_INTEREST_MS || sentMs > nowMs + 60_000) {
      continue
    }
    const stampedAt = new Date(sentMs).toISOString()
    try {
      await input.admin
        .from('leads')
        .update({ meta_wa_commercial_interest_at: stampedAt })
        .eq('id', input.leadId)
        .is('meta_wa_commercial_interest_at', null)
    } catch {
      return { linked, stampedAt: null }
    }
    return { linked, stampedAt }
  }

  return { linked, stampedAt: null }
}

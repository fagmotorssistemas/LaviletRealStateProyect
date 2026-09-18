'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { readOwnProfileRow } from '@/lib/auth/session'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'

export type ConversionLogRow = {
  id: string
  created_at: string
  tenant_id: string | null
  project_id: string | null
  lead_id: string | null
  contact_id: string | null
  event_name: string
  stage: string
  reason: string | null
  event_id: string | null
  idempotency_key: string | null
  delivery_lane: string | null
  details: Record<string, unknown>
}

export async function listMetaCapiConversionLog(input?: {
  limit?: number
  eventName?: string | null
}): Promise<{ ok: true; rows: ConversionLogRow[] } | { ok: false; error: string }> {
  const profile = await readOwnProfileRow()
  if (!profile || !canAccessPath(profile.role, '/inmobiliaria/marketing/capi', profile.crm_paths)) {
    return { ok: false, error: 'Sin permiso' }
  }

  const limit = Math.min(Math.max(Number(input?.limit) || 100, 1), 300)
  let admin
  try {
    admin = createAdminClient()
  } catch {
    return { ok: false, error: 'Admin client no configurado' }
  }

  let q = admin
    .from('meta_capi_conversion_log')
    .select(
      'id, created_at, tenant_id, project_id, lead_id, contact_id, event_name, stage, reason, event_id, idempotency_key, delivery_lane, details',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (input?.eventName) {
    q = q.eq('event_name', input.eventName)
  }

  const { data, error } = await q
  if (error) {
    return { ok: false, error: error.message }
  }

  return {
    ok: true,
    rows: (data || []).map((row) => ({
      id: String(row.id),
      created_at: String(row.created_at),
      tenant_id: row.tenant_id ? String(row.tenant_id) : null,
      project_id: row.project_id ? String(row.project_id) : null,
      lead_id: row.lead_id ? String(row.lead_id) : null,
      contact_id: row.contact_id ? String(row.contact_id) : null,
      event_name: String(row.event_name),
      stage: String(row.stage),
      reason: row.reason ? String(row.reason) : null,
      event_id: row.event_id ? String(row.event_id) : null,
      idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
      delivery_lane: row.delivery_lane ? String(row.delivery_lane) : null,
      details:
        row.details && typeof row.details === 'object' && !Array.isArray(row.details)
          ? (row.details as Record<string, unknown>)
          : {},
    })),
  }
}

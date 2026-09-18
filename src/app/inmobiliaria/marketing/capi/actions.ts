'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCrmDataClient, readOwnProfileRow } from '@/lib/auth/session'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'

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

/**
 * Bitácora CAPI con aislamiento tenant en servidor.
 * - Requiere sesión + path marketing/capi.
 * - Solo filas cuyo tenant_id ∈ getAccessibleTenantIds().
 * - is_probe / delivery_lane=test NO omiten el filtro de tenant.
 * - Filas sin tenant_id no son visibles.
 */
export async function listMetaCapiConversionLog(input?: {
  limit?: number
  eventName?: string | null
}): Promise<{ ok: true; rows: ConversionLogRow[] } | { ok: false; error: string }> {
  const profile = await readOwnProfileRow()
  if (!profile || !canAccessPath(profile.role, '/inmobiliaria/marketing/capi', profile.crm_paths)) {
    return { ok: false, error: 'Sin permiso' }
  }

  let scopeClient
  try {
    scopeClient = await getCrmDataClient()
  } catch {
    return { ok: false, error: 'Cliente CRM no disponible' }
  }
  if (!scopeClient) {
    return { ok: false, error: 'Cliente CRM no disponible' }
  }

  let tenantIds: string[]
  try {
    tenantIds = await getAccessibleTenantIds(scopeClient)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudieron resolver tenants',
    }
  }

  if (tenantIds.length === 0) {
    return { ok: true, rows: [] }
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
    .in('tenant_id', tenantIds)
    .not('tenant_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (input?.eventName) {
    q = q.eq('event_name', input.eventName)
  }

  const { data, error } = await q
  if (error) {
    return { ok: false, error: error.message }
  }

  const tenantSet = new Set(tenantIds)
  const rows = (data || [])
    .map((row) => ({
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
    }))
    .filter((row) => Boolean(row.tenant_id && tenantSet.has(row.tenant_id)))

  return { ok: true, rows }
}

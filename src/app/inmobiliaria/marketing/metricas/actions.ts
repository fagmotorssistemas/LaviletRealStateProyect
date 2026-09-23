'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import {
  assignAdPromotedUnit,
  clearAdPromotedUnits,
} from '@/lib/meta/adPromotedUnits'
import {
  adsMarketingMissingHints,
  fetchAdAccountSnapshot,
  readAdsMarketingCredentials,
} from '@/lib/meta/adsMarketingClient'
import { maskPhoneDisplay } from '@/lib/meta/waCrmVisibility'
import { createClient } from '@/lib/supabase/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  buildMarketingFunnelReport,
  type MarketingFunnelPeriod,
  type MarketingFunnelReport,
} from '@/services/marketingFunnel.service'

const PATH = '/inmobiliaria/marketing/metricas'

export type FunnelLeadDetailRow = {
  id: string
  name: string | null
  phone: string | null
  created_at: string
  temperature: string | null
  status: string | null
  advisorName: string | null
  attributedAdId: string | null
  campaignId: string | null
  campaignName: string | null
}

export type AdsConnectionProbe = {
  connected: boolean
  fetchedAt: string
  error: string | null
  adAccountId: string | null
  currency: string | null
  timezone: string | null
  accountName: string | null
  insightsPingOk: boolean
}

/**
 * Embudo interno campaña/unidad. No encola ni envía conversiones Meta.
 */
export async function fetchMarketingFunnelMetrics(input: {
  period: MarketingFunnelPeriod
  tenantId?: string
  projectId?: string
}): Promise<
  { ok: true; data: MarketingFunnelReport } | { ok: false; error: string }
> {
  try {
    await assertCanAccessCrmPath(PATH)
    const admin = tryCreateAdminClient()
    if (!admin) {
      return {
        ok: false,
        error: 'Falta cliente admin (service_role) para métricas',
      }
    }
    const userClient = await createClient()
    const tenantIds = await getAccessibleTenantIds(userClient)
    const tenantId = input.tenantId || LAVILET_TENANT_ID
    if (!tenantIds.includes(tenantId)) {
      return { ok: false, error: 'tenant_fuera_de_alcance' }
    }
    const projectId = input.projectId || LAVILET_PROJECT_ID
    const data = await buildMarketingFunnelReport(admin, {
      tenantId,
      projectId,
      period: input.period,
    })
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'No se pudo calcular el embudo de marketing',
    }
  }
}

/** Proyectos del tenant accesible (selector de filtro). */
export async function listMarketingFunnelProjects(input?: {
  tenantId?: string
}): Promise<{ id: string; name: string }[]> {
  try {
    await assertCanAccessCrmPath(PATH)
    const userClient = await createClient()
    const tenantIds = await getAccessibleTenantIds(userClient)
    const tenantId = input?.tenantId || LAVILET_TENANT_ID
    if (!tenantIds.includes(tenantId)) return []
    const { data, error } = await userClient
      .from('projects')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
    if (error) return []
    return (data || []).map((row) => ({
      id: String(row.id),
      name: String(row.name || row.id),
    }))
  } catch {
    // La page envuelve con mensaje; nunca romper el SSR por proyectos.
    return []
  }
}

/**
 * Detalle sanitizado de leads del embudo (drill-down). Teléfono enmascarado.
 */
export async function listFunnelLeadDetails(input: {
  leadIds: string[]
  tenantId: string
  projectId: string
  attributionByLeadId?: Record<
    string,
    {
      attributedAdId?: string | null
      campaignId?: string | null
      campaignName?: string | null
    }
  >
}): Promise<
  { ok: true; rows: FunnelLeadDetailRow[] } | { ok: false; error: string }
> {
  try {
    await assertCanAccessCrmPath(PATH)
    const userClient = await createClient()
    const tenantIds = await getAccessibleTenantIds(userClient)
    const tenantId = String(input.tenantId || '').trim() || LAVILET_TENANT_ID
    if (!tenantIds.includes(tenantId)) {
      return { ok: false, error: 'tenant_fuera_de_alcance' }
    }
    const projectId = String(input.projectId || '').trim()
    if (!projectId) return { ok: false, error: 'project_id_required' }

    const ids = [
      ...new Set(
        (input.leadIds || [])
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 200)
    if (!ids.length) return { ok: true, rows: [] }

    const admin = tryCreateAdminClient()
    const db = admin || userClient

    type LeadQueryRow = {
      id: string
      name: string | null
      phone: string | null
      created_at: string
      temperature: string | null
      status: string | null
      assigned_profile:
        | { full_name: string | null }
        | { full_name: string | null }[]
        | null
    }

    const { data, error } = await db
      .from('leads')
      .select(
        'id, name, phone, created_at, temperature, status, assigned_profile:profiles!leads_assigned_to_fkey(full_name)',
      )
      .eq('tenant_id', tenantId)
      .eq('project_id', projectId)
      .in('id', ids)

    if (error) return { ok: false, error: error.message }

    const attr = input.attributionByLeadId || {}
    const rows: FunnelLeadDetailRow[] = ((data || []) as LeadQueryRow[]).map(
      (row) => {
        const profile = Array.isArray(row.assigned_profile)
          ? row.assigned_profile[0]
          : row.assigned_profile
        const meta = attr[row.id]
        return {
          id: row.id,
          name: row.name,
          phone: maskPhoneDisplay(row.phone),
          created_at: row.created_at,
          temperature: row.temperature,
          status: row.status,
          advisorName: profile?.full_name ?? null,
          attributedAdId: meta?.attributedAdId ?? null,
          campaignId: meta?.campaignId ?? null,
          campaignName: meta?.campaignName ?? null,
        }
      },
    )
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { ok: true, rows }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los leads del embudo',
    }
  }
}

export async function assignPromotedUnitAction(input: {
  adId: string
  unitId?: string | null
  externalLabel?: string | null
  projectId: string
  tenantId?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await assertCanAccessCrmPath(PATH)
    const userClient = await createClient()
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return { ok: false, error: 'no_autenticado' }

    const tenantIds = await getAccessibleTenantIds(userClient)
    const tenantId = input.tenantId || LAVILET_TENANT_ID
    if (!tenantIds.includes(tenantId)) {
      return { ok: false, error: 'tenant_fuera_de_alcance' }
    }

    const admin = tryCreateAdminClient()
    if (!admin) {
      return { ok: false, error: 'Falta cliente admin (service_role)' }
    }

    const creds = readAdsMarketingCredentials()
    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id,tenant_id')
      .eq('id', input.projectId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (projectError) return { ok: false, error: projectError.message }
    if (!project) return { ok: false, error: 'project_not_in_tenant' }
    if (input.unitId) {
      const { data: unit, error: unitError } = await admin
        .from('units')
        .select('id,tenant_id,project_id')
        .eq('id', input.unitId)
        .maybeSingle()
      if (unitError) return { ok: false, error: unitError.message }
      if (
        !unit ||
        String(unit.tenant_id) !== tenantId ||
        String(unit.project_id) !== input.projectId
      ) {
        return { ok: false, error: 'unit_not_in_tenant_project' }
      }
    }
    return assignAdPromotedUnit(admin, {
      tenantId,
      projectId: input.projectId,
      adId: input.adId,
      adAccountId: creds?.adAccountId ?? null,
      unitId: input.unitId,
      externalLabel: input.externalLabel,
      userId: user.id,
    })
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'No se pudo asignar la unidad',
    }
  }
}

export async function clearPromotedUnitsAction(input: {
  adId: string
  projectId: string
  tenantId?: string
}): Promise<
  { ok: true; superseded: number } | { ok: false; error: string }
> {
  try {
    await assertCanAccessCrmPath(PATH)
    const userClient = await createClient()
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return { ok: false, error: 'no_autenticado' }

    const tenantIds = await getAccessibleTenantIds(userClient)
    const tenantId = input.tenantId || LAVILET_TENANT_ID
    if (!tenantIds.includes(tenantId)) {
      return { ok: false, error: 'tenant_fuera_de_alcance' }
    }

    const admin = tryCreateAdminClient()
    if (!admin) {
      return { ok: false, error: 'Falta cliente admin (service_role)' }
    }

    return clearAdPromotedUnits(admin, {
      tenantId,
      projectId: input.projectId,
      adId: input.adId,
      userId: user.id,
    })
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'No se pudieron limpiar las unidades promocionadas',
    }
  }
}

/**
 * Ping vivo a Graph: cuenta + insights cortos. Sin secretos en la respuesta.
 */
export async function probeAdsConnectionAction(): Promise<AdsConnectionProbe> {
  const fetchedAt = new Date().toISOString()
  try {
    await assertCanAccessCrmPath(PATH)
  } catch {
    return {
      connected: false,
      fetchedAt,
      error: 'sin_acceso',
      adAccountId: null,
      currency: null,
      timezone: null,
      accountName: null,
      insightsPingOk: false,
    }
  }

  const creds = readAdsMarketingCredentials()
  if (!creds) {
    return {
      connected: false,
      fetchedAt,
      error: adsMarketingMissingHints().join('; ') || 'credenciales_ausentes',
      adAccountId: null,
      currency: null,
      timezone: null,
      accountName: null,
      insightsPingOk: false,
    }
  }

  const account = await fetchAdAccountSnapshot()
  if (account.error) {
    return {
      connected: false,
      fetchedAt: account.fetchedAt || fetchedAt,
      error: account.error,
      adAccountId: account.adAccountId || creds.adAccountId,
      currency: account.currency,
      timezone: account.timezoneName,
      accountName: account.name,
      insightsPingOk: false,
    }
  }

  // Insights ping: 1 día, limit 1, level account — solo verifica ads_read.
  let insightsPingOk = false
  let insightsError: string | null = null
  try {
    const day = new Date().toISOString().slice(0, 10)
    const url = new URL(
      `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(creds.adAccountId)}/insights`,
    )
    url.searchParams.set('fields', 'spend,account_currency')
    url.searchParams.set('level', 'account')
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: day, until: day }),
    )
    url.searchParams.set('limit', '1')
    url.searchParams.set('access_token', creds.token)
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
    })
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string }
      data?: unknown[]
    } | null
    if (!res.ok || json?.error) {
      insightsError =
        json?.error?.message?.slice(0, 200) || `http_${res.status}`
    } else {
      insightsPingOk = true
    }
  } catch (error) {
    insightsError =
      error instanceof Error ? error.message.slice(0, 200) : 'insights_ping_failed'
  }

  return {
    connected: insightsPingOk,
    fetchedAt: account.fetchedAt || fetchedAt,
    error: insightsPingOk ? null : insightsError,
    adAccountId: account.adAccountId || creds.adAccountId,
    currency: account.currency,
    timezone: account.timezoneName,
    accountName: account.name,
    insightsPingOk,
  }
}

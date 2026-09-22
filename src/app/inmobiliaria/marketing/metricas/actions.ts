'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { createClient } from '@/lib/supabase/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  buildMarketingFunnelReport,
  type MarketingFunnelPeriod,
  type MarketingFunnelReport,
} from '@/services/marketingFunnel.service'

const PATH = '/inmobiliaria/marketing/metricas'

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

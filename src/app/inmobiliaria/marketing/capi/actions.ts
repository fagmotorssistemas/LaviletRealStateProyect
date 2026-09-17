'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { createClient } from '@/lib/supabase/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  listMetaCapiOutbox,
  type MetaCapiListFilters,
  type MetaCapiOutboxResult,
} from '@/services/metaCapiOutbox.service'

const PATH = '/inmobiliaria/marketing/capi'

export async function fetchMetaCapiBitacora(
  filters?: MetaCapiListFilters,
): Promise<{ ok: true; data: MetaCapiOutboxResult } | { ok: false; error: string }> {
  try {
    await assertCanAccessCrmPath(PATH)
    const admin = tryCreateAdminClient()
    if (!admin) {
      return {
        ok: false,
        error: 'Falta cliente admin (service_role) para leer meta_capi_outbox',
      }
    }
    const userClient = await createClient()
    const tenantIds = await getAccessibleTenantIds(userClient)
    if (tenantIds.length === 0) {
      return { ok: false, error: 'Sin tenants accesibles para esta sesión' }
    }
    const data = await listMetaCapiOutbox(admin, {
      accessibleTenantIds: tenantIds,
      filters: filters ?? {},
    })
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo cargar la bitácora CAPI',
    }
  }
}

'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  listMetaCapiOutbox,
  type MetaCapiOutboxResult,
  type MetaCapiStatusFilter,
} from '@/services/metaCapiOutbox.service'

const PATH = '/inmobiliaria/marketing/capi'

export async function fetchMetaCapiBitacora(params?: {
  filter?: MetaCapiStatusFilter
  hours?: number
}): Promise<{ ok: true; data: MetaCapiOutboxResult } | { ok: false; error: string }> {
  try {
    await assertCanAccessCrmPath(PATH)
    const admin = tryCreateAdminClient()
    if (!admin) {
      return {
        ok: false,
        error: 'Falta cliente admin (service_role) para leer meta_capi_outbox',
      }
    }
    const data = await listMetaCapiOutbox(admin, {
      filter: params?.filter ?? 'all',
      hours: params?.hours ?? 24,
    })
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo cargar la bitácora CAPI',
    }
  }
}

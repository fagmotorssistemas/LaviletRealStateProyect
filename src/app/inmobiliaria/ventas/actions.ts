'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertCanAccessCrmPath, assertCanWriteCrm } from '@/lib/auth/session'
import { listSalesClosings, recordUnitClosing } from '@/services/inmobiliaria.service'
import type { UnitSalesClosing } from '@/types/inmobiliaria'

export async function listSalesClosingsAction(params: {
  tenantIds: string[]
  projectId?: string
  soldById?: string
  from?: string
  to?: string
  search?: string
}): Promise<UnitSalesClosing[]> {
  await assertCanAccessCrmPath('/inmobiliaria/ventas')
  if (!params.tenantIds.length) return []
  return listSalesClosings(createAdminClient(), params)
}

export async function recordUnitClosingAction(
  payload: Parameters<typeof recordUnitClosing>[1],
): Promise<UnitSalesClosing> {
  await assertCanAccessCrmPath('/inmobiliaria/ventas')
  await assertCanWriteCrm()
  try {
    return await recordUnitClosing(createAdminClient(), payload)
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'No se pudo registrar el cierre'
    throw new Error(message)
  }
}

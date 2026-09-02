'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSalesClosings, recordUnitClosing } from '@/services/inmobiliaria.service'
import type { UnitSalesClosing } from '@/types/inmobiliaria'

async function assertLoggedIn() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return user
}

export async function listSalesClosingsAction(params: {
  tenantIds: string[]
  projectId?: string
  soldById?: string
  from?: string
  to?: string
  search?: string
}): Promise<UnitSalesClosing[]> {
  await assertLoggedIn()
  if (!params.tenantIds.length) return []
  return listSalesClosings(createAdminClient(), params)
}

export async function recordUnitClosingAction(
  payload: Parameters<typeof recordUnitClosing>[1],
): Promise<UnitSalesClosing> {
  await assertLoggedIn()
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

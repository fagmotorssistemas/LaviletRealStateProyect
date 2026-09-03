'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createUnitsImport,
  listUnitsImport,
  listUnitsImportFacets,
  updateUnitsImport,
  type UnitsImportWrite,
} from '@/services/inmobiliaria.service'
import type { UnitImport } from '@/types/inmobiliaria'

async function assertLoggedIn() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
}

export async function listUnitsImportAction(params: {
  search?: string
  category?: string
  floorNumber?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ data: UnitImport[]; total: number }> {
  await assertLoggedIn()
  return listUnitsImport(createAdminClient(), params)
}

export async function listUnitsImportFacetsAction(): Promise<{
  categories: string[]
  floors: { number: number; label: string }[]
}> {
  await assertLoggedIn()
  return listUnitsImportFacets(createAdminClient())
}

export async function createUnitsImportAction(payload: UnitsImportWrite): Promise<UnitImport> {
  await assertLoggedIn()
  return createUnitsImport(createAdminClient(), payload)
}

export async function updateUnitsImportAction(id: string, payload: UnitsImportWrite): Promise<UnitImport> {
  await assertLoggedIn()
  return updateUnitsImport(createAdminClient(), id, payload)
}

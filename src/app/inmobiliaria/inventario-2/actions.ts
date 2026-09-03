'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  createUnitsImport,
  deleteTypologyAsset,
  getTypologyAssetPublicUrl,
  listTypologiesImport,
  listTypologyAssets,
  listUnitsImport,
  listUnitsImportFacets,
  updateUnitsImport,
  type UnitsImportWrite,
} from '@/services/inmobiliaria.service'
import { assertCanAccessCrmPath, assertCanWriteCrm } from '@/lib/auth/session'
import type { TypologyAsset, TypologyImport, UnitImport } from '@/types/inmobiliaria'

export async function listUnitsImportAction(params: {
  search?: string
  category?: string
  floorNumber?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ data: UnitImport[]; total: number }> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  return listUnitsImport(createAdminClient(), params)
}

export async function listUnitsImportFacetsAction(): Promise<{
  categories: string[]
  floors: { number: number; label: string }[]
}> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  return listUnitsImportFacets(createAdminClient())
}

export async function createUnitsImportAction(payload: UnitsImportWrite): Promise<UnitImport> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return createUnitsImport(createAdminClient(), payload)
}

export async function updateUnitsImportAction(id: string, payload: UnitsImportWrite): Promise<UnitImport> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return updateUnitsImport(createAdminClient(), id, payload)
}

export async function listTypologiesImportAction(): Promise<TypologyImport[]> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  return listTypologiesImport(createAdminClient())
}

export async function listTypologyAssetsAction(
  typologyCode: string,
): Promise<(TypologyAsset & { public_url: string })[]> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  const admin = createAdminClient()
  const rows = await listTypologyAssets(admin, typologyCode)
  return rows.map((row) => ({
    ...row,
    public_url: getTypologyAssetPublicUrl(admin, row.storage_path),
  }))
}

export async function deleteTypologyAssetAction(id: string): Promise<void> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return deleteTypologyAsset(createAdminClient(), id)
}

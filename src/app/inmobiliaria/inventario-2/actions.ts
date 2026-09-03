'use server'

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
import { assertCanAccessCrmPath, assertCanWriteCrm, getCrmDataClient } from '@/lib/auth/session'
import type { TypologyAsset, TypologyImport, UnitImport } from '@/types/inmobiliaria'

function actionError(error: unknown) {
  return error instanceof Error ? error.message : 'No se pudo completar la operación'
}

export async function listUnitsImportAction(params: {
  search?: string
  category?: string
  floorNumber?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ data: UnitImport[]; total: number; error?: string }> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
    return await listUnitsImport(await getCrmDataClient(), params)
  } catch (error) {
    console.error('listUnitsImportAction', error)
    return { data: [], total: 0, error: actionError(error) }
  }
}

export async function listUnitsImportFacetsAction(): Promise<{
  categories: string[]
  floors: { number: number; label: string }[]
  error?: string
}> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
    return await listUnitsImportFacets(await getCrmDataClient())
  } catch (error) {
    console.error('listUnitsImportFacetsAction', error)
    return { categories: [], floors: [], error: actionError(error) }
  }
}

export async function createUnitsImportAction(payload: UnitsImportWrite): Promise<UnitImport> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return createUnitsImport(await getCrmDataClient(), payload)
}

export async function updateUnitsImportAction(id: string, payload: UnitsImportWrite): Promise<UnitImport> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return updateUnitsImport(await getCrmDataClient(), id, payload)
}

export async function listTypologiesImportAction(): Promise<TypologyImport[]> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
    return await listTypologiesImport(await getCrmDataClient())
  } catch (error) {
    console.error('listTypologiesImportAction', error)
    return []
  }
}

export async function listTypologyAssetsAction(
  typologyCode: string,
): Promise<(TypologyAsset & { public_url: string })[]> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
    const client = await getCrmDataClient()
    const rows = await listTypologyAssets(client, typologyCode)
    return rows.map((row) => ({
      ...row,
      public_url: getTypologyAssetPublicUrl(client, row.storage_path),
    }))
  } catch (error) {
    console.error('listTypologyAssetsAction', error)
    return []
  }
}

export async function deleteTypologyAssetAction(id: string): Promise<void> {
  await assertCanAccessCrmPath('/inmobiliaria/inventario-2')
  await assertCanWriteCrm()
  return deleteTypologyAsset(await getCrmDataClient(), id)
}

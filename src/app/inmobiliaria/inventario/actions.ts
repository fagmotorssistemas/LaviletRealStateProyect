'use server'

import { assertCanAccessCrmPath, getCrmDataClient } from '@/lib/auth/session'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects, listUnits } from '@/services/inmobiliaria.service'
import type { InventorySortOption, Project, Unit, UnitStatus } from '@/types/inmobiliaria'

export async function listInventoryAction(params: {
  projectId?: string
  status?: string
  category?: string
  search?: string
  sortBy?: InventorySortOption
  page?: number
  pageSize?: number
}): Promise<{
  tenantId: string
  tenantIds: string[]
  projects: Project[]
  units: Unit[]
  total: number
  error?: string
}> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/inventario')
    const client = await getCrmDataClient()
    const tenantIds = await getAccessibleTenantIds(client)
    if (!tenantIds.length) {
      return { tenantId: '', tenantIds: [], projects: [], units: [], total: 0 }
    }

    const [projects, listed] = await Promise.all([
      listProjects(client, tenantIds[0], tenantIds),
      listUnits(client, {
        tenantId: tenantIds[0],
        tenantIds,
        projectId: params.projectId || undefined,
        status: (params.status || undefined) as UnitStatus | undefined,
        category: params.category || undefined,
        search: params.search?.trim() || undefined,
        sort: params.sortBy,
        page: params.page,
        pageSize: params.pageSize,
      }),
    ])

    return {
      tenantId: tenantIds[0],
      tenantIds,
      projects,
      units: listed.data,
      total: listed.total,
    }
  } catch (error) {
    console.error('listInventoryAction', error)
    return {
      tenantId: '',
      tenantIds: [],
      projects: [],
      units: [],
      total: 0,
      error: error instanceof Error ? error.message : 'No se pudo cargar el inventario',
    }
  }
}

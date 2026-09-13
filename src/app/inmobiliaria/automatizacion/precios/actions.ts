'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { listProjectPrices, saveCommercialUnitPrice } from '@/services/unitPrices.service'

async function projectSession(projectId: string) {
  await assertAdmin()
  if (!projectId) throw new Error('Seleccione un proyecto')
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id').eq('id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!project) throw new Error('Proyecto no encontrado o sin acceso')
  return { client: supabase, tenantId: project.tenant_id as string }
}

export async function loadUnitPricesAction(projectId: string) {
  const { client, tenantId } = await projectSession(projectId)
  const [units, config] = await Promise.all([
    listProjectPrices(client, projectId, tenantId),
    client.from('project_automation_config').select('mode').eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (config.error) throw new Error(config.error.message)
  return { units, mode: config.data?.mode || 'lanzamiento' }
}

export async function saveUnitPriceAction(params: { projectId: string; unitId: string; price: string; expectedUpdatedAt: string }) {
  const { client, tenantId } = await projectSession(params.projectId)
  return saveCommercialUnitPrice(client, { ...params, tenantId })
}

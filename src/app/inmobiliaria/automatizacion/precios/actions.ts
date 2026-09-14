'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { listProjectPrices, saveCommercialUnitPrice, saveLaunchPriceVisibility } from '@/services/unitPrices.service'
import { launchPricesVisible } from '@/lib/inmobiliaria/unitPrices'

async function projectSession(projectId: string) {
  await assertAdmin()
  if (!projectId) throw new Error('Seleccione un proyecto')
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at').eq('id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!project) throw new Error('Proyecto no encontrado o sin acceso')
  return { client: supabase, tenantId: project.tenant_id as string, project }
}

export async function loadUnitPricesAction(projectId: string) {
  const { client, tenantId, project } = await projectSession(projectId)
  const [units, config] = await Promise.all([
    listProjectPrices(client, projectId, tenantId),
    client.from('project_automation_config').select('mode').eq('project_id', projectId).eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (config.error) throw new Error(config.error.message)
  return { units, mode: config.data?.mode || 'lanzamiento', launchVisible: launchPricesVisible(project.policies_json), projectUpdatedAt: project.updated_at as string }
}

export async function saveLaunchPriceVisibilityAction(params: { projectId: string; visible: boolean; expectedUpdatedAt: string }) {
  const { client, tenantId, project } = await projectSession(params.projectId)
  return saveLaunchPriceVisibility(client, { ...params, tenantId }, project)
}

export async function saveUnitPriceAction(params: { projectId: string; unitId: string; price: string; expectedUpdatedAt: string }) {
  const { client, tenantId } = await projectSession(params.projectId)
  return saveCommercialUnitPrice(client, { ...params, tenantId })
}

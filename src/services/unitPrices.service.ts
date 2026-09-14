import type { SupabaseClient } from '@supabase/supabase-js'
import { launchPricesVisible, parseCommercialPrice, withLaunchPricesVisibility, type UnitPriceRow } from '../lib/inmobiliaria/unitPrices'

const columns = 'id,unit_number,category,floor_number,bedrooms,area_internal_m2,published_commercial_price,is_published,status,updated_at'
export async function saveLaunchPriceVisibility(client: SupabaseClient, params: {
  projectId: string; tenantId: string; visible: boolean; expectedUpdatedAt: string
}, project: { policies_json: unknown; updated_at: string }) {
  if (!params.projectId || !params.tenantId || typeof params.visible !== 'boolean'
    || !params.expectedUpdatedAt || !Number.isFinite(Date.parse(params.expectedUpdatedAt))) throw new Error('Vuelva a cargar el proyecto antes de guardar la visibilidad.')
  const conflict = 'La configuración del proyecto cambió. Actualice antes de guardar la visibilidad.'
  if (project.updated_at !== params.expectedUpdatedAt) throw new Error(conflict)
  const { data, error } = await client.from('projects').update({
    policies_json: withLaunchPricesVisibility(project.policies_json, params.visible), updated_at: new Date().toISOString(),
  }).eq('id', params.projectId).eq('tenant_id', params.tenantId).eq('updated_at', params.expectedUpdatedAt)
    .select('policies_json,updated_at').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(conflict)
  return { launchVisible: launchPricesVisible(data.policies_json), projectUpdatedAt: data.updated_at as string }
}

export async function listProjectPrices(client: SupabaseClient, projectId: string, tenantId: string) {
  const units: UnitPriceRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('units').select(columns)
      .eq('project_id', projectId).eq('tenant_id', tenantId).order('id').range(offset, offset + 499)
    if (error) throw new Error(error.message)
    units.push(...(data ?? []) as UnitPriceRow[])
    if (!data || data.length < 500) break
  }
  return units.sort((a, b) => a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }))
}

export async function saveCommercialUnitPrice(client: SupabaseClient, params: {
  projectId: string; tenantId: string; unitId: string; price: string; expectedUpdatedAt: string
}) {
  if (!params.projectId || !params.tenantId || !params.unitId || !params.expectedUpdatedAt || !Number.isFinite(Date.parse(params.expectedUpdatedAt))) {
    throw new Error('Faltan datos de la unidad. Vuelva a cargar los precios.')
  }
  const price = parseCommercialPrice(params.price)
  const { data, error } = await client.from('units').update({ published_commercial_price: price, updated_at: new Date().toISOString() })
    .eq('id', params.unitId).eq('project_id', params.projectId).eq('tenant_id', params.tenantId)
    .eq('updated_at', params.expectedUpdatedAt).select(columns).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('La unidad cambió desde que la abrió o ya no está disponible para editar. Actualice la lista antes de guardar.')
  return data as UnitPriceRow
}

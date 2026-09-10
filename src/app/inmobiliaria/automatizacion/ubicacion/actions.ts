'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { googleMapsUrl, validCoordinates, type ProjectVisitLocation } from '@/lib/inmobiliaria/projectLocation'

export async function loadProjectLocationAction(projectId: string) {
  await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,name,address').eq('id', projectId).single()
  if (error || !project) throw new Error('No se pudo acceder al proyecto')
  const { data, error: configError } = await supabase.from('project_automation_config').select('visit_latitude,visit_longitude,visit_location_url').eq('project_id', projectId).eq('tenant_id', project.tenant_id).maybeSingle()
  if (configError) throw new Error('No se pudo cargar la ubicación')
  return { project, point: data?.visit_latitude != null && data?.visit_longitude != null ? { latitude: Number(data.visit_latitude), longitude: Number(data.visit_longitude) } : null, url: data?.visit_location_url ?? null }
}
export async function saveProjectLocationAction(projectId: string, point: ProjectVisitLocation) {
  await assertAdmin()
  if (!point || !validCoordinates(point.latitude, point.longitude)) throw new Error('Selecciona una ubicación válida')
  const { project } = await loadProjectLocationAction(projectId)
  const { supabase } = await getSessionUser()
  const { error } = await supabase.from('project_automation_config').upsert({
    project_id: project.id, tenant_id: project.tenant_id, visit_latitude: Number(point.latitude.toFixed(6)),
    visit_longitude: Number(point.longitude.toFixed(6)), visit_location_url: googleMapsUrl(point), updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' })
  if (error) throw new Error('No se pudo guardar la ubicación del proyecto')
  return loadProjectLocationAction(projectId)
}


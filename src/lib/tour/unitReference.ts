import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'

export type PublicUnitReference = {
  id: string
  unit_number: string
  category: 'suite' | 'departamento'
  floor: string | null
  floor_number: number | null
  bedrooms: number | null
  bathrooms_full: number | null
  area_internal_m2: number | null
  area_exterior_m2: number | null
  spaces: string[] | null
}

// Deliberately exclude internal notes, owner data and prices governed by other visibility rules.
const PUBLIC_FIELDS = 'id,unit_number,category,floor,floor_number,bedrooms,bathrooms_full,area_internal_m2,area_exterior_m2,spaces'

export async function loadPublicUnitReference(client: SupabaseClient, id: string): Promise<PublicUnitReference | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const result = await client.from('units').select(PUBLIC_FIELDS)
    .eq('id', id).eq('tenant_id', LAVILET_TENANT_ID).eq('project_id', LAVILET_PROJECT_ID)
    .eq('is_published', true).eq('status', 'disponible').in('category', ['suite', 'departamento'])
    .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
  if (result.error) throw new Error('PUBLIC_UNIT_REFERENCE_UNAVAILABLE')
  return result.data as PublicUnitReference | null
}

export function unitReferenceSpecs(unit: PublicUnitReference) {
  const specs: { label: string; value: string }[] = []
  const measure = (n: number) => `${Number(n).toLocaleString('es-EC', { maximumFractionDigits: 2 })} m²`
  if (Number(unit.bedrooms) > 0) specs.push({ label: 'Dormitorios', value: String(unit.bedrooms) })
  if (Number(unit.area_internal_m2) > 0) specs.push({ label: 'Área interior', value: measure(unit.area_internal_m2!) })
  if (Number(unit.area_exterior_m2) > 0) specs.push({ label: 'Área exterior', value: measure(unit.area_exterior_m2!) })
  if (Number(unit.bathrooms_full) > 0) specs.push({ label: 'Baños completos', value: String(unit.bathrooms_full) })
  if (unit.floor?.trim() || unit.floor_number != null) specs.push({ label: 'Planta', value: unit.floor?.trim() || String(unit.floor_number) })
  return specs
}

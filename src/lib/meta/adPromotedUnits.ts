import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AdPromotedUnitLink = {
  id: string
  adId: string
  unitId: string | null
  unitLabel: string | null
  externalLabel: string | null
  assignedAt: string
  assignedBy: string | null
}

export type AdPromotedUnitSummary = {
  adId: string
  /** none | single | multi */
  kind: 'none' | 'single' | 'multi'
  label: string
  links: AdPromotedUnitLink[]
  /** true solo si hay exactamente 1 vínculo inequívoco a unit_id (sirve para sumar gasto por unidad). */
  unambiguousUnitId: string | null
}

export async function listActiveAdPromotedUnits(
  admin: SupabaseClient,
  input: { tenantId: string; projectId: string; adIds?: string[] },
): Promise<Map<string, AdPromotedUnitSummary>> {
  let q = admin
    .from('meta_ad_promoted_units')
    .select(
      'id,ad_id,unit_id,external_label,assigned_at,assigned_by,units(unit_number,category)',
    )
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
    .is('superseded_at', null)
  if (input.adIds?.length) {
    q = q.in('ad_id', input.adIds.slice(0, 500))
  }
  const { data, error } = await q
  const map = new Map<string, AdPromotedUnitSummary>()
  if (error || !data) return map

  type Row = {
    id: string
    ad_id: string
    unit_id: string | null
    external_label: string | null
    assigned_at: string
    assigned_by: string | null
    units:
      | { unit_number: string | null; category: string | null }
      | { unit_number: string | null; category: string | null }[]
      | null
  }

  for (const raw of data as unknown as Row[]) {
    const unitRel = Array.isArray(raw.units) ? raw.units[0] : raw.units
    const unitLabel = raw.unit_id
      ? unitRel?.unit_number
        ? `${unitRel.category || 'unidad'} ${unitRel.unit_number}`
        : `unidad:${raw.unit_id.slice(0, 8)}`
      : raw.external_label
    const link: AdPromotedUnitLink = {
      id: raw.id,
      adId: raw.ad_id,
      unitId: raw.unit_id,
      unitLabel,
      externalLabel: raw.external_label,
      assignedAt: raw.assigned_at,
      assignedBy: raw.assigned_by,
    }
    const prev = map.get(raw.ad_id)
    if (!prev) {
      map.set(raw.ad_id, {
        adId: raw.ad_id,
        kind: 'single',
        label: unitLabel || 'Unidad asignada',
        links: [link],
        unambiguousUnitId: raw.unit_id,
      })
    } else {
      prev.links.push(link)
      prev.kind = 'multi'
      prev.label = 'Varias unidades'
      prev.unambiguousUnitId = null
    }
  }
  return map
}

export function summarizePromotedUnit(
  adId: string,
  map: Map<string, AdPromotedUnitSummary>,
): AdPromotedUnitSummary {
  return (
    map.get(adId) || {
      adId,
      kind: 'none',
      label: 'Unidad no asignada',
      links: [],
      unambiguousUnitId: null,
    }
  )
}

/**
 * Asigna una unidad (o etiqueta externa) a un anuncio.
 * No supersede automáticamente otros vínculos (permite multi).
 */
export async function assignAdPromotedUnit(
  admin: SupabaseClient,
  input: {
    tenantId: string
    projectId: string
    adId: string
    adAccountId?: string | null
    unitId?: string | null
    externalLabel?: string | null
    userId: string
    note?: string | null
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const adId = String(input.adId || '').trim()
  if (!adId) return { ok: false, error: 'ad_id_required' }
  const unitId = input.unitId?.trim() || null
  const externalLabel = input.externalLabel?.trim() || null
  if (!unitId && !externalLabel) {
    return { ok: false, error: 'unit_or_external_required' }
  }
  if (unitId) {
    const { data: unit } = await admin
      .from('units')
      .select('id,project_id')
      .eq('id', unitId)
      .maybeSingle()
    if (!unit || String(unit.project_id) !== input.projectId) {
      return { ok: false, error: 'unit_not_in_project' }
    }
  }
  const { data, error } = await admin
    .from('meta_ad_promoted_units')
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      ad_account_id: input.adAccountId || null,
      ad_id: adId,
      unit_id: unitId,
      external_label: unitId ? null : externalLabel,
      note: input.note || null,
      assigned_by: input.userId,
      assigned_at: new Date().toISOString(),
      superseded_at: null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: String(data.id) }
}

/** Marca vínculos vigentes como históricos (no borra). */
export async function clearAdPromotedUnits(
  admin: SupabaseClient,
  input: {
    tenantId: string
    projectId: string
    adId: string
    userId: string
  },
): Promise<{ ok: true; superseded: number } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('meta_ad_promoted_units')
    .update({
      superseded_at: new Date().toISOString(),
      superseded_by: input.userId,
    })
    .eq('tenant_id', input.tenantId)
    .eq('project_id', input.projectId)
    .eq('ad_id', input.adId)
    .is('superseded_at', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, superseded: data?.length || 0 }
}

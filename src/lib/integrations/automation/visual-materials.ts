import { unitTourUrl } from '@/lib/tour/unitModels'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { db, object, scope, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** A typology gallery is evidence of reference images, not photographs or an
 * exact design for every unit associated with that typology. */
export function localVisualMaterials(units: Row[], types: Row[], assets: Row[], publicUrl: (asset: Row) => string): Row {
  const galleries = types.filter(type => type.is_active === true).flatMap(type => {
    const members = units.filter(unit => unit.unit_type_id === type.id && unit.category === 'local'
      && unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
    if (!members.length) return []
    const codes = [text(type.name), text(type.slug)].filter(Boolean)
    const material = assets.filter(asset => codes.includes(text(asset.typology_code))
      && ['render', 'plano'].includes(text(asset.kind)) && !!text(asset.storage_path)
      && !text(asset.storage_path).includes('/_original/') && !/_2048(?:-r\d+)?\./i.test(text(asset.file_name)))
      .map(asset => ({ kind: asset.kind, url: publicUrl(asset) })).filter(asset => asset.url)
    if (!material.length) return []
    return [{ typology: type.name, unit_ids: members.map(unit => unit.id),
      unit_numbers: members.map(unit => unit.unit_number), scope: 'shared_typology_reference',
      asset_count: material.length, examples: material.slice(0, 2), gallery_url: unitTourUrl(members[0].unit_number),
      navigation_reference_unit: members[0].unit_number, navigation_selects_customer_preference: false,
      has_360: false, represents_completed_building: false }]
  })
  return { requested: true, available: galleries.length > 0, read_status: 'complete', galleries,
    instruction: 'Atienda la solicitud visual con las galerías verificadas y sus enlaces. Los locales tienen renders o planos de referencia de la tipología, no un recorrido 360 ni fotografías de obra terminada. No afirme que cada imagen representa exactamente un local concreto. La obra pendiente no impide mostrar renders. Compartir la galería no elige un local ni autoriza trámites. No sustituya esta respuesta por otra enumeración de códigos ni obligue a elegir una unidad antes de ver el material. Un enlace a una imagen no es un adjunto enviado.' }
}

/** Read visual sources only for a reconciled visualization request and its
 * resolved commercial-unit references. Never search arbitrary lead URLs. */
export async function localVisualMaterialContext(info: Row, reference: Row): Promise<Row | null> {
  const requests = rows(object(info.contrato_turno).requests)
  if (!requests.some(request => request.domain === 'property' && acceptedExtractorConfidence(request.confidence)
    && Array.isArray(request.topics) && request.topics.includes('visualization'))) return null
  const resolved = rows(reference.matches).filter(unit => unit.category === 'local')
  if (!resolved.length) return null
  const ids = new Set(resolved.map(unit => text(unit.id)))
  const all = [...rows(info.catalogo_verificacion), ...rows(info.catalogo)]
  const byId = new Map<string, Row>()
  for (const unit of [...resolved, ...all.filter(unit => ids.has(text(unit.id)))])
    byId.set(text(unit.id), { ...byId.get(text(unit.id)), ...unit })
  const members = [...byId.values()]
  const typeIds = [...new Set(members.map(unit => text(unit.unit_type_id)).filter(Boolean))]
  const unavailable = (status: string) => ({ requested: true, available: false, read_status: status, galleries: [],
    instruction: 'Esta lectura no confirma ausencia de imágenes. No diga que no existen ni derive automáticamente; conserve la consulta y las referencias conocidas.' })
  if (!typeIds.length) return unavailable('missing_typology_reference')
  try {
    const client = db()
    const types = await client.from('unit_types').select('id,name,slug,is_active').eq('tenant_id', scope.tenant_id)
      .in('id', typeIds).eq('is_active', true).abortSignal(AbortSignal.timeout(10_000))
    if (types.error) return unavailable('typology_read_failed')
    const aliases = [...new Set((types.data || []).flatMap(type => [type.name, type.slug]).filter(Boolean))]
    if (!aliases.length) return localVisualMaterials(members, [], [], () => '')
    const assets = await client.from('typology_assets').select('typology_code,kind,file_name,storage_path,created_at,sort_order')
      .in('typology_code', aliases).in('kind', ['render', 'plano']).order('sort_order').limit(101)
      .abortSignal(AbortSignal.timeout(10_000))
    if (assets.error) return unavailable('asset_read_failed')
    if ((assets.data || []).length > 100) return unavailable('asset_read_incomplete')
    return localVisualMaterials(members, types.data || [], assets.data || [],
      asset => client.storage.from('typology-assets').getPublicUrl(text(asset.storage_path)).data.publicUrl)
  } catch { return unavailable('asset_read_failed') }
}

export const VISUAL_MATERIAL_WRITER_RULES = 'MATERIAL VISUAL: material_visual describe los recursos realmente consultados para la solicitud actual. Con available=true, comparta la galería pertinente y explique brevemente qué muestra. No declare ausencia de imágenes si existen renders, ni confunda un enlace con una imagen adjunta. No ofrezca 360 para locales que solo tienen galería. La consulta visual conserva la selección y las preferencias: no exige repetir todos los locales ni elegir uno antes de mostrar la galería. Si read_status no es complete, la lectura pendiente no prueba ausencia de material.'

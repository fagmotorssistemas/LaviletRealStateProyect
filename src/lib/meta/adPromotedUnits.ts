import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePropertyTargets, summarizePropertyLinks, type AdPromotedUnitLink, type AdPromotedUnitSummary, type PropertyTarget } from './adPropertyIdentification'
export type { AdPromotedUnitLink, AdPromotedUnitSummary } from './adPropertyIdentification'

export type PromotedPropertyScope = { tenantId: string; projectId: string; adAccountId: string }

/** No guessed global account: only a unique saved account in the authorized project. */
export async function savedPropertyAccount(admin: SupabaseClient, input: {tenantId:string;projectId:string;adIds:string[]}): Promise<string|null> {
  const accounts = new Set<string>()
  for (let i=0;i<input.adIds.length;i+=200) {
    for(let offset=0;;offset+=1000) {
      const {data,error}=await admin.from('meta_ad_promoted_units').select('ad_account_id')
        .eq('tenant_id',input.tenantId).eq('project_id',input.projectId).in('ad_id',input.adIds.slice(i,i+200)).is('superseded_at',null).order('id').range(offset,offset+999)
      if (error) throw new Error('No se pudieron leer las propiedades guardadas.')
      for (const row of data || []) if (/^act_\d+$/.test(row.ad_account_id || '')) accounts.add(row.ad_account_id)
      if (!data || data.length<1000) break
    }
  }
  return accounts.size===1?[...accounts][0]:null
}
type LinkRow = {
  id: string; ad_id: string; unit_id: string | null; external_label: string | null
  assigned_at: string; assigned_by: string | null; superseded_at: string | null; note: string | null
  units: {unit_number: string | null; category: string | null; tenant_id: string; project_id: string} | null
}

function linkFromRow(row: LinkRow): AdPromotedUnitLink {
  return {id: row.id, adId: row.ad_id, unitId: row.unit_id, externalLabel: row.external_label,
    unitLabel: row.unit_id ? `${row.units?.category || 'Unidad'} ${row.units?.unit_number || row.unit_id}` : row.external_label,
    assignedAt: row.assigned_at, assignedBy: row.assigned_by}
}

export async function listActiveAdPromotedUnits(admin: SupabaseClient, input: PromotedPropertyScope & {adIds: string[]}): Promise<Map<string, AdPromotedUnitSummary>> {
  const grouped = new Map<string, AdPromotedUnitLink[]>()
  const ids = [...new Set(input.adIds)]
  for (let i = 0; i < ids.length; i += 200) {
    for (let offset = 0; ; offset += 1000) {
      const {data, error} = await admin.from('meta_ad_promoted_units')
        .select('id,ad_id,unit_id,external_label,assigned_at,assigned_by,units(unit_number,category,tenant_id,project_id)')
        .eq('tenant_id', input.tenantId).eq('project_id', input.projectId)
        .eq('ad_account_id', input.adAccountId).in('ad_id', ids.slice(i,i+200))
        .is('superseded_at', null).order('id').range(offset,offset+999)
      if (error) throw new Error('No se pudieron leer las propiedades guardadas. Vuelva a consultar.')
      for (const row of (data || []) as unknown as LinkRow[]) {
        if (row.unit_id && (!row.units || row.units.tenant_id !== input.tenantId || row.units.project_id !== input.projectId)) throw new Error('La relación guardada requiere revisión de proyecto y unidad.')
        const list = grouped.get(row.ad_id) || []
        list.push(linkFromRow(row)); grouped.set(row.ad_id,list)
      }
      if (!data || data.length < 1000) break
    }
  }
  return new Map([...grouped].map(([adId,links]) => [adId,summarizePropertyLinks(adId,links)]))
}

export function summarizePromotedUnit(adId: string, map: Map<string,AdPromotedUnitSummary>): AdPromotedUnitSummary {
  return map.get(adId) || summarizePropertyLinks(adId,[])
}

/** One atomic correction, preserving previous rows. The RPC remains service-role-only. */
export async function replaceAdPromotedProperties(admin: SupabaseClient, input: PromotedPropertyScope & {
  adId: string; targets: PropertyTarget[]; expectedIds: string[]; userId: string; note: string
}): Promise<{ok:true; id:string} | {ok:false;error:string}> {
  const targets = normalizePropertyTargets(input.targets)
  const {data,error} = await admin.rpc('replace_meta_ad_promoted_properties', {
    p_tenant_id: input.tenantId, p_project_id: input.projectId, p_ad_account_id: input.adAccountId,
    p_ad_id: input.adId, p_targets: targets, p_expected_ids: input.expectedIds,
    p_user_id: input.userId, p_note: input.note,
  })
  if (error) return {ok:false,error: error.message.includes('property_relation_changed')
    ? 'Otra persona corrigió esta propiedad. Recargue el informe antes de guardar.'
    : error.message.includes('existing_relation_account_mismatch')
      ? 'Hay una relación anterior cuya cuenta publicitaria requiere revisión del administrador.'
      : error.code === 'PGRST202' || error.code === '42883'
        ? 'El guardado necesita la actualización pendiente de base de datos. Pida al administrador aplicarla.'
        : 'No se pudo guardar la identificación. Revise las propiedades o vuelva a intentarlo.'}
  return {ok:true,id:String(data?.[0] || '')}
}

export async function listAdPropertyHistory(admin: SupabaseClient, input: PromotedPropertyScope & {adId: string}) {
  const {data,error} = await admin.from('meta_ad_promoted_units')
    .select('id,ad_id,unit_id,external_label,assigned_at,assigned_by,superseded_at,note,units(unit_number,category,tenant_id,project_id)')
    .eq('tenant_id',input.tenantId).eq('project_id',input.projectId).eq('ad_account_id',input.adAccountId)
    .eq('ad_id',input.adId).order('assigned_at',{ascending:false}).limit(100)
  if (error) throw error
  return ((data || []) as unknown as LinkRow[]).map(row => ({...linkFromRow(row),supersededAt:row.superseded_at,note:row.note}))
}

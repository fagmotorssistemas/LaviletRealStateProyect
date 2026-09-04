import type { SupabaseClient } from '@supabase/supabase-js'
import { compareUnitsByUnitNumber } from '@/lib/inmobiliaria/sortUnits'
import { type DataAccessScope } from '@/lib/inmobiliaria/dataScope'
import type {
  Unit, UnitImport, UnitMedia, Lead, Appointment, AppointmentWithUnits, Contract, ContractWithUnits, ShowroomVisit, ShowroomVisitWithUnits, LeadInteraction,
  UnitStatus, LeadStatus, LeadTemperature, AppointmentStatus, InteractionType,
  ShowroomVisitSource,
  Project, ProjectAsset, ProjectAssetKind, ProjectDetail, ContractStatus, InventorySortOption,
  PaymentPlan, LeadFinancing, AsesoriaFinanciamiento, FinancingPartner, TeamProfile,
  UnitSalesClosing, TypologyImport, TypologyAsset, TypologyAssetKind,
} from '@/types/inmobiliaria'
import { UNASSIGNED_ASSIGNEE } from '@/types/inmobiliaria'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'

/** Bucket público para fotos, planos PDF y documentos de proyecto. */
export const PROJECT_ASSETS_BUCKET = 'project-assets'

/** Bucket público para imágenes por unidad (departamento, local, etc.). */
export const UNIT_ASSETS_BUCKET = 'unit-assets'

function unwrapEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return (Array.isArray(value) ? value[0] : value) ?? null
}

// ─── Projects ───────────────────────────────────────────────
export async function listProjects(supabase: SupabaseClient, tenantId: string, tenantIds?: string[]): Promise<Project[]> {
  const tenantFilterIds = tenantIds?.length ? tenantIds : [tenantId]
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .in('tenant_id', tenantFilterIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = projects ?? []
  if (rows.length === 0) return []

  const projectIds = rows.map((p) => p.id)
  const { data: assetRows } = await supabase
    .from('project_assets')
    .select('id, tenant_id, project_id, kind, file_name, storage_path, mime_type, file_size_bytes, caption, sort_order, is_cover, created_at, updated_at')
    .in('project_id', projectIds)

  const byProject = new Map<string, ProjectAsset[]>()
  for (const a of assetRows ?? []) {
    const list = byProject.get(a.project_id) ?? []
    list.push(a as ProjectAsset)
    byProject.set(a.project_id, list)
  }

  return rows.map((p) => ({
    ...(p as Project),
    project_assets: byProject.get(p.id) ?? [],
  }))
}

export async function getProject(supabase: SupabaseClient, projectId: string, tenantId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  return data as Project | null
}

export async function getProjectDetail(supabase: SupabaseClient, projectId: string, tenantId: string): Promise<ProjectDetail | null> {
  const project = await getProject(supabase, projectId, tenantId)
  if (!project) return null

  const [{ count }, { data: assets, error: assetsErr }] = await Promise.all([
    supabase.from('units').select('*', { count: 'exact', head: true }).eq('project_id', projectId),
    supabase
      .from('project_assets')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])
  if (assetsErr) throw assetsErr

  return {
    ...project,
    units_count: count ?? 0,
    project_assets: (assets ?? []) as ProjectAsset[],
  }
}

export function getProjectAssetPublicUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(PROJECT_ASSETS_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

export async function uploadProjectAsset(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    projectId: string
    file: File
    kind: ProjectAssetKind
    caption?: string | null
    setAsCover?: boolean
  },
): Promise<ProjectAsset> {
  const { file: uploadFile, tenantId, projectId, kind, caption, setAsCover } = params
  const ext = uploadFile.name.includes('.') ? uploadFile.name.split('.').pop() : undefined
  const safeName = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
  const storagePath = `${tenantId}/${projectId}/${safeName}`

  const { error: upErr } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .upload(storagePath, uploadFile, { upsert: false, contentType: uploadFile.type || undefined })
  if (upErr) throw upErr

  const { data: maxRow } = await supabase
    .from('project_assets')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const isCover = Boolean(setAsCover && kind === 'photo')
  if (isCover) {
    await supabase.from('project_assets').update({ is_cover: false }).eq('project_id', projectId).eq('kind', 'photo')
  }

  const { data, error } = await supabase
    .from('project_assets')
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      kind,
      file_name: uploadFile.name,
      storage_path: storagePath,
      mime_type: uploadFile.type || null,
      file_size_bytes: uploadFile.size,
      caption: caption ?? null,
      sort_order: nextOrder,
      is_cover: isCover,
    })
    .select()
    .single()

  if (error) {
    await supabase.storage.from(PROJECT_ASSETS_BUCKET).remove([storagePath])
    throw error
  }
  return data as ProjectAsset
}

export async function deleteProjectAsset(supabase: SupabaseClient, assetId: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabase.from('project_assets').select('storage_path').eq('id', assetId).single()
  if (fetchErr) throw fetchErr
  await supabase.storage.from(PROJECT_ASSETS_BUCKET).remove([row.storage_path])
  const { error } = await supabase.from('project_assets').delete().eq('id', assetId)
  if (error) throw error
}

export async function setProjectCoverPhoto(supabase: SupabaseClient, projectId: string, assetId: string): Promise<void> {
  await supabase.from('project_assets').update({ is_cover: false }).eq('project_id', projectId).eq('kind', 'photo')
  const { error } = await supabase.from('project_assets').update({ is_cover: true }).eq('id', assetId).eq('project_id', projectId)
  if (error) throw error
}

export async function updateProjectAssetCaption(supabase: SupabaseClient, assetId: string, caption: string | null): Promise<void> {
  const { error } = await supabase.from('project_assets').update({ caption }).eq('id', assetId)
  if (error) throw error
}

export async function createProject(
  supabase: SupabaseClient,
  payload: Partial<Project> & { tenant_id: string; name: string }
) {
  const { data, error } = await supabase.from('projects').insert(payload).select().single()
  if (error) throw error
  return data as Project
}

// ─── Units (Inventario) ─────────────────────────────────────
interface ListUnitsParams {
  tenantId: string
  tenantIds?: string[]
  projectId?: string
  status?: UnitStatus
  category?: string
  search?: string
  page?: number
  pageSize?: number
  /** `unit_natural`: orden numérico en cliente (solo inventario). Sin definir: paginación en servidor por `unit_number`. */
  sort?: InventorySortOption
}

const FETCH_BATCH = 1000

type UnitSearchMode = 'full' | 'number'

/** PostgREST `.or()` treats `, ( ) . *` as syntax; strip wildcards that would break ilike. */
function sanitizeIlikeTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[%_*,()"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function mapUnitRow(row: Unit): Unit {
  const project = unwrapEmbedded(row.project as Project | Project[] | null | undefined)
  const unitType = unwrapEmbedded(
    (row as Unit & { unit_type?: { name?: string } | { name?: string }[] | null }).unit_type,
  )
  const bathroomsFull = row.bathrooms_full ?? row.bathrooms ?? null
  return {
    ...row,
    project: project ?? undefined,
    unit_type_id: row.unit_type_id ?? null,
    typology_code: unitType?.name ?? row.typology_code ?? null,
    plan_group: row.plan_group ?? null,
    floor_number: row.floor_number ?? null,
    area_exterior_m2: row.area_exterior_m2 ?? null,
    bathrooms_full: bathroomsFull,
    bathrooms_half: row.bathrooms_half ?? null,
    bathrooms: bathroomsFull,
    spaces: Array.isArray(row.spaces) ? row.spaces : [],
    parking_assigned: row.parking_assigned ?? 0,
  }
}

function applyUnitsListFilters(query: any, params: ListUnitsParams, searchMode: UnitSearchMode) {
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]
  query = query.in('tenant_id', tenantIds)
  if (params.projectId) query = query.eq('project_id', params.projectId)
  if (params.status) query = query.eq('status', params.status)
  if (params.category) query = query.eq('category', params.category)
  const term = params.search ? sanitizeIlikeTerm(params.search) : ''
  if (!term) return query
  if (searchMode === 'number') {
    return query.ilike('unit_number', `%${term}%`)
  }
  return query.or(
    `unit_number.ilike."%${term}%",plan_group.ilike."%${term}%",floor.ilike."%${term}%",category.ilike."%${term}%"`,
  )
}

function applyUnitsListSort(query: any, sort: InventorySortOption | undefined) {
  switch (sort) {
    case 'price_desc':
      query = query.order('published_commercial_price', { ascending: false, nullsFirst: false })
      break
    case 'price_asc':
      query = query.order('published_commercial_price', { ascending: true, nullsFirst: false })
      break
    case 'area_desc':
      query = query.order('area_total_m2', { ascending: false, nullsFirst: false })
      break
    case 'area_asc':
      query = query.order('area_total_m2', { ascending: true, nullsFirst: false })
      break
    default:
      query = query.order('unit_number', { ascending: true })
  }
  return query.order('id', { ascending: true })
}

export async function listUnits(supabase: SupabaseClient, params: ListUnitsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const sort = params.sort

  if (sort === 'unit_natural') {
    const all: Unit[] = []
    let batchFrom = 0
    let searchMode: UnitSearchMode = 'full'
    for (;;) {
      let q = applyUnitsListFilters(
        supabase.from('units').select('*, project:projects(id, name), unit_type:unit_types(id, name, slug)'),
        params,
        searchMode,
      )
      const { data, error } = await q.range(batchFrom, batchFrom + FETCH_BATCH - 1)
      if (error && params.search && searchMode === 'full') {
        searchMode = 'number'
        batchFrom = 0
        all.length = 0
        continue
      }
      if (error) throw error
      const rows = ((data ?? []) as Unit[]).map(mapUnitRow)
      if (rows.length === 0) break
      all.push(...rows)
      if (rows.length < FETCH_BATCH) break
      batchFrom += FETCH_BATCH
    }
    all.sort(compareUnitsByUnitNumber)
    const total = all.length
    const pageSlice = all.slice(from, to + 1)
    return { data: pageSlice, total }
  }

  const run = (searchMode: UnitSearchMode) => {
    let query = applyUnitsListFilters(
      supabase.from('units').select('*, project:projects(id, name), unit_type:unit_types(id, name, slug)', { count: 'exact' }),
      params,
      searchMode,
    )
    query = applyUnitsListSort(query, sort)
    return query.range(from, to)
  }

  let { data, error, count } = await run('full')
  if (error && params.search) {
    const retry = await run('number')
    data = retry.data
    error = retry.error
    count = retry.count
  }
  if (error) throw error
  return { data: ((data ?? []) as Unit[]).map(mapUnitRow), total: count ?? 0 }
}

export async function listActiveUnitTypes(
  supabase: SupabaseClient,
  tenantIds: string[],
): Promise<{ id: string; name: string }[]> {
  if (!tenantIds.length) return []
  const { data, error } = await supabase
    .from('unit_types')
    .select('id, name')
    .in('tenant_id', tenantIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }))
}

type UnitTableRow = {
  id: string
  category: string | null
  unit_number: string
  plan_group: string | null
  floor: string | null
  floor_number: number | null
  area_internal_m2: number | null
  area_exterior_m2: number | null
  parking_assigned: number | null
  bedrooms: number | null
  bathrooms_full: number | null
  bathrooms_half: number | null
  bathrooms: number | null
  spaces: string[] | null
  created_at: string
  published_commercial_price: number | null
  status: UnitStatus | null
  unit_type_id: string | null
  unit_type?: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null
}

function unitTypeOf(row: UnitTableRow) {
  const value = row.unit_type
  return Array.isArray(value) ? value[0] : value
}

function mapUnitImportRow(row: UnitTableRow): UnitImport {
  const type = unitTypeOf(row)
  const unitNumber = row.unit_number
  const price = row.published_commercial_price ?? null
  return {
    id: row.id,
    category: row.category ?? '',
    unit_code: unitNumber,
    unit_number: unitNumber,
    plan_group: row.plan_group,
    floor_label: row.floor,
    floor: row.floor,
    floor_number: row.floor_number,
    area_internal_m2: row.area_internal_m2,
    area_exterior_m2: row.area_exterior_m2,
    parking: row.parking_assigned,
    bedrooms: row.bedrooms,
    bathrooms_full: row.bathrooms_full ?? row.bathrooms,
    bathrooms_half: row.bathrooms_half,
    spaces: Array.isArray(row.spaces) ? row.spaces : [],
    created_at: row.created_at,
    price,
    published_commercial_price: price,
    status: row.status ?? 'disponible',
    unit_type_id: row.unit_type_id,
    typology_code: type?.name ?? null,
  }
}

const UNITS_LIST_SELECT =
  'id, category, unit_number, plan_group, floor, floor_number, area_internal_m2, area_exterior_m2, parking_assigned, bedrooms, bathrooms_full, bathrooms_half, bathrooms, spaces, created_at, published_commercial_price, status, unit_type_id'

async function attachUnitTypes(supabase: SupabaseClient, rows: UnitTableRow[]): Promise<UnitImport[]> {
  const ids = [...new Set(rows.map((row) => row.unit_type_id).filter((id): id is string => Boolean(id)))]
  const typeById = new Map<string, { id: string; name: string; slug: string }>()
  if (ids.length > 0) {
    const { data, error } = await supabase.from('unit_types').select('id, name, slug').in('id', ids)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) typeById.set(row.id, row)
  }
  return rows.map((row) =>
    mapUnitImportRow({
      ...row,
      unit_type: row.unit_type_id ? typeById.get(row.unit_type_id) ?? null : null,
    }),
  )
}

export type UnitsImportWrite = {
  category: string
  unit_code: string
  unit_type_id?: string | null
  plan_group: string | null
  floor_label: string | null
  floor_number: number | null
  area_internal_m2: number | null
  area_exterior_m2: number | null
  parking: number | null
  bedrooms: number | null
  bathrooms_full: number | null
  bathrooms_half: number | null
  spaces: string[]
  price: number | null
  status: UnitStatus
}

function toUnitsWrite(payload: UnitsImportWrite) {
  return {
    category: payload.category,
    unit_number: payload.unit_code,
    unit_type_id: payload.unit_type_id || null,
    plan_group: payload.plan_group,
    floor: payload.floor_label,
    floor_number: payload.floor_number,
    area_internal_m2: payload.area_internal_m2,
    area_exterior_m2: payload.area_exterior_m2,
    parking_assigned: payload.parking,
    bedrooms: payload.bedrooms,
    bathrooms_full: payload.bathrooms_full,
    bathrooms_half: payload.bathrooms_half,
    bathrooms: payload.bathrooms_full,
    spaces: payload.spaces,
    published_commercial_price: payload.price,
    status: payload.status,
  }
}

export async function listUnitsImport(
  supabase: SupabaseClient,
  params: {
    search?: string
    category?: string
    floorNumber?: string
    status?: string
    page?: number
    pageSize?: number
  } = {},
): Promise<{ data: UnitImport[]; total: number }> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('units')
    .select(UNITS_LIST_SELECT, { count: 'exact' })
    .eq('tenant_id', TOUR_TENANT_ID)
    .order('unit_number', { ascending: true })

  if (params.category) query = query.eq('category', params.category)
  if (params.status) query = query.eq('status', params.status)
  if (params.floorNumber !== undefined && params.floorNumber !== '') {
    query = query.eq('floor_number', Number(params.floorNumber))
  }

  const search = params.search?.trim()
  if (search) {
    const escaped = search.replace(/[\\%_]/g, '\\$&')
    query = query.or(
      `unit_number.ilike.%${escaped}%,plan_group.ilike.%${escaped}%,floor.ilike.%${escaped}%,category.ilike.%${escaped}%`,
    )
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw new Error(error.message)
  return { data: await attachUnitTypes(supabase, (data ?? []) as UnitTableRow[]), total: count ?? 0 }
}

export async function listUnitsImportFacets(
  supabase: SupabaseClient,
): Promise<{
  categories: string[]
  floors: { number: number; label: string }[]
  unitTypes: { id: string; name: string }[]
}> {
  const [{ data, error }, typesRes] = await Promise.all([
    supabase.from('units').select('category, floor, floor_number').eq('tenant_id', TOUR_TENANT_ID),
    supabase
      .from('unit_types')
      .select('id, name')
      .eq('tenant_id', TOUR_TENANT_ID)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])
  if (error) throw new Error(error.message)
  if (typesRes.error) throw new Error(typesRes.error.message)

  const categories = [...new Set((data ?? []).map((r) => r.category).filter(Boolean))].sort()
  const floorMap = new Map<number, string>()
  for (const row of data ?? []) {
    if (row.floor_number == null) continue
    floorMap.set(row.floor_number, row.floor || `Piso ${row.floor_number}`)
  }
  const floors = [...floorMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, label]) => ({ number, label }))

  return {
    categories,
    floors,
    unitTypes: (typesRes.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  }
}

export async function createUnitsImport(
  supabase: SupabaseClient,
  payload: UnitsImportWrite,
): Promise<UnitImport> {
  const { data, error } = await supabase
    .from('units')
    .insert({
      ...toUnitsWrite(payload),
      tenant_id: TOUR_TENANT_ID,
      project_id: TOUR_PROJECT_ID,
    })
    .select(UNITS_LIST_SELECT)
    .single()
  if (error) throw new Error(error.message)
  const [mapped] = await attachUnitTypes(supabase, [data as UnitTableRow])
  if (!mapped) throw new Error('No se pudo leer la unidad creada')
  return mapped
}

export async function updateUnitsImport(
  supabase: SupabaseClient,
  id: string,
  payload: UnitsImportWrite,
): Promise<UnitImport> {
  const { data, error } = await supabase
    .from('units')
    .update(toUnitsWrite(payload))
    .eq('id', id)
    .select(UNITS_LIST_SELECT)
    .single()
  if (error) throw new Error(error.message)
  const [mapped] = await attachUnitTypes(supabase, [data as UnitTableRow])
  if (!mapped) throw new Error('No se pudo leer la unidad actualizada')
  return mapped
}

export async function listTypologiesImport(supabase: SupabaseClient): Promise<TypologyImport[]> {
  const { data, error } = await supabase
    .from('unit_types')
    .select('id, name, description, created_at')
    .eq('tenant_id', TOUR_TENANT_ID)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    code: row.name,
    category: '',
    name: row.description || row.name,
    created_at: row.created_at,
  }))
}

export async function listTypologyAssets(
  supabase: SupabaseClient,
  typologyCode: string,
): Promise<TypologyAsset[]> {
  const { data, error } = await supabase
    .from('typology_assets')
    .select('id, typology_code, kind, file_name, storage_path, sort_order, created_at')
    .eq('typology_code', typologyCode)
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TypologyAsset[]
}

export function getTypologyAssetPublicUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

export async function insertTypologyAsset(
  supabase: SupabaseClient,
  payload: {
    typology_code: string
    kind: TypologyAssetKind
    file_name: string
    storage_path: string
  },
): Promise<TypologyAsset> {
  const { data: maxRow } = await supabase
    .from('typology_assets')
    .select('sort_order')
    .eq('typology_code', payload.typology_code)
    .eq('kind', payload.kind)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('typology_assets')
    .insert({
      ...payload,
      sort_order: (maxRow?.sort_order ?? -1) + 1,
    })
    .select('id, typology_code, kind, file_name, storage_path, sort_order, created_at')
    .single()

  if (error) throw new Error(error.message || 'No se pudo guardar la fila')
  return data as TypologyAsset
}

export async function findTypologyAssetByKey(
  supabase: SupabaseClient,
  typologyCode: string,
  kind: TypologyAssetKind,
  fileName: string,
): Promise<TypologyAsset | null> {
  const { data, error } = await supabase
    .from('typology_assets')
    .select('id, typology_code, kind, file_name, storage_path, sort_order, created_at')
    .eq('typology_code', typologyCode)
    .eq('kind', kind)
    .eq('file_name', fileName)
    .maybeSingle()
  if (error) throw error
  return (data as TypologyAsset | null) ?? null
}

export async function deleteTypologyAsset(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabase
    .from('typology_assets')
    .select('id, storage_path')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const { error: storageErr } = await supabase.storage
    .from(TYPOLOGY_ASSETS_BUCKET)
    .remove([row.storage_path])
  if (storageErr) throw storageErr

  const { error } = await supabase.from('typology_assets').delete().eq('id', id)
  if (error) throw error
}

function unitNumberMatchesQuery(unitNumber: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  const n = (unitNumber ?? '').trim().toLowerCase()
  if (!q || !n) return false
  if (n.includes(q)) return true
  const qDigits = q.replace(/\D/g, '')
  if (!qDigits) return false
  return n.replace(/\D/g, '') === qDigits
}

/** Buscador de unidades por número para modales (showroom, leads, agenda, ventas). */
export async function searchUnitsByNumber(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    tenantIds?: string[]
    projectId?: string
    query: string
    excludeIds?: string[]
    pageSize?: number
  },
): Promise<Unit[]> {
  const query = params.query.trim()
  if (!query || !sanitizeIlikeTerm(query)) return []
  const pageSize = params.pageSize ?? 20
  const exclude = new Set(params.excludeIds ?? [])
  const base = {
    tenantId: params.tenantId,
    tenantIds: params.tenantIds,
    pageSize,
  }

  const fetch = (projectId?: string) =>
    listUnits(supabase, { ...base, projectId, search: query })

  let rows = ((await fetch(params.projectId)).data ?? []).filter((u) => !exclude.has(u.id))
  if (rows.length === 0 && params.projectId) {
    rows = ((await fetch(undefined)).data ?? []).filter((u) => !exclude.has(u.id))
  }

  if (rows.length === 0) {
    const scan = await listUnits(supabase, {
      ...base,
      projectId: params.projectId,
      pageSize: 200,
    })
    rows = (scan.data ?? []).filter((u) => !exclude.has(u.id) && unitNumberMatchesQuery(u.unit_number, query))
  }

  if (params.projectId) {
    rows.sort((a, b) => Number(a.project_id !== params.projectId) - Number(b.project_id !== params.projectId))
  }
  return rows.slice(0, pageSize)
}

/** Parámetros para exportar inventario (sin paginación; trae todas las filas que coincidan). */
export interface FetchUnitsForExportParams {
  tenantId: string
  projectId?: string
  /** Vacío = todos los estados */
  statuses?: UnitStatus[]
  category?: string
  sort?: InventorySortOption
}

function applyExportUnitFilters(
  supabase: SupabaseClient,
  params: Omit<FetchUnitsForExportParams, 'sort'>,
) {
  let q = supabase.from('units').select('*, project:projects(id, name)').eq('tenant_id', params.tenantId)
  if (params.projectId) q = q.eq('project_id', params.projectId)
  if (params.statuses?.length) q = q.in('status', params.statuses)
  if (params.category) q = q.eq('category', params.category)
  return q
}

export async function countUnitsForExport(
  supabase: SupabaseClient,
  params: Omit<FetchUnitsForExportParams, 'sort'>,
): Promise<number> {
  let q = supabase.from('units').select('*', { count: 'exact', head: true }).eq('tenant_id', params.tenantId)
  if (params.projectId) q = q.eq('project_id', params.projectId)
  if (params.statuses?.length) q = q.in('status', params.statuses)
  if (params.category) q = q.eq('category', params.category)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export async function fetchUnitsForExport(
  supabase: SupabaseClient,
  params: FetchUnitsForExportParams,
): Promise<Unit[]> {
  const sort = params.sort ?? 'unit_natural'
  const filterBase = {
    tenantId: params.tenantId,
    projectId: params.projectId,
    statuses: params.statuses,
    category: params.category,
  }

  if (sort === 'unit_natural') {
    const all: Unit[] = []
    let batchFrom = 0
    for (;;) {
      const q = applyExportUnitFilters(supabase, filterBase).range(batchFrom, batchFrom + FETCH_BATCH - 1)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as Unit[]
      if (rows.length === 0) break
      all.push(...rows)
      if (rows.length < FETCH_BATCH) break
      batchFrom += FETCH_BATCH
    }
    all.sort(compareUnitsByUnitNumber)
    return all
  }

  const all: Unit[] = []
  let batchFrom = 0
  for (;;) {
    let q = applyExportUnitFilters(supabase, filterBase)
    switch (sort) {
      case 'price_desc':
        q = q.order('published_commercial_price', { ascending: false, nullsFirst: false })
        break
      case 'price_asc':
        q = q.order('published_commercial_price', { ascending: true, nullsFirst: false })
        break
      case 'area_desc':
        q = q.order('area_total_m2', { ascending: false, nullsFirst: false })
        break
      case 'area_asc':
        q = q.order('area_total_m2', { ascending: true, nullsFirst: false })
        break
      default:
        q = q.order('unit_number', { ascending: true })
    }
    q = q.order('id', { ascending: true })
    const { data, error } = await q.range(batchFrom, batchFrom + FETCH_BATCH - 1)
    if (error) throw error
    const rows = (data ?? []) as Unit[]
    if (rows.length === 0) break
    all.push(...rows)
    if (rows.length < FETCH_BATCH) break
    batchFrom += FETCH_BATCH
  }
  return all
}

export async function getUnit(supabase: SupabaseClient, unitId: string) {
  const { data, error } = await supabase
    .from('units')
    .select(
      '*, project:projects(id, name), unit_type:unit_types(id, name, slug), unit_media(id, tenant_id, unit_id, type, url, storage_path, file_name, mime_type, file_size_bytes, caption, sort_order, is_cover, created_at, updated_at)',
    )
    .eq('id', unitId)
    .order('sort_order', { referencedTable: 'unit_media', ascending: true })
    .single()
  if (error) throw error
  return mapUnitRow(data as Unit)
}

export function getUnitMediaPublicUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(UNIT_ASSETS_BUCKET).getPublicUrl(storagePath).data.publicUrl
}

export async function uploadUnitMedia(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    projectId: string
    unitId: string
    file: File
    caption?: string | null
    setAsCover?: boolean
    /** Por defecto `gallery` (fotos de la unidad). */
    type?: string
  },
): Promise<UnitMedia> {
  const { file: uploadFile, tenantId, projectId, unitId, caption, setAsCover, type = 'gallery' } = params
  const ext = uploadFile.name.includes('.') ? uploadFile.name.split('.').pop() : undefined
  const safeName = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
  const storagePath = `${tenantId}/${projectId}/${unitId}/${safeName}`

  const { error: upErr } = await supabase.storage
    .from(UNIT_ASSETS_BUCKET)
    .upload(storagePath, uploadFile, { upsert: false, contentType: uploadFile.type || undefined })
  if (upErr) throw upErr

  const publicUrl = getUnitMediaPublicUrl(supabase, storagePath)

  const { data: maxRow } = await supabase
    .from('unit_media')
    .select('sort_order')
    .eq('unit_id', unitId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const isCover = Boolean(setAsCover)
  if (isCover) {
    await supabase.from('unit_media').update({ is_cover: false }).eq('unit_id', unitId)
  }

  const { data, error } = await supabase
    .from('unit_media')
    .insert({
      tenant_id: tenantId,
      unit_id: unitId,
      type,
      url: publicUrl,
      storage_path: storagePath,
      file_name: uploadFile.name,
      mime_type: uploadFile.type || null,
      file_size_bytes: uploadFile.size,
      caption: caption ?? null,
      sort_order: nextOrder,
      is_cover: isCover,
    })
    .select()
    .single()

  if (error) {
    await supabase.storage.from(UNIT_ASSETS_BUCKET).remove([storagePath])
    throw error
  }
  return data as UnitMedia
}

export async function deleteUnitMedia(supabase: SupabaseClient, mediaId: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabase.from('unit_media').select('storage_path').eq('id', mediaId).single()
  if (fetchErr) throw fetchErr
  if (row?.storage_path) {
    await supabase.storage.from(UNIT_ASSETS_BUCKET).remove([row.storage_path])
  }
  const { error } = await supabase.from('unit_media').delete().eq('id', mediaId)
  if (error) throw error
}

export async function setUnitCoverMedia(supabase: SupabaseClient, unitId: string, mediaId: string): Promise<void> {
  await supabase.from('unit_media').update({ is_cover: false }).eq('unit_id', unitId)
  const { error } = await supabase.from('unit_media').update({ is_cover: true }).eq('id', mediaId).eq('unit_id', unitId)
  if (error) throw error
}

export async function updateUnitMediaCaption(supabase: SupabaseClient, mediaId: string, caption: string | null): Promise<void> {
  const { error } = await supabase.from('unit_media').update({ caption }).eq('id', mediaId)
  if (error) throw error
}

function unitWriteRow(payload: Partial<Unit>) {
  const { typology_code: _typology, project: _project, unit_media: _media, ...row } = payload
  return row
}

export async function createUnit(
  supabase: SupabaseClient,
  payload: Partial<Unit> & { tenant_id: string; project_id: string; unit_number: string }
) {
  const { data, error } = await supabase
    .from('units')
    .insert(unitWriteRow(payload))
    .select('*, project:projects(id, name), unit_type:unit_types(id, name, slug)')
    .single()
  if (error) throw error
  return mapUnitRow(data as Unit)
}

export async function updateUnit(
  supabase: SupabaseClient,
  unitId: string,
  payload: Partial<Unit>
) {
  const { data, error } = await supabase
    .from('units')
    .update(unitWriteRow(payload))
    .eq('id', unitId)
    .select('*, project:projects(id, name), unit_type:unit_types(id, name, slug)')
    .single()
  if (error) throw error
  return mapUnitRow(data as Unit)
}

export async function updateUnitStatus(supabase: SupabaseClient, unitId: string, status: UnitStatus) {
  return updateUnit(supabase, unitId, { status })
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  payload: Partial<Project>
) {
  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', projectId)
    .select()
    .single()
  if (error) throw error
  return data as Project
}

// ─── Leads ──────────────────────────────────────────────────
interface ListLeadsParams {
  tenantId: string
  tenantIds?: string[]
  projectId?: string
  status?: LeadStatus
  temperature?: LeadTemperature
  search?: string
  assignedTo?: string
  financing?: boolean
  page?: number
  pageSize?: number
  /** Reservado: el listado muestra todos los leads del tenant. */
  scope?: DataAccessScope | null
}

export async function listLeads(supabase: SupabaseClient, params: ListLeadsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const search = params.search?.replace(/[%(),]/g, '').trim()
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })

  if (params.assignedTo === UNASSIGNED_ASSIGNEE) query = query.is('assigned_to', null)
  else if (params.assignedTo) query = query.eq('assigned_to', params.assignedTo)
  if (params.status) query = query.eq('status', params.status)
  if (params.temperature) query = query.eq('temperature', params.temperature)
  if (params.financing === true) query = query.eq('financing', true)
  if (params.financing === false) query = query.eq('financing', false)
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)

  const { data, error, count } = await query.range(from, to)
  if (error) throw error

  const leads = (data ?? []) as Lead[]
  const assigneeIds = [...new Set(leads.map((l) => l.assigned_to).filter(Boolean))] as string[]
  if (assigneeIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', assigneeIds)
    const byId = new Map(
      (profiles ?? []).map((p) => [
        p.id,
        { full_name: (p.full_name as string | null) ?? null, avatar_url: (p.avatar_url as string | null) ?? null },
      ]),
    )
    for (const lead of leads) {
      if (lead.assigned_to) {
        lead.assigned_profile = byId.get(lead.assigned_to) ?? { full_name: null }
      }
    }
  }

  return { data: leads, total: count ?? 0 }
}

export async function getLead(supabase: SupabaseClient, leadId: string, _scope?: DataAccessScope | null) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, lead_units(*, unit:units(id, unit_number, published_commercial_price, status, project:projects(name))), assigned_profile:profiles!leads_assigned_to_fkey(full_name, avatar_url)')
    .eq('id', leadId)
    .single()
  if (error) throw error
  const lead = data as Lead
  return lead
}

export async function listTeamProfiles(supabase: SupabaseClient): Promise<TeamProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, is_active')
    .order('full_name', { ascending: true })
  if (error) throw error
  return ((data ?? []) as TeamProfile[]).filter((p) => p.is_active !== false)
}

export async function updateLeadAssignee(
  supabase: SupabaseClient,
  leadId: string,
  assignedTo: string | null,
) {
  const { data, error } = await supabase
    .from('leads')
    .update({ assigned_to: assignedTo })
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  return data as Lead
}

export async function createLead(
  supabase: SupabaseClient,
  payload: Partial<Lead> & { tenant_id: string; name: string },
  unitIds?: string[]
) {
  const { data, error } = await supabase.from('leads').insert(payload).select().single()
  if (error) throw error
  const lead = data as Lead

  if (unitIds?.length) {
    const rows = unitIds.map((unit_id, i) => ({ lead_id: lead.id, unit_id, priority: i }))
    const { error: linkError } = await supabase.from('lead_units').insert(rows)
    if (linkError) throw linkError
  }

  return lead
}

export async function updateLead(
  supabase: SupabaseClient,
  leadId: string,
  payload: Partial<Lead>
) {
  const { data, error } = await supabase
    .from('leads')
    .update(payload)
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  return data as Lead
}

export async function updateLeadStatus(supabase: SupabaseClient, leadId: string, status: LeadStatus) {
  const { data, error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  return data as Lead
}

export async function updateLeadTemperature(
  supabase: SupabaseClient,
  leadId: string,
  temperature: LeadTemperature,
) {
  const { data, error } = await supabase
    .from('leads')
    .update({ temperature, temperature_updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  return data as Lead
}

// ─── Lead Units ─────────────────────────────────────────────
export async function addLeadUnit(supabase: SupabaseClient, leadId: string, unitId: string, priority = 0) {
  const { error } = await supabase.from('lead_units').insert({ lead_id: leadId, unit_id: unitId, priority })
  if (error) throw error
}

export async function removeLeadUnit(supabase: SupabaseClient, leadId: string, unitId: string) {
  const { error } = await supabase.from('lead_units').delete().eq('lead_id', leadId).eq('unit_id', unitId)
  if (error) throw error
}

// ─── Lead Interactions ──────────────────────────────────────
export async function listLeadInteractions(supabase: SupabaseClient, leadId: string) {
  const { data, error } = await supabase
    .from('lead_interactions')
    .select('*, responsible:profiles!lead_interactions_responsible_id_fkey(full_name)')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as LeadInteraction[]
}

export async function addLeadInteraction(
  supabase: SupabaseClient,
  payload: { tenant_id: string; lead_id: string; responsible_id: string; type: InteractionType; content: string; result?: string }
) {
  const { data, error } = await supabase.from('lead_interactions').insert(payload).select().single()
  if (error) throw error
  return data as LeadInteraction
}

// ─── Appointments ───────────────────────────────────────────
interface ListAppointmentsParams {
  tenantId: string
  tenantIds?: string[]
  responsibleId?: string
  status?: AppointmentStatus
  statuses?: AppointmentStatus[]
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
  search?: string
  scope?: DataAccessScope | null
}

export async function listAppointments(supabase: SupabaseClient, params: ListAppointmentsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  let query = supabase
    .from('appointments')
    .select('*, lead:leads(id, name, phone), responsible:profiles!appointments_responsible_id_fkey(full_name), project:projects(id, name)', {
      count: 'exact',
    })
    .in('tenant_id', tenantIds)
    .order('start_time', { ascending: true })

  if (params.statuses?.length) query = query.in('status', params.statuses)
  else if (params.status) query = query.eq('status', params.status)
  if (params.responsibleId) query = query.eq('responsible_id', params.responsibleId)
  if (params.dateFrom) query = query.gte('start_time', params.dateFrom)
  if (params.dateTo) query = query.lte('start_time', params.dateTo)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`title.ilike.%${q}%,notes.ilike.%${q}%`)
  }

  let { data, error, count } = await query.range(from, to)
  if (error) {
    let fallback = supabase
      .from('appointments')
      .select('*', { count: 'exact' })
      .in('tenant_id', tenantIds)
      .order('start_time', { ascending: true })
    if (params.statuses?.length) fallback = fallback.in('status', params.statuses)
    else if (params.status) fallback = fallback.eq('status', params.status)
    if (params.responsibleId) fallback = fallback.eq('responsible_id', params.responsibleId)
    if (params.dateFrom) fallback = fallback.gte('start_time', params.dateFrom)
    if (params.dateTo) fallback = fallback.lte('start_time', params.dateTo)
    const retry = await fallback.range(from, to)
    if (retry.error) throw retry.error
    data = retry.data
    count = retry.count
  }
  return { data: (data ?? []) as Appointment[], total: count ?? 0 }
}

export async function getAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  _scope?: DataAccessScope | null,
): Promise<AppointmentWithUnits> {
  const { data: appt, error } = await supabase
    .from('appointments')
    .select(
      '*, lead:leads(id, name, phone), responsible:profiles!appointments_responsible_id_fkey(full_name), project:projects(id, name)',
    )
    .eq('id', appointmentId)
    .single()
  if (error) throw error

  const row = appt as Appointment

  const { data: linkRows } = await supabase
    .from('appointment_units')
    .select('unit_id')
    .eq('appointment_id', appointmentId)

  const unitIds = (linkRows ?? []).map((r) => r.unit_id)
  let units: Unit[] = []
  if (unitIds.length) {
    const { data: unitsData, error: uErr } = await supabase
      .from('units')
      .select('*, project:projects(id, name)')
      .in('id', unitIds)
    if (uErr) throw uErr
    units = (unitsData ?? []) as Unit[]
  }

  return { ...row, units }
}

export async function createAppointment(
  supabase: SupabaseClient,
  payload: Partial<Appointment> & { tenant_id: string; start_time: string },
  unitIds?: string[]
) {
  const { data, error } = await supabase.from('appointments').insert(payload).select().single()
  if (error) throw error
  const appt = data as Appointment

  if (unitIds?.length) {
    const rows = unitIds.map((unit_id) => ({ appointment_id: appt.id, unit_id }))
    const { error: linkError } = await supabase.from('appointment_units').insert(rows)
    if (linkError) throw linkError
  }

  return appt
}

export async function updateAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  payload: Partial<Appointment>,
  unitIds?: string[]
) {
  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', appointmentId)
    .select()
    .single()
  if (error) throw error
  const row = data as Appointment

  if (unitIds !== undefined) {
    const { error: delErr } = await supabase.from('appointment_units').delete().eq('appointment_id', appointmentId)
    if (delErr) throw delErr
    if (unitIds.length) {
      const rows = unitIds.map((unit_id) => ({ appointment_id: appointmentId, unit_id }))
      const { error: linkError } = await supabase.from('appointment_units').insert(rows)
      if (linkError) throw linkError
    }
  }

  return row
}

export async function updateAppointmentStatus(supabase: SupabaseClient, appointmentId: string, status: AppointmentStatus) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)
    .select()
    .single()
  if (error) throw error
  return data as Appointment
}

// ─── Showroom Visits ────────────────────────────────────────
interface ListShowroomParams {
  tenantId: string
  tenantIds?: string[]
  projectId?: string
  salespersonId?: string
  page?: number
  pageSize?: number
  search?: string
  source?: ShowroomVisitSource
  scope?: DataAccessScope | null
}

async function hydrateShowroomVisitUnits(supabase: SupabaseClient, visits: ShowroomVisit[]) {
  const visitIds = visits.map((v) => v.id)
  if (!visitIds.length) return

  const { data: links } = await supabase
    .from('showroom_visit_units')
    .select('showroom_visit_id, unit_id')
    .in('showroom_visit_id', visitIds)

  const unitIds = [...new Set((links ?? []).map((l) => l.unit_id as string))]
  const unitsById = new Map<string, Unit>()
  if (unitIds.length) {
    const { data: unitRows } = await supabase
      .from('units')
      .select('*, project:projects(id, name)')
      .in('id', unitIds)
    for (const row of unitRows ?? []) {
      unitsById.set(row.id, row as Unit)
    }
  }

  const unitsByVisit = new Map<string, Unit[]>()
  for (const link of links ?? []) {
    const unit = unitsById.get(link.unit_id as string)
    if (!unit) continue
    const list = unitsByVisit.get(link.showroom_visit_id as string) ?? []
    list.push(unit)
    unitsByVisit.set(link.showroom_visit_id as string, list)
  }

  for (const visit of visits) {
    visit.units = unitsByVisit.get(visit.id) ?? []
  }
}

export async function listShowroomVisits(supabase: SupabaseClient, params: ListShowroomParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  let query = supabase
    .from('showroom_visits')
    .select(
      '*, salesperson:profiles!showroom_visits_salesperson_id_fkey(full_name, avatar_url), project:projects(id, name), lead:leads(id, name, financing)',
      { count: 'exact' },
    )
    .in('tenant_id', tenantIds)
    .order('visit_start', { ascending: false })

  if (params.projectId) query = query.eq('project_id', params.projectId)
  if (params.salespersonId) query = query.eq('salesperson_id', params.salespersonId)
  if (params.source) query = query.eq('source', params.source)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`client_name.ilike.%${q}%,notes.ilike.%${q}%,phone.ilike.%${q}%`)
  }

  let { data, error, count } = await query.range(from, to)
  if (error) {
    let fallback = supabase
      .from('showroom_visits')
      .select('*', { count: 'exact' })
      .in('tenant_id', tenantIds)
      .order('visit_start', { ascending: false })
    if (params.projectId) fallback = fallback.eq('project_id', params.projectId)
    if (params.salespersonId) fallback = fallback.eq('salesperson_id', params.salespersonId)
    if (params.source) fallback = fallback.eq('source', params.source)
    const retry = await fallback.range(from, to)
    if (retry.error) throw retry.error
    data = retry.data
    count = retry.count
  }

  const visits = (data ?? []) as ShowroomVisit[]
  await hydrateShowroomVisitUnits(supabase, visits)
  return { data: visits, total: count ?? 0 }
}

export async function getShowroomVisit(
  supabase: SupabaseClient,
  visitId: string,
  _scope?: DataAccessScope | null,
): Promise<ShowroomVisitWithUnits> {
  const { data: visit, error } = await supabase
    .from('showroom_visits')
    .select(
      '*, salesperson:profiles!showroom_visits_salesperson_id_fkey(full_name, avatar_url), project:projects(id, name), lead:leads(id, name, financing)',
    )
    .eq('id', visitId)
    .single()
  if (error) throw error

  const row = visit as ShowroomVisit

  const { data: linkRows } = await supabase
    .from('showroom_visit_units')
    .select('unit_id')
    .eq('showroom_visit_id', visitId)

  const unitIds = (linkRows ?? []).map((r) => r.unit_id)
  let units: Unit[] = []
  if (unitIds.length) {
    const { data: unitsData, error: uErr } = await supabase
      .from('units')
      .select('*, project:projects(id, name)')
      .in('id', unitIds)
    if (uErr) throw uErr
    units = (unitsData ?? []) as Unit[]
  }

  return { ...row, units }
}

export async function updateShowroomVisit(
  supabase: SupabaseClient,
  visitId: string,
  payload: Partial<
    Pick<ShowroomVisit, 'source' | 'project_id' | 'client_name' | 'phone' | 'visit_start' | 'visit_end' | 'notes'>
  >,
  unitIds?: string[]
) {
  const { data, error } = await supabase
    .from('showroom_visits')
    .update(payload)
    .eq('id', visitId)
    .select()
    .single()
  if (error) throw error
  const visit = data as ShowroomVisit

  if (unitIds !== undefined) {
    const { error: delErr } = await supabase.from('showroom_visit_units').delete().eq('showroom_visit_id', visitId)
    if (delErr) throw delErr
    if (unitIds.length) {
      const rows = unitIds.map((unit_id) => ({ showroom_visit_id: visitId, unit_id }))
      const { error: linkError } = await supabase.from('showroom_visit_units').insert(rows)
      if (linkError) throw linkError
    }
  }

  return visit
}

export async function createShowroomVisit(
  supabase: SupabaseClient,
  payload: Partial<ShowroomVisit> & { tenant_id: string },
  unitIds?: string[]
) {
  const { data, error } = await supabase.from('showroom_visits').insert(payload).select().single()
  if (error) throw error
  const visit = data as ShowroomVisit

  if (unitIds?.length) {
    const rows = unitIds.map((unit_id) => ({ showroom_visit_id: visit.id, unit_id }))
    const { error: linkError } = await supabase.from('showroom_visit_units').insert(rows)
    if (linkError) throw linkError
  }

  return visit
}

// ─── Unit Sales Closings (reporte de ventas) ────────────────
function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeClosing(row: UnitSalesClosing): UnitSalesClosing {
  return {
    ...row,
    sale_price_final: toNumber(row.sale_price_final) ?? 0,
    published_price_snapshot: toNumber(row.published_price_snapshot),
  }
}

function mapClosingUnit(row: {
  id: string
  unit_number: string
  category?: string | null
  project_id?: string | null
  project?: { id: string; name: string } | { id: string; name: string }[] | null
}): NonNullable<UnitSalesClosing['unit']> {
  const project = unwrapEmbedded(row.project)
  return {
    id: row.id,
    unit_number: row.unit_number,
    category: row.category ?? null,
    project_id: row.project_id ?? undefined,
    project: project ? { id: project.id, name: project.name } : null,
  }
}

function mapFinancingUnit(row: {
  id: string
  unit_number: string
  project?: { name: string } | { name: string }[] | null
}): NonNullable<LeadFinancing['unit']> {
  const project = unwrapEmbedded(row.project)
  return {
    id: row.id,
    unit_number: row.unit_number,
    project: project ? { name: project.name } : null,
  }
}

async function hydrateSalesClosings(
  supabase: SupabaseClient,
  rows: UnitSalesClosing[],
): Promise<UnitSalesClosing[]> {
  const closings = rows.map(normalizeClosing)
  if (!closings.length) return closings

  const unitIds = [...new Set(closings.map((c) => c.unit_id).filter(Boolean))]
  const leadIds = [...new Set(closings.map((c) => c.lead_id).filter(Boolean))] as string[]
  const sellerIds = [...new Set(closings.map((c) => c.sold_by_id).filter(Boolean))] as string[]
  const contractIds = [...new Set(closings.map((c) => c.contract_id).filter(Boolean))] as string[]

  const [unitsRes, leadsRes, sellersRes, contractsRes] = await Promise.all([
    unitIds.length
      ? supabase.from('units').select('id, unit_number, category, project_id, project:projects(id, name)').in('id', unitIds)
      : Promise.resolve({ data: [] as never[] }),
    leadIds.length
      ? supabase.from('leads').select('id, name, phone').in('id', leadIds)
      : Promise.resolve({ data: [] as never[] }),
    sellerIds.length
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', sellerIds)
      : Promise.resolve({ data: [] as never[] }),
    contractIds.length
      ? supabase.from('contracts').select('id, contract_number, status').in('id', contractIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const unitsById = new Map((unitsRes.data ?? []).map((u) => [u.id, u]))
  const leadsById = new Map((leadsRes.data ?? []).map((l) => [l.id, l]))
  const sellersById = new Map((sellersRes.data ?? []).map((s) => [s.id, s]))
  const contractsById = new Map((contractsRes.data ?? []).map((c) => [c.id, c]))

  for (const closing of closings) {
    const rawUnit = closing.unit ?? (closing.unit_id ? unitsById.get(closing.unit_id) : undefined)
    if (rawUnit) closing.unit = mapClosingUnit(rawUnit)
    if (!closing.lead && closing.lead_id) {
      closing.lead = (leadsById.get(closing.lead_id) as UnitSalesClosing['lead']) ?? null
    }
    if (!closing.sold_by && closing.sold_by_id) {
      closing.sold_by = (sellersById.get(closing.sold_by_id) as UnitSalesClosing['sold_by']) ?? null
    }
    if (!closing.contract && closing.contract_id) {
      closing.contract = (contractsById.get(closing.contract_id) as UnitSalesClosing['contract']) ?? null
    }
  }

  return closings
}

export async function listSalesClosings(
  supabase: SupabaseClient,
  params: {
    tenantIds: string[]
    projectId?: string
    soldById?: string
    from?: string
    to?: string
    search?: string
  },
): Promise<UnitSalesClosing[]> {
  let unitIdsFilter: string[] | null = null
  if (params.projectId) {
    const { data: unitRows, error: unitErr } = await supabase
      .from('units')
      .select('id')
      .eq('project_id', params.projectId)
    if (unitErr) throw unitErr
    unitIdsFilter = (unitRows ?? []).map((u) => u.id)
    if (!unitIdsFilter.length) return []
  }

  let query = supabase
    .from('unit_sales_closings')
    .select(
      '*, unit:units(id, unit_number, category, project_id, project:projects(id, name)), lead:leads(id, name, phone), sold_by:profiles!unit_sales_closings_sold_by_id_fkey(id, full_name, avatar_url), contract:contracts(id, contract_number, status)',
    )
    .in('tenant_id', params.tenantIds)
    .order('sale_at', { ascending: false })

  if (unitIdsFilter) query = query.in('unit_id', unitIdsFilter)
  if (params.soldById) query = query.eq('sold_by_id', params.soldById)
  if (params.from) query = query.gte('sale_at', `${params.from}T00:00:00-05:00`)
  if (params.to) query = query.lte('sale_at', `${params.to}T23:59:59.999-05:00`)

  let { data, error } = await query.limit(1000)
  if (error) {
    let fallback = supabase
      .from('unit_sales_closings')
      .select('*')
      .in('tenant_id', params.tenantIds)
      .order('sale_at', { ascending: false })
    if (unitIdsFilter) fallback = fallback.in('unit_id', unitIdsFilter)
    if (params.soldById) fallback = fallback.eq('sold_by_id', params.soldById)
    if (params.from) fallback = fallback.gte('sale_at', `${params.from}T00:00:00-05:00`)
    if (params.to) fallback = fallback.lte('sale_at', `${params.to}T23:59:59.999-05:00`)
    const retry = await fallback.limit(1000)
    if (retry.error) throw retry.error
    data = retry.data
  }

  let rows = await hydrateSalesClosings(supabase, (data ?? []) as UnitSalesClosing[])

  const q = params.search?.replace(/[%(),]/g, '').trim().toLowerCase()
  if (q) {
    rows = rows.filter((row) => {
      const haystack = [
        row.unit?.unit_number,
        row.unit?.project?.name,
        row.lead?.name,
        row.sold_by?.full_name,
        row.contract?.contract_number,
        row.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  return rows
}

export async function listSoldUnitsAsClosings(
  supabase: SupabaseClient,
  params: {
    tenantIds: string[]
    projectId?: string
    from?: string
    to?: string
    excludeUnitIds?: string[]
  },
): Promise<UnitSalesClosing[]> {
  if (!params.tenantIds.length) return []
  let query = supabase
    .from('units')
    .select(
      'id, tenant_id, unit_number, category, project_id, published_commercial_price, updated_at, created_at, project:projects(id, name)',
    )
    .in('tenant_id', params.tenantIds)
    .eq('status', 'vendido')
  if (params.projectId) query = query.eq('project_id', params.projectId)
  const { data, error } = await query
  if (error) throw error

  const excluded = new Set(params.excludeUnitIds ?? [])
  const fromMs = params.from ? Date.parse(`${params.from}T00:00:00-05:00`) : null
  const toMs = params.to ? Date.parse(`${params.to}T23:59:59.999-05:00`) : null

  return (data ?? [])
    .filter((unit) => !excluded.has(unit.id))
    .map((unit) => {
      const saleAt = unit.updated_at || unit.created_at
      return {
        id: `inventario:${unit.id}`,
        tenant_id: unit.tenant_id,
        unit_id: unit.id,
        lead_id: null,
        sold_by_id: null,
        published_price_snapshot: toNumber(unit.published_commercial_price),
        sale_price_final: toNumber(unit.published_commercial_price) ?? 0,
        sale_at: saleAt,
        notes: 'Venta marcada en inventario',
        created_at: saleAt,
        contract_id: null,
        unit: mapClosingUnit(unit),
        lead: null,
        sold_by: null,
        contract: null,
      } satisfies UnitSalesClosing
    })
    .filter((row) => {
      const at = Date.parse(row.sale_at)
      if (fromMs != null && at < fromMs) return false
      if (toMs != null && at > toMs) return false
      return true
    })
}

export async function listSoldLeadsAsClosings(
  supabase: SupabaseClient,
  params: {
    tenantIds: string[]
    soldById?: string
    from?: string
    to?: string
    excludeLeadIds?: string[]
  },
): Promise<UnitSalesClosing[]> {
  if (!params.tenantIds.length) return []

  let query = supabase
    .from('leads')
    .select('id, tenant_id, name, phone, assigned_to, updated_at, created_at')
    .in('tenant_id', params.tenantIds)
    .eq('status', 'vendido')
  if (params.soldById) query = query.eq('assigned_to', params.soldById)

  const { data, error } = await query
  if (error) throw error

  const excluded = new Set(params.excludeLeadIds ?? [])
  const leads = (data ?? []).filter((lead) => !excluded.has(lead.id))
  if (!leads.length) return []

  const leadIds = leads.map((lead) => lead.id)
  const sellerIds = [...new Set(leads.map((lead) => lead.assigned_to).filter(Boolean))] as string[]

  const [linksRes, sellersRes] = await Promise.all([
    supabase
      .from('lead_units')
      .select('lead_id, unit_id')
      .in('lead_id', leadIds)
      .then((res) => res)
      .catch(() => ({ data: [] as Array<{ lead_id: string; unit_id: string }> })),
    sellerIds.length
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', sellerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; avatar_url: string | null }> }),
  ])

  const unitIds = [...new Set((linksRes.data ?? []).map((link) => link.unit_id).filter(Boolean))]
  const unitsRes = unitIds.length
    ? await supabase
        .from('units')
        .select('id, unit_number, category, project_id, project:projects(id, name)')
        .in('id', unitIds)
    : { data: [] as Array<Parameters<typeof mapClosingUnit>[0]> }
  const unitsById = new Map((unitsRes.data ?? []).map((unit) => [unit.id, mapClosingUnit(unit)]))

  const unitByLead = new Map<string, ReturnType<typeof mapClosingUnit>>()
  for (const link of linksRes.data ?? []) {
    const unit = unitsById.get(link.unit_id)
    if (unit && !unitByLead.has(link.lead_id)) unitByLead.set(link.lead_id, unit)
  }
  const sellersById = new Map((sellersRes.data ?? []).map((row) => [row.id, row]))

  const fromMs = params.from ? Date.parse(`${params.from}T00:00:00-05:00`) : null
  const toMs = params.to ? Date.parse(`${params.to}T23:59:59.999-05:00`) : null

  return leads
    .map((lead) => {
      const saleAt = lead.updated_at || lead.created_at
      const seller = lead.assigned_to ? sellersById.get(lead.assigned_to) : null
      const unit = unitByLead.get(lead.id)
      return {
        id: `lead:${lead.id}`,
        tenant_id: lead.tenant_id,
        unit_id: unit?.id ?? lead.id,
        lead_id: lead.id,
        sold_by_id: lead.assigned_to,
        published_price_snapshot: null,
        sale_price_final: 0,
        sale_at: saleAt,
        notes: 'Venta marcada en el lead',
        created_at: saleAt,
        contract_id: null,
        unit: unit ?? undefined,
        lead: { id: lead.id, name: lead.name, phone: lead.phone },
        sold_by: seller
          ? { id: seller.id, full_name: seller.full_name, avatar_url: seller.avatar_url }
          : null,
        contract: null,
      } satisfies UnitSalesClosing
    })
    .filter((row) => {
      const at = Date.parse(row.sale_at)
      if (fromMs != null && at < fromMs) return false
      if (toMs != null && at > toMs) return false
      return true
    })
}

export async function recordUnitClosing(
  supabase: SupabaseClient,
  payload: {
    tenant_id: string
    unit_id: string
    lead_id?: string | null
    sold_by_id: string
    sale_price_final: number
    published_price_snapshot?: number | null
    sale_at?: string
    notes?: string | null
    contract_id?: string | null
  },
) {
  const { data, error } = await supabase
    .from('unit_sales_closings')
    .insert({
      tenant_id: payload.tenant_id,
      unit_id: payload.unit_id,
      lead_id: payload.lead_id || null,
      sold_by_id: payload.sold_by_id,
      sale_price_final: payload.sale_price_final,
      published_price_snapshot: payload.published_price_snapshot ?? null,
      sale_at: payload.sale_at || new Date().toISOString(),
      notes: payload.notes?.trim() || null,
      contract_id: payload.contract_id || null,
    })
    .select()
    .single()
  if (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code === '23505') {
      throw new Error('Esta unidad ya tiene un cierre de venta. No se puede registrar otra vez.')
    }
    throw error
  }

  await supabase.from('units').update({ status: 'vendido' as UnitStatus }).eq('id', payload.unit_id)
  if (payload.lead_id) {
    await supabase.from('leads').update({ status: 'vendido' as LeadStatus }).eq('id', payload.lead_id)
  }

  const [hydrated] = await hydrateSalesClosings(supabase, [data as UnitSalesClosing])
  return hydrated
}

// ─── Contracts ──────────────────────────────────────────────
export const CONTRACTS_FILES_BUCKET = 'contracts-docs'

interface ListContractsParams {
  tenantId: string
  tenantIds?: string[]
  status?: ContractStatus
  search?: string
  page?: number
  pageSize?: number
  scope?: DataAccessScope | null
}

export async function listContracts(supabase: SupabaseClient, params: ListContractsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  let query = supabase
    .from('contracts')
    .select('*, lead:leads(id, name)', { count: 'exact' })
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })

  if (params.status) query = query.eq('status', params.status)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`contract_number.ilike.%${q}%`)
  }

  let { data, error, count } = await query.range(from, to)
  if (error) {
    let fallback = supabase
      .from('contracts')
      .select('*', { count: 'exact' })
      .in('tenant_id', tenantIds)
      .order('created_at', { ascending: false })
    if (params.status) fallback = fallback.eq('status', params.status)
    const retry = await fallback.range(from, to)
    if (retry.error) throw retry.error
    data = retry.data
    count = retry.count
  }
  return { data: (data ?? []) as Contract[], total: count ?? 0 }
}

export async function getContract(
  supabase: SupabaseClient,
  contractId: string,
  _scope?: DataAccessScope | null,
): Promise<ContractWithUnits> {
  const { data: row, error } = await supabase
    .from('contracts')
    .select('*, lead:leads(id, name, phone)')
    .eq('id', contractId)
    .single()
  if (error) throw error

  const contract = row as Contract

  const { data: linkRows } = await supabase.from('contract_units').select('unit_id').eq('contract_id', contractId)

  const unitIds = (linkRows ?? []).map((r) => r.unit_id)
  let units: Unit[] = []
  if (unitIds.length) {
    const { data: unitsData, error: uErr } = await supabase
      .from('units')
      .select('*, project:projects(id, name)')
      .in('id', unitIds)
    if (uErr) throw uErr
    units = (unitsData ?? []) as Unit[]
  }

  return { ...contract, units }
}

export async function updateContract(
  supabase: SupabaseClient,
  contractId: string,
  payload: Partial<Contract>,
  unitIds?: string[]
) {
  const { data, error } = await supabase
    .from('contracts')
    .update(payload)
    .eq('id', contractId)
    .select()
    .single()
  if (error) throw error
  const contract = data as Contract

  if (unitIds !== undefined) {
    const { error: delErr } = await supabase.from('contract_units').delete().eq('contract_id', contractId)
    if (delErr) throw delErr
    if (unitIds.length) {
      const rows = unitIds.map((unit_id) => ({ contract_id: contractId, unit_id }))
      const { error: linkError } = await supabase.from('contract_units').insert(rows)
      if (linkError) throw linkError
    }
  }

  return contract
}

export async function createContract(
  supabase: SupabaseClient,
  payload: Partial<Contract> & { tenant_id: string },
  unitIds?: string[]
) {
  const { data, error } = await supabase.from('contracts').insert(payload).select().single()
  if (error) throw error
  const contract = data as Contract

  if (unitIds?.length) {
    const rows = unitIds.map((unit_id) => ({ contract_id: contract.id, unit_id }))
    const { error: linkError } = await supabase.from('contract_units').insert(rows)
    if (linkError) throw linkError
  }

  return contract
}

export async function updateContractFiles(
  supabase: SupabaseClient,
  contractId: string,
  payload: {
    pdf_url?: string | null
    anticipo_proof_url?: string | null
  }
) {
  const { data, error } = await supabase
    .from('contracts')
    .update(payload)
    .eq('id', contractId)
    .select()
    .single()

  if (error) throw error
  return data as Contract
}

// ─── Financiamiento ─────────────────────────────────────────
export async function listPaymentPlans(
  supabase: SupabaseClient,
  params: { projectIds?: string[]; projectId?: string; search?: string },
): Promise<PaymentPlan[]> {
  let query = supabase
    .from('payment_plans')
    .select('*, project:projects(id, name)')
    .order('name', { ascending: true })

  if (params.projectId) query = query.eq('project_id', params.projectId)
  else if (params.projectIds?.length) query = query.in('project_id', params.projectIds)
  if (params.search) {
    const q = params.search.replace(/[%(),]/g, '').trim()
    if (q) query = query.ilike('name', `%${q}%`)
  }

  const { data, error } = await query
  if (!error) return (data ?? []) as PaymentPlan[]

  let fallback = supabase.from('payment_plans').select('*').order('name', { ascending: true })
  if (params.projectId) fallback = fallback.eq('project_id', params.projectId)
  else if (params.projectIds?.length) fallback = fallback.in('project_id', params.projectIds)
  const retry = await fallback
  if (retry.error) throw retry.error
  return (retry.data ?? []) as PaymentPlan[]
}

export async function createPaymentPlan(
  supabase: SupabaseClient,
  payload: {
    project_id: string
    name: string
    is_active?: boolean
    applies_to_category?: string
    reservation_amount?: number | null
    entry_pct?: number | null
    balance_type?: string | null
    conditions?: string | null
  },
): Promise<PaymentPlan> {
  const { data, error } = await supabase
    .from('payment_plans')
    .insert({
      project_id: payload.project_id,
      name: payload.name,
      is_active: payload.is_active ?? true,
      applies_to_category: payload.applies_to_category ?? 'todos',
      reservation_amount: payload.reservation_amount ?? null,
      entry_pct: payload.entry_pct ?? null,
      balance_type: payload.balance_type || null,
      conditions: payload.conditions ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as PaymentPlan
}

export async function updatePaymentPlan(
  supabase: SupabaseClient,
  planId: string,
  payload: Partial<
    Pick<
      PaymentPlan,
      | 'name'
      | 'is_active'
      | 'project_id'
      | 'applies_to_category'
      | 'reservation_amount'
      | 'entry_pct'
      | 'balance_type'
      | 'conditions'
    >
  >,
): Promise<PaymentPlan> {
  const { data, error } = await supabase.from('payment_plans').update(payload).eq('id', planId).select().single()
  if (error) throw error
  return data as PaymentPlan
}

export async function listLeadFinancing(
  supabase: SupabaseClient,
  params: { status?: string; search?: string } = {},
): Promise<LeadFinancing[]> {
  let query = supabase
    .from('lead_financing')
    .select('*, lead:leads(id, name, phone), unit:units(id, unit_number, project:projects(name)), partner:financing_partners(id, name, partner_type, approx_rate)')
    .order('requested_at', { ascending: false })

  if (params.status) query = query.eq('status', params.status)

  const { data, error } = await query
  let rows: LeadFinancing[]
  if (!error) {
    rows = (data ?? []) as LeadFinancing[]
  } else {
    let fallback = supabase.from('lead_financing').select('*').order('requested_at', { ascending: false })
    if (params.status) fallback = fallback.eq('status', params.status)
    const retry = await fallback
    if (retry.error) {
      const plain = await supabase.from('lead_financing').select('*').order('id', { ascending: false })
      if (plain.error) throw plain.error
      rows = (plain.data ?? []) as LeadFinancing[]
    } else {
      rows = (retry.data ?? []) as LeadFinancing[]
    }
  }
  rows = await hydrateLeadFinancing(supabase, rows)

  const q = params.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.lead?.name?.toLowerCase().includes(q) ||
        r.lead?.phone?.includes(q) ||
        r.notes?.toLowerCase().includes(q) ||
        r.unit?.unit_number?.toLowerCase().includes(q) ||
        r.partner?.name?.toLowerCase().includes(q),
    )
  }
  return rows
}

async function hydrateLeadFinancing(
  supabase: SupabaseClient,
  rows: LeadFinancing[],
): Promise<LeadFinancing[]> {
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))]
  const unitIds = [...new Set(rows.map((r) => r.unit_id).filter(Boolean))] as string[]
  const partnerIds = [...new Set(rows.map((r) => r.financing_partner_id).filter(Boolean))] as string[]
  const [{ data: leads }, { data: units }, { data: partners }] = await Promise.all([
    leadIds.length
      ? supabase.from('leads').select('id, name, phone').in('id', leadIds)
      : Promise.resolve({ data: [] as { id: string; name: string; phone: string | null }[] }),
    unitIds.length
      ? supabase.from('units').select('id, unit_number, project:projects(name)').in('id', unitIds)
      : Promise.resolve({ data: [] as { id: string; unit_number: string; project?: { name: string } | { name: string }[] | null }[] }),
    partnerIds.length
      ? supabase.from('financing_partners').select('id, name, partner_type, approx_rate').in('id', partnerIds)
      : Promise.resolve({ data: [] as Pick<FinancingPartner, 'id' | 'name' | 'partner_type' | 'approx_rate'>[] }),
  ])
  const leadMap = new Map((leads ?? []).map((l) => [l.id, l]))
  const unitMap = new Map((units ?? []).map((u) => [u.id, u]))
  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p]))
  return rows.map((r) => {
    const embedded =
      unwrapPartner(r.partner) ??
      unwrapPartner((r as LeadFinancing & { financing_partners?: unknown }).financing_partners)
    const rawUnit = r.unit ?? (r.unit_id ? unitMap.get(r.unit_id) : undefined)
    return {
      ...r,
      lead: r.lead ?? leadMap.get(r.lead_id),
      unit: rawUnit ? mapFinancingUnit(rawUnit) : undefined,
      partner:
        embedded ??
        (r.financing_partner_id ? partnerMap.get(r.financing_partner_id) ?? null : null),
    }
  })
}

function unwrapPartner(value: unknown): Pick<FinancingPartner, 'id' | 'name' | 'partner_type' | 'approx_rate'> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || !('name' in row)) return undefined
  const name = (row as { name?: unknown }).name
  if (typeof name !== 'string' || !name.trim()) return undefined
  return row as Pick<FinancingPartner, 'id' | 'name' | 'partner_type' | 'approx_rate'>
}

export async function createLeadFinancing(
  supabase: SupabaseClient,
  payload: {
    lead_id: string
    unit_id?: string | null
    financing_partner_id?: string | null
    financing_type?: string | null
    unit_price?: number | null
    entry_amount?: number | null
    financed_amount?: number | null
    term_months?: number | null
    interest_rate?: number | null
    monthly_payment?: number | null
    status?: string
    generated_by?: string | null
    notes?: string | null
  },
): Promise<LeadFinancing> {
  const { data, error } = await supabase
    .from('lead_financing')
    .insert({
      lead_id: payload.lead_id,
      unit_id: payload.unit_id || null,
      financing_partner_id: payload.financing_partner_id || null,
      financing_type: payload.financing_type || null,
      unit_price: payload.unit_price ?? null,
      entry_amount: payload.entry_amount ?? null,
      financed_amount: payload.financed_amount ?? null,
      term_months: payload.term_months ?? null,
      interest_rate: payload.interest_rate ?? null,
      monthly_payment: payload.monthly_payment ?? null,
      status: payload.status || 'simulado',
      generated_by: payload.generated_by ?? 'asesor',
      notes: payload.notes ?? null,
    })
    .select('*, partner:financing_partners(id, name, partner_type, approx_rate)')
    .single()
  if (error) throw error
  return data as LeadFinancing
}

export async function listFinancingPartners(supabase: SupabaseClient): Promise<FinancingPartner[]> {
  const { data, error } = await supabase
    .from('financing_partners')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as FinancingPartner[]
}

export async function findOrCreateFinancingPartner(
  supabase: SupabaseClient,
  params: { name: string; partner_type?: string | null },
): Promise<FinancingPartner> {
  const name = params.name.trim()
  if (!name) throw new Error('El nombre de la institución es obligatorio')

  const { data: existing } = await supabase
    .from('financing_partners')
    .select('*')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()
  if (existing) return existing as FinancingPartner

  const partnerType = ['banco', 'biess', 'cooperativa'].includes(params.partner_type ?? '')
    ? params.partner_type
    : null

  const { data, error } = await supabase
    .from('financing_partners')
    .insert({
      name,
      partner_type: partnerType,
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as FinancingPartner
}

export async function listAsesoriasFinanciamiento(
  supabase: SupabaseClient,
  params: { search?: string; atendido?: boolean } = {},
): Promise<AsesoriaFinanciamiento[]> {
  const { data, error } = await supabase
    .from('asesoria_financiamiento')
    .select('*, lead:leads(id, name, phone)')
    .order('created_at', { ascending: false })

  let rows: AsesoriaFinanciamiento[]
  if (!error) {
    rows = (data ?? []) as AsesoriaFinanciamiento[]
  } else {
    const retry = await supabase.from('asesoria_financiamiento').select('*').order('created_at', { ascending: false })
    if (retry.error) throw retry.error
    rows = (retry.data ?? []) as AsesoriaFinanciamiento[]
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))]
    if (leadIds.length) {
      const { data: leads } = await supabase.from('leads').select('id, name, phone').in('id', leadIds)
      const leadMap = new Map((leads ?? []).map((l) => [l.id, l]))
      rows = rows.map((r) => ({ ...r, lead: r.lead ?? leadMap.get(r.lead_id) }))
    }
  }

  if (params.atendido != null) rows = rows.filter((r) => r.atendido === params.atendido)
  const q = params.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.lead?.name?.toLowerCase().includes(q) ||
        r.lead?.phone?.includes(q) ||
        r.mensaje_completo?.toLowerCase().includes(q),
    )
  }
  return rows
}

export async function createAsesoriaFinanciamiento(
  supabase: SupabaseClient,
  payload: { tenant_id: string; lead_id: string; mensaje_completo?: string | null; atendido?: boolean },
): Promise<AsesoriaFinanciamiento> {
  const { data, error } = await supabase
    .from('asesoria_financiamiento')
    .insert({
      tenant_id: payload.tenant_id,
      lead_id: payload.lead_id,
      mensaje_completo: payload.mensaje_completo ?? null,
      atendido: payload.atendido ?? false,
    })
    .select('*, lead:leads(id, name, phone)')
    .single()
  if (error) throw error
  return data as AsesoriaFinanciamiento
}

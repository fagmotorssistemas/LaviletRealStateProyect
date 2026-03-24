import type { SupabaseClient } from '@supabase/supabase-js'
import { compareUnitsByUnitNumber } from '@/lib/inmobiliaria/sortUnits'
import type { DataAccessScope } from '@/lib/inmobiliaria/dataScope'
import type {
  Unit, UnitMedia, Lead, Appointment, AppointmentWithUnits, Contract, ContractWithUnits, ShowroomVisit, ShowroomVisitWithUnits, LeadInteraction,
  UnitStatus, LeadStatus, AppointmentStatus, InteractionType,
  ShowroomVisitSource,
  Project, ProjectAsset, ProjectAssetKind, ProjectDetail, ContractStatus, InventorySortOption,
} from '@/types/inmobiliaria'

/** Bucket público para fotos, planos PDF y documentos de proyecto. */
export const PROJECT_ASSETS_BUCKET = 'project-assets'

/** Bucket público para imágenes por unidad (departamento, local, etc.). */
export const UNIT_ASSETS_BUCKET = 'unit-assets'

// ─── Projects ───────────────────────────────────────────────
export async function listProjects(supabase: SupabaseClient, tenantId: string): Promise<Project[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = projects ?? []
  if (rows.length === 0) return []

  const ids = rows.map((p) => p.id)
  const { data: assetRows } = await supabase
    .from('project_assets')
    .select('id, tenant_id, project_id, kind, file_name, storage_path, mime_type, file_size_bytes, caption, sort_order, is_cover, created_at, updated_at')
    .in('project_id', ids)

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

export async function listUnits(supabase: SupabaseClient, params: ListUnitsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const sort = params.sort

  if (sort === 'unit_natural') {
    const all: Unit[] = []
    let batchFrom = 0
    for (;;) {
      let q = supabase
        .from('units')
        .select('*, project:projects(id, name)')
        .eq('tenant_id', params.tenantId)
      if (params.projectId) q = q.eq('project_id', params.projectId)
      if (params.status) q = q.eq('status', params.status)
      if (params.category) q = q.eq('category', params.category)
      if (params.search) q = q.or(`unit_number.ilike.%${params.search}%,description.ilike.%${params.search}%`)
      const { data, error } = await q.range(batchFrom, batchFrom + FETCH_BATCH - 1)
      if (error) throw error
      const rows = (data ?? []) as Unit[]
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

  let query = supabase
    .from('units')
    .select('*, project:projects(id, name)', { count: 'exact' })
    .eq('tenant_id', params.tenantId)

  if (params.projectId) query = query.eq('project_id', params.projectId)
  if (params.status) query = query.eq('status', params.status)
  if (params.category) query = query.eq('category', params.category)
  if (params.search) query = query.or(`unit_number.ilike.%${params.search}%,description.ilike.%${params.search}%`)

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
  query = query.order('id', { ascending: true })

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Unit[], total: count ?? 0 }
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
      '*, project:projects(id, name), unit_media(id, tenant_id, unit_id, type, url, storage_path, file_name, mime_type, file_size_bytes, caption, sort_order, is_cover, created_at, updated_at)',
    )
    .eq('id', unitId)
    .order('sort_order', { referencedTable: 'unit_media', ascending: true })
    .single()
  if (error) throw error
  const row = data as Unit
  return row
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

export async function createUnit(
  supabase: SupabaseClient,
  payload: Partial<Unit> & { tenant_id: string; project_id: string; unit_number: string }
) {
  const { data, error } = await supabase.from('units').insert(payload).select().single()
  if (error) throw error
  return data as Unit
}

export async function updateUnit(
  supabase: SupabaseClient,
  unitId: string,
  payload: Partial<Unit>
) {
  const { data, error } = await supabase
    .from('units')
    .update(payload)
    .eq('id', unitId)
    .select()
    .single()
  if (error) throw error
  return data as Unit
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
  projectId?: string
  status?: LeadStatus
  search?: string
  assignedTo?: string
  page?: number
  pageSize?: number
  /** Si no es admin, solo leads asignados al usuario. */
  scope?: DataAccessScope | null
}

export async function listLeads(supabase: SupabaseClient, params: ListLeadsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('leads')
    .select('*, assigned_profile:profiles!leads_assigned_to_fkey(full_name)', { count: 'exact' })
    .eq('tenant_id', params.tenantId)
    .order('created_at', { ascending: false })

  if (params.scope && !params.scope.isAdmin) {
    query = query.eq('assigned_to', params.scope.userId)
  } else if (params.assignedTo) {
    query = query.eq('assigned_to', params.assignedTo)
  }

  if (params.status) query = query.eq('status', params.status)
  if (params.search) query = query.or(`name.ilike.%${params.search}%,phone.ilike.%${params.search}%`)

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Lead[], total: count ?? 0 }
}

export async function getLead(supabase: SupabaseClient, leadId: string, scope?: DataAccessScope | null) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, lead_units(*, unit:units(id, unit_number, published_commercial_price, status, project:projects(name))), assigned_profile:profiles!leads_assigned_to_fkey(full_name)')
    .eq('id', leadId)
    .single()
  if (error) throw error
  const lead = data as Lead
  if (scope && !scope.isAdmin && lead.assigned_to !== scope.userId) {
    throw new Error('No tienes permiso para ver este lead.')
  }
  return lead
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
  responsibleId?: string
  status?: AppointmentStatus
  statuses?: AppointmentStatus[]
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
  search?: string
  /** Si no es admin, solo citas donde es responsable. */
  scope?: DataAccessScope | null
}

export async function listAppointments(supabase: SupabaseClient, params: ListAppointmentsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('appointments')
    .select('*, lead:leads(id, name, phone), responsible:profiles!appointments_responsible_id_fkey(full_name), project:projects(id, name)', {
      count: 'exact',
    })
    .eq('tenant_id', params.tenantId)
    .order('start_time', { ascending: true })

  if (params.statuses?.length) query = query.in('status', params.statuses)
  else if (params.status) query = query.eq('status', params.status)
  if (params.scope && !params.scope.isAdmin) {
    query = query.eq('responsible_id', params.scope.userId)
  } else if (params.responsibleId) {
    query = query.eq('responsible_id', params.responsibleId)
  }
  if (params.dateFrom) query = query.gte('start_time', params.dateFrom)
  if (params.dateTo) query = query.lte('start_time', params.dateTo)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`title.ilike.%${q}%,notes.ilike.%${q}%`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Appointment[], total: count ?? 0 }
}

export async function getAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  scope?: DataAccessScope | null,
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
  if (scope && !scope.isAdmin && row.responsible_id !== scope.userId) {
    throw new Error('No tienes permiso para ver esta cita.')
  }

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
  projectId?: string
  salespersonId?: string
  page?: number
  pageSize?: number
  search?: string
  source?: ShowroomVisitSource
  /** Si no es admin, solo visitas donde es el asesor registrado. */
  scope?: DataAccessScope | null
}

export async function listShowroomVisits(supabase: SupabaseClient, params: ListShowroomParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('showroom_visits')
    .select('*, salesperson:profiles!showroom_visits_salesperson_id_fkey(full_name), project:projects(id, name), lead:leads(id, name)', {
      count: 'exact',
    })
    .eq('tenant_id', params.tenantId)
    .order('visit_start', { ascending: false })

  if (params.projectId) query = query.eq('project_id', params.projectId)
  if (params.scope && !params.scope.isAdmin) {
    query = query.eq('salesperson_id', params.scope.userId)
  } else if (params.salespersonId) {
    query = query.eq('salesperson_id', params.salespersonId)
  }
  if (params.source) query = query.eq('source', params.source)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`client_name.ilike.%${q}%,notes.ilike.%${q}%,phone.ilike.%${q}%`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as ShowroomVisit[], total: count ?? 0 }
}

export async function getShowroomVisit(
  supabase: SupabaseClient,
  visitId: string,
  scope?: DataAccessScope | null,
): Promise<ShowroomVisitWithUnits> {
  const { data: visit, error } = await supabase
    .from('showroom_visits')
    .select(
      '*, salesperson:profiles!showroom_visits_salesperson_id_fkey(full_name), project:projects(id, name), lead:leads(id, name)',
    )
    .eq('id', visitId)
    .single()
  if (error) throw error

  const row = visit as ShowroomVisit
  if (scope && !scope.isAdmin && row.salesperson_id !== scope.userId) {
    throw new Error('No tienes permiso para ver esta visita.')
  }

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

// ─── Unit Sales Closings ────────────────────────────────────
export async function recordUnitClosing(
  supabase: SupabaseClient,
  payload: {
    tenant_id: string
    unit_id: string
    lead_id?: string
    sold_by_id: string
    sale_price_final: number
    published_price_snapshot: number
    notes?: string
  }
) {
  const { data, error } = await supabase.from('unit_sales_closings').insert(payload).select().single()
  if (error) throw error

  await supabase.from('units').update({ status: 'vendido' as UnitStatus }).eq('id', payload.unit_id)

  return data
}

// ─── Contracts ──────────────────────────────────────────────
export const CONTRACTS_FILES_BUCKET = 'contracts-docs'

interface ListContractsParams {
  tenantId: string
  status?: ContractStatus
  search?: string
  page?: number
  pageSize?: number
  /** Si no es admin, solo contratos creados por el usuario (`created_by`). */
  scope?: DataAccessScope | null
}

export async function listContracts(supabase: SupabaseClient, params: ListContractsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('contracts')
    .select('*, lead:leads(id, name)', { count: 'exact' })
    .eq('tenant_id', params.tenantId)
    .order('created_at', { ascending: false })

  if (params.scope && !params.scope.isAdmin) {
    query = query.eq('created_by', params.scope.userId)
  }

  if (params.status) query = query.eq('status', params.status)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`contract_number.ilike.%${q}%`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Contract[], total: count ?? 0 }
}

export async function getContract(
  supabase: SupabaseClient,
  contractId: string,
  scope?: DataAccessScope | null,
): Promise<ContractWithUnits> {
  const { data: row, error } = await supabase
    .from('contracts')
    .select('*, lead:leads(id, name, phone)')
    .eq('id', contractId)
    .single()
  if (error) throw error

  const contract = row as Contract
  if (scope && !scope.isAdmin) {
    if (contract.created_by !== scope.userId) {
      throw new Error('No tienes permiso para ver este contrato.')
    }
  }

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

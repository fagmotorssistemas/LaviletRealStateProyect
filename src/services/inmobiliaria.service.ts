import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Unit, Lead, Appointment, ShowroomVisit, LeadInteraction,
  UnitStatus, LeadStatus, AppointmentStatus, InteractionType, LocationType,
  Project, Contract, ContractStatus,
} from '@/types/inmobiliaria'

// ─── Projects ───────────────────────────────────────────────
export async function listProjects(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Project[]
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
}

export async function listUnits(supabase: SupabaseClient, params: ListUnitsParams) {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('units')
    .select('*, project:projects(id, name)', { count: 'exact' })
    .eq('tenant_id', params.tenantId)
    .order('unit_number', { ascending: true })

  if (params.projectId) query = query.eq('project_id', params.projectId)
  if (params.status) query = query.eq('status', params.status)
  if (params.category) query = query.eq('category', params.category)
  if (params.search) query = query.or(`unit_number.ilike.%${params.search}%,description.ilike.%${params.search}%`)

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Unit[], total: count ?? 0 }
}

export async function getUnit(supabase: SupabaseClient, unitId: string) {
  const { data, error } = await supabase
    .from('units')
    .select('*, project:projects(id, name)')
    .eq('id', unitId)
    .single()
  if (error) throw error
  return data as Unit
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

  if (params.status) query = query.eq('status', params.status)
  if (params.assignedTo) query = query.eq('assigned_to', params.assignedTo)
  if (params.search) query = query.or(`name.ilike.%${params.search}%,phone.ilike.%${params.search}%,email.ilike.%${params.search}%`)

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Lead[], total: count ?? 0 }
}

export async function getLead(supabase: SupabaseClient, leadId: string) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, lead_units(*, unit:units(id, unit_number, published_commercial_price, status, project:projects(name))), assigned_profile:profiles!leads_assigned_to_fkey(full_name)')
    .eq('id', leadId)
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
  if (params.responsibleId) query = query.eq('responsible_id', params.responsibleId)
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
  payload: Partial<Appointment>
) {
  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', appointmentId)
    .select()
    .single()
  if (error) throw error
  return data as Appointment
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
  source?: LocationType
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
  if (params.salespersonId) query = query.eq('salesperson_id', params.salespersonId)
  if (params.source) query = query.eq('source', params.source)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`client_name.ilike.%${q}%,notes.ilike.%${q}%,phone.ilike.%${q}%`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as ShowroomVisit[], total: count ?? 0 }
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

  if (params.status) query = query.eq('status', params.status)
  if (params.search) {
    const q = params.search.trim()
    if (q) query = query.or(`contract_number.ilike.%${q}%`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { data: data as Contract[], total: count ?? 0 }
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

export type UnitStatus =
  | 'disponible'
  | 'en_preventa'
  | 'reservado'
  | 'en_proceso'
  | 'bajo_contrato'
  | 'vendido'
  | 'deshabilitado'

export type LeadStatus =
  | 'nuevo'
  | 'interesado'
  | 'en_contacto'
  | 'agendado'
  | 'en_negociacion'
  | 'reservado'
  | 'vendido'
  | 'no_interesado'

export type AppointmentStatus =
  | 'pendiente'
  | 'aceptado'
  | 'reprogramado'
  | 'atendido'
  | 'cancelado'

export type InteractionType =
  | 'llamada'
  | 'whatsapp'
  | 'visita'
  | 'propuesta'
  | 'seguimiento'
  | 'email'
  | 'otro'

export type LocationType = 'oficina' | 'proyecto' | 'mixto'
export type ContractStatus = 'pendiente' | 'firmado' | 'anulado'

export interface Tenant {
  id: string
  name: string
  ruc: string | null
  address: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
}

export interface Project {
  id: string
  tenant_id: string
  name: string
  address: string | null
  estimated_projection_date: string | null
  architects: string | null
  plan_type: string | null
  summary_financial_initial_pvp_total: number | null
  summary_financial_min_expected_with_discounts: number | null
  policies_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Unit {
  id: string
  tenant_id: string
  project_id: string
  category: string
  unit_number: string
  unit_subtype: string | null
  floor: string | null
  area_internal_m2: number | null
  area_total_m2: number | null
  area_terrace_m2: number | null
  area_terrace_covered_m2: number | null
  area_terrace_open_m2: number | null
  parking_assigned: number
  cost_per_m2_internal: number | null
  published_commercial_price: number | null
  status: UnitStatus
  description: string | null
  slug: string | null
  created_at: string
  updated_at: string
  project?: Project
}

export interface Lead {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  email: string | null
  status: LeadStatus
  budget: number | null
  financing: boolean
  assigned_to: string | null
  source: string | null
  resume: string | null
  created_at: string
  updated_at: string
  lead_units?: LeadUnit[]
  assigned_profile?: { full_name: string | null }
}

export interface LeadUnit {
  lead_id: string
  unit_id: string
  priority: number
  created_at: string
  unit?: Unit
}

export interface LeadInteraction {
  id: string
  tenant_id: string
  lead_id: string
  responsible_id: string | null
  type: InteractionType
  content: string | null
  result: string | null
  created_at: string
  responsible?: { full_name: string | null }
}

export interface Appointment {
  id: string
  tenant_id: string
  lead_id: string | null
  responsible_id: string | null
  title: string | null
  start_time: string
  end_time: string | null
  status: AppointmentStatus
  location_type: LocationType
  office_id: string | null
  project_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  lead?: Lead
  responsible?: { full_name: string | null }
  project?: Project
}

export interface ShowroomVisit {
  id: string
  tenant_id: string
  salesperson_id: string | null
  source: LocationType
  office_id: string | null
  project_id: string | null
  lead_id: string | null
  client_name: string | null
  phone: string | null
  visit_start: string
  visit_end: string | null
  notes: string | null
  created_at: string
  updated_at: string
  salesperson?: { full_name: string | null }
  project?: Project
  lead?: Lead
}

export interface UnitSalesClosing {
  id: string
  tenant_id: string
  unit_id: string
  lead_id: string | null
  sold_by_id: string | null
  published_price_snapshot: number | null
  sale_price_final: number
  sale_at: string
  notes: string | null
  created_at: string
}

export interface Contract {
  id: string
  tenant_id: string
  lead_id: string | null
  contract_number: string | null
  status: ContractStatus
  pdf_url: string | null
  anticipo_amount: number | null
  anticipo_date: string | null
  anticipo_proof_url: string | null
  created_by: string | null
  created_at: string
  lead?: Lead
}

export const UNIT_STATUS_OPTIONS: { value: UnitStatus; label: string }[] = [
  { value: 'disponible', label: 'Disponible' },
  { value: 'en_preventa', label: 'En Preventa' },
  { value: 'reservado', label: 'Reservado' },
  { value: 'en_proceso', label: 'En Proceso' },
  { value: 'bajo_contrato', label: 'Bajo Contrato' },
  { value: 'vendido', label: 'Vendido' },
  { value: 'deshabilitado', label: 'Deshabilitado' },
]

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'interesado', label: 'Interesado' },
  { value: 'en_contacto', label: 'En Contacto' },
  { value: 'agendado', label: 'Agendado' },
  { value: 'en_negociacion', label: 'En Negociación' },
  { value: 'reservado', label: 'Reservado' },
  { value: 'vendido', label: 'Vendido' },
  { value: 'no_interesado', label: 'No Interesado' },
]

export const APPOINTMENT_STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aceptado', label: 'Aceptado' },
  { value: 'reprogramado', label: 'Reprogramado' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'cancelado', label: 'Cancelado' },
]

export const INTERACTION_TYPE_OPTIONS: { value: InteractionType; label: string }[] = [
  { value: 'llamada', label: 'Llamada' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'visita', label: 'Visita' },
  { value: 'propuesta', label: 'Propuesta' },
  { value: 'seguimiento', label: 'Seguimiento' },
  { value: 'email', label: 'Email' },
  { value: 'otro', label: 'Otro' },
]

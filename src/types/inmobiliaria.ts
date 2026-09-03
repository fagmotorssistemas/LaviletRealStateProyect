/** Valores alineados con el enum PostgreSQL `public.user_role`. */
export type UserRole = 'asesor' | 'admin' | 'contable' | 'marketing'

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

/** Valores de `leads.temperature` (default en BD: `frio`). */
export type LeadTemperature = 'frio' | 'tibio' | 'caliente'

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

// Origen de la visita de showroom
export type ShowroomVisitSource =
  | 'organica'
  | 'redes_sociales'
  | 'referido'
  | 'agendada'
  | 'otro'
  // Valores heredados (si ya existen visitas guardadas con la lógica anterior)
  | 'oficina'
  | 'proyecto'
  | 'mixto'
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

/** Fase comercial / obra (UI y reportes). */
export type ProjectConstructionPhase =
  | 'preventa'
  | 'en_construccion'
  | 'entrega_proxima'
  | 'entregado'

/** Archivos vinculados al proyecto (fotos, planos PDF, brochures). */
export type ProjectAssetKind = 'photo' | 'floor_plan' | 'brochure' | 'document' | 'other'

export interface ProjectAsset {
  id: string
  tenant_id: string
  project_id: string
  kind: ProjectAssetKind
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number | null
  caption: string | null
  sort_order: number
  is_cover: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  tenant_id: string
  name: string
  address: string | null
  estimated_projection_date: string | null
  architects: string | null
  plan_type: string | null
  policies_json: Record<string, unknown> | null
  /** Resumen corto para tarjetas y listados. */
  short_description: string | null
  /** Descripción amplia del proyecto. */
  description: string | null
  city: string | null
  country: string | null
  /** Constructora / promotora. */
  developer_name: string | null
  construction_phase: ProjectConstructionPhase | null
  website_url: string | null
  contact_phone: string | null
  contact_email: string | null
  total_units_planned: number | null
  created_at: string
  updated_at: string
  /** Incluido cuando el listado carga relación anidada. */
  project_assets?: ProjectAsset[]
}

/** Detalle con conteo de unidades (sin cargar todas las filas). */
export interface ProjectDetail extends Project {
  units_count: number
  project_assets: ProjectAsset[]
}

/** Fotos/archivos de una unidad (inventario), en Storage o URL legacy en `url`. */
export interface UnitMedia {
  id: string
  unit_id: string
  tenant_id: string
  type: string
  url: string
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  caption: string | null
  sort_order: number
  is_cover: boolean
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
  bedrooms: number | null
  bathrooms: number | null
  cost_per_m2_internal: number | null
  published_commercial_price: number | null
  status: UnitStatus
  description: string | null
  slug: string | null
  created_at: string
  updated_at: string
  project?: Project
  unit_media?: UnitMedia[]
}

/** Fila de `units_import` (carga cruda, sin tenant). */
export interface UnitImport {
  id: string
  category: string
  unit_code: string
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
  created_at: string
  price: number | null
  status: UnitStatus
}

export const UNIT_IMPORT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'suite', label: 'Suite' },
  { value: 'local', label: 'Local' },
]

export function unitImportCategoryLabel(category: string): string {
  return UNIT_IMPORT_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category
}

export interface Lead {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  status: LeadStatus
  temperature: LeadTemperature
  temperature_score: number
  temperature_updated_at: string | null
  budget: number | null
  financing: boolean
  assigned_to: string | null
  source: string | null
  resume: string | null
  created_at: string
  updated_at: string
  lead_units?: LeadUnit[]
  assigned_profile?: { full_name: string | null; avatar_url?: string | null }
}

/** Asesor / usuario del CRM (`profiles`), para asignar responsable. */
export interface TeamProfile {
  id: string
  full_name: string | null
  role: UserRole | null
  avatar_url: string | null
  is_active?: boolean
}

/** Valor de filtro para leads sin `assigned_to`. */
export const UNASSIGNED_ASSIGNEE = '__unassigned__'

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
  office_id: string | null
  project_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  lead?: Lead
  responsible?: { full_name: string | null }
  project?: Project
}

/** Cita con unidades vinculadas (`appointment_units`). */
export interface AppointmentWithUnits extends Appointment {
  units: Unit[]
}

export interface ShowroomVisit {
  id: string
  tenant_id: string
  salesperson_id: string | null
  source: ShowroomVisitSource
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
  salesperson?: { full_name: string | null; avatar_url?: string | null }
  project?: Project
  lead?: Pick<Lead, 'id' | 'name' | 'financing'> & Partial<Lead>
  /** Unidades de interés (listado hidrata `showroom_visit_units`). */
  units?: Unit[]
}

/** Visita con unidades de interés cargadas desde `showroom_visit_units`. */
export interface ShowroomVisitWithUnits extends ShowroomVisit {
  units: Unit[]
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
  contract_id: string | null
  unit?: { id: string; unit_number: string; category?: string | null; project_id?: string; project?: { id: string; name: string } | null }
  lead?: { id: string; name: string; phone?: string | null } | null
  sold_by?: { id: string; full_name: string | null; avatar_url?: string | null } | null
  contract?: { id: string; contract_number: string | null; status: string } | null
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

/** Contrato con unidades vinculadas (`contract_units`). */
export interface ContractWithUnits extends Contract {
  units: Unit[]
}

/** Orden de listado en inventario (unidades). */
export type InventorySortOption =
  | 'unit_natural'
  | 'price_desc'
  | 'price_asc'
  | 'area_desc'
  | 'area_asc'

export const INVENTORY_SORT_OPTIONS: { value: InventorySortOption; label: string }[] = [
  { value: 'unit_natural', label: 'Número de unidad (orden natural)' },
  { value: 'price_desc', label: 'Precio: más caros primero' },
  { value: 'price_asc', label: 'Precio: más baratos primero' },
  { value: 'area_desc', label: 'Mayor área total' },
  { value: 'area_asc', label: 'Menor área total' },
]

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

export const LEAD_TEMPERATURE_OPTIONS: { value: LeadTemperature; label: string }[] = [
  { value: 'frio', label: 'Frío' },
  { value: 'tibio', label: 'Tibio' },
  { value: 'caliente', label: 'Caliente' },
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

export type LeadFinancingStatus = 'simulado' | 'preaprobado' | 'en_tramite' | 'aprobado' | 'negado'

export const LEAD_FINANCING_STATUS_OPTIONS: { value: LeadFinancingStatus; label: string }[] = [
  { value: 'simulado', label: 'Simulado' },
  { value: 'preaprobado', label: 'Preaprobado' },
  { value: 'en_tramite', label: 'En trámite' },
  { value: 'aprobado', label: 'Aprobado' },
  { value: 'negado', label: 'Negado' },
]

export const FINANCING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'banco', label: 'Banco' },
  { value: 'biess', label: 'BIESS' },
  { value: 'cooperativa', label: 'Cooperativa' },
  { value: 'mixto', label: 'Mixto' },
  { value: 'contado', label: 'Contado' },
]

export const PAYMENT_PLAN_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'todos', label: 'Todas las categorías' },
  { value: 'Departamento', label: 'Departamento' },
  { value: 'Local Comercial', label: 'Local comercial' },
  { value: 'Suite', label: 'Suite' },
  { value: 'Oficina', label: 'Oficina' },
  { value: 'Parqueadero', label: 'Parqueadero' },
]

export const PAYMENT_PLAN_BALANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'contado', label: 'Contado' },
  { value: 'mixto', label: 'Mixto' },
  { value: 'credito', label: 'Crédito' },
]

/** Plan comercial de pago por proyecto (`payment_plans`). */
export interface PaymentPlan {
  id: string
  project_id: string
  name: string
  applies_to_category: string
  reservation_amount: number | null
  entry_pct: number | null
  balance_type: string | null
  conditions: string | null
  is_active: boolean
  project?: { id: string; name: string }
}

/** Aliado de crédito (`financing_partners`): Banco Pichincha, BIESS, etc. */
export interface FinancingPartner {
  id: string
  name: string
  partner_type: string | null
  max_term_years: number | null
  min_entry_pct: number | null
  approx_rate: number | null
  requirements: string | null
  approval_days: number | null
  is_active: boolean
}

/** Solicitud / simulación de crédito de un lead (`lead_financing`). */
export interface LeadFinancing {
  id: string
  lead_id: string
  unit_id: string | null
  financing_partner_id: string | null
  financing_type: string | null
  unit_price: number | null
  entry_amount: number | null
  financed_amount: number | null
  term_months: number | null
  interest_rate: number | null
  monthly_payment: number | null
  status: string
  requested_at: string
  resolved_at: string | null
  generated_by: string | null
  pdf_url: string | null
  notes: string | null
  lead?: { id: string; name: string; phone: string | null }
  unit?: { id: string; unit_number: string; project?: { name: string } | null }
  partner?: Pick<FinancingPartner, 'id' | 'name' | 'partner_type' | 'approx_rate'> | null
}

/** Pedido de asesoría de crédito (`asesoria_financiamiento` / `datos_solicitados_clientes`). */
export interface AsesoriaFinanciamiento {
  id: string
  tenant_id: string
  lead_id: string
  mensaje_completo: string | null
  atendido: boolean
  created_at: string
  lead?: { id: string; name: string; phone: string | null }
}

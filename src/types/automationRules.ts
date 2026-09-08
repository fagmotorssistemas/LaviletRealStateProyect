export type AutomationMode = 'lanzamiento' | 'preventa'

export type BusinessHourSlot = { open: string; close: string }
export type BusinessHours = Record<string, BusinessHourSlot>

export type ProjectAutomationConfig = {
  project_id: string
  tenant_id: string
  mode: AutomationMode
  timezone: string
  business_hours: BusinessHours
  admin_profile_id: string | null
  is_active: boolean
  sla_response_minutes: number
  temperature_warm_min: number
  temperature_hot_min: number
  visit_location_url: string | null
  review_sla_minutes: number
  proposal_hold_minutes: number
  max_auto_reassignments: number
  updated_at: string | null
}

export type ProjectSalespersonRow = {
  id: string
  tenant_id: string
  project_id: string
  salesperson_id: string
  role_in_project: string | null
  receives_leads: boolean
  receives_bot_appointments: boolean
  rotation_order: number
  last_lead_assigned_at: string | null
  full_name: string | null
  phone: string | null
  is_active: boolean | null
}

export type ScoringRuleRow = {
  event_type: string
  points: number
  reason: string
  repeatable: boolean
  active: boolean
}

export type NutritionStepRow = {
  id: string
  project_id: string
  week_number: number
  topic: string
  meta_template_name: string
  is_approved: boolean
  active: boolean
}

export type AutomationRulesPayload = {
  tenantId: string
  config: ProjectAutomationConfig | null
  salespeople: ProjectSalespersonRow[]
  scoringRules: ScoringRuleRow[]
  nutritionSteps: NutritionStepRow[]
}

export const AUTOMATION_MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
  { value: 'lanzamiento', label: 'Lanzamiento' },
  { value: 'preventa', label: 'Preventa' },
]

export const TIMEZONE_OPTIONS = [
  { value: 'America/Guayaquil', label: 'America/Guayaquil' },
  { value: 'America/Bogota', label: 'America/Bogota' },
  { value: 'America/Lima', label: 'America/Lima' },
  { value: 'UTC', label: 'UTC' },
]

export const WEEKDAY_OPTIONS: { iso: string; label: string }[] = [
  { iso: '1', label: 'Lunes' },
  { iso: '2', label: 'Martes' },
  { iso: '3', label: 'Miércoles' },
  { iso: '4', label: 'Jueves' },
  { iso: '5', label: 'Viernes' },
  { iso: '6', label: 'Sábado' },
  { iso: '7', label: 'Domingo' },
]

export const DEFAULT_NUTRITION_TOPICS: { week_number: number; topic: string; meta_template_name: string }[] = [
  { week_number: 1, topic: 'Presentación del proyecto', meta_template_name: 'lavilet_nutricion_s1' },
  { week_number: 2, topic: 'Qué tendrá La Vilet', meta_template_name: 'lavilet_nutricion_s2' },
  { week_number: 3, topic: 'Avance de obra', meta_template_name: 'lavilet_nutricion_s3' },
  { week_number: 4, topic: 'Un espacio del proyecto', meta_template_name: 'lavilet_nutricion_s4' },
]

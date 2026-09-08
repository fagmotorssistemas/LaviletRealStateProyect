export type LeadSlaStatus = 'no_aplica' | 'pendiente' | 'vencido' | 'respondido'
export type LeadHandoffStatus = 'none' | 'queued' | 'assigned' | 'acknowledged' | 'resolved'
export type LeadStage = 'lanzamiento' | 'precalificacion' | 'nutricion' | 'preventa' | 'reserva_venta'
export type LeadPurchasePurpose = 'vivir' | 'invertir' | 'segunda_vivienda' | 'negocio'

export interface LeadAutomationRow {
  tenant_id: string
  project_id: string | null
  project_name: string | null
  lead_id: string
  name: string
  phone: string | null
  phone_normalized: string | null
  email: string | null
  source: string | null
  channel: string | null
  campaign: string | null
  created_at: string | null
  last_interaction_at: string | null
  stage: LeadStage
  stage_reason: string | null
  stage_changed_at: string | null
  temperature: 'frio' | 'tibio' | 'caliente'
  score: number
  temperature_updated_at: string | null
  preferred_category: string | null
  purchase_purpose: LeadPurchasePurpose | null
  bot_enabled: boolean
  tracking_consent: boolean
  tracking_consent_at: string | null
  tracking_opt_out_at: string | null
  tracking_opt_out_reason: string | null
  handoff_status: LeadHandoffStatus
  handoff_reason: string | null
  handoff_requested_at: string | null
  handoff_assigned_at: string | null
  assigned_to: string | null
  assignee_name: string | null
  assignee_kommo_id: string | null
  lead_kommo_id: number | null
  seller_response_due_at: string | null
  seller_first_response_at: string | null
  admin_escalated_at: string | null
  latest_conversation_id: string | null
  latest_conversation_at: string | null
  message_count: number
  last_message_at: string | null
  visit_count: number
  last_visit_requested_at: string | null
  last_visit_status: string | null
  last_visit_preferred_time: string | null
  last_temperature_reason: string | null
  last_stage_reason: string | null
  sla_status: LeadSlaStatus
}

export interface LeadAutomationKpiCount {
  source?: string
  stage?: string
  count: number
}

export interface LeadAutomationKpis {
  leads_new: number
  leads_by_source: LeadAutomationKpiCount[]
  leads_by_stage: LeadAutomationKpiCount[]
  leads_cold: number
  leads_warm: number
  leads_hot: number
  reached_hot: number
  handed_off: number
  queued: number
  visits_requested: number
  visits_confirmed: number
  sla_overdue: number
  avg_first_response_minutes: number | null
}

export interface LeadAutomationFilters {
  search: string
  from: string
  to: string
  projectId: string
  source: string
  stage: string
  temperature: string
  assignedTo: string
  handoff: string
  bot: string
  sla: string
}

export interface LeadScoreEventRow {
  id: string
  lead_id: string
  event_type: string
  points: number
  reason: string
  source_message_id: string | null
  created_at: string
}

export interface LeadTemperatureHistoryRow {
  id: string
  lead_id: string
  from_temperature: string | null
  to_temperature: string
  score: number | null
  reason: string
  created_at: string
}

export interface LeadStageHistoryRow {
  id: string
  lead_id: string
  from_stage: string | null
  to_stage: string
  reason: string
  created_at: string
}

export interface ConversationRow {
  id: string
  lead_id: string | null
  channel: string
  status: string
  summary: string | null
  started_at: string
  last_message_at: string | null
  closed_at: string | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: 'cliente' | 'bot' | 'asesor' | 'sistema'
  content: string | null
  media_url: string | null
  sent_at: string
}

export interface LeadInterestUnitRow {
  lead_id: string
  unit_id: string
  interest_level: string | null
  source: string | null
  rejected: boolean
  rejection_reason: string | null
  notes: string | null
  created_at: string | null
  unit?: {
    id: string
    unit_number: string
    category: string | null
    status: string | null
    published_commercial_price: number | null
  } | null
}

export interface LeadVisitRow {
  id: string
  status: string
  requested_at: string
  scheduled_at: string | null
  start_time: string | null
  preferred_time_text: string | null
  confirmed_by_client: boolean
  notes: string | null
  units?: { id: string; unit_number: string }[]
}

export interface LeadNutritionRow {
  lead_id: string
  next_week: number
  next_send_at: string
  last_sent_at: string | null
  completed_at: string | null
  paused_at: string | null
  last_error: string | null
}

export interface NutritionDeliveryRow {
  id: string
  lead_id: string
  week_number: number
  meta_template_name: string
  status: string
  error: string | null
  created_at: string
}

export interface BotEscalationRow {
  id: string
  conversation_id: string
  reason: string | null
  escalated_at: string
  assigned_to: string | null
  resolved_at: string | null
}

export type AutomationTimelineKind =
  | 'mensaje_recibido'
  | 'evento_detectado'
  | 'puntos_asignados'
  | 'cambio_temperatura'
  | 'cambio_etapa'
  | 'solicitud_visita'
  | 'solicitud_traspaso'
  | 'responsable_asignado'
  | 'respuesta_vendedora'

export interface AutomationTimelineItem {
  id: string
  kind: AutomationTimelineKind
  at: string
  title: string
  detail: string | null
}

export interface LeadAutomationDetail {
  row: LeadAutomationRow
  conversations: ConversationRow[]
  messages: MessageRow[]
  scoreEvents: LeadScoreEventRow[]
  temperatureHistory: LeadTemperatureHistoryRow[]
  stageHistory: LeadStageHistoryRow[]
  units: LeadInterestUnitRow[]
  visits: LeadVisitRow[]
  nutrition: LeadNutritionRow | null
  nutritionHistory: NutritionDeliveryRow[]
  escalations: BotEscalationRow[]
  timeline: AutomationTimelineItem[]
}

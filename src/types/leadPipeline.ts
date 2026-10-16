/** Commercial progression is independent of appointments, nurturing and bot tasks. */
export const LEAD_PIPELINE_STAGE_OPTIONS = [
  { value: 'nuevo', label: 'Nuevo / Por atender' },
  { value: 'contacto_inicial', label: 'Contacto inicial' },
  { value: 'necesidad_identificada', label: 'Necesidad identificada' },
  { value: 'interes_comercial', label: 'Interés comercial' },
  { value: 'proceso_reserva', label: 'Proceso de reserva' },
  { value: 'venta_cerrada', label: 'Venta cerrada' },
] as const

export type LeadPipelineStage = typeof LEAD_PIPELINE_STAGE_OPTIONS[number]['value']
export type LeadPipelineSourceRow = Record<string, unknown>
export type LeadPipelineCoverage = Record<string, boolean>
export interface LeadPipelineIssue {
  source: string
  label: string
  category: 'schema' | 'permission' | 'temporary' | 'configuration' | 'unknown'
  code: string | null
  reference: string
  message: string
}
export interface LeadPipelineEvidence {
  source: string
  sourceId: string | null
  reason: string
  at: string | null
}
export interface LeadPipelineHistoryEntry {
  from: LeadPipelineStage | null
  to: LeadPipelineStage
  reason: string
  at: string | null
  actor: string | null
}
export interface LeadPipelineSnapshot {
  stage: LeadPipelineStage
  stageLabel: string
  stageReason: string
  stageChangedAt: string | null
  evidence: LeadPipelineEvidence[]
  nutritionActive: boolean
  nutritionKnown?: boolean
  stageProvisional?: boolean
  nutritionReason: string | null
  purchaseHorizon: string | null
  resumeAt: string | null
  resumeCondition: string | null
  opportunityStatus: 'open' | 'lost' | 'won'
  closureReason: string | null
  attentionStatus: 'por_atender' | 'pendiente_equipo' | 'esperando_lead' | 'sin_datos'
  attentionLabel: string
  lastCustomerAt: string | null
  lastResponseAt: string | null
  lastActivityAt: string | null
  selectedUnitId: string | null
  selectedUnitNumber: string | null
  appointment: { id: string; status: string; label: string; scheduledAt: string | null } | null
  nextAction: string | null
  nextActionAt: string | null
  nextActionOwnerId: string | null
  nextActionScheduled: boolean
  history: LeadPipelineHistoryEntry[]
  coverage: LeadPipelineCoverage
  warnings: string[]
  issues?: LeadPipelineIssue[]
}

export interface LeadPipelineInput {
  lead: LeadPipelineSourceRow
  conversation?: LeadPipelineSourceRow | null
  messages?: LeadPipelineSourceRow[]
  scoreEvents?: LeadPipelineSourceRow[]
  appointments?: LeadPipelineSourceRow[]
  reservations?: LeadPipelineSourceRow[]
  sales?: LeadPipelineSourceRow[]
  jobs?: LeadPipelineSourceRow[]
  metadata?: LeadPipelineSourceRow | null
  units?: LeadPipelineSourceRow[]
  history?: LeadPipelineSourceRow[]
  coverage?: LeadPipelineCoverage
  warnings?: string[]
  issues?: LeadPipelineIssue[]
}

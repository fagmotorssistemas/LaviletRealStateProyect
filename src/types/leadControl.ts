export type LeadControlState = 'intervention' | 'waiting' | 'healthy' | 'intentional'

export type LeadControlCategory =
  | 'entry'
  | 'interpretation'
  | 'context'
  | 'routing'
  | 'generation'
  | 'delivery'
  | 'advisor'
  | 'visit'
  | 'nutrition'
  | 'inactivity'
  | 'intentional'
  | 'normal'

export type LeadControlSeverity = 'critical' | 'high' | 'medium' | 'info'

export interface LeadControlStep {
  order: number
  key: string
  label: string
  category: string
  status: 'succeeded' | 'paused' | 'skipped' | 'failed'
  source: string
  startedAt: string
  completedAt: string
  durationMs: number
  errorCode: string | null
  input: Record<string, unknown>
  output: Record<string, unknown>
}

export interface LeadControlExecution {
  id: string
  kind: string
  status: string
  action: string | null
  occurredAt: string
  availableAt: string | null
  message: string | null
  steps: LeadControlStep[]
}

export interface LeadControlEvidence {
  label: string
  value: string
  at: string | null
}

export interface LeadControlRow {
  leadId: string
  kommoId: number | null
  name: string
  phone: string | null
  projectName: string | null
  stage: string
  temperature: string
  botEnabled: boolean
  assigneeName: string | null
  handoffStatus: string
  state: LeadControlState
  category: LeadControlCategory
  severity: LeadControlSeverity
  reasonCode: string
  reason: string
  explanation: string
  recommendation: string
  detectedAt: string
  lastInteractionAt: string | null
  lastSuccessfulNode: string | null
  stoppedNode: string | null
  evidence: LeadControlEvidence[]
  executions: LeadControlExecution[]
}

export interface LeadControlSummary {
  total: number
  intervention: number
  waiting: number
  healthy: number
  intentional: number
  unassigned: number
}

export interface LeadControlResponse {
  generatedAt: string
  thresholds: {
    automationResponseMinutes: number
    processingMinutes: number
    commercialInactivityDays: number
  }
  summary: LeadControlSummary
  rows: LeadControlRow[]
}

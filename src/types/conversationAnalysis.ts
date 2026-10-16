import type { LeadPipelineStage } from './leadPipeline'

export type AnalysisRow = Record<string, unknown>
export type Evidence = { message_id: string; quote: string }
export type AnalysisFactor = {
  kind: 'customer' | 'conversation'
  reason: string
  basis: 'explicit' | 'hypothesis'
  explanation: string
  next_step: string
  evidence: Evidence[]
  status?: 'open' | 'addressed'
}
export type AnalysisSignal = {
  key: string; label: string; detail: string; source: string; at: string | null
  priority: 'high' | 'medium'; nextStep: string
}
export type AnalysisReview = {
  id: string; status: 'reviewing' | 'actioned' | 'resolved' | 'dismissed'
  note: string; createdAt: string; signature: string; actor: string
  baselineCustomerAt: string | null
}
export type AnalysisTimelineItem = { id: string; at: string; label: string; detail: string; kind: 'message' | 'operation' | 'incident' | 'review' }
export type ConversationAnalysisCase = {
  id: string; name: string; projectId: string; projectName: string; createdAt: string | null
  source: string; temperature: string; residence: string; category: string
  advisorId: string; advisorName: string; kommoId: number | null
  stage: LeadPipelineStage; stageLabel: string; stageAt: string | null; stageProvisional: boolean
  moment: string; momentLabel: string; waiting: 'team' | 'customer' | 'planned' | 'unknown'
  waitingSince: string | null; lastCustomerAt: string | null; lastResponseAt: string | null
  lost: boolean; won: boolean; futureInterest: boolean; contactStopped: boolean
  signals: AnalysisSignal[]; factors: AnalysisFactor[]; timeline: AnalysisTimelineItem[]
  analysis: AnalysisRow | null; analysisId: string | null; reviewAt: string | null; stale: boolean
  reviews: AnalysisReview[]; signature: string; canReview: boolean
  recovery: { at: string; detail: string } | null
  coverage: Record<string, boolean>; warnings: string[]
  milestones: string[]; nextStep: string; codeVersion: string | null
  firstResponseSeconds?: number | null; firstAdvisorSeconds?: number | null
  closureReason?: string | null
}
export type ConversationAnalysisDashboard = {
  items: ConversationAnalysisCase[]; asOf: string; warnings: string[]
}
export const ANALYSIS_REASON_LABELS: Record<string, string> = {
  price: 'Precio y presupuesto', location: 'Ubicación', product_fit: 'Necesidades e inmueble',
  financing: 'Financiamiento', timing: 'Plazo de compra', unanswered: 'Consulta sin resolver',
  repetition: 'Preguntas repetidas', context_loss: 'Pérdida de contexto', unclear_answer: 'Explicación confusa',
  premature_request: 'Solicitud de datos o trámite prematura', technical_failure: 'Incidencia técnica',
  unknown: 'Sin motivo determinado', not_dropped: 'Conversación activa',
}
export const ANALYSIS_MOMENT_LABELS: Record<string, string> = {
  entry: 'Entrada y primera atención', discovery: 'Presentación y necesidades', options: 'Opciones y selección',
  price: 'Precio y presupuesto', financing: 'Financiamiento', visit: 'Coordinación de visita',
  reservation: 'Solicitud de reserva', closure: 'Cierre comercial',
}

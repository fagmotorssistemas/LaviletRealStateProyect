import type { Edge } from '@xyflow/react'
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeKind } from './workflowDefinitions'

export interface WorkflowExecutionStep {
  order: number
  key: string
  label: string
  category: string
  status: string
  source: string
  startedAt: string
  completedAt: string
  durationMs: number
  input: Record<string, unknown>
  output: Record<string, unknown>
  errorCode: string | null
}

export interface WorkflowExecution {
  id: string
  leadGroupId?: string | null
  conversationId?: string | null
  batchId?: string | null
  batchEventIds?: string[]
  batchSize?: number
  kind?: string
  receivedAt?: string
  workflowId: 'overview' | 'pauses' | 'visits' | 'financing' | 'nutrition'
  path: string[]
  status: string
  action: string
  outcome: string
  occurredAt: string
  leadName: string
  message: string
  traceAvailable: boolean
  traceSource?: 'recorded' | 'inferred'
  traceWarning?: string | null
  stopReason?: string | null
  versions?: Record<string, unknown>
  steps: WorkflowExecutionStep[]
}

const KEY_LABELS: Record<string, string> = {
  action: 'Acción', advisor_handoff: 'Derivación al asesor', assigned_advisor: 'Asesor asignado',
  bot_remains_enabled: 'IA permanece activa', catalog_matches: 'Coincidencias del catálogo',
  courtesy: 'Mensaje de cortesía', direct_reply_adjusted: 'Respuesta ajustada',
  events: 'Señales detectadas', financing_continuation: 'Continuación de financiamiento',
  financing_partner: 'Entidad financiera', financing_turn: 'Turno de financiamiento',
  has_interpreted_preference: 'Preferencia interpretada', has_media: 'Contiene archivo',
  has_preference: 'Tiene preferencia', has_project_context: 'Contexto del proyecto',
  has_slot: 'Tiene horario', has_visit_context: 'Contexto de visita', history_messages: 'Mensajes de historial',
  manual_stop: 'Detención manual', media_read_failed: 'Error al leer archivo', message: 'Mensaje',
  messages_in_batch: 'Mensajes recibidos', memory_saved: 'Memoria guardada', needs_help: 'Necesita ayuda',
  opt_out: 'No desea mensajes', preferred_category: 'Categoría de interés', purchase_purpose: 'Propósito de compra',
  reason: 'Motivo', request_registered: 'Solicitud registrada', requested_advisor: 'Solicitó asesor',
  requested_visit: 'Solicitó visita', rescheduling: 'Reagendamiento', response_length: 'Longitud de respuesta',
  response_preview: 'Respuesta', scope: 'Alcance', selected_option: 'Opción seleccionada',
  source: 'Ruta elegida', status: 'Estado', turn_completeness_checked: 'Cobertura revisada',
  uncertain: 'Interpretación incierta', visit_intent: 'Intención de visita',
  nutrition_24h: 'Seguimiento de 24 h', nutrition_week_one: 'Seguimiento de primera semana',
  nutrition_later: 'Seguimiento posterior', provider: 'Proveedor', response_registered: 'Respuesta registrada',
  trace_schema: 'Versión de bitácora', code_version: 'Versión de código', contract_version: 'Contrato de interpretación',
  model: 'Modelo', prompt_versions: 'Versiones de instrucciones', primary_intent: 'Intención principal',
  confidence: 'Confianza', answers_question: 'Pregunta respondida', answer_kind: 'Tipo de respuesta',
  filters: 'Filtros aplicados', candidate_unit_ids: 'Unidades candidatas', selected_unit_ids: 'Unidades elegidas',
  reference_reason: 'Motivo de la referencia', needs_clarification: 'Requiere aclaración',
  next_question: 'Siguiente pregunta', question_target_ids: 'Unidades de la pregunta', locked: 'Respuesta protegida',
  facts_valid: 'Hechos validados', coverage_checked: 'Cobertura comprobada', delivery_confirmed: 'Entrega al teléfono confirmada',
  method: 'Método de interpretación', property_group: 'Grupo de propiedades', property_category: 'Categoría interpretada',
  operation: 'Operación solicitada', query_scope: 'Alcance de la búsqueda', query: 'Consulta aplicada',
  reference_kind: 'Tipo de referencia', request_count: 'Solicitudes reconocidas', discarded_request_count: 'Solicitudes sin evidencia',
  prompt_revision: 'Huella de instrucciones',
}

export function fieldLabel(key: string) {
  return KEY_LABELS[key] || key.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase())
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Sin dato'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(', ') : 'Ninguno'
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${fieldLabel(key)}: ${displayValue(item)}`).join(' · ') || 'Sin datos'
  return String(value)
}

function nodeKind(step: WorkflowExecutionStep): WorkflowNodeKind {
  if (step.status === 'failed' || step.status === 'paused') return 'pause'
  if (step.category === 'input') return 'input'
  if (step.category === 'ai') return 'ai'
  if (step.category === 'decision' || step.category === 'control') return 'decision'
  if (step.category === 'action') return 'action'
  if (step.category === 'output') return 'success'
  return 'process'
}

function statusLabel(status: string) {
  return { succeeded: 'Completado', paused: 'Detenido', skipped: 'Omitido', failed: 'Error' }[status] || status
}

function resultSummary(step: WorkflowExecutionStep) {
  if (step.errorCode) return `Error: ${step.errorCode}`
  if (step.key === 'message_delivery' && step.output.action === 'accepted') return 'Kommo aceptó iniciar Salesbot; entrega al teléfono sin confirmar.'
  const entries = Object.entries(step.output)
  if (!entries.length) return statusLabel(step.status)
  return entries.slice(0, 3).map(([key, value]) => `${fieldLabel(key)}: ${displayValue(value)}`).join(' · ')
}

export function workflowFromExecution(execution: WorkflowExecution): WorkflowDefinition | null {
  if (!execution.steps?.length) return null
  const steps = [...execution.steps].sort((a, b) => a.order - b.order)
  const nodes: WorkflowNode[] = steps.map((step, index) => ({
    id: `step-${step.order}`,
    type: 'workflow',
    position: { x: index * 285, y: index % 2 === 0 ? 180 : 230 },
    data: {
      title: step.key === 'message_delivery' && step.output.action === 'accepted' ? 'Aceptación de Kommo' : step.label,
      eyebrow: `${String(step.order).padStart(2, '0')} · ${statusLabel(step.status)}`,
      summary: resultSummary(step),
      kind: nodeKind(step),
      source: step.source,
      reads: Object.keys(step.input).map(fieldLabel),
      result: resultSummary(step),
      trace: true,
      traceStatus: step.status,
      durationMs: step.durationMs,
      input: step.input,
      output: step.output,
      errorCode: step.errorCode,
    },
  }))
  const edges: Edge[] = nodes.slice(1).map((node, index) => ({
    id: `execution-${index + 1}-${index + 2}`,
    source: nodes[index].id,
    target: node.id,
    type: 'smoothstep',
  }))
  return {
    label: `Ejecución de ${execution.leadName}`,
    description: `${execution.outcome}. Cada nodo corresponde a un paso registrado; los pasos ausentes no se dan por ejecutados.`,
    nodes,
    edges,
  }
}

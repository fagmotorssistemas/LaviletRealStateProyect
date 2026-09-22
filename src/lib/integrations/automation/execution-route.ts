type Row = Record<string, unknown>
type RouteStep = { order: number; key: string; status: string; output: Row; errorCode: string | null }
export type ExecutionWorkflowId = 'overview' | 'pauses' | 'visits' | 'financing' | 'nutrition'
const text = (value: unknown) => typeof value === 'string' ? value : ''

function inferredRoute(kind: string, payload: Row, result: Row, lead?: Row): { workflowId: ExecutionWorkflowId; path: string[] } {
  const action = text(result.action), source = text(result.source)
  if (kind === 'maintenance' && text(payload.task).startsWith('nutrition_')) return {
    workflowId: 'nutrition', path: ['timer', action === 'cancelled' ? 'cancel' : 'eligible'],
  }
  if (['bot_paused', 'human_attention', 'paused_before_reply', 'paused_before_salesbot'].includes(action)) return {
    workflowId: 'pauses', path: ['inbound', action === 'human_attention' ? 'human' : lead?.tracking_opt_out_at ? 'optout' : 'manual', 'pause'],
  }
  if (action === 'confirmed' || /visit|appointment|reagend|cita/.test(`${source} ${text(result.state)}`)) return {
    workflowId: 'visits', path: ['intent', action === 'confirmed' ? 'confirmed' : 'state'],
  }
  if (/financ/.test(`${source} ${text(result.state)}`)) return { workflowId: 'financing', path: ['intent', 'progress'] }
  // Legacy results do not prove that extraction, generation or review ran.
  return { workflowId: 'overview', path: ['inbound', ...(action === 'accepted' ? ['delivery'] : [])] }
}

/** Recorded steps are the only authority for an observed execution path. */
export function executionRoute(steps: RouteStep[], kind: string, payload: Row, result: Row, lead?: Row) {
  if (!steps.length) return { ...inferredRoute(kind, payload, result, lead), traceSource: 'inferred' as const,
    stopReason: text(result.reason) || null, versions: {} as Row }
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  const last = ordered.at(-1)!
  const stopped = [...ordered].reverse().find(step => step.status === 'failed' || step.status === 'paused')
  const decision = [...ordered].reverse().find(step => ['dialogue_decision', 'route_selected'].includes(step.key))
  const source = text(decision?.output.source)
  const workflowId: ExecutionWorkflowId = stopped?.key === 'response_permission' ? 'pauses'
    : ordered.some(step => step.key === 'visit_coordination' || step.key === 'visit_result') || /visit/.test(source) ? 'visits'
      : /financ/.test(source) ? 'financing'
        : kind === 'maintenance' && text(payload.task).startsWith('nutrition_') ? 'nutrition' : 'overview'
  const reasonStep = stopped || (last.key === 'execution_exit' && last.status !== 'succeeded' ? last : undefined)
  return {
    workflowId, path: ordered.map(step => `step-${step.order}`), traceSource: 'recorded' as const,
    stopReason: reasonStep ? reasonStep.errorCode || text(reasonStep.output.reason) || text(reasonStep.output.action) || reasonStep.key : null,
    versions: ordered.find(step => step.key === 'execution_version')?.output || {},
  }
}

export function executionOutcome(status: string, action: string) {
  if (status === 'uncertain') return 'Requiere revisión'
  if (status === 'pending') return 'Pendiente'
  if (status === 'processing') return 'Procesando'
  const labels: Record<string, string> = {
    accepted: 'Kommo aceptó el envío', confirmed: 'Cita confirmada', advisor_handoff: 'Derivado a asesor',
    bot_paused: 'IA detenida', human_attention: 'Atención del asesor', duplicate: 'Evento duplicado',
    cancelled: 'Cancelado', expired: 'Ventana vencida', paused_before_reply: 'Pausado antes de responder',
    paused_before_salesbot: 'Pausado antes del envío', courtesy_already_acknowledged: 'Cortesía ya atendida',
  }
  return labels[action] || action.replaceAll('_', ' ') || (status === 'completed' ? 'Completado' : status)
}

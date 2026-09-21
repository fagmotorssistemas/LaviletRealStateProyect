import 'server-only'
import { db, object, scope, text, type Row } from './data'

export type TraceCategory = 'input' | 'control' | 'context' | 'ai' | 'decision' | 'action' | 'output'
export type TraceStatus = 'succeeded' | 'paused' | 'skipped' | 'failed'

type PendingStep = {
  order: number
  key: string
  label: string
  category: TraceCategory
  source: string
  startedMs: number
  completedMs?: number
  status?: TraceStatus
  input: Row
  output: Row
  errorCode?: string
}

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

export function traceText(value: unknown, max = 360) {
  return text(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[correo protegido]')
    .replace(/(?:\+?\d[\s().-]*){10,13}/g, '[dato protegido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || '')
  return /^[A-Z0-9_]+$/.test(value) ? value.slice(0, 120) : 'PROCESSING_FAILED'
}

export class AutomationExecutionTrace {
  private steps: PendingStep[] = []
  private leadId: string | null = null
  private conversationId: string | null = null
  private readonly eventIds: string[]

  constructor(events: Row[]) {
    this.eventIds = [...new Set(events.map(event => text(event.id)).filter(id => UUID.test(id)))]
  }

  setContext(values: { leadId?: unknown; conversationId?: unknown }) {
    if (UUID.test(text(values.leadId))) this.leadId = text(values.leadId)
    if (UUID.test(text(values.conversationId))) this.conversationId = text(values.conversationId)
  }

  start(key: string, label: string, category: TraceCategory, source: string, input: Row = {}) {
    const step: PendingStep = {
      order: this.steps.length + 1,
      key,
      label,
      category,
      source,
      startedMs: Date.now(),
      input: object(input),
      output: {},
    }
    this.steps.push(step)
    return step.order
  }

  finish(order: number, status: TraceStatus, output: Row = {}, error?: unknown) {
    const step = this.steps.find(item => item.order === order)
    if (!step || step.status) return
    step.completedMs = Date.now()
    step.status = status
    step.output = object(output)
    if (error) step.errorCode = safeError(error)
  }

  add(key: string, label: string, category: TraceCategory, source: string, status: TraceStatus, input: Row = {}, output: Row = {}, error?: unknown) {
    const order = this.start(key, label, category, source, input)
    this.finish(order, status, output, error)
    return order
  }

  failOpenSteps(error: unknown) {
    for (const step of this.steps.filter(item => !item.status)) this.finish(step.order, 'failed', {}, error)
    this.add('execution_failed', 'Ejecución interrumpida', 'output', 'worker.ts', 'failed', {}, {}, error)
  }

  async flush() {
    if (!this.eventIds.length || !this.steps.length) return
    const now = Date.now()
    const rows = this.eventIds.flatMap(eventId => this.steps.map(step => ({
        ...scope,
        event_id: eventId,
        lead_id: this.leadId,
        conversation_id: this.conversationId,
        step_order: step.order,
        step_key: step.key.slice(0, 80),
        label: step.label.slice(0, 160),
        category: step.category,
        status: step.status || 'failed',
        source_module: step.source.slice(0, 240),
        started_at: new Date(step.startedMs).toISOString(),
        completed_at: new Date(step.completedMs || now).toISOString(),
        duration_ms: Math.min(600000, Math.max(0, (step.completedMs || now) - step.startedMs)),
        input_summary: step.input,
        output_summary: step.output,
        error_code: step.errorCode || null,
      })))
    try {
      await db().from('lv_automation_execution_steps').upsert(rows, { onConflict: 'event_id,step_order' })
    } catch {
      // La auditoría nunca debe impedir una respuesta al lead.
    }
  }
}

export function traceForEvents(rows: Row[]) {
  return new AutomationExecutionTrace(rows.map(object))
}

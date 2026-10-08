import 'server-only'
import { db, object, scope, text, type Row } from './data'
import { sanitizeTraceSummary, traceErrorCode } from './trace-summary'
export { traceText } from './trace-summary'

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
export const TRACE_SCHEMA_VERSION = 'lavilet-trace-v3'
export type TraceVersions = { contractVersion?: string; model?: string; promptVersions?: Record<string, string | number> }
type TraceDependencies = {
  persist: (rows: Row[]) => PromiseLike<{ error?: unknown }>
  report: (record: Row) => void
}
export type TracePersistence = { status: 'complete' | 'partial' | 'failed'; saved_steps: number; expected_steps: number; error_code?: string }
const defaults: TraceDependencies = {
  persist: rows => db().from('lv_automation_execution_steps').upsert(rows, { onConflict: 'event_id,step_order' })
    .abortSignal(AbortSignal.timeout(5000)),
  report: record => console.error(JSON.stringify(record)),
}
const versionValue = (value: unknown) => typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value) ? value : null

export class AutomationExecutionTrace {
  private steps: PendingStep[] = []
  private leadId: string | null = null
  private conversationId: string | null = null
  private readonly eventIds: string[]
  private readonly dependencies: TraceDependencies
  private saved = new Map<string, string>()

  constructor(events: Row[], dependencies: Partial<TraceDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies }
    this.eventIds = [...new Set(events.map(event => text(event.id)).filter(id => UUID.test(id)))]
    this.add('execution_version', 'Versión de la ejecución', 'context', 'execution-trace.ts', 'succeeded', {}, {
      trace_schema: TRACE_SCHEMA_VERSION,
      code_version: versionValue(process.env.VERCEL_GIT_COMMIT_SHA || process.env.AUTOMATION_CODE_VERSION),
      contract_version: null,
      model: versionValue(process.env.OPENAI_MODEL),
      prompt_versions: {},
      batch_id: this.eventIds[0] || null,
      batch_event_ids: this.eventIds,
    })
  }

  /** Only identities actually used by this turn; absence stays explicit. No prompt content. */
  setVersions(values: TraceVersions) {
    const version = this.steps.find(step => step.key === 'execution_version')!
    if (values.contractVersion) version.output.contract_version = versionValue(values.contractVersion)
    if (values.model) version.output.model = versionValue(values.model)
    const prompts = object(version.output.prompt_versions)
    for (const [name, value] of Object.entries(values.promptVersions || {})) {
      if (/^[\w.-]{1,80}$/.test(name) && (typeof value === 'number' && Number.isFinite(value) || versionValue(value))) prompts[name] = value
    }
    version.output.prompt_versions = prompts
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
      input: sanitizeTraceSummary(input),
      output: {},
    }
    this.steps.push(step)
    return step.order
  }

  currentStep() {
    return [...this.steps].reverse().find(step => !step.status)?.order
  }

  finish(order: number, status: TraceStatus, output: Row = {}, error?: unknown) {
    const step = this.steps.find(item => item.order === order)
    if (!step || step.status) return
    step.completedMs = Date.now()
    step.status = status
    step.output = sanitizeTraceSummary(output)
    if (error) step.errorCode = traceErrorCode(error)
  }

  add(key: string, label: string, category: TraceCategory, source: string, status: TraceStatus, input: Row = {}, output: Row = {}, error?: unknown) {
    const order = this.start(key, label, category, source, input)
    this.finish(order, status, output, error)
    return order
  }

  failOpenSteps(error: unknown) {
    const interpretationFailure = traceErrorCode(error) === 'TURN_INTERPRETATION_INVALID'
    const pendingInterpretation = this.steps.find(step => step.key === 'semantic_extraction' && !step.status)
    const calls = pendingInterpretation ? this.steps.filter(step => step.key === 'model_request'
      && step.input.caused_by_step === pendingInterpretation.order
      && ['extractor', 'interpretation'].includes(text(step.input.ai_role))).length : 0
    // Only machine control identifiers are retained. Never serialize an error,
    // a provider body, the customer's quotation or arbitrary issue prose.
    const rawIssues = error && typeof error === 'object' ? (error as { issues?: unknown }).issues : null
    const issues = Array.isArray(rawIssues) ? rawIssues.filter((issue): issue is string => typeof issue === 'string'
      && /^[a-z][a-z0-9_.:-]{0,119}$/.test(issue)).slice(0, 40) : []
    const diagnostic = interpretationFailure ? { interpretation_validation: {
      version: 'interpretation-validation-v1', status: 'invalid', issues,
      ...(calls ? { extractor_calls: calls, attempted_repair: calls > 1 } : {}),
      events_accepted: false,
    } } : {}
    for (const step of this.steps.filter(item => !item.status)) this.finish(step.order, 'failed',
      step.key === 'semantic_extraction' ? diagnostic : {}, error)
    this.add('execution_failed', 'Ejecución interrumpida', 'output', 'worker.ts', 'failed', {}, diagnostic, error)
  }

  async flush(final = true): Promise<TracePersistence> {
    if (!this.eventIds.length || !this.steps.length) return { status: 'complete', saved_steps: 0, expected_steps: 0 }
    const now = Date.now()
    const rows = this.eventIds.flatMap(eventId => this.steps.filter(step => final || step.status).map(step => ({
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
        input_summary: sanitizeTraceSummary(step.input),
        output_summary: sanitizeTraceSummary(step.output),
        error_code: step.errorCode || (!step.status ? 'TRACE_STEP_NOT_FINISHED' : null),
      })))
    const key = (row: Row) => `${row.event_id}:${row.step_order}`
    // Bound each write so one large model snapshot cannot make every other
    // batch invisible. Upserts make checkpoints and retries idempotent.
    const dirty = rows.filter(row => this.saved.get(key(row)) !== JSON.stringify(row))
    const batches: Row[][] = []
    let batch: Row[] = [], bytes = 0
    for (const row of dirty) {
      const size = Buffer.byteLength(JSON.stringify(row))
      if (batch.length && bytes + size > 200_000) { batches.push(batch); batch = []; bytes = 0 }
      batch.push(row); bytes += size
    }
    if (batch.length) batches.push(batch)
    let failure: string | undefined
    for (const chunk of batches) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await this.dependencies.persist(chunk)
          if (result.error) throw result.error
          chunk.forEach(row => this.saved.set(key(row), JSON.stringify(row)))
          break
        } catch (error) {
          const code = traceErrorCode(error)
          const permanent = /^(?:22|23|42|PGRST)/.test(code)
          if (!attempt && !permanent) continue
          failure = code
          break
        }
      }
    }
    const savedSteps = rows.filter(row => this.saved.get(key(row)) === JSON.stringify(row)).length
    const result: TracePersistence = { status: savedSteps === rows.length ? 'complete' : savedSteps ? 'partial' : 'failed',
      saved_steps: savedSteps, expected_steps: rows.length, ...(failure ? { error_code: failure } : {}) }
    if (failure) try { this.dependencies.report({ event: 'AUTOMATION_TRACE_FLUSH_FAILED', code: failure,
      event_ids: this.eventIds, ...result }) } catch { /* Never replay a delivery for an audit failure. */ }
    return result
  }
}

export function traceForEvents(rows: Row[]) {
  return new AutomationExecutionTrace(rows.map(object))
}

import type { WorkflowExecutionStep } from './executionWorkflow'
import { executionCost } from './executionCost'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}

export type ResponseAttempt = {
  number: number
  reply: string | null
  writerStep: number | null
  writerCost: ReturnType<typeof executionCost> | null
  reviews: { step: number; result: unknown; cost: ReturnType<typeof executionCost> }[]
  systemResult: { status: string; issues: unknown } | null
}

/** Only calls owned by this response-coverage step belong to its attempt history. */
export function responseAttempts(steps: WorkflowExecutionStep[], coverage: WorkflowExecutionStep): ResponseAttempt[] {
  if (coverage.key !== 'response_coverage') return []
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  const nextBoundary = ordered.find(step => step.order > coverage.order
    && ['response_coverage', 'route_selected', 'response_validation', 'message_delivery'].includes(step.key))?.order ?? Infinity
  const calls = ordered.filter(step => step.key === 'model_request' && step.order > coverage.order && step.order < nextBoundary
    && step.input.caused_by_step === coverage.order)
  const attempts: ResponseAttempt[] = []
  for (const call of calls) {
    const role = call.input.ai_role
    const result = record(record(call.output.output_snapshot).data)
    if (role === 'writer') {
      attempts.push({ number: attempts.length + 1, reply: typeof result.reply === 'string' ? result.reply : null,
        writerStep: call.order, writerCost: executionCost([call]), reviews: [], systemResult: null })
    } else if (role === 'reviewer') {
      const current = attempts.at(-1)
      if (current) current.reviews.push({ step: call.order, result: Object.keys(result).length ? result : null, cost: executionCost([call]) })
    }
  }
  const repairs = Array.isArray(coverage.output.repair_attempts) ? coverage.output.repair_attempts.map(record) : []
  for (const attempt of attempts.slice(0, -1)) {
    const repair = repairs.find(item => item.target === 'commercial_draft'
      && typeof item.proposed_preview === 'string' && !!attempt.reply
      && (attempt.reply.startsWith(item.proposed_preview) || item.proposed_preview.startsWith(attempt.reply)))
    if (repair) attempt.systemResult = { status: String(repair.status || 'No registrado'), issues: repair.issues }
  }
  const last = attempts.at(-1)
  if (last) last.systemResult = { status: String(coverage.output.status || 'No registrado'), issues: coverage.output.issues }
  return attempts
}

import type { WorkflowExecution } from './executionWorkflow'

const timestamp = (value?: string) => value ? Date.parse(value) : NaN
const delta = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null

/** Use wall-clock endpoints: trace containers overlap model calls, so adding
 * their durations would count the same processing time twice. */
export function executionTiming(execution: WorkflowExecution) {
  const received = timestamp(execution.receivedAt)
  const starts = execution.steps.map(s => timestamp(s.startedAt)).filter(Number.isFinite)
  const start = starts.length ? Math.min(...starts) : NaN
  const delivery = execution.steps.filter(s => s.key === 'message_delivery' && s.status === 'succeeded')
    .sort((a, b) => timestamp(a.completedAt) - timestamp(b.completedAt))[0]
  const end = delivery ? timestamp(delivery.completedAt) : timestamp(execution.occurredAt)
  return { responseMs: delivery ? delta(received, end) : null,
    elapsedMs: delta(received, end), processingMs: delta(start, end), waitingMs: delta(received, start),
    sent: !!delivery }
}

export function durationLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'Sin dato'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  return seconds < 60 ? `${seconds.toLocaleString('es-EC', { maximumFractionDigits: 1 })} s`
    : `${Math.floor(seconds / 60)} min ${(seconds % 60).toLocaleString('es-EC', { maximumFractionDigits: 1 })} s`
}

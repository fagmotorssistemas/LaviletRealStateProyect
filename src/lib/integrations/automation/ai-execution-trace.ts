import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { AutomationExecutionTrace } from './execution-trace'

type Context = { trace: AutomationExecutionTrace; calls: number }
const active = new AsyncLocalStorage<Context>()

export function withAIExecutionTrace<T>(trace: AutomationExecutionTrace, work: () => Promise<T>) {
  return active.run({ trace, calls: 0 }, work)
}

/** Capture the exact composed instructions actually sent, by hash only. */
export function beginModelTrace(instructions: string, model: string, task: string) {
  const context = active.getStore()
  if (!context) return { finish: (_error?: unknown) => { void _error } }
  const revision = createHash('sha256').update(instructions).digest('hex').slice(0, 16)
  const purpose = task === 'writing' ? 'Redactar con IA' : task === 'review' ? 'Revisar con IA' : 'Interpretar con IA'
  const parent = context.trace.currentStep()
  context.trace.setVersions({ model, promptVersions: { [`${task}_${++context.calls}`]: revision } })
  const order = context.trace.start('model_request', purpose, 'ai', 'ai.ts', {
    task, model, prompt_revision: revision, ...(parent ? { caused_by_step: parent } : {}),
  })
  return { finish: (error?: unknown) => context.trace.finish(order, error ? 'failed' : 'succeeded', {
    model, prompt_revision: revision, task, result: error ? 'failed' : 'structured_result_received',
  }, error) }
}

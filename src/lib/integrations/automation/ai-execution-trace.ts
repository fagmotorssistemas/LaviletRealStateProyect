import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { AutomationExecutionTrace } from './execution-trace'

type Context = { trace: AutomationExecutionTrace; calls: number }
type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
const active = new AsyncLocalStorage<Context>()

export function withAIExecutionTrace<T>(trace: AutomationExecutionTrace, work: () => Promise<T>) {
  return active.run({ trace, calls: 0 }, work)
}

/** Hash actual composed instructions; retain protected writer inputs for diagnosis. */
export function beginModelTrace(instructions: string, model: string, task: string, input?: unknown, schema?: unknown) {
  const context = active.getStore()
  if (!context) return { finish: (_error?: unknown, _usage?: Usage) => { void _error; void _usage } }
  const revision = createHash('sha256').update(instructions).digest('hex').slice(0, 16)
  const purpose = task === 'writing' ? 'Redactar con IA' : task === 'review' ? 'Revisar con IA' : 'Interpretar con IA'
  const parent = context.trace.currentStep()
  context.trace.setVersions({ model, promptVersions: { [`${task}_${++context.calls}`]: revision } })
  const order = context.trace.start('model_request', purpose, 'ai', 'ai.ts', {
    task, model, prompt_revision: revision, ...(parent ? { caused_by_step: parent } : {}),
    ...(task === 'writing' ? { prompt_snapshot: { instructions, user_prefix: 'Responda en JSON. Datos de entrada:\n', data: input, response_schema: schema } } : {}),
  })
  return { finish: (error?: unknown, usage?: Usage) => context.trace.finish(order, error ? 'failed' : 'succeeded', {
    model, prompt_revision: revision, task, result: error ? 'failed' : 'structured_result_received',
    ...(usage ? { token_usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null, total_tokens: usage.total_tokens ?? null, cached_input_tokens: usage.input_tokens_details?.cached_tokens ?? null } } : {}),
  }, error) }
}

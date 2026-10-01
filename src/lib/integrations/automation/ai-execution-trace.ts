import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { AutomationExecutionTrace } from './execution-trace'
import { aiRequestRole, type ReviewReasoningEffort } from './ai-model-routing'
import type { ModelResponseDiagnostics } from './ai-output'
import type { OpenAIRequestDiagnostics } from './openai-request'

type Context = { trace: AutomationExecutionTrace; calls: number; deadlineAt: number; guard?: () => Promise<void> }
type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } }
const active = new AsyncLocalStorage<Context>()

export function recordDraftDecision(reply: string, attempt: number, approved: boolean, review: unknown, codeIssues: string[]) {
  const context = active.getStore()
  if (!context) return
  context.trace.add('draft_validation', 'Aceptar o rechazar el borrador comercial', 'decision', 'sdr.ts', 'succeeded', {}, {
    output_snapshot: { data: { borrador_evaluado: reply, intento: attempt + 1,
      decision: approved ? 'Aceptado para continuar' : 'Rechazado',
      siguiente_accion: approved ? 'Continuar con la respuesta' : attempt === 0 ? 'Solicitar una corrección' : 'Usar respuesta de respaldo',
      revision_ia: review, controles_codigo: codeIssues } },
  })
}

export function withAIExecutionTrace<T>(trace: AutomationExecutionTrace, work: () => Promise<T>, guard?: () => Promise<void>, deadlineAt = Date.now() + 240_000) {
  // The route allows 300 seconds. Leave time for persistence, delivery checks
  // and advisor recovery even if several reviews need their entire budget.
  return active.run({ trace, calls: 0, deadlineAt, guard }, work)
}

export function aiExecutionRequestOptions() {
  const context = active.getStore()
  return context ? { deadlineAt: context.deadlineAt, beforeAttempt: context.guard } : {}
}

/** Hash actual composed instructions; retain protected writer inputs for diagnosis. */
export function beginModelTrace(instructions: string, model: string, task: string, input?: unknown, schema?: unknown, attachments = false, outputBudget?: number, reasoningEffort?: ReviewReasoningEffort) {
  const context = active.getStore()
  if (!context) return { finish: (_error?: unknown, _usage?: Usage, _result?: unknown, _diagnostics?: ModelResponseDiagnostics, _transport?: OpenAIRequestDiagnostics) => { void _error; void _usage; void _result; void _diagnostics; void _transport } }
  const role = aiRequestRole(schema, task, attachments)
  const revision = createHash('sha256').update(instructions).digest('hex').slice(0, 16)
  const purpose = task === 'writing' ? 'Redactar con IA' : task === 'review' ? 'Revisar con IA' : 'Interpretar con IA'
  const parent = context.trace.currentStep()
  context.trace.setVersions({ model, promptVersions: { [`${task}_${++context.calls}`]: revision } })
  const order = context.trace.start('model_request', purpose, 'ai', 'ai.ts', {
    task, ai_role: role, model, attachments_omitted: attachments, prompt_revision: revision, ...(parent ? { caused_by_step: parent } : {}),
    ...(outputBudget !== undefined ? { configured_max_output_tokens: outputBudget } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    prompt_snapshot: { instructions, user_prefix: 'Responda en JSON. Datos de entrada:\n', data: input, response_schema: schema },
  })
  return { finish: (error?: unknown, usage?: Usage, result?: unknown, diagnostics?: ModelResponseDiagnostics, transport?: OpenAIRequestDiagnostics) => context.trace.finish(order, error ? 'failed' : 'succeeded', {
    model, prompt_revision: revision, task, result: error ? 'failed' : 'structured_result_received',
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(result !== undefined ? { output_snapshot: { data: result } } : {}),
    ...(diagnostics ? { provider_diagnostics: diagnostics } : {}),
    ...(transport ? { request_diagnostics: transport } : {}),
    ...(usage ? { token_usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null,
      total_tokens: usage.total_tokens ?? null, cached_input_tokens: usage.input_tokens_details?.cached_tokens ?? null,
      ...(usage.output_tokens_details?.reasoning_tokens !== undefined ? { reasoning_tokens: usage.output_tokens_details.reasoning_tokens } : {}) } } : {}),
  }, error) }
}

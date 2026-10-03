import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { AutomationExecutionTrace } from './execution-trace'
import { aiRequestRole, type ReviewReasoningEffort } from './ai-model-routing'
import type { ModelResponseDiagnostics } from './ai-output'
import type { OpenAIRequestDiagnostics } from './openai-request'
import { AI_USER_PREFIX } from './ai-request-body'
import { promptCostComparison } from './prompt-cost-comparison'
import { object } from './data'

type Context = { trace: AutomationExecutionTrace; calls: number; deadlineAt: number; guard?: () => Promise<void> }
type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } }
const active = new AsyncLocalStorage<Context>()

export function recordCatalogRetrieval(result: Record<string, unknown>) {
  active.getStore()?.trace.add('catalog_embedding_search', 'Búsqueda de unidades por embeddings', 'decision',
    'catalog-embeddings.ts', result.applied === true ? 'succeeded' : 'skipped', { enabled: result.enabled }, result)
}

/** Diagnostic only: records an already computed decision, never evaluates or
 * changes business rules. The parent links it to the response being prepared. */
export function recordBudgetDecision(assessment: Record<string, unknown>) {
  const trace = active.getStore()?.trace
  if (!trace) return
  const parent = trace.currentStep()
  trace.add('budget_resolution', 'Comparar presupuesto con precios autorizados', 'decision', 'turn-budget.ts', 'succeeded',
    { ...(parent ? { caused_by_step: parent } : {}), amount: assessment.amount, currency: assessment.currency },
    { status: assessment.status, scope: assessment.scope, price_evidence_complete: assessment.price_evidence_complete,
      candidate_unit_ids: assessment.candidate_unit_ids, matching_unit_ids: assessment.matching_unit_ids, minimum_price: assessment.minimum_price })
}

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
  const comparison = attachments ? null : promptCostComparison(instructions, input, schema)
  const data = object(input), verified = object(data.contexto_verificado), state = object(data.estado_del_turno)
  const catalogMode = object(verified.catalog_context_scope).kind === 'semantic_candidates'
    || object(state.alcance_catalogo).kind === 'semantic_candidates' ? 'semantic_candidates'
    : data.contexto_verificado || data.fuentes_autorizadas ? 'current_catalog' : 'not_applicable'
  const order = context.trace.start('model_request', purpose, 'ai', 'ai.ts', {
    task, ai_role: role, model, attachments_omitted: attachments, prompt_revision: revision, ...(parent ? { caused_by_step: parent } : {}),
    ...(comparison ? { context_cost_comparison: comparison } : {}),
    catalog_context_mode: catalogMode,
    ...(outputBudget !== undefined ? { configured_max_output_tokens: outputBudget } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    prompt_snapshot: { capture_version: 2, instructions, user_prefix: AI_USER_PREFIX,
      data: JSON.parse(JSON.stringify(input ?? null)), response_schema: schema ? JSON.parse(JSON.stringify(schema)) : null,
      request_parameters: { model, max_output_tokens: outputBudget, reasoning_effort: reasoningEffort || null } },
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

import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { executionCost, tokens } from './executionCost'

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const isCostStep = (s: WorkflowExecutionStep) => s.key === 'model_request' || s.key === 'catalog_embedding_search'
export function callCatalogMode(step: WorkflowExecutionStep) {
  if (step.input.catalog_context_mode === 'task_context') return 'Contexto reducido por consulta'
  if (step.input.catalog_context_mode === 'optimized_exact') return 'Consulta exacta reducida'
  if (step.input.catalog_context_mode === 'optimized_embeddings') return 'Con embeddings'
  if (step.key === 'catalog_embedding_search') return step.output.applied === true ? 'Consulta aplicada' : 'Consulta no aplicada'
  if (step.input.catalog_context_mode === 'semantic_candidates') return 'Con embeddings'
  if (step.input.catalog_context_mode === 'current_catalog') return 'Recorrido normal'
  const data = obj(obj(step.input.prompt_snapshot).data)
  const verified = obj(data.contexto_verificado), state = obj(data.estado_del_turno)
  const scope = obj(verified.catalog_context_scope).kind ? obj(verified.catalog_context_scope) : obj(state.alcance_catalogo)
  if (scope.kind === 'optimized_catalog') return scope.method === 'structured_catalog_and_embeddings' ? 'Con embeddings' : 'Consulta exacta reducida'
  if (obj(verified.prompt_context_selection).mode === 'semantic_candidates'
    || obj(verified.catalog_context_scope).kind === 'semantic_candidates'
    || obj(state.alcance_catalogo).kind === 'semantic_candidates') return 'Con embeddings'
  if (obj(verified.prompt_context_selection).version === 'task-context-v1'
    || obj(state.seleccion_contexto).version === 'task-context-v1') return 'Contexto reducido por consulta'
  if (data.contexto_verificado || data.fuentes_autorizadas) return 'Recorrido normal'
  return 'Sin selección de catálogo registrada'
}

export function executionCatalogMode(execution: WorkflowExecution) {
  const retrieval = execution.steps.find(s => s.key === 'catalog_embedding_search')
  if (retrieval?.output.applied === true) return 'Con embeddings'
  if (retrieval?.output.optimized === true) return 'Consulta exacta reducida'
  if (execution.steps.some(s => callCatalogMode(s) === 'Contexto reducido por consulta')) return 'Contexto reducido por consulta'
  if (execution.steps.some(s => callCatalogMode(s) === 'Consulta exacta reducida')) return 'Consulta exacta reducida'
  if (execution.steps.some(s => callCatalogMode(s) === 'Con embeddings')) return 'Con embeddings'
  if (execution.steps.some(s => callCatalogMode(s) === 'Recorrido normal')) return 'Recorrido normal'
  return 'Sin registro'
}

/** Character ratio calibrated with this call's real provider usage. It is NOT
 * tokenization nor a prediction of alternate output, retries, or cache hits. */
export function normalCallEstimate(step: WorkflowExecutionStep) {
  const comparison = obj(step.input.context_cost_comparison)
  const actualSize = tokens(comparison.actual_prompt_characters), normalSize = tokens(comparison.normal_prompt_characters)
  const usage = obj(step.output.token_usage), input = tokens(usage.input_tokens), output = tokens(usage.output_tokens)
  const cached = tokens(usage.cached_input_tokens)
  if (comparison.version !== 'context-size-v1' || !actualSize || !normalSize || !input
    || output === null || cached === null || cached > input) return null
  const normalInput = Math.ceil(input * normalSize / actualSize)
  const price = (cache: number) => executionCost([{ ...step,
    output: { ...step.output, token_usage: { input_tokens: normalInput, cached_input_tokens: cache, output_tokens: output } } }])
  const cost = price(Math.min(normalInput, Math.round(normalInput * cached / input)))
  if (!cost.complete) return null
  return { inputTokens: normalInput, totalTokens: normalInput + output, outputTokens: output,
    cost, noCacheUsd: price(0).estimatedUsd, allCachedUsd: price(normalInput).estimatedUsd,
    tokenDifference: normalInput - input, actualCharacters: actualSize, normalCharacters: normalSize }
}

export function normalExecutionEstimate(execution: WorkflowExecution) {
  if (!['Con embeddings', 'Consulta exacta reducida'].includes(executionCatalogMode(execution))) return null
  let totalTokens = 0, usd = 0, changed = 0
  for (const step of execution.steps.filter(s => s.key === 'model_request')) {
    const estimate = normalCallEstimate(step), actual = executionCost([step])
    if ((['Con embeddings', 'Consulta exacta reducida'].includes(callCatalogMode(step)) && !estimate) || !actual.complete) return null
    totalTokens += estimate?.totalTokens ?? actual.totalTokens
    usd += estimate?.cost.estimatedUsd ?? actual.estimatedUsd
    if (estimate) changed++
  }
  return changed ? { totalTokens, usd, changed } : null
}

export function comparisonCandidates(execution: WorkflowExecution, executions: WorkflowExecution[]) {
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const currentBatch = execution.batchId || execution.id
  const unique = new Map<string, WorkflowExecution>()
  for (const item of executions) {
    const batch = item.batchId || item.id
    if (item.id === execution.id || batch === currentBatch || !item.steps.some(isCostStep)) continue
    if ((unique.get(batch)?.steps.length || 0) < item.steps.length) unique.set(batch, item)
  }
  return [...unique.values()].map(item => ({ execution: item,
    sameMessage: !!execution.message.trim() && normalize(item.message) === normalize(execution.message) }))
    .sort((a, b) => Number(b.sameMessage) - Number(a.sameMessage)
      || (b.execution.receivedAt || b.execution.occurredAt).localeCompare(a.execution.receivedAt || a.execution.occurredAt))
}

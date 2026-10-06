import type { WorkflowExecutionStep } from './executionWorkflow'

// USD per million tokens. Keep this dated snapshot stable for historical estimates.
const PRICE_VERSION = '2026-09-29'
const prices: Record<string, { input: number; cached: number; output: number; version?: string; source?: string }> = {
  'text-embedding-3-small': { input: 0.02, cached: 0.02, output: 0, version: '2026-10-03',
    source: 'https://developers.openai.com/api/docs/models/text-embedding-3-small' },
  'gpt-4.1': { input: 2, cached: 0.5, output: 8 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6, version: '2026-09-30',
    source: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2, version: '2026-09-30',
    source: 'https://developers.openai.com/api/docs/models/gpt-5-mini' },
}

export const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

export const promptCharacterFields = ['instructions', 'context', 'schema', 'user_prefix', 'total'] as const
type PromptCharacterField = typeof promptCharacterFields[number]
export type PromptCharacters = Record<PromptCharacterField, number | null>

/** Use the measurement made before privacy filtering. A protected or limited
 * snapshot cannot reconstruct the size of the request actually sent. */
export function promptCharacters(step: Pick<WorkflowExecutionStep, 'key' | 'input'>): PromptCharacters | null {
  if (step.key !== 'model_request') return null
  const size = step.input.prompt_size as Record<string, unknown> | undefined
  const result = Object.fromEntries(promptCharacterFields.map(key => [key,
    size?.unit === 'characters' ? tokens(size[key]) : null])) as PromptCharacters
  const parts = promptCharacterFields.filter(key => key !== 'total').map(key => result[key])
  if (parts.every(value => value !== null) && result.total !== null
    && parts.reduce((sum: number, value) => sum + (value ?? 0), 0) !== result.total) result.total = null
  return result
}

/** Compare the same recorded metric across every call, including rewrites.
 * Missing measurements make that field unavailable instead of a partial sum. */
export function sumPromptCharacters(steps: Pick<WorkflowExecutionStep, 'key' | 'input'>[]): PromptCharacters | null {
  const sizes = steps.map(promptCharacters).filter((size): size is PromptCharacters => size !== null)
  if (!sizes.length) return null
  return Object.fromEntries(promptCharacterFields.map(key => [key,
    sizes.every(size => size[key] !== null) ? sizes.reduce((sum, size) => sum + size[key]!, 0) : null])) as PromptCharacters
}

const modelName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === 'text-embedding-3-small') return name
  if (name === 'gpt-4.1' || /^gpt-4\.1-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-4.1'
  if (name === 'gpt-4.1-mini' || /^gpt-4\.1-mini-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-4.1-mini'
  if (name === 'gpt-5-mini' || /^gpt-5-mini-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-5-mini'
  if (name === 'gpt-4o-mini' || /^gpt-4o-mini-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-4o-mini'
  return null
}

export function executionCost(steps: Pick<WorkflowExecutionStep, 'key' | 'input' | 'output'>[]) {
  let calls = 0, measuredCalls = 0, pricedCalls = 0
  let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, estimatedUsd = 0
  let inputUsd = 0, cachedUsd = 0, outputUsd = 0, embeddingTokens = 0, embeddingUsd = 0
  let unmeasuredTransportAttempts = 0
  const priceSnapshots = new Map<string, { model: string; version: string; source: string | null }>()
  for (const step of steps) {
    const embedding = step.key === 'catalog_embedding_search'
    if (step.key !== 'model_request' && !embedding) continue
    // A bypass without a remote request is not a billed call. A successful
    // embedding followed by failed retrieval still consumed embedding tokens.
    const unknownEmbeddingUsage = embedding && step.output.embedding_requested === true && step.output.embedding_usage_recorded !== true
    if (embedding && step.output.embedding_input_tokens === 0 && !unknownEmbeddingUsage) continue
    calls++
    const transport = step.output.request_diagnostics as { attempts?: { outcome?: string }[] } | undefined
    if (!embedding && Array.isArray(transport?.attempts)) {
      // A timed-out earlier request may have reached the provider. Its usage is
      // unavailable; the final successful response does not measure that attempt.
      unmeasuredTransportAttempts += transport.attempts.slice(0, -1)
        .filter(attempt => ['timeout', 'network', 'invalid_response'].includes(attempt.outcome || '')).length
    }
    const usage = step.output.token_usage as Record<string, unknown> | undefined
    const input = unknownEmbeddingUsage ? null : tokens(embedding ? step.output.embedding_input_tokens : usage?.input_tokens), output = embedding ? 0 : tokens(usage?.output_tokens)
    if (input === null || output === null) continue
    measuredCalls++
    inputTokens += input
    outputTokens += output
    if (embedding) embeddingTokens += input
    const cached = embedding ? 0 : tokens(usage?.cached_input_tokens)
    if (cached !== null && cached <= input) cachedInputTokens += cached
    const model = modelName(embedding ? step.output.model : step.output.model || step.input.model), rate = prices[model || '']
    if (!rate || cached === null || cached > input) continue
    pricedCalls++
    priceSnapshots.set(model!, { model: model!, version: rate.version || PRICE_VERSION, source: rate.source || null })
    const uncachedCost = (input - cached) * rate.input / 1_000_000
    const cacheCost = cached * rate.cached / 1_000_000, resultCost = output * rate.output / 1_000_000
    inputUsd += uncachedCost; cachedUsd += cacheCost; outputUsd += resultCost
    estimatedUsd += uncachedCost + cacheCost + resultCost
    if (embedding) embeddingUsd += uncachedCost
  }
  return { calls, measuredCalls, pricedCalls, inputTokens, cachedInputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens, estimatedUsd, inputUsd, cachedUsd, outputUsd, embeddingTokens, embeddingUsd, unmeasuredTransportAttempts,
    priceVersion: [...new Set([...priceSnapshots.values()].map(snapshot => snapshot.version))].sort().join(' y ') || PRICE_VERSION,
    priceSnapshots: [...priceSnapshots.values()],
    complete: calls === measuredCalls && calls === pricedCalls && unmeasuredTransportAttempts === 0 }
}

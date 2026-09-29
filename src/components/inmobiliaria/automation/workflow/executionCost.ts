import type { WorkflowExecutionStep } from './executionWorkflow'

// USD per million tokens. Keep this dated snapshot stable for historical estimates.
const PRICE_VERSION = '2026-09-29'
const prices: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-4.1': { input: 2, cached: 0.5, output: 8 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
}

const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const modelName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === 'gpt-4.1' || /^gpt-4\.1-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-4.1'
  if (name === 'gpt-4o-mini' || /^gpt-4o-mini-\d{4}-\d{2}-\d{2}$/.test(name)) return 'gpt-4o-mini'
  return null
}

export function executionCost(steps: Pick<WorkflowExecutionStep, 'key' | 'input' | 'output'>[]) {
  let calls = 0, measuredCalls = 0, pricedCalls = 0
  let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, estimatedUsd = 0
  for (const step of steps) {
    if (step.key !== 'model_request') continue
    calls++
    const usage = step.output.token_usage as Record<string, unknown> | undefined
    const input = tokens(usage?.input_tokens), output = tokens(usage?.output_tokens)
    if (input === null || output === null) continue
    measuredCalls++
    inputTokens += input
    outputTokens += output
    const cached = tokens(usage?.cached_input_tokens)
    if (cached !== null && cached <= input) cachedInputTokens += cached
    const rate = prices[modelName(step.input.model) || '']
    if (!rate || cached === null || cached > input) continue
    pricedCalls++
    estimatedUsd += ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1_000_000
  }
  return { calls, measuredCalls, pricedCalls, inputTokens, cachedInputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens, estimatedUsd, priceVersion: PRICE_VERSION,
    complete: calls === measuredCalls && calls === pricedCalls }
}

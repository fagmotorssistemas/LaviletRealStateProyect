import { AsyncLocalStorage } from 'node:async_hooks'
import { AI_USER_PREFIX } from './ai-request-body'
import { SEMANTIC_OPENING_RULE } from './semantic-catalog-context'

const baseline = new AsyncLocalStorage<{ data: unknown; rules?: { actual: string; normal: string } }>()

/** Observability only. Never sends the alternate context to a model. */
export function withPromptCostComparison<T>(data: unknown, work: () => T, rules?: { actual: string; normal: string }): T {
  return baseline.run({ data, rules }, work)
}

export function promptCostComparison(instructions: string, input: unknown, schema: unknown) {
  const normal = baseline.getStore()
  if (!normal) return null
  const size = (rules: string, data: unknown) => rules.length + AI_USER_PREFIX.length
    + JSON.stringify(data ?? null).length + JSON.stringify(schema ?? null).length
  return {
    version: 'context-size-v1', method: 'characters_calibrated_by_actual_input_tokens',
    actual_prompt_characters: size(instructions, input),
    normal_prompt_characters: size((normal.rules ? instructions.replace(normal.rules.actual, normal.rules.normal) : instructions).replace(SEMANTIC_OPENING_RULE, ''), normal.data),
    scope: 'expanded_context_same_draft_and_calls',
  }
}

export type AIRequestRole = 'media' | 'scope' | 'extractor' | 'reviewer' | 'writer' | 'draft' | 'interpretation'

export function aiRequestRole(schema: unknown, task: string, attachments: boolean): AIRequestRole {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties || {}
  return attachments ? 'media' : properties.property_fragments ? 'scope' : properties.turn_semantics ? 'extractor'
    : task === 'review' ? 'reviewer' : properties.requests && properties.question ? 'writer'
      : task === 'writing' ? 'draft' : 'interpretation'
}

/** Role-specific defaults leave writer/extractor configuration and rollbacks independent. */
export function automationModelForRole(role: AIRequestRole, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (role === 'scope') return env.OPENAI_MODEL_SCOPE?.trim() || 'gpt-4o-mini'
  if (role === 'reviewer') return env.OPENAI_MODEL_REVIEWER?.trim() || 'gpt-5-mini'
  return env.OPENAI_MODEL?.trim() || undefined
}

export type ReviewReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

/** Reasoning controls apply only to the evaluated reviewer family. Do not send
 * unsupported parameters after a model override or change other agents. */
export function automationReasoningEffortForRole(role: AIRequestRole, model: string,
  env: NodeJS.ProcessEnv = process.env): ReviewReasoningEffort | undefined {
  if (role !== 'reviewer' || !/^gpt-5-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return undefined
  const configured = env.OPENAI_REVIEW_REASONING_EFFORT?.trim().toLowerCase() || 'low'
  if (!['minimal', 'low', 'medium', 'high'].includes(configured)) throw new Error('OPENAI_REVIEW_REASONING_EFFORT_INVALID')
  return configured as ReviewReasoningEffort
}

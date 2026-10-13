export type AIRequestRole = 'media' | 'scope' | 'extractor' | 'reviewer' | 'writer' | 'draft' | 'interpretation'

export function aiRequestRole(schema: unknown, task: string, attachments: boolean): AIRequestRole {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties || {}
  return attachments ? 'media' : properties.property_fragments ? 'scope' : properties.turn_semantics ? 'extractor'
    : task === 'review' ? 'reviewer' : properties.requests && properties.question ? 'writer'
      : task === 'writing' ? 'draft' : 'interpretation'
}

/** Each evaluated role can change or roll back without changing media interpretation. */
export function automationModelForRole(role: AIRequestRole, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (role === 'scope') return env.OPENAI_MODEL_SCOPE?.trim() || 'gpt-4o-mini'
  if (role === 'reviewer') return env.OPENAI_MODEL_REVIEWER?.trim() || 'gpt-5-mini'
  if (role === 'extractor') return env.OPENAI_MODEL_EXTRACTOR?.trim() || 'gpt-6-luna'
  if (role === 'writer' || role === 'draft') return env.OPENAI_MODEL_WRITER?.trim() || 'gpt-6-luna'
  return env.OPENAI_MODEL?.trim() || undefined
}

export type ReviewReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
export type ExtractorReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WriterReasoningEffort = ExtractorReasoningEffort
export type AIReasoningEffort = ReviewReasoningEffort | ExtractorReasoningEffort

/** Each role's reasoning controls apply only to its supported model family.
 * Luna extraction and writing start at low to avoid the provider's medium default. */
export function automationReasoningEffortForRole(role: AIRequestRole, model: string,
  env: NodeJS.ProcessEnv = process.env): AIReasoningEffort | undefined {
  if (role === 'extractor' && model === 'gpt-6-luna') {
    const configured = env.OPENAI_EXTRACTOR_REASONING_EFFORT?.trim().toLowerCase() || 'low'
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(configured)) throw new Error('OPENAI_EXTRACTOR_REASONING_EFFORT_INVALID')
    return configured as ExtractorReasoningEffort
  }
  if ((role === 'writer' || role === 'draft') && model === 'gpt-6-luna') {
    const configured = env.OPENAI_WRITER_REASONING_EFFORT?.trim().toLowerCase() || 'low'
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(configured)) throw new Error('OPENAI_WRITER_REASONING_EFFORT_INVALID')
    return configured as WriterReasoningEffort
  }
  if (role !== 'reviewer' || !/^gpt-5-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return undefined
  const configured = env.OPENAI_REVIEW_REASONING_EFFORT?.trim().toLowerCase() || 'low'
  if (!['minimal', 'low', 'medium', 'high'].includes(configured)) throw new Error('OPENAI_REVIEW_REASONING_EFFORT_INVALID')
  return configured as ReviewReasoningEffort
}

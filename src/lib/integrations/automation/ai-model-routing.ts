export type AIRequestRole = 'media' | 'scope' | 'extractor' | 'reviewer' | 'writer' | 'draft' | 'interpretation'

export function aiRequestRole(schema: unknown, task: string, attachments: boolean): AIRequestRole {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties || {}
  return attachments ? 'media' : properties.property_fragments ? 'scope' : properties.turn_semantics ? 'extractor'
    : task === 'review' ? 'reviewer' : properties.requests && properties.question ? 'writer'
      : task === 'writing' ? 'draft' : 'interpretation'
}

/** Roles can change independently; audio transcription uses its own endpoint/model. */
export function automationModelForRole(role: AIRequestRole, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (role === 'scope') return env.OPENAI_MODEL_SCOPE?.trim() || 'gpt-6-luna'
  if (role === 'media') return env.OPENAI_MODEL_MEDIA?.trim() || 'gpt-6-luna'
  if (role === 'reviewer') return env.OPENAI_MODEL_REVIEWER?.trim() || 'gpt-6-luna'
  if (role === 'extractor') return env.OPENAI_MODEL_EXTRACTOR?.trim() || 'gpt-6-luna'
  if (role === 'writer' || role === 'draft') return env.OPENAI_MODEL_WRITER?.trim() || 'gpt-6-luna'
  return env.OPENAI_MODEL?.trim() || undefined
}

export type ReviewReasoningEffort = 'minimal' | ExtractorReasoningEffort
export type ExtractorReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WriterReasoningEffort = ExtractorReasoningEffort
export type AIReasoningEffort = ReviewReasoningEffort | ExtractorReasoningEffort

/** Each role's reasoning controls apply only to its supported model family.
 * Luna roles start at low to avoid the provider's medium default. */
export function automationReasoningEffortForRole(role: AIRequestRole, model: string,
  env: NodeJS.ProcessEnv = process.env): AIReasoningEffort | undefined {
  if ((role === 'scope' || role === 'media') && model === 'gpt-6-luna') {
    const setting = role === 'scope' ? 'OPENAI_SCOPE_REASONING_EFFORT' : 'OPENAI_MEDIA_REASONING_EFFORT'
    const configured = env[setting]?.trim().toLowerCase() || 'low'
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(configured)) throw new Error(`${setting}_INVALID`)
    return configured as AIReasoningEffort
  }
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
  if (role === 'reviewer' && model === 'gpt-6-luna') {
    const configured = env.OPENAI_REVIEW_REASONING_EFFORT?.trim().toLowerCase() || 'low'
    if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(configured)) throw new Error('OPENAI_REVIEW_REASONING_EFFORT_INVALID')
    return configured as ReviewReasoningEffort
  }
  if (role !== 'reviewer' || !/^gpt-5-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return undefined
  const configured = env.OPENAI_REVIEW_REASONING_EFFORT?.trim().toLowerCase() || 'low'
  if (!['minimal', 'low', 'medium', 'high'].includes(configured)) throw new Error('OPENAI_REVIEW_REASONING_EFFORT_INVALID')
  return configured as ReviewReasoningEffort
}

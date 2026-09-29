export type AIRequestRole = 'media' | 'scope' | 'extractor' | 'reviewer' | 'writer' | 'draft' | 'interpretation'

export function aiRequestRole(schema: unknown, task: string, attachments: boolean): AIRequestRole {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties || {}
  return attachments ? 'media' : properties.property_fragments ? 'scope' : properties.turn_semantics ? 'extractor'
    : task === 'review' ? 'reviewer' : properties.requests && properties.question ? 'writer'
      : task === 'writing' ? 'draft' : 'interpretation'
}

/** Keep the trial scoped to the classifier and reviewer; env overrides allow a quick rollback. */
export function automationModelForRole(role: AIRequestRole, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (role === 'scope') return env.OPENAI_MODEL_SCOPE?.trim() || 'gpt-4o-mini'
  if (role === 'reviewer') return env.OPENAI_MODEL_REVIEWER?.trim() || 'gpt-4o-mini'
  return env.OPENAI_MODEL?.trim() || undefined
}

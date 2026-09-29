type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Reserve room for the actual review, not for the size of its catalogue or history.
 * This is a bounded output allowance, not a prediction of tokens billed. */
export function aiOutputBudget(schema: unknown, task: string, input: unknown): number {
  const properties = row(row(schema).properties)
  if (properties.turn_semantics) return 4200
  if (task !== 'review' || !properties.factual_values || !properties.claims) return 2200
  const data = row(input), draft = string(data.respuesta_propuesta).trim()
  if (!draft) return 2200
  // Only explicit references in the draft can multiply a shared numeric claim.
  // The evidence may contain the whole catalogue; its length must not raise cost.
  const evidenceUnits = row(data.evidencia_turno).units
  const unitNumbers = [...new Set((Array.isArray(evidenceUnits) ? evidenceUnits : [])
    .map(unit => string(row(unit).unit_number)).filter(Boolean))]
  // A comma between two known unit references may be a list separator even
  // without spaces. Normalize only such lists; prices and decimal attributes
  // must not accidentally become a large set of named units.
  const unitPattern = unitNumbers.map(escapeRegex).join('|')
  const compactList = unitPattern ? new RegExp(`(?<![\\p{L}\\p{N}$.,])(?:${unitPattern})(?:\\s*,\\s*(?:${unitPattern}))+(?![\\p{L}\\p{N}]|[.,]\\d)`, 'gu') : null
  const sentences = draft.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)
  const relations = Math.min(80, sentences.reduce((total, sentence) => {
    let attributes = sentence.replace(/https?:\/\/\S+/g, '')
    if (compactList) attributes = attributes.replace(compactList, list => list.replaceAll(',', ', '))
    let namedUnits = 0
    for (const number of unitNumbers) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}.,])${escapeRegex(number)}(?![\\p{L}\\p{N}]|[.,]\\d)`, 'gu')
      if (pattern.test(attributes)) {
        namedUnits++
        attributes = attributes.replace(pattern, '')
      }
    }
    const numericValues = attributes.match(/\d+(?:[.,]\d+)*/g)?.length || 0
    return total + numericValues * Math.max(1, namedUnits)
  }, 0))
  const claims = Math.min(16, sentences.length)
  const allowance = 1600 + claims * 140 + Math.ceil(draft.length / 2) + relations * 170
  return Math.min(12000, Math.max(2200, Math.ceil(allowance / 250) * 250))
}

export type ModelResponseDiagnostics = {
  response_status: string
  incomplete_reason: string | null
  configured_max_output_tokens: number
  output_budget_exhausted: boolean
}

/** Never put provider error messages, partial outputs or arbitrary strings in diagnostics. */
export function modelResponseDiagnostics(result: unknown, budget: number): ModelResponseDiagnostics {
  const response = row(result), status = string(response.status)
  const rawReason = row(response.incomplete_details).reason
  const reason = rawReason === 'max_output_tokens' || rawReason === 'content_filter' ? rawReason
    : rawReason == null ? null : 'unknown'
  return {
    response_status: ['completed', 'incomplete', 'failed', 'cancelled', 'queued', 'in_progress'].includes(status) ? status : 'unknown',
    incomplete_reason: reason,
    configured_max_output_tokens: budget,
    output_budget_exhausted: status === 'incomplete' && reason === 'max_output_tokens',
  }
}

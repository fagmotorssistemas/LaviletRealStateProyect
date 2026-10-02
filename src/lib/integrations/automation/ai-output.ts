type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Reserve room for the actual review, not for the size of its catalogue or history.
 * This is a bounded output allowance, not a prediction of tokens billed. */
export function aiOutputBudget(schema: unknown, task: string, input: unknown): number {
  const properties = row(row(schema).properties)
  const numericContract = row(properties.numeric_contract).enum
  const inline = Array.isArray(numericContract) && numericContract.includes('numeric-inline-v1')
  if (properties.turn_semantics) return 4200
  if (task === 'review' && properties.facts && properties.findings) {
    // Room for extracted facts and reasoning; never parse the draft's numbers
    // or scale output by the catalogue size. This is only a completion ceiling.
    const length = string(row(input).borrador).length
    return Math.min(12000, Math.ceil(Math.max(4000, 2200 + length * 1.5) / 250) * 250)
  }
  if (task !== 'review' || !inline && (!properties.factual_values || !properties.claims)) return 2200
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
  const scopedDraft = inline && data.reparacion_numerica && Array.isArray(data.oraciones_borrador)
    ? data.oraciones_borrador.map(s => string(row(s).text)).join('\n') : draft
  const sentences = scopedDraft.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)
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
  // A numeric patch emits no narrative claims or obligations. Reserve bounded
  // reasoning/completion room for its own checks, not the unrelated sentence.
  if (inline && data.reparacion_numerica) {
    const checks = Array.isArray(data.referencias_numericas) ? data.referencias_numericas.length : 0
    return Math.min(12000, Math.ceil(Math.max(2500, 1600 + checks * 450 + relations * 170) / 250) * 250)
  }
  const baseAllowance = 1600 + claims * 140 + Math.ceil(draft.length / 2) + relations * 170
  const contractVersions = row(properties.review_contract).enum
  const focused = Array.isArray(contractVersions) && contractVersions.includes('focused-review-v1')
  const count = (value: unknown, limit: number) => Array.isArray(value) ? Math.min(limit, value.length) : 0
  // The focused contract adds one classification for every numeric reference,
  // one verdict per active obligation, and explicit resolutions during repair.
  // These required output rows caused a measured 2200-token truncation despite
  // a short draft. Reserve for the rows, not for unused catalogue evidence.
  // A real two-attribute review exhausted 2750 tokens (320 reasoning tokens).
  // Leave bounded completion room for factual rows and their explanations;
  // reserved output is a ceiling, not automatically consumed or billed.
  const focusedRows = focused ? count(data.referencias_numericas, 80) * (inline ? 260 : 110)
    + count(data.obligaciones_aplicables, 24) * 70
    + count(row(row(data.reparacion_revision).ficha_anterior).claims, 80) * 90
    + count(row(row(data.reparacion_revision).ficha_anterior).pending_checks, 80) * 90 : 0
  const allowance = focused ? Math.max(3500, baseAllowance) + focusedRows : baseAllowance
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

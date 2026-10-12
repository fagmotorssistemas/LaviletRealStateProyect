export type ExtractorConfidence = 'high' | 'medium' | 'low'

/** Admission only: callers still validate literal evidence, provenance, typed
 * values and permission context. Confidence is the model's label, not a score. */
export function acceptedExtractorConfidence(value: unknown): value is 'high' | 'medium' {
  return value === 'high' || value === 'medium'
}

/** Derived meaning cannot be more confident than the evidence it consumes. */
export function combinedExtractorConfidence(...values: unknown[]): ExtractorConfidence {
  if (!values.length || values.some(value => !acceptedExtractorConfidence(value))) return 'low'
  return values.some(value => value === 'medium') ? 'medium' : 'high'
}

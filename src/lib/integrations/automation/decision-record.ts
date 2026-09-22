import { sanitizeTraceSummary } from './trace-summary'

export type DecisionRecord = {
  rule_id: string
  origin: 'client' | 'catalog' | 'memory' | 'coverage_review' | 'operational' | 'policy' | 'model'
  reason: string
  caused_by_step?: number
  facts?: Record<string, unknown>
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  outcome?: string
  setting?: { kind: 'code' | 'prompt' | 'data' | 'configuration'; label: string; href?: string; source?: string }
}

/** Recorded at the decision site; never infer a causal link from adjacent steps. */
export function decisionRecord(value: DecisionRecord) {
  return sanitizeTraceSummary({ version: 'lavilet-decision-v1', ...value })
}

export function catalogSnapshot(units: unknown) {
  if (!Array.isArray(units)) return []
  return units.slice(0, 40).map(unit => Object.fromEntries(
    ['id', 'unit_number', 'category', 'bedrooms', 'floor_number', 'floor', 'area_internal_m2', 'area_exterior_m2', 'bathrooms_full']
      .map(key => [key, unit && typeof unit === 'object' ? (unit as Record<string, unknown>)[key] ?? null : null]),
  ))
}

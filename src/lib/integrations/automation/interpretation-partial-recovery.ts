import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const grounded = (quote: unknown, current: string) => !!text(quote).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())

/** A failed non-operational citation can become a targeted clarification.
 * Never recover monetary, identity or permission failures by accepting them. */
export function partiallyRecoverInterpretation(raw: Row, current: string, issues: string[]): Row | null {
  if (raw.recovery_outcome !== 'clarification') return null
  if (!issues.length || issues.some(issue => !/^(?:missing_current_evidence|non_current_evidence):(?:property|primary_intent|requests\.\d+|quantity\.\d+)$/.test(issue))) return null
  const semantics = object(raw.turn_semantics)
  if (['requested_advisor', 'opt_out', 'consent_granted', 'visit_needs_help'].some(key => raw[key] === true)
    || raw.financing_consent != null || !['', 'none', 'information', 'declined'].includes(text(object(semantics.reservation).kind))
    || !['', 'none'].includes(text(object(raw.visit_intent).kind))) return null
  const requests = rows(raw.requests).filter(request => ['property', 'project', 'courtesy', 'other'].includes(text(request.domain))
    && grounded(request.evidence, current) && acceptedExtractorConfidence(request.confidence))
  if (!requests.length) return null
  const propertyFailed = issues.some(issue => issue.endsWith(':property'))
  const old = object(semantics.property)
  const next: Row = { ...raw, requests, events: [],
    turn_semantics: { ...semantics,
      ...(propertyFailed || issues.some(issue => issue.endsWith(':primary_intent')) ? { primary_intent: 'other', primary_evidence: '', confidence: 'low' } : {}),
      housing_quantities: rows(semantics.housing_quantities).filter(quantity => grounded(quantity.evidence, current)),
      ...(propertyFailed ? { property: { ...old, group: null, category: null, excluded_categories: [], operation: 'none',
        selector: null, reference_kind: 'none', query_scope: null, unit_numbers: [], filters: {}, filter_evidence: {}, evidence: '', confidence: 'low' } } : {}) } }
  if (propertyFailed) {
    next.unit_id = next.preferred_category = null
    next.declaration_evidence = { ...object(raw.declaration_evidence), preferred_category: null }
    next.catalog_request = { purpose: 'none', requirements: [], semantic_preferences: [], evidence: '', confidence: 'low' }
    next.evidence_sources = []
  }
  return next
}

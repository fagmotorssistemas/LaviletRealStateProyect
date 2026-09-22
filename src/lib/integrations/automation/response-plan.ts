import { object, text, type Row } from './data'

const lockedSources = new Set([
  'visit_intake', 'visit_status', 'visit_option_choice', 'visit_acceptance_clarification',
  'property_unit_selected', 'property_budget_deferred', 'property_budget_confirmed',
  'property_floor_comparison', 'property_floor_options',
  'property_living_options', 'unit_alternative', 'unit_alternative_journey',
  'accepted_unit_alternative', 'accepted_price_option', 'budget_options',
  'financing_selection_required', 'financing_question', 'team_attendance',
])

/** Deterministic copy already represents the verified action and must not be rewritten by another model. */
export function responsePlan(baseReply: string, audit: Row) {
  const source = text(audit.source)
  const uncovered = Array.isArray(audit.uncovered_requests) ? audit.uncovered_requests : []
  const locked = audit.coverage_complete !== false && !uncovered.length
    && (lockedSources.has(source) || source === 'unit_price' && audit.verified_price_only === true)
  return {
    source,
    locked,
    protected_facts: object(audit.catalog_results).units || [],
    covered_requests: Array.isArray(audit.covered_requests) ? audit.covered_requests : [],
    required_links: [...baseReply.matchAll(/https?:\/\/[^\s)]+/g)].map(match => match[0]),
    required_numbers: [...baseReply.matchAll(/\b\d[\d.,]*\b/g)].map(match => match[0]),
    next_question: text(baseReply.match(/[^?¿\n]*\?\s*$/)?.[0]).trim() || null,
  }
}

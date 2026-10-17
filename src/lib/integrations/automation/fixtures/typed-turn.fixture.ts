import { ACTION_AUTHORITY_VERSION,ACTION_DOMAINS } from '../action-authority'
import { object,type Row } from '../data'
import base from './extractor-profile-turn.json'
import { visitPreferenceFixture } from './visit-preference.fixture'

/** Model outputs are explicit test inputs. This helper never interprets prose. */
export function typedTurnFixture(current: string, overrides: Row = {}): Row {
  const raw: Row = structuredClone(base)
  Object.assign(raw, { events: [], requests: [], full_name: null, residence_city: null, residence_country: null,
    preferred_category: null, purchase_purpose: null, requested_advisor: false, opt_out: false, consent_granted: false,
    qualification: {}, profile_evidence: { full_name: null, residence_city: null, residence_country: null },
    declaration_evidence: { preferred_category: null, purchase_purpose: null },
    financing_partner_choice: { kind: 'none', name: null, reference_kind: 'none', evidence: '', confidence: 'low' },
    communication: { kind: 'substantive', evidence: current, confidence: 'high', greeting_present: false },
    action_authority: { version: ACTION_AUTHORITY_VERSION, ...Object.fromEntries(ACTION_DOMAINS.map(domain => [domain,
      { decision: 'none', attribution: 'none', target: 'unspecified', scope: 'none', evidence: '', confidence: 'low' }])) },
    routing: { repair_requested: false, team_attendance: false, visit_help: false, visit_response: 'none',
      proposal_id: null, option_index: null, all_options_declined: false, location_target: 'none', visual_target: 'none',
      location_kind: 'none', address_preference: 'unspecified', map_preference: 'unspecified', visual_preference: 'unspecified',
      visual_only: false, photo_requested: false, house_request: false, evidence: current, confidence: 'high' },
    visit_preference: visitPreferenceFixture({ decision: 'none', evidence: '', confidence: 'low' }), visit_preferences: [], visit_intent: null,
  })
  raw.turn_semantics = { ...object(raw.turn_semantics), primary_intent: 'other', primary_evidence: '', confidence: 'low',
    property: { group: null, category: null, operation: 'none', reference_kind: 'none', unit_numbers: [], excluded_categories: [],
      filters: {}, filter_evidence: {}, evidence: '', confidence: 'low', query_scope: null, selector: null },
    reservation: { kind: 'none', reference_kind: 'none', unit_numbers: [], evidence: '', confidence: 'low' },
    unit_choice: { kind: 'none', unit_numbers: [], evidence: '', confidence: 'low' },
    category_choice: { kind: 'none', category: null, evidence: '', confidence: 'low' },
    preference_change: { kind: 'none', bedrooms: null, bedroom_decision: 'unspecified', evidence: '', confidence: 'low' },
    budget: { status: 'not_discussed', amount: null, subject: 'unspecified', evidence: '', confidence: 'low' },
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }, housing_quantities: [] }
  return { ...raw, ...overrides }
}

export function authorityFixture(current: string, domain: string, decision = 'request', attribution = 'self', scope = 'operation'): Row {
  return { ...object(typedTurnFixture(current).action_authority), [domain]: {
    decision, attribution, scope, target: 'project', evidence: current, confidence: 'high',
  } }
}

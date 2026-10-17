/* eslint-disable @typescript-eslint/no-require-imports -- Explicit fixture contract migration. */
const { typedTurnFixture, authorityFixture } = require('../../src/lib/integrations/automation/fixtures/typed-turn.fixture.ts')

// Migrate author-supplied decisions, not the customer's vocabulary. Existing
// v4 authority is never overwritten. Empty/malformed provider outputs stay so.
function currentExtractorFixture(current, legacy) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) || !Object.keys(legacy).length) return legacy
  const raw = typedTurnFixture(current, structuredClone(legacy))
  if (!Object.hasOwn(legacy, 'action_authority')) {
    const choose = (domain, decision = 'request', scope = 'operation', attribution = 'self') => {
      raw.action_authority[domain] = authorityFixture(current, domain, decision, attribution, scope)[domain]
    }
    if (legacy.requested_advisor === true) choose('advisor')
    if (typeof legacy.financing_consent === 'boolean') choose('financing', legacy.financing_consent ? 'request' : 'decline')
    if (legacy.consent_granted === true || legacy.tracking_consent === true) choose('tracking', 'accept', 'all_contact')
    if (legacy.opt_out === true) choose('tracking', 'decline', 'all_contact')
    if (legacy.visit_intent && ['request_visit', 'accept_visit_preference'].includes(legacy.visit_intent.kind)) choose('visit')
    if (legacy.turn_semantics?.reservation?.kind === 'request') choose('reservation')
    if (!legacy.visit_intent && legacy.events?.includes('requested_visit')) {
      choose('visit')
      raw.visit_intent = { kind: 'request_visit', purpose: 'coordination', target: 'project', destination: null,
        evidence: current, confidence: 'high' }
    }
  }
  if (legacy.turn_semantics?.interaction_goal) {
    const goal = raw.turn_semantics.interaction_goal
    if (!Object.hasOwn(goal, 'qualification_decision')) goal.qualification_decision =
      goal.mode === 'information_only' ? 'pause' : goal.mode === 'guided_search' ? 'resume' : 'unchanged'
  }
  return raw
}
module.exports = { currentExtractorFixture }

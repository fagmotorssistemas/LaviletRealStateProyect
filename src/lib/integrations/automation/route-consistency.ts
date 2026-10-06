import { object, text } from './data'

/** A pending workflow is context, not consent to continue it on every turn. */
export function visitRoutePermission(requests: unknown, semantics: unknown, visit: unknown, explicitVisitSignal = false) {
  const inventory = (Array.isArray(requests) ? requests : []).map(object)
  const confident = inventory.filter(request => request.confidence === 'high')
  const visitRequest = confident.some(request => request.domain === 'visit')
  const otherRequest = confident.some(request => !['visit', 'courtesy'].includes(text(request.domain)))
  const intent = object(visit)
  const turn = object(semantics), property = object(turn.property)
  const propertyRequest = property.confidence === 'high' && !['', 'none'].includes(text(property.operation))
  const currentVisit = explicitVisitSignal || visitRequest
    || intent.confidence === 'high' && ['request_visit', 'accept_visit_preference', 'decline_visit', 'visit_status'].includes(text(intent.kind))
    || turn.confidence === 'high' && turn.primary_intent === 'request_visit'
  const otherIntent = turn.confidence === 'high' && ['select_property', 'ask_price', 'discuss_budget', 'ask_financing', 'project_information', 'request_reservation', 'ask_reservation'].includes(text(turn.primary_intent))
  const informationOnly = intent.confidence === 'high' && intent.kind === 'visit_information'
  const denied = intent.target === 'other' || informationOnly || !currentVisit && (otherRequest || propertyRequest || otherIntent)
  return { allowed: !denied, reason: informationOnly ? 'visit_information_is_not_scheduling'
    : denied ? 'current_request_overrides_pending_visit' : 'visit_context_permitted',
    current_domains: confident.map(request => text(request.domain)), visit_intent: text(intent.kind) }
}

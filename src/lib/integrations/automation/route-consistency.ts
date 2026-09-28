import { object, text } from './data'

/** A pending workflow is context, not consent to continue it on every turn. */
export function visitRoutePermission(requests: unknown, semantics: unknown, visit: unknown) {
  const inventory = (Array.isArray(requests) ? requests : []).map(object)
  const confident = inventory.filter(request => request.confidence === 'high')
  const visitRequest = confident.some(request => request.domain === 'visit')
  const otherRequest = confident.some(request => !['visit', 'courtesy'].includes(text(request.domain)))
  const intent = object(visit)
  const property = object(object(semantics).property)
  const propertyRequest = property.confidence === 'high' && !['', 'none'].includes(text(property.operation))
  const denied = intent.kind === 'none' && intent.confidence === 'high' && !visitRequest && (otherRequest || propertyRequest)
  return { allowed: !denied, reason: denied ? 'current_request_overrides_pending_visit' : 'visit_context_permitted',
    current_domains: confident.map(request => text(request.domain)), visit_intent: text(intent.kind) }
}

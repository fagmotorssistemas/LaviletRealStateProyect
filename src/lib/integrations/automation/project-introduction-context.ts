import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { normalizedRequestTopics } from './request-topics'
import { groundedCurrentCategoryExclusions } from './purchase-evidence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const hasValues = (value: unknown): boolean => value != null && value !== false && value !== ''
  && (Array.isArray(value) ? value.some(hasValues)
    : typeof value === 'object' ? Object.values(object(value)).some(hasValues) : true)
const requestIdentity = (request: Row) => JSON.stringify([request.request, request.evidence,
  text(request.source) || 'current', request.source === 'pending' ? request.source_message_id : null])
const constrainedGroup = (value: unknown) => hasValues(value) && value !== 'all'
const positiveAmount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0

/** One semantic decision for the base reply, writer and reviewer. A broad group
 * label cannot turn an explicit project overview into a housing search. */
export function generalProjectIntroductionTurn(info: Row): boolean {
  const semantics = object(info.semantica_turno), intent = object(info.contrato_turno), property = object(semantics.property)
  const shared = rows(intent.requests), interpreted = rows(info.solicitudes_interpretadas || semantics.requests)
  const identities = new Set(shared.map(requestIdentity))
  const requests = [...shared, ...interpreted.filter(request => !identities.has(requestIdentity(request)))]
    .filter(request => request.domain !== 'courtesy')
  if (semantics.primary_intent !== 'project_information' || !acceptedExtractorConfidence(semantics.confidence)
    || intent.objective !== 'project_information' || requests.length !== 1 || requests[0].domain !== 'property'
    || !acceptedExtractorConfidence(requests[0].confidence) || requests[0].source === 'pending'
    || hasValues(intent.required_facts) || hasValues(intent.subject)
    || ['mixed', 'out_of_scope', 'uncertain', 'clarify_scope'].includes(text(object(intent.scope).kind))
    || hasValues(info.limite_alcance)) return false
  const topics = normalizedRequestTopics(requests[0].topics)
  if (topics && (topics.length !== 1 || topics[0] !== 'project_overview')) return false
  const overviewOnly = topics?.length === 1 && topics[0] === 'project_overview'
  const groupConstrainsRequest = (value: unknown) => constrainedGroup(value)
    && !(overviewOnly && ['residential', 'commercial'].includes(text(value)))
  const catalog = object(semantics.catalog_request || info.catalog_request), context = object(info.property_context), query = object(context.query)
  const lead = object(info.lead), known = object(object(info.conversacion).datos_conocidos)
  const savedProperty = object(object(info.hechos_confirmados).property), preference = object(context.category_preference)
  const confirmedCategory = preference.confirmed === true && hasValues(preference.category)
    || groundedCurrentCategoryExclusions({ ...savedProperty, excluded_categories: [savedProperty.category] },
      text(savedProperty.evidence)).includes(text(savedProperty.category))
    || ['choose_floor', 'choose_unit', 'review_unit'].includes(text(context.phase)) && hasValues(query.category)
  const pending = [info.pregunta_pendiente, context.pending_question, intent.pending_question].map(object)
    .find(question => text(question.id) || text(question.act)) || {}
  // A presentation already followed by the brochure or a concrete commercial
  // step must not replace a clarification in an established conversation.
  if (object(info.estado_conversacion).brochure_sent === true
    || object(info.estado_conversacion).presentation_sent === true
    || text(pending.act) && pending.act !== 'profile'
    || text(pending.id) && !text(pending.id).startsWith('lead_')
    || confirmedCategory && hasValues(lead.preferred_category) || hasValues(lead.purchase_purpose)
    || ['preferred_bedrooms', 'budget', 'budget_max'].some(key => positiveAmount(lead[key]))
    || confirmedCategory && hasValues(known.categoria) || hasValues(known.proposito)
    || ['dormitorios', 'presupuesto'].some(key => positiveAmount(known[key]))) return false
  if (!['none', 'search', ''].includes(text(property.operation)) || !['none', ''].includes(text(property.reference_kind))
    || groupConstrainsRequest(property.group)
    || ['category', 'unit_numbers', 'filters', 'filter_evidence', 'selector', 'excluded_categories'].some(key => hasValues(property[key]))
    || catalog.purpose && !['none', 'search'].includes(text(catalog.purpose))
    || ['metric', 'requirements', 'semantic_preferences'].some(key => hasValues(catalog[key]))
    || groupConstrainsRequest(query.group)
    || ['filters', 'requirements', 'selector'].some(key => hasValues(query[key]))
    || hasValues(query.category) && (!overviewOnly || confirmedCategory)
    || query.operation && !['none', 'search'].includes(text(query.operation))
    || ['selected_ids', 'focused_ids', 'offered_ids', 'comparison_ids'].some(key => hasValues(context[key]))
    || text(lead.unit_id)
    || hasValues(semantics.housing_quantities) || hasValues(semantics.household)
    || object(semantics.budget).status && object(semantics.budget).status !== 'not_discussed') return false
  return true
}

/** Only a current, single, general project request receives the editable summary.
 * Specific or repeated requests retain their own response and next step. */
export function projectIntroductionForTurn(info: Row): Row | null {
  if (!generalProjectIntroductionTurn(info)) return null
  return configuredProjectIntroduction(info)
}

/** Configuration authority is separate from eligibility. The opening planner
 * also uses it for legacy callers that have no interpreted request contract. */
export function configuredProjectIntroduction(info: Row): Row | null {
  const configured = object(info.configuracion_presentacion_proyecto || info.presentacion_general_proyecto)
  return configured.available === true && text(configured.summary).trim()
    ? { available: true, summary: text(configured.summary), source: text(configured.source), content_kind: 'approved_business_summary' }
    : null
}

/** Remove the unspecialized configuration from every model projection. */
export function withProjectIntroductionForTurn(info: Row): Row {
  const selected = projectIntroductionForTurn(info), result = { ...info }
  delete result.configuracion_presentacion_proyecto
  delete result.presentacion_general_proyecto
  if (selected) result.presentacion_general_proyecto = selected
  return result
}

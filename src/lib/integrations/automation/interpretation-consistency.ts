import { acceptedExtractorConfidence, type ExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { financingAmountStatements } from './financing-amounts'
import { normalizeCatalogRequest } from './catalog-request'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const citation = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
const grounded = (value: unknown, current: string) => !!citation(value) && citation(current).includes(citation(value))
const activeBudgetStates = new Set(['amount_pending', 'no_defined_budget', 'unknown', 'amount', 'maximum_total',
  'initial_capital', 'sufficient_for_selected_unit', 'insufficient_for_selected_unit', 'declines_to_disclose'])
const propertyOperations = new Set(['search', 'rank', 'compare', 'select', 'details'])
const answerKinds = new Set(['affirmative', 'negative', 'uncertain', 'value'])
const propertyTopics = new Set(['project_overview', 'location', 'purchase_price', 'commercial_stage',
  'construction_status', 'delivery', 'spatial_fit', 'accessibility', 'property_features', 'property_options', 'visualization'])

/** Compare model-owned fields, never words. A typed category answer must carry
 * the corresponding property meaning before the planner can ask a next step. */
export function propertyAnswerConsistencyIssues(raw: Row, current: string, pending: Row): string[] {
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  const answer = object(semantics.answer_to_previous), choice = object(semantics.category_choice)
  const currentValue = pending.id === 'property_category' && answer.question_id === pending.id
    && answer.kind === 'value' && acceptedExtractorConfidence(answer.confidence) && grounded(answer.evidence, current)
  const chosen = choice.kind === 'selected' && acceptedExtractorConfidence(choice.confidence)
    && grounded(choice.evidence, current) && ['suite', 'departamento', 'penthouse', 'local'].includes(text(choice.category))
  const propertyValid = acceptedExtractorConfidence(property.confidence) && grounded(property.evidence, current)
  const group = text(property.group), category = text(property.category)
  if ((currentValue || chosen) && (!propertyValid || !['residential', 'commercial'].includes(group)
    && !['suite', 'departamento', 'penthouse', 'local'].includes(category))) return ['incomplete_property_answer:property']
  if (propertyValid && (category === 'local' && group === 'residential'
    || ['suite', 'departamento', 'penthouse'].includes(category) && group === 'commercial'
    || chosen && category && category !== choice.category)) return ['inconsistent_property_answer:property']
  return []
}

/** A current withdrawal, role clarification or an unknown budget is still a
 * monetary update. Absence of a new budget amount must not erase any of them. */
function hasCurrentMonetaryMeaning(raw: Row, current: string): boolean {
  const semantics = object(raw.turn_semantics), budget = object(semantics.budget)
  return activeBudgetStates.has(text(budget.status)) && grounded(budget.evidence, current)
    || financingAmountStatements(raw.financing_amounts, current).length > 0
}

function currentRequests(raw: Row, current: string): Row[] {
  return rows(raw.requests).filter(request => acceptedExtractorConfidence(request.confidence) && grounded(request.evidence, current))
}

function currentProperty(raw: Row, current: string): Row | null {
  const property = object(object(raw.turn_semantics).property)
  return acceptedExtractorConfidence(property.confidence) && propertyOperations.has(text(property.operation))
    && grounded(property.evidence, current) ? property : null
}

function currentAnswer(raw: Row, current: string, pending?: Row): Row | null {
  const answer = object(object(raw.turn_semantics).answer_to_previous)
  return acceptedExtractorConfidence(answer.confidence) && answerKinds.has(text(answer.kind)) && grounded(answer.evidence, current)
    && text(answer.question_id) && answer.question_id !== 'none'
    && (!pending || text(pending.id) && answer.question_id === pending.id) ? answer : null
}

function hasIndependentCurrentMeaning(raw: Row, current: string): boolean {
  if (currentProperty(raw, current)) return true
  if (normalizeCatalogRequest(raw.catalog_request, current)) return true
  const answer = currentAnswer(raw, current)
  if (answer && !text(answer.question_id).startsWith('budget_')) return true
  return currentRequests(raw, current).some(request => request.domain !== 'financing'
    && (request.domain !== 'property' || Array.isArray(request.topics)
      && request.topics.some(topic => propertyTopics.has(text(topic)))))
}

/** Source validation checks where an excerpt came from. This independent check
 * compares typed meanings: a property answer cannot be classified as a budget
 * update solely because a budget exists in memory. It does not interpret words
 * or authorize an action, and remains silent for unresolved/financial turns. */
export function interpretationConsistencyIssues(raw: Row, current: string): string[] {
  const semantics = object(raw.turn_semantics)
  if (semantics.primary_intent !== 'discuss_budget' || !acceptedExtractorConfidence(semantics.confidence)
    || hasCurrentMonetaryMeaning(raw, current) || !hasIndependentCurrentMeaning(raw, current)) return []
  // Generic financial questions are not monetary declarations, but make a
  // compound interpretation inconclusive. Let the model retain their meaning.
  if (currentRequests(raw, current).some(request => request.domain === 'financing'
    || Array.isArray(request.topics) && request.topics.includes('financing'))) return []
  return ['inconsistent_primary_intent:budget']
}

type Primary = { primary_intent: string; primary_evidence: string; confidence: ExtractorConfidence }
const primary = (intent: string, source: Row): Primary => ({ primary_intent: intent,
  primary_evidence: text(source.primary_evidence || source.evidence),
  confidence: acceptedExtractorConfidence(source.confidence) ? source.confidence : 'low' })

function supportedPrimary(raw: Row, current: string, pending: Row, candidate: unknown): Primary | null {
  const semantics = object(candidate)
  if (!acceptedExtractorConfidence(semantics.confidence) || !grounded(semantics.primary_evidence, current)) return null
  const intent = text(semantics.primary_intent), property = currentProperty(raw, current)
  const catalog = normalizeCatalogRequest(raw.catalog_request, current)
  const requests = currentRequests(raw, current), answer = currentAnswer(raw, current, pending)
  const reservation = object(object(raw.turn_semantics).reservation), visit = object(raw.visit_intent)
  const supported = intent === 'answer_previous' && !!answer
    || intent === 'select_property' && property?.operation === 'select'
    || intent === 'ask_price' && requests.some(request => Array.isArray(request.topics) && request.topics.includes('purchase_price'))
    || intent === 'ask_financing' && requests.some(request => request.domain === 'financing')
    || intent === 'project_information' && (!!property || !!catalog || requests.some(request => request.domain === 'property'))
    || intent === 'request_visit' && visit.kind === 'request_visit' && acceptedExtractorConfidence(visit.confidence) && grounded(visit.evidence, current)
    || ['request_reservation', 'ask_reservation'].includes(intent) && acceptedExtractorConfidence(reservation.confidence)
      && grounded(reservation.evidence, current) && reservation.kind === (intent === 'request_reservation' ? 'request' : 'information')
  return supported ? primary(intent, semantics) : null
}

/** Invoke only after the caller certifies and isolates a context-only budget.
 * Replace at most the primary label/evidence; existing property, profile,
 * monetary facts and permissions remain byte-for-byte unchanged. No action is
 * inferred from a primary label, and no category or unit is created here. */
export function reconcilePrimaryAfterBudgetIsolation(raw: Row, current: string, pending: Row = {}, repaired?: Row): Row | null {
  if (hasCurrentMonetaryMeaning(raw, current)) return null
  const semantics = object(raw.turn_semantics)
  const incoming = object(repaired?.turn_semantics)
  let next = supportedPrimary(raw, current, pending, incoming) || supportedPrimary(raw, current, pending, semantics)
  if (!next) {
    const answer = currentAnswer(raw, current, pending), property = currentProperty(raw, current)
    const catalog = normalizeCatalogRequest(raw.catalog_request, current)
    const requests = currentRequests(raw, current)
    const priceRequest = requests.find(request => Array.isArray(request.topics) && request.topics.includes('purchase_price'))
    const financialRequest = requests.find(request => request.domain === 'financing')
    const propertyRequest = requests.find(request => request.domain === 'property')
    // A selected operation already belongs to the validated block. Merely
    // accepting a proposal or supplying bedrooms never changes it to select.
    next = property?.operation === 'select' ? primary('select_property', property)
      : priceRequest ? primary('ask_price', priceRequest)
        : financialRequest ? primary('ask_financing', financialRequest)
          : answer ? primary('answer_previous', answer)
            : property ? primary('project_information', property)
              : propertyRequest ? primary('project_information', propertyRequest)
                : catalog ? primary('project_information', catalog) : null
  }
  return next ? { ...raw, turn_semantics: { ...semantics, ...next } } : null
}

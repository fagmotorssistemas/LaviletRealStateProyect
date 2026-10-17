import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

type Subject = 'vehicle' | 'property' | 'unknown'
type Category = 'suite' | 'departamento' | 'penthouse' | 'local' | 'vivienda' | null
const categories: Category[] = ['suite', 'departamento', 'penthouse', 'local', 'vivienda']
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const proof = (value: unknown, current: string) => !!text(value).trim() && current.includes(text(value).trim())

/** Only structured interpretation identifies the customer's subject. The
 * positional text/history arguments remain context, not an NLP fallback;
 * absent metadata means unknown. */
export function salesSubject(current: string, history: unknown = [], interpreted: unknown = {}) {
  void history
  const input = object(interpreted)
  const semantics = object(input.semantics || input.semantica_turno || input.turn_semantics || input)
  const intent = object(input.intent || input.contrato_turno)
  const scope = object(input.scope || intent.scope)
  const property = object(semantics.property)
  const requests = rows(input.requests || input.solicitudes_interpretadas || intent.requests || semantics.requests)
    .filter(request => request.source !== 'pending' && acceptedExtractorConfidence(request.confidence) && proof(request.evidence, current))
  const knownProperty = acceptedExtractorConfidence(property.confidence) && proof(property.evidence, current)
  const inProperty = ['property', 'mixed'].includes(text(scope.kind)) && scope.uncertain !== true
    || requests.some(request => ['property', 'financing', 'visit', 'advisor'].includes(text(request.domain)))
    || knownProperty && ['residential', 'commercial'].includes(text(property.group))
  const typedSubject = object(input.sales_subject)
  const subject: Subject = inProperty ? 'property'
    : typedSubject.subject === 'vehicle' && acceptedExtractorConfidence(typedSubject.confidence) && proof(typedSubject.evidence, current)
      ? 'vehicle' : 'unknown'
  const category: Category = knownProperty && categories.includes(property.category as Category) ? property.category as Category
    : knownProperty && property.group === 'residential' ? 'vivienda' : null
  const topics = requests.flatMap(request => Array.isArray(request.topics) ? request.topics.map(text) : [])
  const primary = text(intent.objective || semantics.primary_intent)
  const question = topics.includes('purchase_price') || primary === 'ask_price' && proof(semantics.primary_evidence, current) ? 'price'
    : requests.some(request => request.domain === 'financing') || primary === 'ask_financing' && proof(semantics.primary_evidence, current) ? 'financing'
      : object(input.recommendation_request || semantics.recommendation_request).requested === true ? 'recommendation'
        : ['affirmative', 'negative', 'value'].includes(text(object(semantics.answer_to_previous).kind))
          && proof(object(semantics.answer_to_previous).evidence, current) ? 'acknowledgement' : 'other'
  return { subject, category, question, acceptedRedirect: input.accepted_redirect === true && inProperty }
}

/** Read a boundary receipt, never infer it from an older response's text. */
export function isPropertyScopeRedirect(value: string, receipt: unknown = {}) {
  void value
  const row = object(receipt), scope = object(row.business_scope || row.scope)
  return row.outside_boundary === true || ['out_of_scope', 'mixed'].includes(text(scope.kind)) && scope.uncertain !== true
}

export function purchasePriceQuestion(value: string, interpreted: unknown = {}) {
  return salesSubject(value, [], interpreted).question === 'price'
}

export function mentionsOwnedVehicle(value: string, interpreted: unknown = {}) {
  const input = object(interpreted), parking = object(input.parking_requirement || object(input.semantica_turno).parking_requirement)
  return parking.owned_vehicle === true && acceptedExtractorConfidence(parking.confidence) && proof(parking.evidence, value)
}

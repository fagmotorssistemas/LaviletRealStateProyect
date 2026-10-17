import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
/** The current interpreted request owns the subject. Missing CRM data has no meaning. */
export function informationSubject(_current: string, info: Row): 'project' | 'property' | null {
  const semantics = object(info.semantica_turno), property = object(semantics.property)
  if (!acceptedExtractorConfidence(semantics.confidence)) return null
  const requests = (Array.isArray(semantics.requests) ? semantics.requests : []).map(object)
  if (requests.length > 1) return null
  if (['details', 'compare'].includes(text(property.operation))) return 'property'
  if (requests.some(request => Array.isArray(request.topics) && request.topics.includes('project_overview'))) return 'project'
  return null
}

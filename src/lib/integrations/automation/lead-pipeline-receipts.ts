import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

/** A grounded current request is required; navigation and bot offers do not
 * establish a commercial availability enquiry. */
export function rememberPipelineAvailability(previous: unknown, requests: unknown, current: string, messageId: string, at: string): Row[] {
  const saved = Array.isArray(previous) ? previous.map(object) : []
  const request = (Array.isArray(requests) ? requests.map(object) : []).find(row => row.domain === 'property'
    && row.source !== 'pending' && acceptedExtractorConfidence(row.confidence)
    && Array.isArray(row.topics) && row.topics.includes('availability') && text(row.evidence).trim()
    && current.normalize('NFKC').toLowerCase().includes(text(row.evidence).trim().normalize('NFKC').toLowerCase()))
  if (!request || !messageId || saved.some(row => row.kind === 'commercial_interest' && row.topic === 'availability')) return saved
  return [...saved, { kind: 'commercial_interest', topic: 'availability', evidence: request.evidence, source_message_id: messageId, at }]
}

import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { responseReviewSettings, type ResponseReviewSettings } from '@/lib/inmobiliaria/responseReview'
import { MAX_REPLY_CHARACTERS } from './response-plan'

// A server-owned snapshot for this execution; model output and lead messages cannot change it.
const policy = new AsyncLocalStorage<Readonly<ResponseReviewSettings>>()
export function withResponseReviewPolicy<T>(settings: ResponseReviewSettings, work: () => T): T {
  return policy.run(Object.freeze({ ...settings }), work)
}
export function responseReviewEnabled() { return policy.getStore()?.enabled !== false }
export function responseReviewControl() {
  return { ...(policy.getStore() || responseReviewSettings(null)), source: 'project_setting' as const }
}
export class InvalidWriterTransportError extends Error {
  constructor(issue: string) { super(issue); this.name = 'InvalidWriterTransportError' }
}
export function unreviewedWriterReply(value: unknown) {
  const reply = typeof value === 'string' ? value.trim() : ''
  if (!reply) throw new InvalidWriterTransportError('EMPTY_WRITER_REPLY')
  if (reply.length > MAX_REPLY_CHARACTERS) throw new InvalidWriterTransportError('WRITER_TRANSPORT_LENGTH')
  return { reply, audit: { status: 'review_disabled', review_control: responseReviewControl(),
    independent_review: false, semantic_review: { status: 'disabled' }, repair_attempts: [],
    final_validation: { passed: true, policy: 'transport_only', issues: [] },
    follow_up: { usable: true, source: 'writer_without_review' }, needs_advisor: false, unresolved: [],
  } }
}

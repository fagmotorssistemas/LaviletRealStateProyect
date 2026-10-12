import test from 'node:test'
import assert from 'node:assert/strict'
import type { WorkflowExecutionStep } from './executionWorkflow'
import { messageReviewMarker } from './messageReviewMarker'

const step = (output: Record<string, unknown>, key = 'response_coverage', order = 12): WorkflowExecutionStep => ({
  order, key, output, input: {}, label: key, category: 'control', status: 'succeeded', source: 'fixture',
  startedAt: '', completedAt: '', durationMs: 0, errorCode: null,
})
const observed = (status: string) => ({
  status: 'review_observed', review_control: { observationOnly: true, source: 'project_setting' },
  observation: { status, enforcement: false }, semantic_review: { status: status === 'checked' ? 'checked' : 'rejected' },
})

test('a final rejected draft stays red even if Kommo accepts the recovery message', () => {
  const marker = messageReviewMarker([
    step({ status: 'rejected_review', draft_rejected: true, recovery: { pending: true } }),
    step({ action: 'accepted' }, 'message_delivery', 15),
  ])!
  assert.equal(marker.tone, 'rejected')
  assert.equal(marker.kind, 'blocked')
  assert.equal(marker.label, 'Borrador rechazado')
  assert.match(marker.description, /no confirma.*Kommo/)
})

test('an invalid review sheet does not claim that the commercial text was false', () => {
  const marker = messageReviewMarker([step({ status: 'invalid_coverage', issues: ['invalid_review_metadata'] })])!
  assert.equal(marker.tone, 'rejected')
  assert.equal(marker.label, 'Revisión sin aprobar')
  assert.match(marker.description, /ficha interna/)
})

test('a rejected draft repaired before approval remains visible in amber', () => {
  const marker = messageReviewMarker([step({ status: 'checked', repair_attempts: [
    { target: 'commercial_draft', status: 'rejected_review', issues: ['catalog_value_mismatch'] },
  ] })])!
  assert.equal(marker.kind, 'repaired')
  assert.equal(marker.tone, 'warning')
  assert.equal(marker.label, 'Rechazo corregido')
  assert.match(marker.description, /final quedó aprobado/)
})

test('repair of reviewer metadata is distinguished from changing a commercial draft', () => {
  const marker = messageReviewMarker([step({ status: 'checked', repair_attempts: [
    { target: 'review_metadata', status: 'invalid_review_metadata', issues: [{ kind: 'review_metadata' }] },
  ] })])!
  assert.equal(marker.tone, 'warning')
  assert.equal(marker.label, 'Ficha reparada')
  assert.match(marker.description, /no demuestra.*mensaje comercial/)
})

test('a completed reviewer repair still exposes the preceding issues', () => {
  assert.equal(messageReviewMarker([step({ status: 'checked', repair_attempts: [
    { target: 'review_metadata', status: 'review_completed', issues: [{ code: 'invalid_review_metadata' }] },
  ] })])?.label, 'Ficha reparada')
})

test('demo rejection is amber and explicitly says that it did not block delivery preparation', () => {
  const marker = messageReviewMarker([step(observed('rejected_review'))])!
  assert.equal(marker.kind, 'observed')
  assert.equal(marker.tone, 'warning')
  assert.match(marker.label, /demo/)
  assert.match(marker.description, /no bloqueó el borrador/)
})

test('demo approval and a clean normal approval have no rejection marker', () => {
  assert.equal(messageReviewMarker([step(observed('checked'))]), null)
  assert.equal(messageReviewMarker([step({ status: 'checked', repaired: true, repair_attempts: [] })]), null)
})

const observedMetadata = () => ({
  ...observed('checked'),
  final_validation: { passed: false, issues: ['question_metadata_purpose_mismatch'] },
  semantic_review: { status: 'checked', acceptance: { content_approved: true, follow_up_usable: true }, findings: [], fact_checks: [] },
})

test('a demo question sheet mismatch is distinct from a rejected commercial draft', () => {
  const marker = messageReviewMarker([step(observedMetadata())])!
  assert.equal(marker.kind, 'technical')
  assert.equal(marker.tone, 'warning')
  assert.equal(marker.label, 'Ficha interna inconsistente · demo')
  assert.match(marker.description, /revisor aprobó el contenido/)
  assert.match(marker.description, /no garantiza que el texto sea correcto/)
})

test('a question sheet warning never masks mixed factual or commercial guards', () => {
  for (const issue of ['catalog_area_mismatch', 'numbers_changed', 'required_continuation_missing', 'hard_fact']) {
    const fixture = observedMetadata()
    fixture.final_validation.issues.push(issue)
    const marker = messageReviewMarker([step(fixture)])!
    assert.equal(marker.kind, 'observed', issue)
    assert.equal(marker.label, 'Rechazo observado · demo', issue)
  }
})

test('metadata classification requires explicit content approval and no risk findings', () => {
  const contentRejected = observedMetadata()
  contentRejected.semantic_review.acceptance.content_approved = false
  assert.equal(messageReviewMarker([step(contentRejected)])?.kind, 'observed')
  const finding = observedMetadata()
  assert.equal(messageReviewMarker([step({ ...finding, semantic_review: { ...finding.semantic_review,
    findings: [{ category: 'turn_goal', reason: 'No atendió el siguiente paso.' }] } })])?.kind, 'observed')
  const contradiction = observedMetadata()
  assert.equal(messageReviewMarker([step({ ...contradiction, semantic_review: { ...contradiction.semantic_review,
    fact_checks: [{ status: 'contradiction' }] } })])?.kind, 'observed')
})

test('unknown or incomplete guard diagnostics retain the generic demo marker', () => {
  const fixture = observedMetadata()
  fixture.final_validation.issues = []
  assert.equal(messageReviewMarker([step(fixture)])?.kind, 'observed')
  const unexplainedDetail = observedMetadata()
  assert.equal(messageReviewMarker([step({ ...unexplainedDetail, final_validation: { ...unexplainedDetail.final_validation,
    details: [{ fragment: 'Dato sin comprobar' }] } })])?.kind, 'observed')
})

test('demo mode is never inferred from an unverified status label', () => {
  assert.equal(messageReviewMarker([step({ ...observed('rejected_review'), review_control: { observationOnly: true } })]), null)
})

test('extractor and delivery failures do not become review rejections', () => {
  const extraction = step({ status: 'invalid', issues: ['non_current_evidence:turn_semantics.budget.evidence'] }, 'semantic_extraction', 8)
  extraction.status = 'failed'
  extraction.errorCode = 'TURN_INTERPRETATION_INVALID'
  const delivery = step({ status: 'rejected_review' }, 'message_delivery', 15)
  delivery.status = 'failed'
  assert.equal(messageReviewMarker([extraction, delivery]), null)
  assert.equal(messageReviewMarker([extraction, step({ status: 'checked' }), delivery]), null)
})

test('a standalone provider timeout does not pretend that the draft was rejected', () => {
  assert.equal(messageReviewMarker([step({ status: 'unavailable', semantic_review: { error_code: 'REVIEW_TIMEOUT' } })]), null)
})

test('a catalogue recovery records the discarded draft separately from the replacement', () => {
  assert.equal(messageReviewMarker([step({ status: 'recovered_catalog_result', recovery: { strategy: 'verified_empty_search', pending: false } })])?.tone, 'rejected')
})

test('the final approved coverage supersedes a preceding rejection without hiding its repair', () => {
  const marker = messageReviewMarker([
    step({ status: 'checked' }, 'response_coverage', 18),
    step({ status: 'rejected_guard' }, 'response_coverage', 12),
  ])!
  assert.equal(marker.tone, 'warning')
  assert.equal(marker.kind, 'repaired')
})

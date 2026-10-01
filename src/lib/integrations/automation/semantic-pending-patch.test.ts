import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { semanticPendingScope, semanticPendingSchema, mergeSemanticPendingPatch } from './semantic-pending-patch'
import { focusedRepairScope, focusedRepairNumericReferences, mergeFocusedRepair, observedNumericIssues, adaptFocusedReview } from './focused-review'
import { buildNumericReferences, numericCoverageIssues } from './focused-numeric-coverage'
import { claimSchema, groundedClaimReviewSchema, reviewClaims } from './semantic-review'
import { atomicNumericSchema, materializeNumericReview } from './atomic-numeric-review'

const sentences = [{ id: 'S1', text: 'El penthouse tiene 3 dormitorios y está en el último nivel.' }]
const sources = [{ id: 'E1', kind: 'project_fact' }]
const fact = { fragment: 'S1', field: 'bedrooms', value: 3, unit_id: 'p602', operator: 'eq' }
const location = { fragment: 'S1', subject: 'Ubicación en el último nivel', claim_kind: 'project_fact', polarity: 'affirmation',
  verdict: 'supported', evidence_ids: ['E1'], evidence: 'La documentación del edificio confirma la ubicación.' }
const pending = { fragment: 'S1', reason: 'Falta el número de planta para comprobar último nivel.' }
const previous: Row = { review_contract: 'focused-review-v1', factual_values: [fact], project_values: [], claims: [],
  numeric_checks: [{ numeric_id: 'N1', classification: 'business_quantity', factual_value_indexes: [0], project_value_indexes: [], unit_ids: [], reason: 'Dormitorios.' }],
  pending_checks: [pending], non_factual_sentence_ids: [], obligation_checks: [{ id: 'business_scope', verdict: 'met' }] }
const issues = [{ code: 'review_sentence_pending', sentence_id: 'S1' }]
const patch = (claim = location): Row => ({ review_contract: 'focused-review-v1', claims: [claim],
  factual_values: [], project_values: [], numeric_checks: [], obligation_checks: [], non_factual_sentence_ids: [], pending_checks: [],
  pending_resolutions: [{ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], factual_value_indexes: [], project_value_indexes: [], reason: 'Relación contrastada.' }] })
const base = groundedClaimReviewSchema({ type: 'object', additionalProperties: false, properties: { claims: claimSchema } }, sources)

test('semantic patch resolves a relation without inventing a floor or regenerating checked quantities', () => {
  const scope = semanticPendingScope(issues, previous, sentences)!
  const merged = mergeSemanticPendingPatch(previous, patch(), scope, sentences, 'same', 'same')
  assert.deepEqual(merged.pending_checks, [])
  assert.deepEqual(merged.claims, [location])
  for (const key of ['factual_values', 'project_values', 'numeric_checks', 'obligation_checks']) assert.deepEqual(merged[key], previous[key])
  assert.deepEqual(observedNumericIssues(merged, sentences), [])
  assert.deepEqual(numericCoverageIssues(merged, buildNumericReferences(sentences), []), [])
})

test('unsupported, contradicted and unverified-source relations still block after a pending repair', () => {
  const scope = semanticPendingScope(issues, previous, sentences)!
  for (const [verdict, evidence_ids] of [['unsupported', []], ['contradicted', ['E1']], ['supported', ['E99']]] as const) {
    const repaired = patch({ ...location, verdict, evidence_ids: [...evidence_ids] })
    const merged = mergeSemanticPendingPatch(previous, repaired, scope, sentences, 'same', 'same')
    const adapted = adaptFocusedReview(merged, sentences, [])
    assert.equal(reviewClaims(adapted.claims, sentences[0].text, sources, true).valid, false)
  }
})

test('semantic-only scope is refused when any independent numeric or commercial failure exists', () => {
  for (const issue of [{ code: 'numeric_binding_not_in_sentence', sentence_id: 'S1' }, { code: 'claim_unsupported', sentence_id: 'S1' }, { code: 'review_sentence_pending', sentence_id: 'S99' }])
    assert.equal(semanticPendingScope([...issues, issue], previous, sentences), null)
})

test('semantic patch cannot change the draft, erase valid quantities or silently drop a pending check', () => {
  const scope = semanticPendingScope(issues, previous, sentences)!
  assert.throws(() => mergeSemanticPendingPatch(previous, patch(), scope, sentences, 'old', 'new'), /DRAFT_CHANGED/)
  const malformed = mergeSemanticPendingPatch(previous, { ...patch(), factual_values: [{ ...fact, value: 4 }] }, scope, sentences, 'same', 'same')
  assert.deepEqual(malformed.factual_values, [fact])
  assert.ok((malformed.pending_repair_issues as Row[]).length)
  const missing = mergeSemanticPendingPatch(previous, { ...patch(), pending_resolutions: [] }, scope, sentences, 'same', 'same')
  assert.deepEqual(missing.pending_checks, [pending])
})

test('strict wire schema requests only semantic repairs and explicit pending resolutions', () => {
  const scope = semanticPendingScope(issues, previous, sentences)!
  const schema = atomicNumericSchema(semanticPendingSchema(base, previous, scope, sentences))
  const validate = new Ajv({ strict: false }).compile(schema)
  const wire = { ...patch(), numeric_contract: 'numeric-inline-v1', numeric_coverage: 'asserted-facts-v1' }
  delete wire.factual_values; delete wire.project_values
  wire.pending_resolutions = [{ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0], numeric_ids: [], reason: 'Relación contrastada.' }]
  assert.equal(validate(wire), true, JSON.stringify(validate.errors))
  assert.deepEqual(materializeNumericReview(wire).pending_resolutions, patch().pending_resolutions)
  assert.equal(validate({ ...wire, numeric_checks: previous.numeric_checks }), false)
  assert.equal(object(object(schema.properties).factual_values).maxItems, undefined)
})

test('removing a phantom floor can add the actual relation while preserving bedroom verification in the same sentence', () => {
  const phantom = { ...fact, field: 'floor_number', value: 6 }
  const prior = { ...previous, pending_checks: [], factual_values: [fact, phantom] }
  const scope = focusedRepairScope(observedNumericIssues(prior, sentences), sentences, [])
  const refs = focusedRepairNumericReferences(scope, prior, buildNumericReferences(sentences), sentences)
  assert.deepEqual(refs, []) // The 3 belongs to an already valid bedroom check.
  scope.numeric_ids = refs.map(ref => ref.id)
  const repaired = { ...patch(), pending_resolutions: [], dismissed_numeric_checks: [{ fragment: 'S1', field: 'floor_number', resolution: 'not_asserted', reason: 'El texto afirma una relación, no el número seis.' }] }
  const merged = mergeFocusedRepair(prior, repaired, scope, sentences)
  assert.deepEqual(merged.factual_values, [fact])
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(merged.numeric_checks, prior.numeric_checks)
  assert.deepEqual(observedNumericIssues(merged, sentences), [])
})

test('an explicit ordinal remains a numeric quantity and its failed field stays in the repair', () => {
  const explicit = [{ id: 'S1', text: 'El penthouse está en la sexta planta.' }]
  const refs = buildNumericReferences(explicit)
  const floor = { ...fact, field: 'floor_number', value: 6 }
  const prior = { ...previous, factual_values: [floor] }
  const scope = focusedRepairScope([{ code: 'invalid_unit_fact', sentence_id: 'S1', field: 'floor_number' }], explicit, [])
  assert.deepEqual(focusedRepairNumericReferences(scope, prior, refs, explicit), refs)
})

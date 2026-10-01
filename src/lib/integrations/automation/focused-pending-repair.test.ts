import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { mergePendingRepairs, pendingReferencesForRepair, pendingResolutionSchema } from './focused-pending-repair'
import { focusedRepairScope, focusedReviewIssues, mergeFocusedRepair } from './focused-review'
import type { Row } from './data'

const sentences = [{ id: 'S1', text: 'El proyecto está en Cuenca y su reserva está confirmada.' },
  { id: 'S2', text: 'La visita está agendada.' }]
const scope = { focused_sentence_ids: ['S1'] }
const pending = { fragment: 'S1', reason: 'Falta contrastar la confirmación de la reserva.' }
const other = { fragment: 'S2', reason: 'Falta contrastar la visita.' }
const location = { fragment: 'S1', subject: 'Ubicación', claim_kind: 'project_fact', verdict: 'supported',
  evidence_ids: ['E1'], evidence: 'La fuente indica Cuenca.', polarity: 'affirmation' }
const resolution = (extra: Row = {}) => ({ pending_id: 'P1', resolution: 'resolved', claim_indexes: [0],
  factual_value_indexes: [], project_value_indexes: [], reason: 'La nueva comprobación contrasta el estado operativo.', ...extra })

test('a partial sentence fact cannot silently erase a pending assertion from the same sentence', () => {
  const previous = { review_contract: 'focused-review-v1', claims: [location], factual_values: [], project_values: [],
    non_factual_sentence_ids: [], pending_checks: [pending], obligation_checks: [], numeric_checks: [] }
  const repairScope = focusedRepairScope([{ code: 'review_sentence_pending', sentence_id: 'S1' }], [sentences[0]], [])
  const repaired = { ...previous, claims: [], pending_checks: [], claim_resolutions: [], pending_resolutions: [] }
  const merged = mergeFocusedRepair(previous, repaired, repairScope, [sentences[0]])
  assert.deepEqual(merged.claims, [location])
  assert.deepEqual(merged.pending_checks, [pending])
  assert.ok(focusedReviewIssues(merged, [sentences[0]], []).issues.some(row => row.code === 'review_sentence_pending'))
})

test('pending references preserve their global IDs when a repair targets only one sentence', () => {
  const refs = pendingReferencesForRepair([other, pending], scope, sentences)
  assert.deepEqual(refs.map(row => [row.pending_id, row.pending_index, row.sentence_id]), [['P2', 1, 'S1']])
  const whole = { focused_sentence_ids: ['S1', 'S2'] }
  assert.deepEqual(pendingReferencesForRepair([{ fragment: 'S99', reason: 'Referencia inválida.' }], whole, sentences)
    .map(row => [row.pending_id, row.sentence_id]), [['P1', null]])
})

test('an explicit resolution linked to a new same-sentence assertion removes only its own pending check', () => {
  const reservation = { fragment: 'S1', subject: 'Reserva', verdict: 'supported' }
  const nextPending = { fragment: 'S1', reason: 'Falta confirmar la fecha.' }
  const merged = mergePendingRepairs({ pending_checks: [pending, other] },
    { claims: [reservation], pending_checks: [nextPending], pending_resolutions: [resolution()] }, scope, sentences)
  assert.deepEqual(merged.pending_checks, [other, nextPending])
  assert.deepEqual(merged.issues, [])
  assert.equal(merged.resolutions.length, 1)
  for (const key of ['factual_values', 'project_values']) {
    const indexKey = key === 'factual_values' ? 'factual_value_indexes' : 'project_value_indexes'
    const result = mergePendingRepairs({ pending_checks: [pending] }, { [key]: [{ fragment: sentences[0].text }], pending_checks: [],
      pending_resolutions: [resolution({ claim_indexes: [], [indexKey]: [0] })] }, scope, sentences)
    assert.deepEqual(result.pending_checks, [])
    assert.deepEqual(result.issues, [])
  }
})

test('a nonexistent assertion can be explicitly dismissed without treating an empty list as a resolution', () => {
  const dismissal = resolution({ resolution: 'not_asserted', claim_indexes: [], reason: 'El borrador no afirma ese hecho.' })
  const result = mergePendingRepairs({ pending_checks: [pending] }, { pending_checks: [], pending_resolutions: [dismissal] }, scope, sentences)
  assert.deepEqual(result.pending_checks, [])
  assert.deepEqual(result.resolutions, [dismissal])
  assert.deepEqual(result.issues, [])
})

test('missing links, duplicates, unknown pending IDs and out-of-sentence references preserve the pending check', () => {
  for (const resolutions of [
    [resolution({ claim_indexes: [] })], [resolution(), resolution()], [resolution({ pending_id: 'P9' })],
    [resolution({ claim_indexes: [1] })], [resolution({ claim_indexes: [-1] })],
    [resolution({ reason: '  ' })], [resolution({ resolution: 'not_asserted' })],
    [resolution({ claim_indexes: [0, 0] })],
  ]) {
    const result = mergePendingRepairs({ pending_checks: [pending] },
      { claims: [{ fragment: 'S2' }], pending_checks: [], pending_resolutions: resolutions }, scope, sentences)
    assert.deepEqual(result.pending_checks, [pending], JSON.stringify(resolutions))
    assert.ok(result.issues.every(row => row.code === 'invalid_pending_repair_resolution' && row.kind === 'review_metadata'))
    assert.ok(result.issues.length)
  }
  const outside = mergePendingRepairs({ pending_checks: [pending, other] },
    { pending_checks: [], pending_resolutions: [resolution({ pending_id: 'P2', resolution: 'not_asserted', claim_indexes: [] })] }, scope, sentences)
  assert.deepEqual(outside.pending_checks, [pending, other])
  assert.ok(outside.issues.length)
})

test('a newly reported pending check outside repair scope remains a blocking repair error', () => {
  const result = mergePendingRepairs({ pending_checks: [] }, { pending_checks: [other] }, scope, sentences)
  assert.equal(result.issues[0].code, 'invalid_pending_repair_resolution')
})

test('pending resolution schema enforces explicit compatible links and rejects impossible combinations', () => {
  const validate = new Ajv({ strict: false }).compile(pendingResolutionSchema([pending], scope, sentences))
  for (const row of [resolution(), resolution({ claim_indexes: [], factual_value_indexes: [0] }),
    resolution({ claim_indexes: [], project_value_indexes: [0] }), resolution({ resolution: 'not_asserted', claim_indexes: [] })])
    assert.equal(validate([row]), true, JSON.stringify(validate.errors))
  for (const row of [resolution({ claim_indexes: [] }), resolution({ resolution: 'not_asserted' }), resolution({ pending_id: 'P9' })])
    assert.equal(validate([row]), false, JSON.stringify(row))
  assert.equal(validate([]), true) // Omitting a decision conserves the pending check in the merge.
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { claimReferencesForRepair, focusedRepairScope, mergeFocusedRepair } from './focused-review'
import { reviewClaims } from './semantic-review'
import type { Row } from './data'

const sentences = [{ id: 'S1', text: 'La Vilet está en Cuenca y cuenta con helipuerto.' }, { id: 'S2', text: 'Podemos compartirle información.' }]
const location = { fragment: sentences[0].text, subject: 'Ubicación', claim_kind: 'project_fact', polarity: 'affirmation',
  verdict: 'supported', evidence_ids: ['E1'], evidence_source: 'verified_context', evidence: 'Ubicación registrada.' }
const unsupported = { ...location, subject: 'Helipuerto', verdict: 'unsupported', evidence_ids: [], evidence_source: 'none', evidence: 'No consta un helipuerto.' }
const previous: Row = { review_contract: 'focused-review-v1', claims: [location, unsupported], factual_values: [], project_values: [],
  non_factual_sentence_ids: ['S2'], pending_checks: [], obligation_checks: [] }
const scope = focusedRepairScope([{ code: 'claim_unsupported', fragment: sentences[0].text }], sentences, [])
const repair = (extra: Row = {}): Row => ({ claims: [], factual_values: [], project_values: [], pending_checks: [],
  non_factual_sentence_ids: [], obligation_checks: [], claim_resolutions: [], ...extra })

test('a valid fact in the same sentence cannot erase an unsupported commercial claim during repair', () => {
  for (const replacement of [repair({ claims: [{ ...location, fragment: 'S1' }] }),
    repair({ factual_values: [{ fragment: 'S1', unit_id: 'u1', field: 'bedrooms', value: 3, operator: 'eq' }] })]) {
    const merged = mergeFocusedRepair(previous, replacement, scope, sentences)
    assert.ok((merged.claims as Row[]).includes(unsupported))
    assert.ok(reviewClaims(merged.claims, sentences[0].text, [{ id: 'E1', kind: 'project_fact' }], true)
      .issues.some(issue => issue.code === 'claim_unsupported'))
    assert.deepEqual(merged.claim_resolutions, [])
  }
})

test('replacing an earlier claim requires its stable ID and a new claim from the same sentence', () => {
  const replacement = { ...unsupported, fragment: 'S1', verdict: 'supported', evidence_ids: ['E2'], evidence_source: 'verified_context', evidence: 'Fuente nueva verificada.' }
  const resolution = { claim_id: 'C2', resolution: 'replaced', replacement_indexes: [0], reason: 'Se corrigió la fuente de esta afirmación concreta.' }
  const merged = mergeFocusedRepair(previous, repair({ claims: [replacement], claim_resolutions: [resolution] }), scope, sentences)
  assert.deepEqual(merged.claims, [location, replacement])
  assert.deepEqual(merged.claim_resolutions, [resolution])
  assert.deepEqual(merged.claim_repair_issues, [])
})

test('discarding a misattributed claim requires an explicit not_asserted resolution with a reason', () => {
  const actualSentences = [{ id: 'S1', text: 'La Vilet está en Cuenca.' }]
  const realLocation = { ...location, fragment: actualSentences[0].text }
  const misattributed = { ...unsupported, fragment: actualSentences[0].text }
  const prior = { ...previous, claims: [realLocation, misattributed] }
  const target = focusedRepairScope([{ code: 'claim_unsupported', fragment: 'S1' }], actualSentences, [])
  const resolution = { claim_id: 'C2', resolution: 'not_asserted', replacement_indexes: [], reason: 'El borrador solo expresa la ubicación; la ficha anterior añadió una instalación no mencionada.' }
  const merged = mergeFocusedRepair(prior, repair({ claim_resolutions: [resolution] }), target, actualSentences)
  assert.deepEqual(merged.claims, [realLocation])
  assert.deepEqual(merged.claim_resolutions, [resolution])
  assert.deepEqual(merged.claim_repair_issues, [])
})

test('invalid and ambiguous claim resolutions preserve the prior claim and expose a technical issue', () => {
  const cases: Row[][] = [
    [{ claim_id: 'C99', resolution: 'not_asserted', replacement_indexes: [], reason: 'Fuera del alcance.' }],
    [{ claim_id: 'C2', resolution: 'not_asserted', replacement_indexes: [], reason: ' ' }],
    [{ claim_id: 'C2', resolution: 'not_asserted', replacement_indexes: [0], reason: 'Incompatible.' }],
    [{ claim_id: 'C2', resolution: 'replaced', replacement_indexes: [99], reason: 'Índice inexistente.' }],
    [{ claim_id: 'C2', resolution: 'replaced', replacement_indexes: [0.5], reason: 'Índice no entero.' }],
    [{ claim_id: 'C2', resolution: 'replaced', replacement_indexes: [], reason: 'Sin reemplazo.' }],
    [{ claim_id: 'C2', resolution: 'replaced', replacement_indexes: [0], reason: 'Reemplazo repetido.' },
      { claim_id: 'C1', resolution: 'replaced', replacement_indexes: [0], reason: 'No permite borrar otro claim con el mismo reemplazo.' }],
    [{ claim_id: 'C2', resolution: 'not_asserted', replacement_indexes: [], reason: 'Primero.' },
      { claim_id: 'C2', resolution: 'not_asserted', replacement_indexes: [], reason: 'Segundo.' }],
  ]
  for (const resolutions of cases) {
    const merged = mergeFocusedRepair(previous, repair({ claims: [{ ...location, fragment: 'S1' }], claim_resolutions: resolutions }), scope, sentences)
    assert.ok((merged.claims as Row[]).includes(unsupported), JSON.stringify(resolutions))
    const issues = merged.claim_repair_issues as Row[]
    assert.ok(issues.length, JSON.stringify(resolutions))
    assert.ok(issues.every(issue => issue.code === 'invalid_claim_repair_resolution' && issue.owner === 'system' && issue.repair_owner === 'reviewer'))
  }
  const malformed = mergeFocusedRepair(previous, repair({ claim_resolutions: 'invalid' }), scope, sentences)
  assert.ok((malformed.claim_repair_issues as Row[]).length)
  assert.deepEqual(malformed.claims, previous.claims)
})

test('cross-sentence and out-of-scope replacements cannot clear an earlier unsupported claim', () => {
  const wider = focusedRepairScope([{ code: 'claim_unsupported', fragment: 'S1' }, { code: 'unreviewed_sentence', sentence_id: 'S2' }], sentences, [])
  const resolution = { claim_id: 'C2', resolution: 'replaced', replacement_indexes: [0], reason: 'Se intentó usar otra oración.' }
  const merged = mergeFocusedRepair(previous, repair({ claims: [{ ...location, fragment: 'S2' }], claim_resolutions: [resolution] }), wider, sentences)
  assert.ok((merged.claims as Row[]).includes(unsupported))
  assert.ok((merged.claim_repair_issues as Row[]).some(issue => String(issue.reason).includes('misma oración')))
  const unrelated = { ...location, fragment: 'S2' }
  const prior = { ...previous, claims: [unrelated, unsupported] }
  const references = claimReferencesForRepair(prior.claims, scope, sentences)
  assert.deepEqual(references.map(reference => reference.claim_id), ['C2'])
  const removedOutside = mergeFocusedRepair(prior, repair({ claim_resolutions: [{ claim_id: 'C1', resolution: 'not_asserted', replacement_indexes: [], reason: 'No está en el alcance.' }] }), scope, sentences)
  assert.ok((removedOutside.claims as Row[]).includes(unrelated))
  assert.ok((removedOutside.claim_repair_issues as Row[]).length)
})

test('claim IDs are global and a malformed prior sentence needs explicit resolution rather than silent removal', () => {
  const prior = { ...previous, claims: [{ ...location, fragment: 'S2' }, { ...unsupported, fragment: 'S99' }] }
  const all = focusedRepairScope([{ code: 'unknown_review_sentence', fragment: 'S99' }], sentences, [])
  assert.deepEqual(claimReferencesForRepair(prior.claims, all, sentences).map(reference => [reference.claim_id, reference.claim_index, reference.sentence_id]),
    [['C1', 0, 'S2'], ['C2', 1, null]])
  const unresolved = mergeFocusedRepair(prior, repair({ claims: [{ ...location, fragment: 'S1' }] }), all, sentences)
  assert.ok((unresolved.claims as Row[]).some(claim => claim.fragment === 'S99'))
  const fixed = mergeFocusedRepair(prior, repair({ claims: [{ ...location, fragment: 'S1' }], claim_resolutions: [
    { claim_id: 'C2', resolution: 'replaced', replacement_indexes: [0], reason: 'La cita correcta corresponde a la primera oración.' },
  ] }), all, sentences)
  assert.equal((fixed.claims as Row[]).some(claim => claim.fragment === 'S99'), false)
  assert.deepEqual(fixed.claim_repair_issues, [])
})

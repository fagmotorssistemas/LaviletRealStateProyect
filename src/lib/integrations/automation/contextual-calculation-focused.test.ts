import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { contextualReasoningEvidence, type ContextualCalculation } from './contextual-reasoning'
import { claimSchema, factualValuesSchema, groundedClaimReviewSchema } from './semantic-review'
import { focusedReviewContext, focusedReviewSchema, focusedReviewIssues, FOCUSED_REVIEW_VERSION } from './focused-review'
import { buildNumericReferences, numericCoverageIssues } from './focused-numeric-coverage'
import { focusedValueScopeIssues } from './focused-value-scope'
import { numericSubjectIssues } from './focused-subject-scope'
import { normalizeReviewReferences, replyReferences, sentenceReferenceReviewSchema } from './turn-evidence'
import { structuredFactIssues, structuredReviewSchema } from './structured-facts'
import { completeTurnReply } from './turn-completeness'

const current = 'Mi cama mide 90 x 190 cm. ¿Qué superficie ocupa?'
const reply = 'Según las medidas que indicó, la huella calculada sería de 1,71 m². La distribución y circulación requieren comprobar el dormitorio.'
const catalog: Row[] = [{ id: 'p602', unit_number: '602', category: 'penthouse', area_internal_m2: 142.09, bedrooms: 3, floor_number: 6, status: 'disponible', is_published: true }]
const proof: ContextualCalculation = { operation: 'multiply', operands: [
  { value: 90, unit: 'cm', source: { kind: 'lead_current', reference: '', quote: '90 x 190 cm' } },
  { value: 190, unit: 'cm', source: { kind: 'lead_current', reference: '', quote: '90 x 190 cm' } },
], result: { value: 1.71, unit: 'm2' }, scope: 'grounded' }
const derived = (fragment = 'S1'): Row => ({ fragment, field: 'derived_value', unit_id: null, value: 1.71,
  measurement_unit: 'm2', operator: 'eq', upper_value: null, value_scope: 'individual', subject_category: null, calculation: structuredClone(proof) })
const check = (numeric_id: string, classification: string, extra: Row = {}): Row => ({ numeric_id, classification,
  factual_value_indexes: [], project_value_indexes: [], unit_ids: [], reason: 'Expresión contrastada según su procedencia.', ...extra })
function schemaFor(text: string, units: Row[] = []): Row {
  const base: Row = { type: 'object', additionalProperties: false, properties: { factual_values: factualValuesSchema, claims: claimSchema }, required: ['factual_values', 'claims'] }
  const referenced = sentenceReferenceReviewSchema(base, text, current, units, true)
  const structured = structuredReviewSchema(referenced, replyReferences(text).map(row => row.id), units, [])
  return focusedReviewSchema(groundedClaimReviewSchema(structured, []), replyReferences(text), [], units)
}
function reviewFor(text = reply, facts: Row[] = [derived()]): Row {
  return { review_contract: FOCUSED_REVIEW_VERSION, claims: [], factual_values: facts, project_values: [],
    non_factual_sentence_ids: replyReferences(text).filter(row => !facts.some(fact => fact.fragment === row.id)).map(row => row.id),
    pending_checks: [], obligation_checks: [], numeric_checks: buildNumericReferences(replyReferences(text)).map(ref =>
      check(ref.id, 'business_quantity', { factual_value_indexes: [facts.findIndex(fact => fact.fragment === ref.sentence_id && fact.value === ref.value)] })) }
}

for (const units of [[], catalog]) test('final focused schema keeps a checked derived result without inventing a catalogue subject: catalog=' + units.length, () => {
  const validate = new Ajv({ allErrors: true }).compile(schemaFor(reply, units)), review = reviewFor()
  assert.ok(validate(review), JSON.stringify(validate.errors))
  assert.deepEqual(focusedReviewIssues(review, replyReferences(reply), []).issues, [])
  assert.deepEqual(numericCoverageIssues(review, buildNumericReferences(replyReferences(reply)), units), [])
  const normalized = normalizeReviewReferences(review, units, reply, current, true).review
  assert.deepEqual(structuredFactIssues(normalized.factual_values, units, contextualReasoningEvidence(current, { catalogo: units }), reply), [])
  assert.deepEqual(focusedValueScopeIssues(normalized.factual_values, units, true), [])
  assert.deepEqual(numericSubjectIssues(normalized.factual_values, units), [])
  for (const change of [{ unit_id: 'p602' }, { subject_category: 'penthouse' }, { value_scope: 'group_summary' }, { operator: 'gte' }])
    assert.equal(validate(reviewFor(reply, [{ ...derived(), ...change }])), false, JSON.stringify(change))
})

test('the nonfocused sentence projection also preserves null subject and proof with an empty catalogue', () => {
  const base: Row = { type: 'object', additionalProperties: false, properties: { factual_values: factualValuesSchema }, required: ['factual_values'] }
  const schema = sentenceReferenceReviewSchema(base, reply, current, [])
  const fact = derived(); delete fact.value_scope; delete fact.subject_category
  const validate = new Ajv({ allErrors: true }).compile(schema)
  assert.ok(validate({ factual_values: [fact] }), JSON.stringify(validate.errors))
  assert.equal(validate({ factual_values: [{ ...fact, value: 9 }] }), false, 'A value absent from the draft is not a candidate')
})

test('correct schema shape and numeric coverage cannot waive an invented operand or wrong result proof', () => {
  const validate = new Ajv({ allErrors: true }).compile(schemaFor(reply))
  for (const kind of ['fabricated_measure', 'wrong_arithmetic']) {
    const fact = derived(), calculation = object(fact.calculation)
    if (kind === 'fabricated_measure') (calculation.operands as Row[])[0].value = 100
    else object(calculation.result).value = 2
    const review = reviewFor(reply, [fact])
    assert.ok(validate(review), JSON.stringify(validate.errors))
    assert.deepEqual(numericCoverageIssues(review, buildNumericReferences(replyReferences(reply)), []), [])
    const normalized = normalizeReviewReferences(review, [], reply, current, true).review
    assert.ok(structuredFactIssues(normalized.factual_values, [], contextualReasoningEvidence(current, {}), reply)
      .some(issue => issue.code === 'derived_calculation_unverified'), kind)
  }
  assert.ok(focusedValueScopeIssues([{ ...derived(), value_scope: 'each_member' }], [], true).length)
  assert.ok(numericSubjectIssues([{ ...derived(), subject_category: 'penthouse' }], []).length)
})

test('a mixed reply verifies published project measurements separately from arithmetic and retains ordinary exact-value rejection', () => {
  const text = 'El penthouse 602 tiene 142,09 m² interiores. ' + reply
  const published: Row = { fragment: 'S1', unit_id: 'p602', field: 'area_internal_m2', value: 142.09,
    measurement_unit: 'm2', operator: 'eq', upper_value: null, value_scope: 'individual', subject_category: 'penthouse' }
  const facts = [published, derived('S2')], review = reviewFor(text, facts)
  const refs = buildNumericReferences(replyReferences(text))
  review.numeric_checks = refs.map(ref => ref.value === 602 ? check(ref.id, 'unit_identifier', { unit_ids: ['p602'] })
    : check(ref.id, 'business_quantity', { factual_value_indexes: [ref.value === 142.09 ? 0 : 1] }))
  const validate = new Ajv({ allErrors: true }).compile(schemaFor(text, catalog))
  assert.ok(validate(review), JSON.stringify(validate.errors))
  assert.deepEqual(numericCoverageIssues(review, refs, catalog), [])
  const normalized = normalizeReviewReferences(review, catalog, text, current, true).review
  assert.deepEqual(structuredFactIssues(normalized.factual_values, catalog, contextualReasoningEvidence(current, { catalogo: catalog }), text), [])
  const wrong = structuredClone(normalized.factual_values as Row[]); wrong[0].value = 142
  assert.ok(structuredFactIssues(wrong, catalog, contextualReasoningEvidence(current, { catalogo: catalog }), text).length,
    'Adding calculation support never allows rounding a published measurement')
  const unlinked = { ...review, numeric_checks: (review.numeric_checks as Row[]).map(row => row.classification === 'business_quantity'
    ? { ...row, factual_value_indexes: [] } : row) }
  assert.ok(numericCoverageIssues(unlinked, refs, catalog).length, 'A narrative approval cannot replace quantity bindings')
})

test('focused projection carries arithmetic sources independently of catalogue claim sources', () => {
  const evidence = contextualReasoningEvidence(current, { catalogo: catalog })
  const context = { mensaje_actual: current, razonamiento_contextual: evidence, evidencia_afirmaciones: [],
    oraciones_borrador: replyReferences(reply), respuesta_propuesta: reply, contexto_verificado: {}, contrato_redaccion: {} }
  const original = structuredClone(context), projected = focusedReviewContext(context, [])
  assert.deepEqual(projected.razonamiento_contextual, evidence)
  assert.deepEqual(context, original)
})

test('the real focused pipeline accepts a proven calculation with no catalogue after validating its final strict schema', async () => {
  const calls: string[] = [], validate = new Ajv({ allErrors: true })
  const result = await completeTurnReply({ current, baseReply: reply, history: [], verified: {
    catalogo: [], proyecto: {}, solicitudes_interpretadas: [{ request: current, evidence: current, domain: 'property', confidence: 'high' }],
    semantica_turno: { primary_intent: 'project_information', confidence: 'high', property: { operation: 'details' } },
    datos_confirmados: { proposito: 'vivir' },
  }, audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: false } },
  async (_instructions, input, schema, _image, _file, _tone, task) => {
    calls.push(task!)
    const context = object(input)
    assert.equal(object(context.razonamiento_contextual).current_message, current)
    let response: Row
    if (task === 'writing') response = { reply, question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
      requests: (context.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id, intent: 'Explicar la huella con las medidas declaradas', request_type: 'general_information',
        status: 'answered', evidence: 'Se responde con cálculo y limitación de distribución.', fact_key: null })) }
    else {
      const actual = String(context.respuesta_propuesta), sentences = context.oraciones_borrador as Row[]
      const fact = derived(sentences.find(sentence => String(sentence.text).includes('1,71 m²'))!.id as string)
      response = reviewFor(actual, [fact])
      response.obligation_checks = (context.obligaciones_aplicables as Row[]).map(obligation => ({ id: obligation.id, verdict: 'met', sentence_ids: [fact.fragment], reason: 'La respuesta cumple esta obligación.' }))
    }
    const compiled = validate.compile(schema!)
    assert.ok(compiled(response), JSON.stringify(compiled.errors))
    return response
  })
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.match(result.reply, /1,71 m²/)
})


test('a derived null subject cannot be resolved through a legacy blank unit number', () => {
  const normalized = normalizeReviewReferences(reviewFor(), [{ id: 'legacy-unit', unit_number: '' }], reply, current, true).review
  assert.equal((normalized.factual_values as Row[])[0].unit_id, null)
  assert.deepEqual(structuredFactIssues(normalized.factual_values, [], contextualReasoningEvidence(current, {}), reply), [])
})


test('a broken arithmetic proof repairs only the focused reviewer sheet while preserving the writer draft', async () => {
  const message = 'Mis dos camas miden 90 x 190 cm cada una. ¿Qué superficie ocupan?'
  const text = 'Las huellas calculadas suman 3,42 m². La distribución y circulación requieren comprobar el dormitorio.'
  const arithmetic: ContextualCalculation = { ...structuredClone(proof), operands: [...structuredClone(proof.operands),
    { value: 2, unit: 'count', source: { kind: 'lead_current', reference: '', quote: 'dos camas' } }], result: { value: 3.42, unit: 'm2' } }
  const calls: string[] = [], drafts: string[] = [], ajv = new Ajv({ allErrors: true })
  let reviews = 0
  const result = await completeTurnReply({ current: message, baseReply: text, history: [], verified: {
    catalogo: [], proyecto: {}, solicitudes_interpretadas: [{ request: message, evidence: message, domain: 'property', confidence: 'high' }],
    semantica_turno: { primary_intent: 'project_information', confidence: 'high', property: { operation: 'details' } },
    datos_confirmados: { proposito: 'vivir' },
  }, audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: false } },
  async (_instructions, input, schema, _image, _file, _tone, task) => {
    calls.push(task!)
    const context = object(input)
    assert.equal(object(context.razonamiento_contextual).current_message, message)
    let response: Row
    if (task === 'writing') response = { reply: text, question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
      requests: (context.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id, intent: 'Calcular las huellas de ambas camas', request_type: 'general_information',
        status: 'answered', evidence: 'Se explica la operación sin confirmar cabida.', fact_key: null })) }
    else {
      reviews++
      assert.equal(context.respuesta_propuesta, text, 'A reviewer metadata repair must keep the original writer draft')
      drafts.push(String(context.respuesta_propuesta))
      const fact: Row = { ...derived('S1'), value: 3.42, calculation: structuredClone(arithmetic) }
      if (reviews === 1) object(object(fact.calculation).result).value = 3.5
      response = reviewFor(text, [fact])
      response.obligation_checks = (context.obligaciones_aplicables as Row[]).map(obligation => ({ id: obligation.id, verdict: 'met', sentence_ids: ['S1'], reason: 'La respuesta cumple esta obligación.' }))
      if (reviews === 2) {
        const repair = object(context.reparacion_revision)
        const errors = repair.errores as Row[]
        assert.ok(errors.some(error => error.code === 'derived_calculation_unverified' && error.kind === 'review_metadata' && error.repair_owner === 'reviewer'))
        assert.deepEqual((context.oraciones_borrador as Row[]).map(sentence => sentence.id), ['S1'], 'Only the calculation sentence is rechecked')
        assert.deepEqual(context.obligaciones_aplicables, [], 'Previously satisfied commercial obligations stay in the accepted sheet')
        response.non_factual_sentence_ids = []
        response.dismissed_numeric_checks = []
        response.claim_resolutions = []
        response.pending_resolutions = []
      }
    }
    const validate = ajv.compile(schema!)
    assert.ok(validate(response), JSON.stringify(validate.errors))
    return response
  })
  assert.deepEqual(calls, ['writing', 'review', 'review'])
  assert.deepEqual(drafts, [text, text])
  assert.equal(result.reply, text)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  const repairs = result.audit.repair_attempts as Row[]
  assert.equal(repairs.length, 1)
  assert.equal(repairs[0].target, 'review_metadata')
  assert.deepEqual(repairs[0].focused_sentence_ids, ['S1'])
  assert.deepEqual(repairs[0].remaining_issues, [])
  const finalFacts = object(result.audit.semantic_review).factual_values as Row[]
  assert.equal(object(object(finalFacts[0].calculation).result).value, 3.42)
})

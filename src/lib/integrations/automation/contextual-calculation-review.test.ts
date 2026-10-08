import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { validateBusinessFacts, factFindings } from './business-facts'
import { businessRiskSchemaForSources, businessRiskContext, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { contextualReasoningEvidence, type ContextualCalculation } from './contextual-reasoning'
import { factualValueIssues, derivedFactualValueSchema } from './semantic-review'
import { structuredFactIssues, structuredReviewSchema } from './structured-facts'
import { remapNumericChecks } from './focused-numeric-coverage'
import { object, type Row } from './data'

const current = 'Serían dos camas de 0.9 m por 1.9 m.'
const units = [{ id: '602', category: 'penthouse', area_internal_m2: 109.69, area_exterior_m2: 34.59, bedrooms: 2 }]
const evidence = contextualReasoningEvidence(current, { catalogo: units })
const source = { kind: 'lead_current' as const, reference: '', quote: current }
const proof: ContextualCalculation = { operation: 'multiply', operands: [
  { value: 0.9, unit: 'm', source }, { value: 1.9, unit: 'm', source }, { value: 2, unit: 'count', source },
], result: { value: 3.42, unit: 'm2' }, scope: 'grounded' }
const draft = 'Con sus medidas, la superficie conjunta es 3,42 m². Eso no confirma la cabida; hace falta revisar distribución y circulación.'
const fact: Row = { statement: draft, kind: 'other_calculation', subject_id: null, scope: null,
  field: 'derived_value', value: 3.42, upper_value: null, relation: 'eq', unit: 'm2', calculation: proof }
const derived: Row = { fragment: draft, field: 'derived_value', unit_id: null, value: 3.42,
  operator: 'eq', upper_value: null, measurement_unit: 'm2', calculation: proof }

function check(value: Row, actualDraft = draft) { return validateBusinessFacts([value], units, [], {}, evidence, actualDraft)[0] }

test('derived business arithmetic is verified separately and never guarantees physical fit', () => {
  const result = check(fact)
  assert.equal(result.status, 'verified')
  assert.equal(result.source?.not_fit_guarantee, true)
  assert.equal(result.source?.scope, 'grounded')
  assert.deepEqual(factFindings([result]), [])
  assert.equal(units[0].area_internal_m2, 109.69)
  const official = check({ ...fact, kind: 'catalog_value', subject_id: '602', field: 'area_internal_m2', calculation: undefined })
  assert.equal(official.status, 'contradiction')
})

test('valid arithmetic cannot authorize a different numeric result or measurement unit in the real draft', () => {
  for (const wrong of ['La superficie conjunta es 3,5 m².', 'La superficie conjunta cuesta $3,42.', 'La medida conjunta es 3,42 m.']) {
    const checked = check({ ...fact, statement: wrong }, wrong)
    assert.equal(checked.status, 'unverified')
    assert.equal(checked.repairable, true)
    assert.ok(factFindings([checked]).length)
    assert.ok(structuredFactIssues([{ ...derived, fragment: wrong }], units, evidence, wrong).length)
  }
  const expressedInCentimetres = 'La superficie conjunta es 34200 cm².'
  assert.equal(check({ ...fact, statement: expressedInCentimetres }, expressedInCentimetres).status, 'verified')
})

test('bad calculation metadata gets bounded repair, then a finding instead of AI-only approval', () => {
  const bad = check({ ...fact, calculation: { ...proof, result: { value: 3.5, unit: 'm2' } } })
  assert.equal(bad.status, 'unverified')
  assert.equal(bad.repairable, true)
  assert.equal(factFindings([bad]).length, 1)
  assert.match(String(factFindings([bad])[0].authoritative_fact), /Corrija o retire el cálculo/)
  assert.equal(check(fact).status, 'verified')
  assert.equal(check({ ...fact, calculation: null }).status, 'unverified')
})

test('spatial arithmetic cannot bypass its proof through a legacy catalogue field or money label', () => {
  const schema = businessRiskSchemaForSources(units, [])
  const validate = new Ajv().compile(schema)
  for (const spoof of [
    { ...fact, field: 'area_internal_m2', calculation: undefined },
    { ...fact, field: 'bedrooms', unit: 'count', calculation: undefined },
    { ...fact, field: 'amount', unit: 'm2', calculation: undefined },
  ]) {
    assert.equal(validate({ review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', facts: [spoof], question: null, findings: [] }), false)
    const checked = check(spoof)
    assert.equal(checked.status, 'unverified')
    assert.equal(checked.repairable, true)
    assert.equal(factFindings([checked]).length, 1)
  }
  const oldFinance = check({ ...fact, field: 'published_commercial_price', unit: 'USD', calculation: undefined })
  assert.equal(oldFinance.status, 'unverified')
  assert.equal(oldFinance.repairable, false)
  assert.deepEqual(factFindings([oldFinance]), [])
})

test('historical, fabricated and silently hypothetical operands are not approved', () => {
  const historical = { ...proof, operands: proof.operands.map(operand => ({ ...operand,
    source: { kind: 'lead_current', reference: '', quote: 'Tengo dos camas de 0.9 m por 1.9 m.' } })) }
  assert.equal(check({ ...fact, calculation: historical }).status, 'unverified')
  const fake = { ...proof, operands: proof.operands.map(operand => ({ ...operand,
    source: { kind: 'project_fact', reference: 'fabricated-room-width', quote: '' } })) }
  assert.equal(check({ ...fact, calculation: fake }).status, 'unverified')
  const assumed = { ...proof, scope: 'illustrative', operands: proof.operands.map(operand => ({ ...operand,
    source: { kind: 'illustrative_assumption', reference: '', quote: 'Si fueran dos camas de 0.9 m por 1.9 m.' } })) }
  assert.equal(check({ ...fact, calculation: assumed }).status, 'unverified')
  const actual = 'Si fueran dos camas de 0.9 m por 1.9 m. ' + draft
  assert.equal(check({ ...fact, statement: actual, calculation: assumed }, actual).status, 'verified')
})

test('business schema accepts existing facts and requires evidence only for derived facts', () => {
  const schema = businessRiskSchemaForSources(units, [])
  const ajv = new Ajv({ allErrors: true })
  const validate = ajv.compile(schema)
  const review = { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', facts: [fact], question: null, findings: [] }
  assert.equal(validate(review), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...review, facts: [{ ...fact, calculation: undefined }] }), false)
  const published = { statement: 'Tiene dos dormitorios.', kind: 'catalog_value', subject_id: '602', scope: null,
    field: 'bedrooms', value: 2, relation: 'eq', unit: 'count', upper_value: null }
  assert.equal(validate({ ...review, facts: [published] }), true, JSON.stringify(validate.errors))
})

test('legacy and structured arithmetic use the same proof while published numbers remain strict', () => {
  assert.deepEqual(factualValueIssues([derived], draft, units, evidence), [])
  assert.deepEqual(structuredFactIssues([derived], units, evidence, draft), [])
  assert.equal(factualValueIssues([{ ...derived, field: 'area_internal_m2', unit_id: '602' }], draft, units, evidence)[0].kind, 'catalog_data')
  assert.equal(structuredFactIssues([{ ...derived, field: 'area_internal_m2', unit_id: '602' }], units, evidence, draft)[0].kind, 'catalog_data')
  assert.equal(structuredFactIssues([{ ...derived, calculation: null }], units, evidence, draft)[0].code, 'derived_calculation_unverified')
  assert.equal(structuredFactIssues([derived], units, evidence, 'Otro texto.')[0].code, 'review_fragment_not_in_reply')
  const schema = structuredReviewSchema({ type: 'object', properties: { factual_values: { type: 'array', items: { type: 'object', properties: {}, required: [] } } }, required: ['factual_values'] }, ['S1'], [], [])
  const validate = new Ajv().compile(object(schema.properties).factual_values)
  assert.equal(validate([{ ...derived, fragment: 'S1' }]), true, JSON.stringify(validate.errors))
  assert.equal(new Ajv().compile(derivedFactualValueSchema(['S1']))({ ...derived, fragment: 'S1' }), true)
})

test('calculation proofs stay distinct when numeric repair indexes are merged', () => {
  const otherProof = { ...proof, scope: 'illustrative' }
  const original = { ...derived, fragment: 'S1' }
  const replacement = { ...original, calculation: otherProof }
  const result = remapNumericChecks([{ numeric_id: 'N1', factual_value_indexes: [0], project_value_indexes: [] }],
    { factual_values: [original] }, { factual_values: [replacement, original] }, [{ id: 'S1', text: draft }])
  assert.deepEqual(result[0].factual_value_indexes, [1])
})

test('business review receives current arithmetic evidence without adding it to catalogue', () => {
  const context = businessRiskContext({ current, reply: draft, obligations: [], units, groups: [], projectFacts: [],
    claimSources: [], verified: { razonamiento_contextual: evidence }, audit: {}, allowedLinks: [] })
  assert.deepEqual(object(context.fuentes_autorizadas).razonamiento_contextual, evidence)
  assert.equal(object(object(context.fuentes_autorizadas).units).derived_value, undefined)
})

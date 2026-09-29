/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { assessMissingFacts } = require('../src/lib/integrations/automation/coverage-evidence.ts')

const priceRequest = '¿Cuánto cuesta?'
const questionText = '¿A cuál de las opciones se refiere?'
const priceCoverage = { fragment: priceRequest, fact_key: 'price', status: 'clarification',
  evidence: 'Falta precisar la unidad de interés del cliente; la pregunta permite identificarla.' }
const approvedQuestion = { text: questionText, purpose: 'clarify_request', missing_datum: 'Unidad de interés',
  next_decision: 'Consultar el precio de la unidad indicada', validated: true, clarifies: [priceRequest] }

test('reviewed clarification uses its request reference without copying the question into evidence', () => {
  assert.ok(!priceCoverage.evidence.includes(questionText))
  const result = assessMissingFacts([priceRequest], {}, [priceCoverage], approvedQuestion)
  assert.equal(result.assessments[0].outcome, 'clarification_needed')
  assert.equal(result.assessments[0].question, questionText)
  assert.deepEqual(result.unresolved, [])
})

test('a canonical clarification cannot cover an undeclared request even if evidence copies its question', () => {
  for (const clarifies of [[], ['¿Aceptan mascotas?']]) {
    const result = assessMissingFacts([priceRequest], {}, [{ ...priceCoverage, evidence: questionText }],
      { ...approvedQuestion, clarifies })
    assert.equal(result.assessments[0].outcome, 'review_conflict')
    assert.deepEqual(result.unresolved, [])
  }
})

test('clarification links require independent validation and the clarification purpose', () => {
  for (const patch of [{ validated: false }, { purpose: 'choose_property' }, { text: '' }]) {
    const result = assessMissingFacts([priceRequest], {}, [priceCoverage], { ...approvedQuestion, ...patch })
    assert.equal(result.assessments[0].outcome, 'review_conflict')
  }
})

test('clarifying the client reference leaves a genuinely missing project fact unresolved', () => {
  const policyRequest = '¿Aceptan mascotas?'
  const policyCoverage = { fragment: policyRequest, fact_key: 'policy', status: 'missing_fact',
    evidence: 'Las fuentes verificadas no describen la política de mascotas.' }
  const result = assessMissingFacts([priceRequest, policyRequest], {}, [priceCoverage, policyCoverage], approvedQuestion)
  assert.deepEqual(result.assessments.map(item => item.outcome), ['clarification_needed', 'missing_fact'])
  assert.deepEqual(result.unresolved, [policyRequest])
})

test('legacy reviews retain literal evidence matching only when clarifies is absent', () => {
  const legacyQuestion = { ...approvedQuestion }
  delete legacyQuestion.clarifies
  const linked = assessMissingFacts([priceRequest], {}, [{ ...priceCoverage, evidence: questionText }], legacyQuestion)
  assert.equal(linked.assessments[0].outcome, 'clarification_needed')
  const unlinked = assessMissingFacts([priceRequest], {}, [priceCoverage], legacyQuestion)
  assert.equal(unlinked.assessments[0].outcome, 'review_conflict')
})

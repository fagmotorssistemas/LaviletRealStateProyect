import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object } from './data'
import { reviewObligations, focusedReviewContext, focusedReviewIssues, focusedReviewSchema } from './focused-review'
import { businessRiskReviewInstructions, businessRiskDecision, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { SEMANTIC_POLICY_REVIEW_RULES } from './semantic-policy-review'
import { PRICE_REPLY_RULES, unitPriceQuote } from './price-reply'

const topics = Object.fromEntries(['project_intro', 'general_location', 'exact_location', 'purchase_prices',
  'commercial_stage', 'construction_status', 'delivery', 'spatial_caveat'].map(key => [key, { allowed: false, reason: 'Not relevant to the current question.' }]))
const scope = { version: 'response-content-scope-v1', topics }
const current = 'Prefiero un penthouse.'
const relevant = 'Podemos revisar los penthouses compatibles. ¿Cuántos dormitorios necesita?'
const sentences = [{ id: 'S1', text: relevant }]

const obligation = () => reviewObligations({}, { alcance_contenido_turno: scope }, {})
  .find(row => row.id === 'response_content_scope')!

test('review receives the same semantic content scope without making allowed topics mandatory', () => {
  const value = obligation()
  assert.equal(value.version, scope.version)
  assert.deepEqual(value.topics, topics)
  assert.match(String(value.instruction), /autoriza pertinencia, no demuestra un hecho ni obliga/)
  assert.match(String(value.instruction), /presupuesto, entrada, ingreso o préstamo/)
  assert.match(String(value.instruction), /sin una infracción concreta de alcance/)
  assert.equal(reviewObligations({}, {}, {}).some(row => row.id === 'response_content_scope'), false)
  const context = focusedReviewContext({ mensaje_actual: current,
    contexto_verificado: { alcance_contenido_turno: scope }, evidencia_afirmaciones: [] }, [value])
  assert.equal(object(context.contexto_verificado).alcance_contenido_turno, undefined)
  assert.deepEqual(context.obligaciones_aplicables, [])
})

test('focused review cannot turn content relevance into a factual veto', () => {
  const obligations = [obligation()]
  const review = { claims: [], factual_values: [], project_values: [], non_factual_sentence_ids: ['S1'], pending_checks: [],
    obligation_checks: [{ id: 'response_content_scope', verdict: 'violated', sentence_ids: ['S1'],
      reason: 'The quoted purchase price was added without a price request or a budget comparison; purchase_prices.allowed=false.' }] }
  const schema = focusedReviewSchema({ type: 'object', properties: {}, required: [] }, sentences, obligations, [], [])
  const value = { ...review, review_contract: 'focused-review-v1', numeric_checks: [] }
  // This isolated schema deliberately does not declare evidence lists; test the
  // live obligation item as well as the runtime disposition of its decision.
  const check = new Ajv().compile(object(object(schema.properties).obligation_checks).items)
  assert.equal(check(review.obligation_checks[0]), false)
  const issues = focusedReviewIssues(value, sentences, obligations).issues
  assert.deepEqual(issues, [])
})

test('courtesy and repetition alone do not invent a scope veto', () => {
  const obligations = [obligation()]
  const review = { claims: [], factual_values: [], project_values: [], non_factual_sentence_ids: ['S1'], pending_checks: [],
    obligation_checks: [{ id: 'response_content_scope', verdict: 'met', sentence_ids: ['S1'], reason: 'Only the relevant response and commercial next step.' }] }
  assert.deepEqual(focusedReviewIssues(review, sentences, obligations).issues, [])
  assert.equal(businessRiskDecision({ review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [] }).approved, true)
})

test('all reviewer paths preserve relevance and dynamic price conditions without a launch-stage obligation', () => {
  assert.match(businessRiskReviewInstructions(), /No evalúe las obligaciones del redactor/)
  assert.match(SEMANTIC_POLICY_REVIEW_RULES, /No decide qué comunicar ni qué preguntar/)
  assert.match(SEMANTIC_POLICY_REVIEW_RULES, /fuente, vigencia y condiciones/)
  assert.match(PRICE_REPLY_RULES, /La etapa por sí sola no decide/)
  const prices = reviewObligations({}, { politica_comercial: { precios_aproximados: true } }, {})
    .find(row => row.id === 'price_conditions')!
  assert.match(String(prices.instruction), /No exija mencionar lanzamiento/)
})

for (const mode of ['lanzamiento', 'preventa']) test('published prices retain current referential conditions in ' + mode, () => {
  const quote = unitPriceQuote({ modo_comercial: mode, alcance_negocio: 'property', catalogo: [{ id: '602', unit_number: '602',
    category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 539900, status: 'disponible', is_published: true }],
    politica_comercial: { precios_autorizados: true, precios_aproximados: true } }, '¿Qué precio tiene el penthouse 602?', {})
  assert.equal(quote?.quoted, true)
  assert.deepEqual(quote?.prices, [539900])
  assert.match(quote!.reply, /referencial|orientativ/)
  assert.match(quote!.reply, /cambi|variar/)
  assert.doesNotMatch(quote!.reply, /lanzamiento/)
})

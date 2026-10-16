import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { acceptedExtractorConfidence, combinedExtractorConfidence } from './extractor-confidence'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { interpretationSourceIssues } from './turn-interpretation-input'
import { normalizeTurnSemantics, normalizedReservation } from './turn-semantics'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { resolveTurnIntent } from './turn-intent'
import { resolvePropertyTurn } from './property-context'
import { withProjectIntroductionForTurn } from './project-introduction-context'
import { evaluateBudgetOptions } from './budget-evaluation'
import { reservationPermission, reservationRequest } from './reservation-action'
import { financingInputs } from './financing'
import { normalizedVisitPreference, normalizedVisitIntent } from './conversation-rules'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { deliveredPendingQuestion } from './continuation-question'
import { financingInvitationReceipt } from './financing-invitation'

function extraction(current: string, confidence = 'medium'): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'property', topics: ['project_overview'], request: current, evidence: current, confidence }]
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'project_information'; semantics.primary_evidence = current; semantics.confidence = confidence
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
  return raw
}

async function interpret(current: string, raw: Row, input: Row = {}) {
  let calls = 0
  const before = structuredClone(raw)
  const result = await interpretConversationTurn({ mensaje_actual: current, ...input }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1, 'The valid medium extraction does not require another model call')
  assert.deepEqual(raw, before, 'The original model confidence remains observable')
  assert.equal(result.diagnostic.confidence_policy, 'high_or_medium_with_current_evidence')
  return result
}

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2,
    published_commercial_price: 350000, is_published: true, status: 'disponible' },
  { id: 'ph602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    published_commercial_price: 550000, is_published: true, status: 'disponible' },
]

test('admission distinguishes medium from low and derived confidence keeps the weakest source', () => {
  assert.equal(acceptedExtractorConfidence('high'), true)
  assert.equal(acceptedExtractorConfidence('medium'), true)
  for (const value of ['low', '', null, undefined, 0.7]) assert.equal(acceptedExtractorConfidence(value), false)
  assert.equal(combinedExtractorConfidence('high', 'medium'), 'medium')
  assert.equal(combinedExtractorConfidence('medium', 'low'), 'low')
})

test('a medium overview survives interpretation, routing and approved summary projection', async () => {
  const current = 'Saludos, quiero información por favor'
  const interpreted = await interpret(current, extraction(current))
  assert.equal(interpreted.semantics.primary_intent, 'project_information')
  assert.equal(interpreted.semantics.confidence, 'medium')
  assert.equal(interpreted.requests[0].confidence, 'medium')
  const intent = resolveTurnIntent({ current, semantics: interpreted.semantics, requests: interpreted.requests,
    scope: { kind: 'property', uncertain: false } })
  assert.equal(intent.objective, 'project_information')
  const info = withProjectIntroductionForTurn({ semantica_turno: interpreted.semantics,
    solicitudes_interpretadas: interpreted.requests, contrato_turno: intent,
    configuracion_presentacion_proyecto: { available: true, summary: 'La Vilet ofrece viviendas y locales en Cuenca.', source: 'approved' } })
  assert.equal(object(info.presentacion_general_proyecto).summary, 'La Vilet ofrece viviendas y locales en Cuenca.')
})

test('medium budget remains medium in durable memory and evaluates verified units without extending affordability', async () => {
  const current = 'Mi presupuesto total es de 400 mil'
  const raw = extraction(current), semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'discuss_budget'
  semantics.budget = { status: 'maximum_total', amount: 400000, evidence: current, confidence: 'medium' }
  raw.requests = [{ domain: 'financing', request: current, evidence: current, confidence: 'medium' }]
  const interpreted = await interpret(current, raw)
  const summary = rememberInterpretedTurn({}, current, interpreted.extracted, interpreted.semantics)
  const budget = object(confirmedInterpretationMemory(summary).budget)
  assert.equal(budget.amount, 400000); assert.equal(budget.confidence, 'medium')
  const evaluated = evaluateBudgetOptions({ budget, units: catalog, pricesAuthorized: true, membershipComplete: true })
  assert.deepEqual(evaluated.matching_unit_ids, ['d202'])
  assert.deepEqual(evaluated.outside_unit_ids, ['ph602'])
  assert.equal(evaluated.universal_affordability_allowed, false)
  const incomplete = evaluateBudgetOptions({ budget, units: [...catalog, { id: 'unknown', category: 'suite' }],
    pricesAuthorized: true, membershipComplete: true })
  assert.equal(incomplete.coverage, 'unknown')
})

test('medium bedrooms reach property retrieval and memory without inventing a category', async () => {
  const current = 'Quiero unos 3 dormitorios'
  const raw = extraction(current), semantics = object(raw.turn_semantics)
  raw.requests = [{ domain: 'property', topics: ['property_options'], request: current, evidence: current, confidence: 'medium' }]
  semantics.property = { group: 'residential', category: null, operation: 'search', reference_kind: 'none',
    query_scope: 'catalog', unit_numbers: [], filters: { bedrooms: 3 }, filter_evidence: { bedrooms: current },
    evidence: current, confidence: 'medium' }
  semantics.housing_quantities = [{ dimension: 'bedrooms', values: [3], role: 'requirement', count_basis: 'unspecified',
    evidence: current, confidence: 'medium' }]
  const interpreted = await interpret(current, raw)
  assert.equal(object(interpreted.semantics.property).confidence, 'medium')
  assert.equal(object(interpreted.semantics.property).category, null)
  const summary = rememberInterpretedTurn({}, current, interpreted.extracted, interpreted.semantics)
  assert.equal(object(confirmedInterpretationMemory(summary).property).confidence, 'medium')
  const resolved = resolvePropertyTurn(catalog, current, summary, [], interpreted.semantics)
  assert.deepEqual(new Set(resolved.matches.map(unit => unit.id)), new Set(['d202', 'ph602']))
  const query = resolvedCatalogQuery({ semantica_turno: interpreted.semantics, solicitudes_interpretadas: interpreted.requests,
    property_context: resolved.context, catalogo: catalog, catalogo_verificacion: catalog,
    catalog_read: { complete: true }, catalog_verification_read: { complete: true } })
  assert.notEqual(query.reason, 'uncertain_interpretation')
  assert.equal(query.request.confidence, 'medium')
})

test('medium still requires current evidence and cannot validate a historical amount or unsupported quantity', () => {
  const current = 'Quiero 3 dormitorios', raw = extraction(current)
  object(raw.turn_semantics).budget = { status: 'maximum_total', amount: 400000, evidence: 'Tengo 400 mil', confidence: 'medium' }
  assert.ok(interpretationSourceIssues(raw, current).includes('non_current_evidence:budget'))
  assert.equal(object(normalizeTurnSemantics(raw, current, {}).budget).status, 'not_discussed')
  object(raw.turn_semantics).budget = { status: 'maximum_total', amount: 400000, evidence: current, confidence: 'medium' }
  assert.ok(interpretationSourceIssues(raw, current).includes('invalid_budget_amount'))
  object(raw.turn_semantics).primary_evidence = 'Quiero información de ayer'
  assert.ok(interpretationSourceIssues(raw, current).includes('non_current_evidence:primary_intent'))
})

test('low remains unavailable for routing, amounts and catalogue facts', () => {
  const current = 'Quiero información', raw = extraction(current, 'low')
  const semantics = normalizeTurnSemantics(raw, current, {})
  assert.equal(semantics.primary_intent, 'other'); assert.equal(semantics.confidence, 'low')
  assert.equal(evaluateBudgetOptions({ budget: { status: 'maximum_total', amount: 600000, confidence: 'low' },
    units: catalog, pricesAuthorized: true, membershipComplete: true }).comparable, false)
})

test('medium accepts only the actual reservation invitation and keeps conditional, negated and stale targets blocked', () => {
  const question = '¿Le gustaría que le ayudemos a iniciar la reserva del departamento 202?'
  const pending = deliveredPendingQuestion(question, { plan: { question_id: 'reservation_invitation', question_act: 'reservation', selected_unit_id: 'd202' },
    metadata: { text: question, purpose: 'permission_to_continue', continuation_id: 'reservation_invitation', continuation_act: 'reservation' } }, catalog)
  const answer = { question_id: pending.id, kind: 'affirmative', evidence: 'Sí', confidence: 'medium' }
  const reservation = normalizedReservation({ kind: 'none' }, 'Sí', pending, answer)
  assert.equal(reservation.kind, 'request'); assert.equal(reservation.confidence, 'medium')
  assert.deepEqual(reservationRequest(reservation, [{ externalId: 'yes', text: 'Sí' }], catalog, [catalog[0]])?.unit_ids, ['d202'])
  assert.equal(reservationRequest(reservation, [{ externalId: 'yes', text: 'Sí' }], catalog, [catalog[1]]), null)
  assert.equal(normalizedReservation({ kind: 'none' }, 'Sí', { ...pending, act: 'confirm_unit' }, answer).kind, 'none')
  const conditional = 'Quiero reservar el departamento 202 solo si me aprueban el crédito'
  const explicit = normalizedReservation({ kind: 'request', evidence: 'Quiero reservar el departamento 202',
    confidence: 'medium', unit_numbers: ['202'] }, conditional)
  assert.equal(reservationPermission(explicit, conditional).kind, 'information')
  assert.equal(reservationRequest({ kind: 'request', evidence: 'quiero reservar el departamento 202',
    confidence: 'medium', unit_numbers: ['202'] }, [{ externalId: 'no', text: 'No quiero reservar el departamento 202' }], catalog, [catalog[0]]), null)
})

test('medium financing consent still belongs to the real operational question, not an informational question or lender name', () => {
  const context = { partners: ['Cooperativa JEP'], current: {} }, current = 'Sí'
  const yes = { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', confidence: 'medium',
    answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: current, confidence: 'medium' } } }
  const operational = '¿Desea que continuemos con el proceso de financiamiento?'
  assert.equal(financingInputs(yes, current, operational, context, { kind: 'financing_consent', reply: operational,
    invitation: financingInvitationReceipt({ text: operational, purpose: 'permission_to_continue',
      continuation_id: 'financing_invitation', continuation_act: 'financing' }) }).consent, true)
  const informational = '¿Desea conocer las opciones de financiamiento?'
  assert.equal(financingInputs(yes, current, informational, context, { kind: 'financing_consent', reply: informational }).consent, null)
  assert.equal(financingInputs({}, 'Con Cooperativa JEP', operational, context, {}).consent, null)
})

test('medium visit data retains its label while alternative dates, rejected visits and noncurrent quotes remain invalid', () => {
  const preference = { evidence: 'viernes a las 10 am', date_text: 'viernes', time_text: 'a las 10 am', location_type: 'office', confidence: 'medium' }
  assert.equal(normalizedVisitPreference(preference, 'viernes a las 10 am')?.confidence, 'medium')
  assert.equal(normalizedVisitPreference(preference, 'viernes a las 10 am o lunes'), null)
  const intent = { kind: 'request_visit', purpose: 'coordination', target: 'project', destination: 'office',
    evidence: 'Quiero una cita', confidence: 'medium' }
  assert.equal(normalizedVisitIntent(intent, 'Quiero una cita')?.confidence, 'medium')
  assert.equal(normalizedVisitIntent({ ...intent, evidence: 'No quiero una cita' }, 'No quiero una cita'), null)
  assert.equal(normalizedVisitIntent(intent, '¿Cuál es el horario?'), null)
})

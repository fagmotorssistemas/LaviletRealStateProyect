import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { commercialJourneyPlan, rememberCommercialJourney, interpretCommercialJourney } from './commercial-journey'
import { courtesyContinuationCandidate } from './courtesy-continuation'
import { turnContinuation } from './turn-continuation'
import { resolvePropertyTurn } from './property-context'
import { normalizedTurnCommunication } from './turn-communication'
import { normalizedPendingQuestion } from './turn-semantics'
import { finalWriterContract } from './response-plan'
import { recordedWriterObjective } from '../../../components/inmobiliaria/automation/workflow/writerContext'
import type { WorkflowExecutionStep } from '../../../components/inmobiliaria/automation/workflow/executionWorkflow'

const units: Row[] = [
  { id: 'u302', unit_number: '302', category: 'departamento', bedrooms: 3, published_commercial_price: 241660 },
  { id: 'u304', unit_number: '304', category: 'departamento', bedrooms: 2, published_commercial_price: 230349 },
  { id: 'u308', unit_number: '308', category: 'suite', bedrooms: 1, published_commercial_price: 169878 },
].map(unit => ({ ...unit, status: 'disponible', is_published: true, floor_number: 3 }))
const pending = { id: 'unit_choice', act: 'confirm_unit', question: '¿Le gustaría continuar con la unidad 302?', target_ids: ['u302'], candidate_ids: ['u302'] }
const info = (kind = 'courtesy_only'): Row => ({ catalogo: units, catalog_read: { complete: true },
  politica_comercial: { precios_autorizados: true }, perfil_lead: { full_name: 'Carlos', residence_city: 'Loja' },
  property_context: { selected_ids: ['u302'], offered_ids: ['u302'], pending_question: pending,
    query: { group: 'residential', category: 'departamento', scope: 'selected', operation: 'none', filters: {} } },
  hechos_confirmados: { budget: { status: 'no_defined_budget', amount: null, confidence: 'high', evidence: 'Aún no lo tengo definido' } },
  recorrido_comercial: {}, semantica_turno: { communication: { kind, confidence: 'high', evidence: 'Gracias', greeting_present: false } },
  contrato_turno: { current_message: 'Gracias', pending_question: pending }, solicitudes_interpretadas: [] })

test('a courtesy resumes the actual pending unit decision, requiring a question but granting no operation', () => {
  const input = info(), before = structuredClone(input), plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'resume_pending_decision')
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(plan.question_act, 'confirm_unit')
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['u302'])
  const contract = finalWriterContract('', { commercial_journey: plan }, { verified: { ...input, siguiente_paso_comercial: plan } })
  assert.equal(object(contract.continuacion_del_turno).required, true)
  assert.equal(plan.financing_offer_allowed, false)
  assert.equal(plan.visit_offer_allowed, false)
  assert.deepEqual(input, before)
})

test('a delivered courtesy reminder is remembered once; an omitted or unsent question cannot count as delivery', () => {
  const input = info(), plan = commercialJourneyPlan(input)
  assert.equal(Object.hasOwn(rememberCommercialJourney({}, plan, {}, true), 'courtesy_resumed_question_keys'), false)
  assert.deepEqual(rememberCommercialJourney({}, plan, pending, false), {})
  const saved = rememberCommercialJourney({}, plan, pending, true)
  const next = { ...input, recorrido_comercial: saved }
  assert.equal(courtesyContinuationCandidate(next), null)
  assert.equal(commercialJourneyPlan(next).action, 'courtesy_only')
  assert.equal(turnContinuation({}, next).required, false)
})

test('the old selected-unit state without a next question now plans a continuation confirmation', () => {
  const input = info('substantive')
  input.property_context = { ...object(input.property_context), pending_question: {} }
  input.contrato_turno = { current_message: 'Dije la 302, no la 308' }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'confirm_selected_option')
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(plan.question_act, 'confirm_unit')
  assert.equal(plan.selected_unit_id, 'u302')
  assert.equal(turnContinuation({}, { ...input, siguiente_paso_comercial: plan }).required, true)
})

test('a real affirmation to this unit confirmation is distinct from courtesy and is not asked again', () => {
  const input = info('substantive')
  const saved = interpretCommercialJourney({}, { answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', confidence: 'high' } }, pending, ['u302'])
  assert.deepEqual(saved.continued_unit_ids, ['u302'])
  assert.equal(commercialJourneyPlan({ ...input, recorrido_comercial: saved }).question_id, '')
  assert.deepEqual(interpretCommercialJourney({}, { answer_to_previous: { question_id: 'unit_choice', kind: 'uncertain', confidence: 'high' } }, pending, ['u302']), {})
  assert.equal(courtesyContinuationCandidate({ ...info(), recorrido_comercial: saved }), null)
})

for (const [label, patch] of Object.entries({
  explicit_close: { semantica_turno: { communication: { kind: 'closing_only', evidence: 'Gracias, hasta luego', confidence: 'high' } } },
  paused: { interaction_mode: { mode: 'information_only' } },
  waiting_reservation: { reservation_context: { active: true } },
  waiting_visit: { propuestas: [{ status: 'awaiting_advisor' }] },
  no_known_decision: { property_context: {}, contrato_turno: {} },
  profile_without_fresh_data: { property_context: { pending_question: { id: 'lead_profile_residence', question: '¿Dónde reside?' } } },
  finance_without_consent: { property_context: { pending_question: { id: 'financing_data', question: 'Pregunta financiera' } } },
})) test('courtesy cannot revive a conversation or capture without authority: ' + label, () => {
  assert.equal(courtesyContinuationCandidate({ ...info(), ...patch }), null)
})

test('a neutral social opening does not create a missing-profile or catalogue question', () => {
  assert.equal(courtesyContinuationCandidate({ ...info(), property_context: {}, contrato_turno: {} }), null)
  const current = 'Gracias, hasta luego'
  assert.equal(normalizedTurnCommunication({ kind: 'closing_only', evidence: current, confidence: 'high', greeting_present: false }, current).kind, 'closing_only')
  assert.equal(commercialJourneyPlan(info('closing_only')).action, 'closing_only')
})

test('restating a delivered financing invitation is not consent to collect financial data', () => {
  const pending = { id: 'financing_invitation', act: 'financing', question: '¿Le gustaría conocer las opciones de financiamiento?' }
  const input = { ...info(), property_context: { pending_question: pending }, financiamiento: { current: {} } }
  assert.equal(commercialJourneyPlan(input).question_id, 'financing_invitation')
  assert.equal(commercialJourneyPlan(input).financing_offer_allowed, false)
  assert.equal(object(object(input.financiamiento).current).explicit_consent, undefined)
})

test('model-declared reference ambiguity preserves the original category, constraints and selection', () => {
  const current = 'La otra opción, no la 304, prefiero la 308'
  const previous = { offered_ids: ['u304', 'u302'], selected_ids: [],
    query: { category: 'departamento', group: 'residential', operation: 'details', scope: 'offered', filters: { bedrooms: 2 } } }
  const result = resolvePropertyTurn(units, current, { _property_context: previous }, [], { property: {
    reference_kind: 'ambiguous', operation: 'details', unit_numbers: ['302', '308'], confidence: 'high', evidence: current } })
  assert.equal(result.needsClarification, true)
  assert.equal(result.explicit, false)
  assert.equal(result.reason, 'unresolved_choice')
  assert.deepEqual(result.context.selected_ids, [])
  assert.deepEqual(result.query, previous.query)
  assert.equal(normalizedPendingQuestion(object(result.context).pending_question).id, 'unit_choice')
  assert.equal(commercialJourneyPlan({ ...info('substantive'), referencia_unidad: result, property_context: result.context }).action, 'clarify_unit_reference')
})

test('an explicit clear request for a new unit is not vetoed just because it was not offered', () => {
  const current = 'Ahora quiero ver la suite 308'
  const result = resolvePropertyTurn(units, current, { _property_context: { offered_ids: ['u304', 'u302'] } }, [], { property: {
    category: 'suite', group: 'residential', reference_kind: 'explicit', operation: 'details', unit_numbers: ['308'], confidence: 'high', evidence: current } })
  assert.equal(result.needsClarification, false)
  assert.equal(result.matches[0].unit_number, '308')
})

test('the highlighted plan is the recorded nested object, with null kept distinct from a missing capture', () => {
  const step = (value: unknown) => ({ key: 'model_request', input: { ai_role: 'writer', prompt_snapshot: { data: { contrato_redaccion: { objetivo_siguiente: value } } } } }) as unknown as WorkflowExecutionStep
  const original = { instruction: 'Primera línea.\nSegunda línea.', question_id: 'unit_choice', selection_scope: { unit_ids: ['302'] } }
  assert.deepEqual(recordedWriterObjective(step(original))?.value, original)
  assert.equal(recordedWriterObjective(step(null))?.value, null)
  assert.equal(recordedWriterObjective({ key: 'model_request', input: { ai_role: 'writer' } } as unknown as WorkflowExecutionStep), null)
})

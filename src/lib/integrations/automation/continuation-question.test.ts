import test from 'node:test'
import assert from 'node:assert/strict'
import { deliveredPendingQuestion } from './continuation-question'
import { journeyPendingQuestion } from './commercial-journey'
import { normalizeTurnSemantics } from './turn-semantics'
import { financingInputs } from './financing'

test('an emitted unit question is not remembered as the purpose the journey planned to ask', () => {
  const reply = 'Tenemos varias opciones. ¿Cuál de estas unidades le gustaría revisar?'
  const plan = { question_id: 'property_purpose', question: '¿Lo busca para vivir o invertir?' }
  for (const metadata of [undefined, { purpose: 'choose_property', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }]) {
    const saved = journeyPendingQuestion(reply, plan, true, metadata)
    assert.equal(saved.id, 'unit_choice')
    const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: 'sí', confidence: 'high',
      answer_to_previous: { question_id: 'property_purpose', kind: 'affirmative', evidence: 'sí', confidence: 'high' } } }, 'sí', saved)
    assert.equal((semantics.answer_to_previous as { question_id: string | null }).question_id, null)
  }
})

test('semantic receipts allow free wording and preserve only matching proposal scope', () => {
  const plan = { question_id: 'property_bedrooms', question_act: 'explore_alternatives',
    question: '¿Acepta tres dormitorios?', proposed_query: { group: 'residential', filters: { bedrooms: 3 } }, alternative_unit_ids: ['a', 'b'] }
  const question = '¿Podrían servirle estas alternativas con tres habitaciones?'
  const saved = deliveredPendingQuestion(question, { plan, metadata: { text: question, purpose: 'choose_property',
    continuation_id: 'property_bedrooms', continuation_act: 'explore_alternatives' } }, [{ id: 'a' }, { id: 'b' }])
  assert.equal(saved.act, 'explore_alternatives')
  assert.deepEqual(saved.candidate_ids, ['a', 'b'])
  assert.equal((saved.proposed_query as { filters: { bedrooms: number } }).filters.bedrooms, 3)
  const changed = deliveredPendingQuestion('¿Qué presupuesto tiene?', { plan,
    metadata: { purpose: 'clarify_request', continuation_id: 'budget_amount', continuation_act: 'budget' } })
  assert.equal(changed.id, 'budget_amount')
  assert.equal(changed.proposed_query, undefined)
  assert.deepEqual(changed.candidate_ids, [])
})

test('an invitation to explore property cannot grant financing consent or reserve a planned unit', () => {
  const plan = { question_id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?', selected_unit_id: 'a' }
  const reply = 'Podemos revisar financiamiento después. ¿Le gustaría conocer esta opción?'
  const saved = deliveredPendingQuestion(reply, { plan, metadata: { purpose: 'choose_property', continuation_id: 'unit_choice', continuation_act: 'show_unit_details' } })
  assert.equal(saved.id, 'unit_choice')
  assert.deepEqual(saved.target_ids, [])
  const input = financingInputs({ turn_semantics: { answer_to_previous: { question_id: saved.id, kind: 'affirmative', confidence: 'high' } } },
    'Sí', reply, { partners: ['Cooperativa JEP'], current: {} })
  assert.equal(input.consent, null)
})

test('unknown meaning, several questions, omitted questions and rejected drafts do not persist an action', () => {
  const plan = { question_id: 'reservation_invitation', selected_unit_id: 'a', question: '¿Desea reservar?' }
  assert.deepEqual(deliveredPendingQuestion('¿Desea reservar?', { plan, metadata: { continuation_id: 'none', continuation_act: 'other' } }), {})
  assert.deepEqual(deliveredPendingQuestion('¿Desea reservar? ¿Qué día viene?', { plan }), {})
  assert.deepEqual(deliveredPendingQuestion('Con mucho gusto.', { plan }), {})
  assert.deepEqual(journeyPendingQuestion('¿Desea reservar?', plan, false), {})
  assert.deepEqual(deliveredPendingQuestion('¿Qué opina?', { plan }), {})
})

test('same actual planned reservation retains that unit, but never a unit absent from the current catalog', () => {
  const plan = { question_id: 'reservation_invitation', selected_unit_id: 'a', question: '¿Desea reservar esta unidad?' }
  assert.deepEqual(deliveredPendingQuestion(plan.question, { plan }, [{ id: 'a' }]).target_ids, ['a'])
  assert.deepEqual(deliveredPendingQuestion(plan.question, { plan }, [{ id: 'b' }]).target_ids, [])
})

test('several fields in the same required collection remain data requests and never grant consent', () => {
  const reply = '¿Me indica su nombre legal? ¿Trabaja como empleado o independiente?'
  const candidate = { id: 'financing_data', act: 'financing', question: '¿Trabaja como empleado o independiente?' }
  for (const metadata of [undefined, { purpose: 'collect_financing_required', continuation_id: 'financing_data', continuation_act: 'financing' }]) {
    const saved = deliveredPendingQuestion(reply, { metadata, candidates: [candidate] })
    assert.equal(saved.id, 'financing_data')
    assert.equal(saved.question, reply)
    assert.equal(financingInputs({ turn_semantics: { answer_to_previous: { question_id: saved.id, kind: 'affirmative', confidence: 'high' } } },
      'Sí', reply, { partners: ['Cooperativa JEP'], current: {} }).consent, null)
  }
  assert.deepEqual(deliveredPendingQuestion('¿Desea financiar? ¿Desea reservar?', { metadata: {
    purpose: 'permission_to_continue', continuation_id: 'financing_invitation', continuation_act: 'financing' } }), {})
})

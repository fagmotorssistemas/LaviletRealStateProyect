import test from 'node:test'
import assert from 'node:assert/strict'
import { deliveredPendingQuestion } from './continuation-question'
import { normalizedPendingQuestion } from './turn-semantics'
import { object } from './data'
import { confirmedFinancingEntryReference } from './financing-entry'

const catalog = [{ id: 'p605', category: 'penthouse', bedrooms: 3 }, { id: 'p602', category: 'penthouse', bedrooms: 3 }]
const metadata = { text: '¿Cuál le gustaría conocer con más detalle?', purpose: 'choose_property',
  continuation_id: 'unit_choice', continuation_act: 'show_unit_details' }
const plan = { question_id: 'unit_choice', question_act: 'show_unit_details', selected_unit_id: 'p605',
  selection_scope: { unit_ids: ['p605', 'p602'] } }

test('writer metadata preserves the same continuation for any wording without inspecting the reply', () => {
  const expected = deliveredPendingQuestion('Primera versión.', { metadata, plan }, catalog)
  assert.equal(expected.id, 'unit_choice')
  assert.equal(expected.question, metadata.text)
  assert.deepEqual(expected.target_ids, ['p605'])
  for (const reply of ['Elija el espacio que desee explorar.', '¿Desea reservar?', 'Texto sin interrogación',
    'Datos del departamento.\n\nMás detalles del inmueble.', '']) {
    assert.deepEqual(deliveredPendingQuestion(reply, { metadata, plan }, catalog), expected)
  }
})

test('the writer can express the same question freely without a recognized keyword or punctuation', () => {
  for (const text of ['Podemos acercarnos a la opción que prefiera', 'Compártame cuál desea explorar',
    '¿Por cuál comenzamos?', 'You may choose the home to explore']) {
    const saved = deliveredPendingQuestion('Opaque final draft', { metadata: { ...metadata, text }, plan }, catalog)
    assert.equal(saved.id, metadata.continuation_id)
    assert.equal(saved.act, metadata.continuation_act)
    assert.equal(saved.question, text)
    assert.deepEqual(saved.target_ids, ['p605'])
  }
})

test('a plan, legacy receipt or reservation wording cannot invent absent metadata', () => {
  const reservation = { question_id: 'reservation_invitation', question_act: 'reservation', selected_unit_id: 'p605' }
  for (const input of [{ plan: reservation }, { candidates: [{ id: 'reservation_invitation', act: 'reservation', question: '¿Reservamos?' }] },
    { plan: reservation, metadata: {} }, { plan: reservation, metadata: { continuation_id: 'none', continuation_act: 'other', text: '' } }]) {
    assert.deepEqual(deliveredPendingQuestion('¿Desea iniciar la reserva del 605?', input, catalog), {})
  }
})

test('malformed metadata does not acquire a different act or missing question from the prose', () => {
  for (const broken of [{ ...metadata, text: '' }, { ...metadata, text: undefined },
    { ...metadata, continuation_id: 'unknown' }, { ...metadata, continuation_act: 'unknown' },
    { ...metadata, continuation_id: 'reservation_invitation', continuation_act: 'financing' },
    { ...metadata, continuation_id: 'financing_invitation', continuation_act: 'reservation' },
    { ...metadata, continuation_id: 'lead_profile', continuation_act: 'other' }]) {
    assert.deepEqual(deliveredPendingQuestion('¿Desea iniciar la reserva?', { metadata: broken, plan }, catalog), {})
  }
})

test('only the identical structured ID and act can carry a plan scope', () => {
  for (const unrelated of [{ ...plan, question_id: 'financing_invitation' }, { ...plan, question_act: 'confirm_unit' },
    { ...plan, question_act: undefined }]) {
    const saved = deliveredPendingQuestion('No parsing.', { metadata, plan: unrelated }, catalog)
    assert.equal(saved.id, 'unit_choice')
    assert.deepEqual(saved.target_ids, [])
    assert.deepEqual(saved.candidate_ids, [])
  }
})

test('unknown catalog IDs and conflicting receipt scopes never select an arbitrary property', () => {
  const missing = deliveredPendingQuestion('No parsing.', { metadata,
    plan: { ...plan, selected_unit_id: 'invented', selection_scope: { unit_ids: ['p605', 'invented'] } } }, catalog)
  assert.deepEqual(missing.target_ids, [])
  assert.deepEqual(missing.candidate_ids, ['p605'])
  assert.deepEqual(deliveredPendingQuestion('No parsing.', { metadata, plan }).target_ids, [])
  const contradictory = deliveredPendingQuestion('No parsing.', { metadata, plan, candidates: [
    { id: 'unit_choice', act: 'show_unit_details', target_ids: ['p605'] },
    { id: 'unit_choice', act: 'show_unit_details', target_ids: ['p602'] },
  ] }, catalog)
  assert.deepEqual(contradictory.target_ids, [])
})

test('down payment references retain typed provenance regardless of phrasing', () => {
  const financialMetadata = { text: '¿Aportaría esa cantidad o prefiere otro importe?', purpose: 'collect_financing_required',
    continuation_id: 'financing_down_payment', continuation_act: 'financing' }
  const financialPlan = { question_id: financialMetadata.continuation_id, question_act: financialMetadata.continuation_act,
    question_amount_reference: { kind: 'proposed_down_payment', original_role: 'total_budget', amount: 100000,
      evidence: 'Tengo cien mil de presupuesto total' } }
  const saved = deliveredPendingQuestion('A different wording with no numeric amount.', { metadata: financialMetadata, plan: financialPlan })
  assert.equal(object(saved.amount_reference).amount, 100000)
  assert.equal(object(saved.amount_reference).question_source, financialMetadata.text)
  assert.equal(object(saved.amount_reference).resolution, 'writer_structured_total_budget_entry_proposal')
  assert.deepEqual(normalizedPendingQuestion(saved), saved)
  const noScope = deliveredPendingQuestion('¿Usaría 100000 de entrada?', { metadata: financialMetadata })
  assert.equal(noScope.amount_reference, undefined)
})

test('normalization checks monetary receipt data without judging its question wording', () => {
  const reference = { kind: 'proposed_down_payment', original_role: 'total_budget', amount: 100000,
    evidence: 'Tengo cien mil', question_source: 'Any freely worded proposition', delivered_question: 'Your preference',
    resolution: 'writer_structured_total_budget_entry_proposal' }
  const pending = { id: 'financing_down_payment', act: 'financing', question: 'Your preference', amount_reference: reference }
  assert.deepEqual(normalizedPendingQuestion(pending).amount_reference, reference)
  for (const malformed of [{ ...reference, amount: -1 }, { ...reference, amount: Number.NaN },
    { ...reference, kind: 'catalogue_price' }, { ...reference, original_role: 'loan' },
    { ...reference, evidence: '' }, { ...reference, question_source: '' }, { ...reference, resolution: 'unverified' }]) {
    assert.equal(normalizedPendingQuestion({ ...pending, amount_reference: malformed }).amount_reference, undefined)
  }
})

test('a typed affirmation can confirm a structured down payment receipt with unrecognized wording', () => {
  const question = '¿Le parece aportar aquella cantidad?'
  const pending = normalizedPendingQuestion({ id: 'financing_down_payment', act: 'financing', question,
    amount_reference: { kind: 'proposed_down_payment', original_role: 'total_budget', amount: 100000, currency: 'USD',
      evidence: 'Tengo cien mil', question_source: 'La redacción no necesita mencionar presupuesto ni entrada.',
      delivered_question: question, resolution: 'writer_structured_total_budget_entry_proposal' } })
  const raw = { turn_semantics: { budget: { status: 'not_discussed' },
    answer_to_previous: { question_id: 'financing_down_payment', kind: 'affirmative', confidence: 'high', evidence: 'Sí' } } }
  const confirmed = confirmedFinancingEntryReference(raw, 'Sí', pending)
  assert.equal(confirmed?.amount, 100000)
  assert.equal(confirmed?.evidence, 'Sí')
  assert.equal(object(confirmed?.amount_reference).resolution, 'writer_structured_total_budget_entry_proposal')
  assert.equal(confirmedFinancingEntryReference(raw, 'Sí', { ...pending, id: 'reservation_invitation' }), null)
  assert.equal(confirmedFinancingEntryReference(raw, 'Sí', { ...pending, act: 'reservation' }), null)
  assert.equal(confirmedFinancingEntryReference(raw, 'Sí', { ...pending, question: 'Another structured question' }), null)
  assert.equal(confirmedFinancingEntryReference(raw, 'Sí', { ...pending,
    amount_reference: { ...object(pending.amount_reference), currency: 'EUR' } }), null)
})

test('a structured down payment receipt preserves checks on the current customer answer', () => {
  const question = 'Indíqueme si desea aportar ese monto'
  const pending = normalizedPendingQuestion({ id: 'financing_down_payment', act: 'financing', question,
    amount_reference: { kind: 'proposed_down_payment', original_role: 'total_budget', amount: 100000,
      evidence: 'Tengo cien mil', question_source: question, delivered_question: question,
      resolution: 'writer_structured_total_budget_entry_proposal' } })
  for (const current of ['Sí, pero solo una parte', 'Sí si me aprueban', 'Sí, 80000', 'No']) {
    const raw = { turn_semantics: { budget: { status: 'not_discussed' },
      answer_to_previous: { question_id: 'financing_down_payment', kind: 'affirmative', confidence: 'high', evidence: current } } }
    assert.equal(confirmedFinancingEntryReference(raw, current, pending), null)
  }
  const affirmative = { turn_semantics: { budget: { status: 'not_discussed' },
    answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', confidence: 'high', evidence: 'Sí' } } }
  assert.equal(confirmedFinancingEntryReference(affirmative, 'Sí', pending), null)
})

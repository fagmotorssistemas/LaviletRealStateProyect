import test from 'node:test'
import assert from 'node:assert/strict'
import { deliveredPendingQuestion } from './continuation-question'
import { journeyPendingQuestion } from './commercial-journey'
import { normalizeTurnSemantics } from './turn-semantics'
import { financingInputs } from './financing'
import { leadProfilePendingQuestion } from './lead-introduction'

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

test('empty semantic receipts cannot hide the verified scope of the same emitted question', () => {
  const catalog = [{ id: 'a' }, { id: 'b' }]
  for (const [id, act, question] of [
    ['property_bedrooms', 'confirm_bedrooms', '¿Desea mantener los tres dormitorios al buscar opciones más económicas?'],
    ['property_category', 'explore_alternatives', '¿Le gustaría revisar estas alternativas?'],
    ['unit_choice', 'show_unit_details', '¿Le gustaría ver los detalles del departamento 502?'],
  ]) {
    const metadata = { text: question, purpose: 'choose_property', continuation_id: id, continuation_act: act }
    const empty = { id, act, question, target_ids: [], candidate_ids: [] }
    const rich = { id, act, question, target_ids: act === 'show_unit_details' ? ['a'] : [], candidate_ids: ['a', 'b'],
      ...(act !== 'show_unit_details' ? { proposed_query: { group: 'residential', category: 'departamento', filters: { bedrooms: 3 } } } : {}) }
    const expected = deliveredPendingQuestion(question, { metadata, candidates: [rich] }, catalog)
    for (const candidates of [[empty, rich], [rich, empty], [empty, rich, empty]]) {
      const saved = deliveredPendingQuestion(question, { metadata, candidates }, catalog)
      assert.deepEqual(saved, expected)
      assert.deepEqual(saved.candidate_ids, ['a', 'b'])
      if (act === 'show_unit_details') assert.deepEqual(saved.target_ids, ['a'])
      else assert.equal((saved.proposed_query as { filters: { bedrooms: number } }).filters.bedrooms, 3)
    }
  }
})

test('scope is accepted only from receipts for the same question, ID and act', () => {
  const question = '¿Le gustaría ver los detalles del departamento 502?'
  const metadata = { text: question, purpose: 'choose_property', continuation_id: 'unit_choice', continuation_act: 'show_unit_details' }
  const actual = { id: 'unit_choice', act: 'show_unit_details', question, target_ids: ['a'], candidate_ids: ['a', 'b'] }
  const unrelated = [
    { ...actual, question: '¿Le gustaría ver los detalles del penthouse 602?', target_ids: ['c'] },
    { ...actual, id: 'property_category', target_ids: ['c'] },
    { ...actual, act: 'choose_unit', target_ids: ['c'] },
  ]
  const catalog = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const saved = deliveredPendingQuestion(question, { metadata, candidates: [...unrelated, actual],
    plan: { question_id: 'financing_invitation', selected_unit_id: 'c', question: '¿Desea iniciar la revisión financiera?' } }, catalog)
  assert.deepEqual(saved.target_ids, ['a'])
  assert.deepEqual(saved.candidate_ids, ['a', 'b'])
  assert.equal(saved.proposed_query, undefined)
  const changed = deliveredPendingQuestion('¿Qué presupuesto tiene?', { metadata: { text: '¿Qué presupuesto tiene?',
    purpose: 'clarify_request', continuation_id: 'budget_amount', continuation_act: 'budget' }, candidates: [actual] }, catalog)
  assert.deepEqual(changed.target_ids, [])
  assert.deepEqual(changed.candidate_ids, [])
})

test('contradictory verified scopes do not choose a unit or borrow a different proposal', () => {
  const question = '¿Le gustaría revisar estas alternativas?'
  const metadata = { text: question, purpose: 'choose_property', continuation_id: 'property_category', continuation_act: 'explore_alternatives' }
  const first = { id: 'property_category', act: 'explore_alternatives', question, target_ids: ['a'], candidate_ids: ['a'],
    proposed_query: { group: 'residential', filters: { bedrooms: 3 } } }
  const saved = deliveredPendingQuestion(question, { metadata, candidates: [first,
    { ...first, target_ids: ['b'], candidate_ids: ['b'], proposed_query: { group: 'residential', filters: { bedrooms: 2 } } }] }, [{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(saved.target_ids, [])
  assert.deepEqual(saved.candidate_ids, [])
  assert.equal(saved.proposed_query, undefined)
})

test('a residence confirmation retains the profile referent of the actual question, including approved paraphrases', () => {
  const candidate = { city: 'Cuenca', country: null, evidence: 'soy de cuenca' }
  for (const question of ['¿Es también su lugar de residencia actual?', '¿Actualmente reside allí?']) {
    const reply = `Entiendo que es de Cuenca. ${question}`
    const profileReceipt = leadProfilePendingQuestion(reply, { profile_introduction: { question_purpose: 'confirm_residence', candidate } })
    const empty = { id: 'lead_residence_confirmation', act: 'profile', question }
    const metadata = { text: question, purpose: 'collect_lead_profile', continuation_id: empty.id, continuation_act: empty.act }
    for (const receipts of [[empty, profileReceipt], [profileReceipt, empty]]) {
      const saved = deliveredPendingQuestion(reply, { metadata, candidates: receipts })
      assert.equal(saved.question, question)
      assert.deepEqual(saved.residence_candidate, candidate)
      assert.deepEqual(saved.target_ids, [])
      assert.deepEqual(saved.candidate_ids, [])
    }
  }
})

test('residence confirmation never borrows a city from another question, profile ID or conflicting receipt', () => {
  const question = '¿Actualmente reside allí?'
  const metadata = { text: question, purpose: 'collect_lead_profile', continuation_id: 'lead_residence_confirmation', continuation_act: 'profile' }
  const cuenca = { id: metadata.continuation_id, act: 'profile', question, residence_candidate: { city: 'Cuenca', country: null, evidence: 'soy de cuenca' } }
  const loja = { ...cuenca, residence_candidate: { city: 'Loja', country: null, evidence: 'soy de loja' } }
  for (const receipts of [[{ ...cuenca, question: '¿Cuenca es su residencia actual?' }], [{ ...cuenca, id: 'lead_profile_residence' }], [cuenca, loja], [loja, cuenca]]) {
    const saved = deliveredPendingQuestion(question, { metadata, candidates: receipts })
    assert.equal(saved.id, metadata.continuation_id)
    assert.equal(saved.residence_candidate, undefined)
  }
  const changed = deliveredPendingQuestion('¿Desea revisar esta vivienda?', { metadata: {
    text: '¿Desea revisar esta vivienda?', purpose: 'choose_property', continuation_id: 'unit_choice', continuation_act: 'show_unit_details',
  }, candidates: [cuenca] })
  assert.equal(changed.residence_candidate, undefined)
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

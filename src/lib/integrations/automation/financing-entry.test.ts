import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { financingInputs } from './financing'
import { financingJourney, financingStage, rememberedFinancingPartner } from './financing-stage'
import { financingAmounts } from './financing-amounts'
import { financingEntryState, rememberFinancingEntry, FINANCING_ENTRY_QUESTION, financingEntryQuestion,
  deliveredFinancingEntryReference, confirmedFinancingEntryReference, resolveFinancingEntryReference } from './financing-entry'
import { financingInvitationReceipt, operationalFinancingInvitation } from './financing-invitation'
import { budgetQuestionBasis } from './budget-question-context'
import { commercialJourneyPlan } from './commercial-journey'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'

const partners = ['Banco Pichincha', 'Cooperativa JEP']
const context = { partners, current: {} }
const invitation = 'Podemos ayudarle a analizar el financiamiento. ¿Desea que continuemos con el proceso de financiamiento por este chat?'
const invitationStep = { kind: 'financing_consent', reply: invitation, invitation: financingInvitationReceipt({
  text: invitation, purpose: 'permission_to_continue', continuation_id: 'financing_invitation', continuation_act: 'financing',
}) }
const total = { amount: 400000, evidence: 'Tengo un presupuesto total de 400 mil' }
const unit = { id: 'p602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6,
  is_published: true, status: 'disponible', published_commercial_price: 550000 }
const pending = { id: 'financing_down_payment', act: 'financing', question: FINANCING_ENTRY_QUESTION }
function info(journey: Row = { accepted: true }): Row {
  return { lead: { purchase_purpose: 'vivir', preferred_bedrooms: 3 },
    perfil_lead: { full_name: 'Carlos', name_status: 'confirmed', residence_city: 'Cuenca', residence_status: 'confirmed',
      sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Carlos' },
        residence_city: { source: 'lead_declaration', evidence: 'Vivo en Cuenca' } } },
    catalogo: [unit], catalog_read: { complete: true }, catalogo_verificacion: [unit],
    property_context: { query: { group: 'residential', category: 'penthouse', operation: 'select' }, selected_ids: [unit.id] },
    referencia_unidad: { query: { group: 'residential', category: 'penthouse', operation: 'select' }, matches: [unit] },
    financiamiento: { ...context, journey }, financing_amounts: { total_budget: total },
    politica_comercial: { precios_autorizados: true }, hechos_confirmados: { budget: {
      status: 'maximum_total', ...total, confidence: 'high' } }, semantica_turno: { budget: { status: 'not_discussed' } } }
}

test('a delivered process invitation with a writer receipt stays actionable without a reviewer decision', () => {
  assert.equal(financingInputs({ turn_semantics: { answer_to_previous: { question_id: 'financing_invitation',
    kind: 'affirmative', evidence: 'si me parece bien', confidence: 'high' } } }, 'si me parece bien', invitation, context,
    invitationStep).consent, true)
  const current = 'SI CONTINUEMOS CON JEP'
  const extracted = { financing_consent: null, financing_partner_choice: { kind: 'select', name: 'Cooperativa JEP',
    evidence: current, confidence: 'high' }, turn_semantics: { primary_intent: 'answer_previous', confidence: 'high',
    answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: current, confidence: 'high' } } }
  const input = financingInputs(extracted, current, invitation, context, invitationStep)
  assert.equal(input.consent, true)
  assert.equal(input.partner, 'Cooperativa JEP')
  const journey = financingJourney({}, input, 'accepted-jep')
  assert.equal(journey.accepted, true)
  assert.equal(rememberedFinancingPartner(journey, partners), 'Cooperativa JEP')
  const selecting = info(journey)
  selecting.property_context = { ...object(selecting.property_context), selected_ids: [] }
  assert.equal(financingStage(selecting).stage, 'clarify_entry')
  assert.equal(financingStage(selecting).collection_allowed, false)
})

test('continuation recognition does not turn entity information, refusal or conditional permission into consent', () => {
  for (const reply of ['¿Desea conocer las opciones de financiamiento?', '¿Podemos revisar las tasas de JEP?',
    '¿Quiere que expliquemos cómo iniciar su evaluación financiera?', 'Podemos ayudarle con JEP. ¿Desea avanzar?',
    'Podemos analizar financiamiento. ¿Desea continuar con el penthouse 602?',
    '¿Con qué entidad desea iniciar la revisión: Pichincha o JEP?',
    '¿Cuál de los bancos desea elegir para iniciar la revisión financiera?']) {
    assert.equal(operationalFinancingInvitation(reply), false, reply)
    assert.equal(financingInputs({}, 'Sí, continuemos con JEP', reply, context, { kind: 'unverified_offer', reply }).consent, null)
  }
  for (const current of ['Con JEP', '¿Qué ofrece JEP?', 'No quiero continuar',
    'Sí, continuemos con JEP solo si me aseguran la aprobación', 'Sí, continuemos con JEP pero con crédito directo'])
    assert.equal(financingInputs({}, current, invitation, context).consent, null, current)
  const stale = { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', confidence: 'high',
    primary_evidence: 'Sí, quiero iniciar la revisión', answer_to_previous: { question_id: 'financing_invitation',
      kind: 'affirmative', evidence: 'Sí, quiero iniciar la revisión', confidence: 'high' } } }
  assert.equal(financingInputs(stale, 'Tengo una pregunta', invitation, context).consent, null)
})

test('entry is asked after acceptance and before unit selection without converting a known total budget', () => {
  const verified = info(), before = structuredClone(verified)
  const stage = financingStage(verified)
  assert.equal(stage.stage, 'clarify_entry')
  assert.equal(stage.question, financingEntryQuestion(verified).question)
  assert.match(String(stage.question), /presupuesto de \$400\.000.*destinaría ese monto.*otra cantidad/)
  assert.equal(stage.question_id, 'financing_down_payment')
  assert.equal(stage.collection_allowed, false)
  const plan = commercialJourneyPlan({ ...verified, etapa_financiamiento: stage,
    estado_conversacion: { brochure_sent: true } })
  assert.equal(plan.action, 'clarify_financing_down_payment')
  assert.equal(plan.question_id, 'financing_down_payment')
  assert.equal(plan.question, stage.question)
  assert.deepEqual(plan.question_amount_reference, stage.question_amount_reference)
  assert.deepEqual(verified, before)
  assert.equal(financingEntryState(verified).amount, null)
  assert.equal(budgetQuestionBasis(pending), 'down_payment')
  assert.equal(financingStage({ ...verified, financiamiento: { ...context, journey: {} } }).stage, 'explain_and_offer')
  const unselected = { ...verified, property_context: { selected_ids: [] } }
  assert.equal(financingStage(unselected).stage, 'clarify_entry')
  assert.equal(commercialJourneyPlan(unselected).action, 'clarify_financing_down_payment')
  const entryKnown = { ...unselected, financiamiento: { ...context, journey: { accepted: true },
    entry: { status: 'not_defined', evidence: 'Todavía no sé', source_message_id: 'answer' } } }
  assert.equal(financingStage(entryKnown).stage, 'select_property')
  assert.notEqual(commercialJourneyPlan(entryKnown).action, 'clarify_financing_down_payment')
  assert.equal(financingStage(entryKnown).collection_allowed, false)
})

test('entry question reuses the real confirmed budget, with a generic question when no amount is grounded', () => {
  const changed = { ...info(), hechos_confirmados: { budget: { status: 'maximum_total', amount: 275500,
    evidence: 'Presupuesto total de 275500', confidence: 'high' } } }
  assert.match(String(financingEntryQuestion(changed).question), /\$275\.500/)
  const noTotal = { ...info(), hechos_confirmados: {}, financing_amounts: {}, lead: {} }
  assert.equal(financingEntryQuestion(noTotal).question, FINANCING_ENTRY_QUESTION)
  assert.equal(financingEntryQuestion(noTotal).amount_reference, undefined)
  assert.doesNotMatch(FINANCING_ENTRY_QUESTION, /esta unidad/)
})

test('an acknowledged different entry without its amount asks directly for that amount instead of repeating the total proposal', () => {
  const current = 'Tendría prevista otra cantidad'
  const saved = rememberFinancingEntry({}, current, { turn_semantics: { budget: {
    status: 'amount_pending', amount: null, evidence: current, confidence: 'high' } } }, pending, 'entry-pending')
  const verified = { ...info(), financiamiento: { ...context, journey: { accepted: true }, entry: saved } }
  const entry = financingEntryState(verified), stage = financingStage(verified), plan = commercialJourneyPlan(verified)
  assert.equal(entry.answered, false)
  assert.equal(entry.status, 'amount_pending')
  assert.equal(entry.question, FINANCING_ENTRY_QUESTION)
  assert.equal(entry.amount_reference, undefined)
  assert.equal(stage.question, FINANCING_ENTRY_QUESTION)
  assert.equal(stage.question_amount_reference, undefined)
  assert.equal(plan.question, FINANCING_ENTRY_QUESTION)
  assert.equal(plan.question_amount_reference, undefined)
  assert.equal(object(object(verified.financing_amounts).total_budget).amount, 400000)
})

test('ambiguous prior budget is clarified once before entry, then total, entry and unit stay distinct across later turns', () => {
  const ambiguous = { ...info(), property_context: { query: { group: 'residential', category: 'penthouse', operation: 'search' }, selected_ids: [] },
    financing_amounts: {}, hechos_confirmados: { budget: { status: 'amount', amount: 400000,
      evidence: 'Tengo 400 mil', confidence: 'high' } } }
  const clarification = commercialJourneyPlan(ambiguous)
  assert.equal(clarification.action, 'clarify_budget_kind')
  assert.equal(clarification.question_id, 'budget_kind')
  assert.equal(financingStage(ambiguous).question, clarification.question)
  assert.equal(financingStage(ambiguous).collection_allowed, false)
  const confirmed = { ...ambiguous, financing_amounts: { total_budget: total },
    hechos_confirmados: { budget: { status: 'maximum_total', ...total, confidence: 'high' } } }
  const proposal = commercialJourneyPlan(confirmed)
  assert.equal(proposal.action, 'clarify_financing_down_payment')
  assert.match(String(proposal.question), /\$400\.000/)
  const current = 'Para la entrada tendría 200 mil'
  const extracted = { financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: current }],
    turn_semantics: { budget: { status: 'initial_capital', amount: 200000, confidence: 'high', evidence: current } } }
  const previous = { _pending_question: pending, _financing_amounts: { total_budget: total },
    _interpretation_memory: confirmed.hechos_confirmados }
  const summary = rememberInterpretedTurn(previous, current, extracted, extracted.turn_semantics)
  const entry = rememberFinancingEntry({}, current, extracted, pending, 'entry-answer')
  const choosing = { ...confirmed, hechos_confirmados: summary._interpretation_memory,
    financing_amounts: summary._financing_amounts, financiamiento: { ...context, journey: { accepted: true }, entry } }
  assert.equal(financingStage(choosing).stage, 'select_property')
  assert.equal(commercialJourneyPlan(choosing).action, 'select_property')
  const selected = { ...choosing, property_context: { ...object(choosing.property_context), selected_ids: [unit.id] } }
  for (const semantica_turno of [{ budget: extracted.turn_semantics.budget }, { budget: { status: 'not_discussed' } }]) {
    const later = { ...selected, semantica_turno }
    assert.equal(financingStage(later).stage, 'continue_financing')
    assert.equal(commercialJourneyPlan(later).action, 'continue_financing')
    assert.equal(financingStage(later).entry_status, 'amount')
  }
  assert.equal(object(object(summary._financing_amounts).total_budget).amount, 400000)
  assert.equal(object(object(summary._financing_amounts).down_payment).amount, 200000)
})

test('delivered entry proposals retain the same verified amount across equivalent monetary formats', () => {
  const proposal = financingEntryQuestion(info()), current = 'Sí'
  const raw = { turn_semantics: { budget: { status: 'not_discussed' },
    answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high', evidence: current } } }
  for (const format of ['$400.000', '$400,000', '400 mil dólares', 'cuatrocientos mil dólares', '$400 000', '400000 USD']) {
    const reply = String(proposal.question).replace('$400.000', format)
    const reference = deliveredFinancingEntryReference(reply, object(proposal.amount_reference))
    assert.ok(reference, format)
    const question = reply.match(/¿[^?]*\?/g)!.at(-1)!
    assert.equal(confirmedFinancingEntryReference(raw, current, { ...pending, question, amount_reference: reference })?.amount, 400000, format)
  }
  for (const format of ['$300.000', '400 dólares', '$400,00', '$400. 000', '$400.000 o $350.000',
    'entre 350 y 400 mil dólares', '400 mil dólares y 200 mil para la entrada', '400 mil euros']) {
    const reply = String(proposal.question).replace('$400.000', format)
    assert.equal(deliveredFinancingEntryReference(reply, object(proposal.amount_reference)), null, format)
  }
})

test('affirmation confirms the amount in the actual delivered proposal and preserves the original total', () => {
  const proposal = financingEntryQuestion(info())
  const reference = deliveredFinancingEntryReference(String(proposal.question), object(proposal.amount_reference))!
  const current = 'Sí, ese monto para la entrada'
  const actualQuestion = String(proposal.question).match(/¿[^?]*\?/g)!.at(-1)!
  const proposedPending = { ...pending, question: actualQuestion, amount_reference: reference }
  const raw = { turn_semantics: { budget: { status: 'not_discussed', amount: null },
    answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high', evidence: current } } }
  const resolved = resolveFinancingEntryReference(raw, current, proposedPending)
  assert.equal(confirmedFinancingEntryReference(resolved, current, proposedPending)?.amount, 400000)
  assert.equal(object(object(resolved.turn_semantics).budget).status, 'initial_capital')
  const entry = rememberFinancingEntry({}, current, raw, proposedPending, 'affirmed-entry')
  assert.equal(entry.amount, 400000)
  assert.equal(entry.evidence, current)
  const amounts = financingAmounts({ total_budget: total }, resolved.financing_amounts, current)
  assert.equal(object(amounts.total_budget).amount, 400000)
  assert.equal(object(amounts.down_payment).amount, 400000)
  const next = financingStage({ ...info(), property_context: { selected_ids: [] }, financing_amounts: amounts,
    financiamiento: { ...context, journey: { accepted: true }, entry } })
  assert.equal(next.stage, 'select_property')
  assert.equal(next.entry_status, 'amount')
})

test('unknown, partial, conditional, stale or unrelated affirmations never infer the proposed entry', () => {
  const proposal = financingEntryQuestion(info())
  const reference = deliveredFinancingEntryReference(String(proposal.question), object(proposal.amount_reference))!
  const question = String(proposal.question).match(/¿[^?]*\?/g)!.at(-1)!
  for (const current of ['Sí, tengo prevista otra cantidad', 'Sí, pero solo una parte',
    'Sí, si me aprueban el crédito', 'Sí, pero serían 200 mil', 'Con JEP', '¿Me conviene?', 'No']) {
    const raw = { turn_semantics: { budget: { status: 'not_discussed' },
      answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high', evidence: current } } }
    assert.equal(confirmedFinancingEntryReference(raw, current, { ...pending, question, amount_reference: reference }), null, current)
    assert.deepEqual(rememberFinancingEntry({}, current, raw, { ...pending, question, amount_reference: reference }, 'answer'), {}, current)
  }
  const raw = { turn_semantics: { budget: { status: 'not_discussed' },
    answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high', evidence: 'Sí' } } }
  for (const invalidPending of [pending, { ...pending, question, amount_reference: proposal.amount_reference },
    { ...pending, question: FINANCING_ENTRY_QUESTION, amount_reference: reference },
    { ...pending, question, amount_reference: { ...reference, amount: 300000 } },
    { ...pending, question, amount_reference: { ...reference, original_role: 'loan' } }])
    assert.equal(confirmedFinancingEntryReference(raw, 'Sí', invalidPending), null)
  assert.equal(confirmedFinancingEntryReference(raw, 'Se ve bien', { ...pending, question, amount_reference: reference }), null)
  assert.equal(deliveredFinancingEntryReference(FINANCING_ENTRY_QUESTION, object(proposal.amount_reference)), null)
  assert.equal(deliveredFinancingEntryReference(`${proposal.question} ¿Cuál unidad prefiere?`, object(proposal.amount_reference)), null)
})

test('current monetary answer overrides the proposed amount without withdrawing the original total', () => {
  const proposal = financingEntryQuestion(info())
  const reference = deliveredFinancingEntryReference(String(proposal.question), object(proposal.amount_reference))!
  const current = 'No, para la entrada tendría 200 mil'
  const raw = { financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: current, replaces_role: null }],
    turn_semantics: { budget: { status: 'initial_capital', amount: 200000, evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: pending.id, kind: 'negative', confidence: 'high', evidence: current } } }
  const proposedPending = { ...pending, question: String(proposal.question).match(/¿[^?]*\?/g)!.at(-1)!, amount_reference: reference }
  const resolved = resolveFinancingEntryReference(raw, current, proposedPending)
  assert.deepEqual(resolved, raw)
  const entry = rememberFinancingEntry({}, current, raw, proposedPending, 'different-entry')
  assert.equal(entry.amount, 200000)
  const amounts = financingAmounts({ total_budget: total }, resolved.financing_amounts, current)
  assert.equal(object(amounts.total_budget).amount, 400000)
  assert.equal(object(amounts.down_payment).amount, 200000)
})

test('real interpretation validates an affirmative amount reference with current evidence and remembers both monetary roles', async () => {
  for (const budgetStatus of ['not_discussed', 'amount_pending'] as const) {
    const proposal = financingEntryQuestion(info())
    const amountReference = deliveredFinancingEntryReference(String(proposal.question), object(proposal.amount_reference))!
    const actualQuestion = String(proposal.question).match(/¿[^?]*\?/g)!.at(-1)!
    const proposedPending = { ...pending, question: actualQuestion, amount_reference: amountReference }
    const current = 'Sí, ese monto para la entrada'
    const raw: Row = structuredClone(profileFixture)
    raw.full_name = raw.residence_city = raw.residence_country = null
    raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
    raw.requests = [{ domain: 'financing', request: 'Confirmar la entrada propuesta', evidence: current, confidence: 'high' }]
    const semantics = object(raw.turn_semantics)
    semantics.primary_intent = 'answer_previous'; semantics.primary_evidence = current
    semantics.answer_to_previous = { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' }
    semantics.budget = { status: budgetStatus, amount: null, evidence: budgetStatus === 'amount_pending' ? current : '', confidence: 'high' }
    raw.financing_amounts = []
    object(raw.qualification).presupuesto_texto = null
    const previous: Row = { _pending_question: proposedPending, _financing_amounts: { total_budget: total },
      _interpretation_memory: { budget: { status: 'maximum_total', ...total, confidence: 'high' } } }
    let calls = 0
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, resumen: previous, pregunta_pendiente: proposedPending }, {
      activePrompt: async () => '', aiJson: async () => { calls++; return structuredClone(raw) },
    })
    assert.equal(calls, 1, budgetStatus)
    assert.equal(interpreted.semantics.budget.status, 'initial_capital')
    assert.equal(interpreted.semantics.budget.amount, 400000)
    assert.equal(interpreted.semantics.budget.evidence, current)
    const summary = rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics)
    assert.equal(object(object(summary._financing_amounts).total_budget).amount, 400000)
    assert.equal(object(object(summary._financing_amounts).down_payment).amount, 400000)
  }
})

test('a direct entry amount is remembered once with its own role, preserving total and lender', () => {
  const current = '200 mil para la entrada'
  const extracted = { financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: current }],
    turn_semantics: { budget: { status: 'initial_capital', amount: 200000, evidence: current, confidence: 'high' } } }
  const entry = rememberFinancingEntry({}, current, extracted, pending, 'entry-answer')
  const amounts = financingAmounts({ total_budget: total }, extracted.financing_amounts, current)
  const verified = { ...info(), financing_amounts: amounts, financiamiento: { ...context, journey: { accepted: true }, entry } }
  assert.equal(financingStage(verified).stage, 'continue_financing')
  assert.equal(financingStage(verified).collection_allowed, true)
  assert.equal(object(amounts.total_budget).amount, 400000)
  assert.equal(object(amounts.down_payment).amount, 200000)
  assert.equal(financingEntryState(verified).amount, 200000)
  assert.deepEqual(rememberFinancingEntry(entry, 'Sí', {}, {}, 'later'), entry)
  assert.equal(financingStage({ ...verified, financiamiento: { ...context, journey: { accepted: true } } }).stage, 'continue_financing',
    'Older grounded down_payment declarations also prevent a repeat.')
})

test('unknown and withheld entry answers advance orientation without invented money or changing the total', () => {
  for (const [current, status, entryStatus] of [
    ['Todavía no sé cuánto pondría de entrada', 'no_defined_budget', 'not_defined'],
    ['Prefiero no compartir ese dato por ahora', 'declines_to_disclose', 'declined'],
  ]) {
    const extracted = { turn_semantics: { budget: { status, amount: null, evidence: current, confidence: 'high' } } }
    const entry = rememberFinancingEntry({}, current, extracted, pending, 'answer')
    assert.equal(entry.status, entryStatus)
    const verified = { ...info(), financiamiento: { ...context, journey: { accepted: true }, entry } }
    assert.equal(financingStage(verified).stage, 'continue_financing')
    assert.equal(financingStage(verified).collection_allowed, true)
    assert.equal(financingEntryState(verified).amount, null)
    assert.equal(object(object(verified.financing_amounts).total_budget).amount, 400000)
    assert.deepEqual(rememberFinancingEntry({}, current, extracted, { id: 'budget_amount' }, 'other'), {})
    const financialAnswer = { ...extracted, turn_semantics: { ...extracted.turn_semantics,
      primary_intent: 'ask_financing', primary_evidence: current, confidence: 'high',
      answer_to_previous: { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' } } }
    const input = financingInputs(financialAnswer, current, FINANCING_ENTRY_QUESTION, context)
    assert.notEqual(input.declined, true, 'Withholding entry is not withdrawing financing acceptance.')
    assert.equal(financingJourney({ accepted: true }, input, 'answer').accepted, true)
  }
})

test('a bare yes or stale entry evidence cannot complete the amount; explicit zero stays distinct from unknown', () => {
  const current = 'Sí'
  const entry = rememberFinancingEntry({}, current, { turn_semantics: { budget: {
    status: 'amount_pending', amount: null, evidence: current, confidence: 'high' } } }, pending, 'no-amount')
  assert.equal(financingEntryState({ financiamiento: { entry } }).answered, false)
  assert.deepEqual(rememberFinancingEntry({}, 'Se ve bien', { financing_amounts: [
    { role: 'down_payment', amount: 200000, evidence: 'Tengo 200 mil para la entrada' }] }, pending, 'stale'), {})
  const zero = 'No tengo dinero para la entrada, serían cero'
  const zeroEntry = rememberFinancingEntry({}, zero, { financing_amounts: [
    { role: 'down_payment', amount: 0, evidence: zero }] }, pending, 'zero')
  assert.equal(financingEntryState({ financiamiento: { entry: zeroEntry } }).amount, 0)
  assert.equal(financingEntryState({ financiamiento: { entry: zeroEntry } }).answered, true)
})

test('a current withdrawal clears entry readiness instead of reusing a historical amount', () => {
  const previous = { status: 'amount', amount: 200000, evidence: 'Tengo 200 mil para la entrada', source_message_id: 'old' }
  const current = 'Esos 200 mil no son para la entrada, serían el préstamo'
  const entry = rememberFinancingEntry(previous, current, { financing_amounts: [
    { role: 'loan', amount: 200000, replaces_role: 'down_payment', evidence: current }] }, {}, 'withdraw')
  assert.equal(entry.status, 'missing')
  assert.equal(financingEntryState({ financiamiento: { entry }, financing_amounts: { down_payment: previous } }).answered, false)
})

test('the interpretation and memory pipeline keeps the total budget when the current answer supplies only entry', async () => {
  for (const [current, status, amount] of [
    ['Unos 200 mil', 'initial_capital', 200000],
    ['Todavía no sé cuánto pondría', 'no_defined_budget', null],
    ['Prefiero no compartir ese monto', 'declines_to_disclose', null],
  ] as const) {
    const raw: Row = structuredClone(profileFixture)
    raw.full_name = raw.residence_city = raw.residence_country = null
    raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
    raw.requests = [{ domain: 'financing', request: 'Responder el monto de entrada', evidence: current, confidence: 'high' }]
    const semantics = object(raw.turn_semantics)
    semantics.primary_intent = 'answer_previous'; semantics.primary_evidence = current
    semantics.answer_to_previous = { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' }
    semantics.budget = { status, amount, evidence: current, confidence: 'high' }
    raw.financing_amounts = amount === null ? [] : [{ role: 'down_payment', amount, evidence: current, replaces_role: null }]
    object(raw.qualification).presupuesto_texto = current
    const previous: Row = { _pending_question: pending, _financing_amounts: { total_budget: total },
      _interpretation_memory: { budget: { status: 'maximum_total', ...total, confidence: 'high' },
        qualification: { presupuesto_texto: total.evidence } } }
    let calls = 0
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, resumen: previous, pregunta_pendiente: pending }, {
      activePrompt: async () => '', aiJson: async () => { calls++; return structuredClone(raw) },
    })
    assert.equal(calls, 1)
    const summary = rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics)
    summary._financing_entry = rememberFinancingEntry({}, current, { ...interpreted.extracted,
      turn_semantics: interpreted.semantics }, pending, 'answer')
    assert.equal(object(object(summary._interpretation_memory).budget).status, 'maximum_total')
    assert.equal(object(object(summary._interpretation_memory).budget).amount, 400000)
    assert.equal(object(object(object(summary._interpretation_memory).qualification)).presupuesto_texto, total.evidence)
    assert.equal(object(object(summary._financing_amounts).total_budget).amount, 400000)
    const stage = financingStage({ ...info(), financing_amounts: summary._financing_amounts,
      financiamiento: { ...context, journey: { accepted: true }, entry: summary._financing_entry } })
    assert.equal(stage.stage, 'continue_financing', current)
    assert.equal(stage.collection_allowed, true)
  }
})

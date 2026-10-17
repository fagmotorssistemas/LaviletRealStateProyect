import { writerFixture } from './fixtures/writer-response.fixture'
import { financingInvitationReceipt } from './financing-invitation'
import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { deliveredPendingQuestion } from './continuation-question'
import { financingInputs } from './financing'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { rememberFinancingEntry } from './financing-entry'
import { commercialJourneyPlan } from './commercial-journey'
import { financingStage, rememberedFinancingPartner } from './financing-stage'
import { normalizedPendingQuestion } from './turn-semantics'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { typedTurnFixture, authorityFixture } from './fixtures/typed-turn.fixture'

const demo = { enabled: true, observationOnly: true, updatedAt: null }
const pass = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
const units = [
  { id: 'ph602', unit_number: '602', category: 'penthouse', unit_type: 'penthouse', bedrooms: 3,
    floor_number: 6, bathrooms_full: 2, published_commercial_price: 550000, is_published: true, status: 'disponible' },
  { id: 'ph605', unit_number: '605', category: 'penthouse', unit_type: 'penthouse', bedrooms: 3,
    floor_number: 6, bathrooms_full: 3, published_commercial_price: 539900, is_published: true, status: 'disponible' },
]
const wrong = { purpose: 'none', role: 'necessary_clarification', missing_datum: '', next_decision: 'Elegir unidad',
  continuation_id: 'none', continuation_act: 'choose_unit' }

test('accepted JEP with known entry plans property selection with canonical inventory before compacting financial context', async () => {
  const reply = 'Podemos continuar con JEP. La unidad 602 tiene dos baños y la 605 tiene tres. ¿Cuál de estas unidades le gustaría revisar?'
  let writer: Row = {}
  const result = await withResponseReviewPolicy(demo, () => completeTurnReply({
    current: 'Sí, continuemos con JEP', baseReply: reply,
    verified: {
      lead: { purchase_purpose: 'vivir', preferred_category: 'penthouse' },
      catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true }, catalog_verification_read: { complete: true },
      recorrido_comercial: {}, politica_comercial: { precios_autorizados: true },
      hechos_confirmados: { budget: { status: 'maximum_total', amount: 400000, evidence: 'Mi presupuesto total es 400 mil', confidence: 'high' } },
      financing_amounts: { down_payment: { amount: 200000, evidence: 'Puedo poner 200 mil de entrada' } },
      property_context: { query: { group: 'residential', category: 'penthouse', operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } },
        selected_ids: [], category_preference: { category: 'penthouse', confirmed: true } },
      financiamiento: { partners: ['Cooperativa JEP'], journey: { accepted: true, status: 'accepted',
        partner_preference: { name: 'Cooperativa JEP', evidence: 'Sí, continuemos con JEP', source_message_id: 'lead-acceptance' } } },
      semantica_turno: { primary_intent: 'ask_financing', confidence: 'high', budget: { status: 'not_discussed' } },
      solicitudes_interpretadas: [{ domain: 'financing', request: 'Continuar con JEP', evidence: 'Sí, continuemos con JEP', confidence: 'high' }],
    }, audit: { source: 'financing_question', semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    if (task === 'review') return pass
    writer = object(raw)
    return writerFixture({ reply, question: wrong, requests: [{ fragment: 'R1', intent: 'Continuar con JEP', request_type: 'general_information',
      status: 'answered', evidence: 'Podemos continuar con JEP.', fact_key: null }] })
  }))
  const plan = object(result.audit.commercial_journey)
  assert.equal(plan.action, 'select_property')
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(object(plan.readiness).financing_accepted, true)
  assert.deepEqual(new Set(object(plan.selection_scope).unit_ids as string[]), new Set(['ph602', 'ph605']))
  const verified = object(writer.contexto_verificado)
  assert.equal(object(verified.prompt_context_selection).task, 'property_selection')
  assert.deepEqual(new Set((object(writer.evidencia_turno).units as Row[]).map(unit => unit.unit_number)), new Set(['602', '605']))
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.follow_up).usable, true, JSON.stringify({ question: result.audit.question,
    follow_up: result.audit.follow_up, recovery: result.audit.question_metadata_recovery }))
})

for (const [mode, policy] of [
  ['normal', { enabled: true, observationOnly: false, updatedAt: null }],
  ['demonstration', demo],
  ['disabled', { enabled: false, observationOnly: false, updatedAt: null }],
] as const) test('the delivered entry proposal binds a yes before property selection without replacing total budget or lender: '+mode, async () => {
  const total = { status: 'maximum_total', amount: 400000, evidence: 'Mi presupuesto total es 400 mil', confidence: 'high' }
  const data: Row = {
    recorrido_comercial: {},
    lead: { purchase_purpose: 'vivir', preferred_category: 'penthouse' },
    catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true }, catalog_verification_read: { complete: true },
    hechos_confirmados: { budget: total }, financing_amounts: { total_budget: total },
    property_context: { query: { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } },
      selected_ids: [], category_preference: { category: 'penthouse', confirmed: true } },
    financiamiento: { partners: ['Cooperativa JEP'], journey: { accepted: true, status: 'accepted',
      partner_preference: { name: 'Cooperativa JEP', evidence: 'Sí, continuemos con JEP', source_message_id: 'accepted-jep' } } },
    semantica_turno: { primary_intent: 'ask_financing', budget: { status: 'not_discussed' } },
  }
  const planned = commercialJourneyPlan(data)
  assert.equal(planned.action, 'clarify_financing_down_payment')
  const reply = String(planned.question)
  const result = await withResponseReviewPolicy(policy, () => completeTurnReply({ current: 'Sí, continuemos con JEP',
    baseReply: reply, verified: data, audit: { source: 'financing_question', semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, _raw, _schema, _image, _file, _tone, task) => task === 'review' ? pass : writerFixture({
    reply, question: { purpose: 'collect_financing_required', role: 'necessary_clarification', missing_datum: 'Entrada inicial',
      next_decision: 'Definir entrada', continuation_id: 'financing_down_payment', continuation_act: 'financing' }, requests: [],
  })))
  const receipt = deliveredPendingQuestion(result.reply, { metadata: result.audit.question, plan: result.audit.commercial_journey })
  assert.equal(receipt.id, 'financing_down_payment')
  assert.equal(object(receipt.amount_reference).amount, 400000, JSON.stringify({ phase: 'first receipt', receipt, plan: result.audit.commercial_journey, reply: result.reply }))
  assert.equal(object(normalizedPendingQuestion(receipt).amount_reference).amount, 400000, JSON.stringify({ phase: 'normalize receipt', receipt }))
  const receiptAgain = deliveredPendingQuestion(result.reply, { metadata: result.audit.question, candidates: [receipt] })
  assert.equal(object(receiptAgain.amount_reference).amount, 400000, JSON.stringify({ receiptAgain, receipt, metadata: result.audit.question }))
  const current = 'Sí, ese monto'
  const raw: Row = { ...structuredClone(profileFixture), communication: typedTurnFixture(current).communication }
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'financing', request: 'Confirmar entrada', evidence: current, confidence: 'high' }]
  raw.financing_amounts = []
  object(raw.qualification).presupuesto_texto = null
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'answer_previous'; semantics.primary_evidence = current
  semantics.answer_to_previous = { question_id: receipt.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  semantics.budget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'high' }
  const previous = { _pending_question: receipt, _financing_amounts: { total_budget: total }, _interpretation_memory: { budget: total } }
  let calls = 0
  const interpreted = await interpretConversationTurn({ mensaje_actual: current, resumen: previous, pregunta_pendiente: receipt }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  const summary = rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics)
  const entry = rememberFinancingEntry({}, current, interpreted.extracted, receipt, 'entry-confirmation')
  assert.equal(entry.amount, 400000, JSON.stringify({ phase: 'remember entry', entry, extracted: interpreted.extracted }))
  assert.equal(object(object(summary._financing_amounts).total_budget).amount, 400000, 'total budget retained')
  assert.equal(object(object(summary._financing_amounts).down_payment).amount, 400000, 'entry remembered')
  data.financing_amounts = summary._financing_amounts
  object(data.financiamiento).entry = entry
  data.semantica_turno = interpreted.semantics
  const resumed = commercialJourneyPlan(data)
  assert.equal(resumed.action, 'select_property')
  assert.equal(resumed.question_id, 'unit_choice')
  assert.equal(resumed.financing_offer_allowed, false)
  assert.equal(financingStage(data).collection_allowed, false, 'Entry alone cannot start collecting personal data without a unit.')
  assert.equal(rememberedFinancingPartner(object(object(data.financiamiento).journey), ['Cooperativa JEP']), 'Cooperativa JEP')
})

for (const verdict of ['block', 'unavailable']) test('demonstration preserves an actual financing invitation despite writer metadata and review findings: '+verdict, async () => {
  const reply = 'Podemos ayudarle a analizar financiamiento. ¿Desea que continuemos con el proceso de financiamiento por este chat?'
  const result = await withResponseReviewPolicy(demo, () => completeTurnReply({ current: 'Prefiero penthouses', baseReply: reply,
    verified: { catalogo: [], siguiente_paso_comercial: { action: 'offer_financing', question_id: 'financing_invitation',
      question: '¿Desea que continuemos con el proceso de financiamiento?', question_act: 'financing' } },
    audit: { source: 'budget_financing_guidance', semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    if (task === 'review') {
      if (verdict === 'unavailable') throw new Error('OPENAI_TIMEOUT')
      return { ...pass, verdict: 'block', findings: [{ category: 'commercial_next_step', statement: reply,
        reason: 'Observación del contenido', authoritative_fact: 'Seguimiento independiente' }] }
    }
    return writerFixture({ reply, question: { ...wrong, purpose: 'permission_to_continue', continuation_id: 'financing_invitation', continuation_act: 'financing' }, requests: [{ fragment: 'R1', intent: 'Penthouses', request_type: 'general_information',
      status: 'answered', evidence: 'Podemos ayudarle', fact_key: null }] })
  }))
  assert.equal(result.audit.status, 'review_observed')
  assert.equal(object(result.audit.final_validation).passed, true)
  assert.equal(object(object(result.audit.semantic_review).acceptance).content_approved, false)
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.follow_up).usable, true)
  const receipt = deliveredPendingQuestion(reply, { metadata: result.audit.question, plan: result.audit.commercial_journey })
  assert.equal(receipt.id, 'financing_invitation')
  const acceptance = financingInputs({ action_authority: authorityFixture('Sí, continuemos con JEP', 'financing', 'accept'), turn_semantics: {
    answer_to_previous: { question_id: receipt.id, kind: 'affirmative', confidence: 'high', evidence: 'Sí, continuemos con JEP' },
  }, financing_partner_choice: { kind: 'select', reference_kind: 'explicit', name: 'Cooperativa JEP', evidence: 'Sí, continuemos con JEP', confidence: 'high' } },
  'Sí, continuemos con JEP', reply, { partners: ['Cooperativa JEP'], current: {} }, { kind: 'financing_consent', reply,
    invitation: financingInvitationReceipt(result.audit.question) })
  assert.equal(acceptance.consent, true)
  assert.equal(acceptance.partner, 'Cooperativa JEP')
})

test('a rejected demonstration answer without a question has no next action to lose or authorize', async () => {
  const reply = 'Con gusto.'
  const result = await withResponseReviewPolicy(demo, () => completeTurnReply({ current: 'Gracias', baseReply: reply, verified: {},
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, async (_rules, _raw, _schema, _image, _file, _tone, task) =>
    task === 'review' ? { ...pass, verdict: 'block', findings: [{ category: 'style', statement: reply, reason: 'Observación', authoritative_fact: '' }] }
      : writerFixture({ reply, question: wrong, requests: [] })))
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.follow_up).usable, true)
  assert.deepEqual(deliveredPendingQuestion(reply, { metadata: result.audit.question }), {})
})

for (const status of ['initial_capital', 'no_defined_budget', 'declines_to_disclose'])
  test('the separate entry answer keeps the confirmed total purchase budget: '+status, () => {
    const current = status === 'initial_capital' ? 'Puedo poner 200 mil de entrada' : status === 'no_defined_budget' ? 'Todavía no sé cuánto poner de entrada' : 'Prefiero no compartir mi entrada'
    const budget = { status: 'maximum_total', amount: 400000, confidence: 'high', evidence: 'Mi presupuesto total es 400 mil' }
    const amounts = status === 'initial_capital' ? [{ role: 'down_payment', amount: 200000, evidence: current, replaces_role: null }] : []
    const saved = rememberInterpretedTurn({ _pending_question: { id: 'financing_down_payment' },
      _interpretation_memory: { budget }, _financing_amounts: { total_budget: { amount: 400000, evidence: budget.evidence } } }, current,
    { qualification: { presupuesto_texto: current }, financing_amounts: amounts }, {
      budget: { status, amount: status === 'initial_capital' ? 200000 : null, evidence: current, confidence: 'high' }, financing_amounts: amounts,
    })
    assert.deepEqual(object(saved._interpretation_memory).budget, budget)
    assert.equal(object(object(saved._financing_amounts).total_budget).amount, 400000)
    if (amounts.length) assert.equal(object(object(saved._financing_amounts).down_payment).amount, 200000)
  })

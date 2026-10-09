import assert from 'node:assert/strict'
import test from 'node:test'
import { commercialEngagement, COMMERCIAL_ENGAGEMENT_VERSION, explicitPropertyInterest, type CommercialEngagementTurn } from './commercial-engagement'
import { journeyPendingQuestion } from './commercial-journey'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { object, type Row } from './data'

const pending = { id: 'property_category', act: 'choose_category', question: '¿Busca una vivienda o un local para su negocio?' }
const activeMemory = { engagement_version: COMMERCIAL_ENGAGEMENT_VERSION, passive_sales: false, property_interest: true }
const passiveMemory = { engagement_version: COMMERCIAL_ENGAGEMENT_VERSION, passive_sales: true, property_interest: false }
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

function answerToUse(current: string): CommercialEngagementTurn {
  const declaration = current.toLowerCase().indexOf('me interesa algo para vivienda')
  return {
    scope: { kind: 'property', uncertain: false }, pendingQuestion: pending,
    semantics: { primary_intent: 'other', primary_evidence: current, confidence: 'high',
      property: { group: 'residential', category: null, operation: 'none', evidence: declaration < 0 ? current : current.slice(declaration),
        confidence: 'high', excluded_categories: ['local'] },
      answer_to_previous: { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' } },
    intent: { objective: 'other', scope: { kind: 'property', uncertain: false }, pending_question: pending, requests: [] },
  }
}

for (const current of [
  'muchas gracias, bueno me interesa algo para vivienda',
  'Bueno me interesa algo para vivienda',
  'MUCHAS GRACIAS, BUENO ME INTERESA ALGO PARA VIVIENDA',
  'Bueno, me interesa algo para vivienda',
  'Bueno estoy interesado en una vivienda',
]) test('a word ending in no does not turn a housing answer into a sales refusal: ' + current, () => {
  const engagement = commercialEngagement(current, [], activeMemory, answerToUse(current))
  assert.equal(engagement.passive, false)
  assert.equal(engagement.interested, true)
  assert.equal(engagement.property_continuation_allowed, true)
  assert.notEqual(engagement.property_continuation?.reason, 'current_sales_refusal')
  assert.equal(commercialEngagement(current, [], { property_interest: true }).passive, false, 'Legacy callers must not find a refusal inside bueno')
})

for (const current of [
  'muchas gracias, bueno me interesa algo para vivienda',
  'Me interesa una vivienda',
]) test('a grounded answer about use restores discovery when a false refusal was already persisted: ' + current, () => {
  const engagement = commercialEngagement(current, [], passiveMemory, answerToUse(current))
  assert.equal(engagement.passive, false)
  assert.equal(engagement.interested, true)
  assert.equal(engagement.property_continuation_allowed, true)
  assert.equal(engagement.property_continuation?.property_interest_renewed, true)
  const allowed = engagement.property_continuation?.allowed_question_ids as string[]
  for (const id of ['financing_invitation', 'visit_invitation', 'reservation_invitation', 'financing_data']) assert.ok(!allowed.includes(id))
})

test('a factual query about homes does not erase a persisted refusal or create use-selection consent', () => {
  const current = 'Bueno, ¿qué precio tienen las viviendas?'
  const engagement = commercialEngagement(current, [], passiveMemory, {
    scope: { kind: 'property', uncertain: false }, pendingQuestion: pending,
    intent: { objective: 'ask_price', scope: { kind: 'property' }, requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
    semantics: { primary_intent: 'ask_price', confidence: 'high',
      property: { group: 'residential', operation: 'search', evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: null, kind: 'none', evidence: '', confidence: 'high' } },
  })
  assert.equal(engagement.passive, true)
  assert.equal(engagement.property_continuation_allowed, true)
  assert.equal(engagement.property_continuation?.property_interest_renewed, false)
})

test('a factual price objective stays passive even when its auxiliary answer incorrectly labels a use value', () => {
  const current = 'Bueno, ¿qué precio tienen las viviendas?'
  const engagement = commercialEngagement(current, [], passiveMemory, {
    scope: { kind: 'property', uncertain: false }, pendingQuestion: pending,
    intent: { objective: 'ask_price', scope: { kind: 'property' }, requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
    semantics: { primary_intent: 'ask_price', confidence: 'high',
      property: { group: 'residential', operation: 'search', evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' } },
  })
  assert.equal(engagement.passive, true)
  assert.equal(engagement.interested, false)
  assert.equal(engagement.property_continuation_allowed, true, 'The requested price can still be answered')
  assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  assert.notEqual(engagement.property_continuation?.reason, 'current_property_use_choice')
})

for (const variant of ['historical_group_evidence', 'different_pending_question', 'bare_affirmative'] as const)
  test('use discovery recovery requires the current grounded value, not an incidental group: ' + variant, () => {
    const current = variant === 'bare_affirmative' ? 'Sí, gracias' : 'muchas gracias, bueno me interesa algo para vivienda'
    const turn = answerToUse(current), semantics = object(turn.semantics), property = object(semantics.property), answer = object(semantics.answer_to_previous)
    turn.semantics = { ...semantics,
      property: { ...property, ...(variant === 'historical_group_evidence' ? { evidence: 'Busco una vivienda de tres dormitorios' } : {}) },
      answer_to_previous: { ...answer, ...(variant === 'different_pending_question' ? { question_id: 'budget_amount' }
        : variant === 'bare_affirmative' ? { kind: 'affirmative' } : {}) },
    }
    const engagement = commercialEngagement(current, [], passiveMemory, turn)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  })

for (const current of [
  'bueno me interesa comprar una vivienda',
  'bueno estoy interesado en comprar un departamento',
  'Bueno quiero comprar una vivienda',
  'BUENO ME INTERESA COMPRAR UNA VIVIENDA',
]) test('explicit property interest uses the same refusal word boundaries: ' + current, () => {
  assert.equal(explicitPropertyInterest(current), true)
  assert.equal(commercialEngagement(current, [], {}).passive, false)
  assert.equal(commercialEngagement(current, [], {}).interested, true)
})

for (const current of [
  'No me interesa comprar una vivienda',
  'Bueno, no me interesa el proyecto',
  'No estoy interesado en una vivienda',
  'Bueno, no quiero comprar una vivienda',
  'No no me interesa comprar una vivienda',
  'Solo por curiosidad, ¿tienen viviendas?',
  'Número equivocado',
]) test('real sales refusals still take precedence over a positive answer label: ' + current, () => {
  const engagement = commercialEngagement(current, [], activeMemory, answerToUse(current))
  assert.equal(engagement.passive, true)
  assert.equal(engagement.interested, false)
  assert.equal(engagement.property_continuation_allowed, false)
  assert.equal(engagement.property_continuation?.reason, 'current_sales_refusal')
  assert.equal(explicitPropertyInterest(current), false)
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) for (const recoverPassive of [false, true])
  test('the reported housing answer reaches the writer, review and budget receipt: ' + mode + ', recoverPassive=' + recoverPassive, async () => {
    const current = 'muchas gracias, bueno me interesa algo para vivienda'
    const turn = answerToUse(current), tasks: string[] = [], contexts: Row[] = []
    const question = { purpose: 'clarify_request', role: 'necessary_clarification', missing_datum: 'Presupuesto total aproximado',
      next_decision: 'Continuar con las necesidades de vivienda', continuation_id: 'budget_amount', continuation_act: 'budget' }
    const verified: Row = {
      lead: { purchase_purpose: 'vivir' }, recorrido_comercial: {},
      property_context: { query: { group: 'residential', operation: 'search', filters: {} }, selected_ids: [] },
      perfil_lead: { full_name: 'Carlos', name_status: 'confirmed', residence_city: 'Cuenca', residence_status: 'confirmed',
        sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Carlos' } } },
      catalogo: [{ id: 'd202', category: 'departamento', unit_number: '202', bedrooms: 3, floor_number: 2,
        area_internal_m2: 120.83, is_published: true, status: 'disponible' }],
      catalog_read: { complete: true }, politica_comercial: { precios_autorizados: false },
      _sales_memory: recoverPassive ? passiveMemory : activeMemory, semantica_turno: { ...object(turn.semantics), budget: { status: 'not_discussed' } },
      contrato_turno: turn.intent,
    }
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current, baseReply: 'Tenemos opciones de vivienda. ¿Qué tipo le interesa?', verified,
        history: [{ role: 'bot', content: pending.question }],
        audit: { source: 'property_living_options', semantic_review_enabled: true, business_risk_review_enabled: true, resolved_turn_intent: turn.intent } },
      async (_rules, raw, _schema, _image, _file, _tone, task) => {
        tasks.push(task || ''); const context = object(raw); contexts.push(context)
        if (task === 'writing') {
          const plan = object(object(context.contexto_verificado).siguiente_paso_comercial)
          const reply = 'Con gusto le orientamos para su vivienda. ' + String(plan.question)
          return { reply, question, requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id,
            intent: 'Atender su búsqueda de vivienda', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
        }
        return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...question, offered_action: 'none' } }
      }))
    const writer = object(contexts[0].contexto_verificado), plan = object(result.audit.commercial_journey)
    assert.equal(object(writer.commercial_engagement).passive, false)
    assert.notEqual(object(object(writer.commercial_engagement).property_continuation).reason, 'current_sales_refusal')
    assert.equal(object(writer.siguiente_paso_comercial).action, 'ask_budget')
    assert.equal(plan.question_id, 'budget_amount')
    assert.match(result.reply, /presupuesto total aproximado/i)
    assert.doesNotMatch(result.reply, /dormitorios|suites|penthouses|qué tipo|financiamiento/i)
    assert.equal(object(result.audit.final_validation).passed, true, JSON.stringify(result.audit))
    assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    if (contexts.length > 1) assert.equal(rows(contexts[1].obligaciones_del_turno).find(row => row.id === 'commercial_next_step')?.question_id, 'budget_amount')
    const receipt = journeyPendingQuestion(result.reply, plan, true, result.audit.question)
    assert.equal(receipt.id, 'budget_amount')
    assert.equal(receipt.act, 'budget')
    assert.deepEqual(receipt.candidate_ids, [])
    assert.deepEqual(object(verified.property_context).selected_ids, [])
  })

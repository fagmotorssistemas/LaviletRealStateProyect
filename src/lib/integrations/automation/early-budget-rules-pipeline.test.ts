import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { progressivePendingQuestion } from './progressive-options'
import { BUDGET_ORIENTATION_RULES } from './budget-orientation-rules'
import { object, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const modes = ['normal', 'demonstration', 'disabled'] as const
const catalog = [{ id: 'd201', unit_number: '201', category: 'departamento', floor_number: 2, bedrooms: 3,
  area_internal_m2: 120.83, published_commercial_price: 250000, is_published: true, status: 'disponible' }]

for (const mode of modes) test('early budget survives writer, reviewer and question receipt despite a stale options invitation: ' + mode, async () => {
  const current = 'Busco una vivienda'
  const question = '¿Qué presupuesto total aproximado tiene previsto para la compra?'
  const reply = 'Con gusto le orientamos con las opciones de vivienda. ' + question
  const plan = { action: 'ask_budget', question_id: 'budget_amount', question,
    instruction: 'El uso ya se conoce. Pregunte únicamente el presupuesto total aproximado antes de dormitorios y opciones.' }
  const metadata = { purpose: 'clarify_request', role: 'necessary_clarification', missing_datum: 'Presupuesto total de compra',
    next_decision: 'Orientar la búsqueda y después conocer sus necesidades', continuation_id: 'budget_amount', continuation_act: 'budget' }
  const verified = { catalogo: catalog, politica_comercial: { precios_autorizados: true },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    siguiente_paso_comercial: plan,
    solicitudes_interpretadas: [{ domain: 'property', request: current, evidence: current, confidence: 'high', topics: ['property_options'] }],
    semantica_turno: { confidence: 'high', primary_intent: 'answer_previous', primary_evidence: current,
      budget: { status: 'not_discussed' } },
    property_context: { selected_ids: [], query: { group: 'residential', filters: {} } } }
  const stale = { source: 'property_living_options', semantic_review_enabled: true, business_risk_review_enabled: true,
    progressive_selection: { stage: 'offer_details', question: '¿Desea conocer las opciones con más detalle?' },
    pending_question: { id: 'unit_choice', act: 'explore_alternatives', question: '¿Desea conocer las opciones con más detalle?', candidate_ids: ['d201'] } }
  const before = structuredClone(verified)
  const tasks: string[] = [], contexts: Row[] = [], appliedRules: string[] = []
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
    () => completeTurnReply({ current, baseReply: 'Tenemos viviendas. ¿Desea conocer más detalles?', verified, audit: stale },
      async (rules, raw, _schema, _image, _file, _tone, task) => {
        const context = object(raw); tasks.push(task || ''); contexts.push(context); appliedRules.push(String(rules))
        if (task === 'writing') {
          return { reply, question: metadata, requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id,
            intent: 'Atender vivienda', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
        }
        return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...metadata, offered_action: 'none' } }
      }))
  assert.equal(result.reply, reply, String(result.audit.status))
  for (const context of contexts) {
    const obligation = rows(context.obligaciones_del_turno).find(row => row.id === 'commercial_next_step')!
    assert.equal(obligation.question_id, 'budget_amount')
    assert.equal(obligation.continuation_required, true)
    assert.ok(String(obligation.instruction).includes(BUDGET_ORIENTATION_RULES), 'Obligation rules: '+String(obligation.instruction))
  }
  assert.ok(appliedRules[0].includes(BUDGET_ORIENTATION_RULES), 'Writer rules: '+appliedRules[0].slice(-6000))
  assert.equal(object(object(object(contexts[0].response_content_scope).topics).purchase_prices).allowed, false)
  assert.equal(rows(object(contexts[0].evidencia_turno).units)[0]?.published_commercial_price, undefined)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
  assert.deepEqual(verified, before)
  if (contexts.length > 1) {
    const writerPlan = rows(contexts[0].obligaciones_del_turno).find(row => row.id === 'commercial_next_step')
    const reviewPlan = rows(contexts[1].obligaciones_del_turno).find(row => row.id === 'commercial_next_step')
    assert.deepEqual(reviewPlan, writerPlan)
  }
  const delivered = progressivePendingQuestion(result.reply, { ...stale, commercial_journey: plan, turn_completeness: result.audit })
  assert.equal(delivered.id, 'budget_amount')
  assert.equal(delivered.act, 'budget')
  assert.deepEqual(delivered.candidate_ids, [])
})

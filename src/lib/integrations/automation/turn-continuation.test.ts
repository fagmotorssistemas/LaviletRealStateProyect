import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { commercialJourneyPlan, journeyPendingQuestion, rememberCommercialJourney } from './commercial-journey'
import { finalWriterContract } from './response-plan'
import { reviewObligations } from './focused-review'
import { turnContinuation, turnContinuationIssues } from './turn-continuation'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { responseReviewSettings } from '@/lib/inmobiliaria/responseReview'

const off = responseReviewSettings({ response_review: { enabled: false } })
const audit = { source: 'project_overview', semantic_review_enabled: true, business_risk_review_enabled: true,
  profile_introduction: { stage: 'deliver', question_purpose: 'none', brochure_previously_sent: true } }
const fresh = (): Row => ({ recorrido_comercial: {}, lead: {}, perfil_lead: {}, property_context: { query: {} },
  financiamiento: {}, catalogo: [], semantica_turno: { primary_intent: 'project_information' } })
const reviewPass = { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
function draft(reply: string) { return { reply, requests: [], question: null } }

test('the same pending decision applies across information topics, without a keyword-specific reply patch', async () => {
  for (const [current, answer, source] of [
    ['que es mixto', 'El proyecto combina viviendas y espacios comerciales.', 'project_overview'],
    ['¿Dónde queda?', 'El proyecto está en Puertas del Sol, Cuenca.', 'location'],
    ['¿Qué es un recorrido virtual?', 'Permite explorar los espacios digitalmente.', 'virtual_showroom'],
    ['¿Qué contiene el brochure?', 'Presenta información y planos del proyecto.', 'brochure'],
  ]) {
    const calls: string[] = [], errors: unknown[] = []
    const reply = `${answer} ¿Le interesa una vivienda o un local para su negocio?`
    const result = await withResponseReviewPolicy(off, () => completeTurnReply({ current, baseReply: answer, verified: fresh(), audit: { ...audit, source } },
      async (_rules, raw, _schema, _image, _file, _tone, task) => {
        calls.push(String(task))
        try {
          const context = object(raw)
          const step = (context.obligaciones_del_turno as Row[]).find(item => item.id === 'commercial_next_step')!
          assert.equal(step.continuation_required, true); assert.equal(step.question_id, 'property_category')
          assert.equal(task, 'writing')
        } catch (error) { errors.push(error); throw error }
        return draft(reply)
      }))
    assert.deepEqual(errors, [])
    assert.equal(result.reply, reply); assert.deepEqual(calls, ['writing'])
    assert.equal(object(result.audit.commercial_journey).action, 'discover_use')
    assert.equal(object(object(result.audit.writer_contract).continuacion_del_turno).required, true)
    assert.equal(journeyPendingQuestion(reply, object(result.audit.commercial_journey), true).id, 'property_category')
  }
})

test('known preferences choose the remaining decision rather than repeating the initial categories', () => {
  const info = { ...fresh(), lead: { purchase_purpose: 'vivir', preferred_bedrooms: 2 },
    property_context: { query: { group: 'residential', category: 'departamento', filters: { bedrooms: 2 } } } }
  const plan = commercialJourneyPlan(info, audit), verified = { ...info, siguiente_paso_comercial: plan }
  assert.equal(plan.action, 'ask_budget')
  const contract = finalWriterContract('', audit, { verified })
  assert.equal(contract.pregunta_siguiente, plan.question)
  assert.equal(contract.continuacion_del_turno.question_id, 'budget_amount')
  const obligation = reviewObligations(audit, verified, contract).find(item => item.id === 'commercial_next_step')!
  assert.equal(obligation.continuation_required, true)
  assert.equal(obligation.question_id, contract.continuacion_del_turno.question_id)
})

test('reviewed pipeline repairs a missing CTA once, then reviews the completed answer', async () => {
  const answer = 'El proyecto combina viviendas y espacios comerciales.'
  const reply = `${answer} ¿Busca una vivienda o un local?`
  const calls: string[] = [], errors: unknown[] = []
  const result = await completeTurnReply({ current: 'que es mixto', baseReply: answer, verified: fresh(), audit },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      const data = object(raw); calls.push(String(task))
      try {
        const obligation = (data.obligaciones_del_turno as Row[]).find(item => item.id === 'commercial_next_step')!
        assert.equal(obligation.continuation_required, true)
        if (calls.length === 2) {
          const repairs = object(data.reparacion).correcciones_concretas
          // The requested repair is scoped to the missing decision, not a new handoff.
          assert.ok(JSON.stringify(repairs ?? data).includes('Añada únicamente la pregunta'))
        }
      } catch (error) { errors.push(error); throw error }
      return task === 'writing' ? draft(calls.length === 1 ? answer : reply) : reviewPass
    })
  assert.deepEqual(errors, [])
  assert.equal(result.audit.status, 'checked'); assert.equal(result.reply, reply)
  assert.deepEqual(calls, ['writing', 'writing', 'review'])
  assert.equal(result.needsAdvisor, false)
  assert.ok((result.audit.repair_attempts as Row[]).some(item => (item.issues as string[]).includes('required_continuation_missing')))
})

test('a missing CTA cannot be approved merely because the facts are correct', async () => {
  const answer = 'El proyecto combina viviendas y espacios comerciales.'
  const calls: string[] = []
  const result = await completeTurnReply({ current: 'que es mixto', baseReply: answer, verified: fresh(), audit },
    async (_rules, _context, _schema, _image, _file, _tone, task) => { calls.push(String(task)); return draft(answer) })
  assert.equal(result.audit.status, 'rejected_guard')
  assert.deepEqual(calls, ['writing', 'writing'])
  assert.ok((result.audit.issues as string[]).includes('required_continuation_missing'))
})

test('the reviewer can reject a generic CTA that replaces the actual pending decision', async () => {
  const answer = 'El proyecto combina viviendas y espacios comerciales.'
  const generic = '¿Desea más información?', specific = '¿Busca una vivienda o un local para su negocio?'
  const calls: string[] = [], errors: unknown[] = []
  const result = await completeTurnReply({ current: 'que es mixto', baseReply: answer, verified: fresh(), audit },
    async (rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(String(task))
      if (task === 'writing') return draft(`${answer} ${calls.length === 1 ? generic : specific}`)
      try {
        assert.match(rules, /continuation_required=true/)
        const next = (object(raw).obligaciones_del_turno as Row[]).find(item => item.id === 'commercial_next_step')!
        assert.equal(next.question_id, 'property_category')
      } catch (error) { errors.push(error); throw error }
      return calls.length === 2 ? { ...reviewPass, verdict: 'block', findings: [{ category: 'turn_goal', statement: generic,
        reason: 'commercial_next_step exige identificar vivienda o comercio; ofrecer más información no recoge esa decisión.',
        authoritative_fact: specific }] } : reviewPass
    })
  assert.deepEqual(errors, [])
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, `${answer} ${specific}`)
  assert.deepEqual(calls, ['writing', 'review', 'writing', 'review'])
  assert.equal(result.needsAdvisor, false)
})

test('review disabled remains a real bypass; an omitted question is never saved as delivered', async () => {
  const answer = 'El proyecto combina viviendas y espacios comerciales.'
  const result = await withResponseReviewPolicy(off, () => completeTurnReply({ current: 'que es mixto', baseReply: answer, verified: fresh(), audit }, async () => draft(answer)))
  assert.equal(result.reply, answer); assert.equal(result.audit.status, 'review_disabled')
  const plan = object(result.audit.commercial_journey)
  assert.equal(plan.question_id, 'property_category')
  assert.deepEqual(journeyPendingQuestion(answer, plan, true), {})
  assert.equal(rememberCommercialJourney({}, plan, {}, true).stage, 'discover_use')
})

test('a material link after the question cannot erase the pending decision', () => {
  const plan = commercialJourneyPlan(fresh(), audit)
  const question = '¿Le interesa una vivienda o un local comercial?'
  for (const reply of [question, `${question}\n\nBrochure: https://www.lavilett.com/materiales/brochure.pdf`,
    'https://www.lavilett.com/?next=ignored\n' + question + '\nCon mucho gusto.']) {
    assert.deepEqual(turnContinuationIssues(reply, { commercial_journey: plan }), [])
    assert.equal(journeyPendingQuestion(reply, plan, true).question, question)
  }
  assert.deepEqual(turnContinuationIssues('https://www.lavilett.com/?next=ignored', { commercial_journey: plan }), ['required_continuation_missing'])
})

test('passive information, rejected offers, operations awaiting a result and closures do not acquire a compulsory CTA', () => {
  for (const action of ['leave_open', 'await_reservation', 'visit_pending', 'current_operation']) {
    const plan = { action, question: '', question_id: '' }
    assert.equal(turnContinuation({ commercial_journey: plan }).required, false)
    assert.deepEqual(turnContinuationIssues('Con mucho gusto.', { commercial_journey: plan }), [])
  }
  const info = { ...fresh(), _sales_memory: { passive_sales: true } }
  assert.equal(commercialJourneyPlan(info).action, 'leave_open')
})

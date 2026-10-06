import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { deliveredPendingQuestion } from './continuation-question'
import { withResponseReviewPolicy } from './response-review-policy'
import { object } from './data'

for (const enabled of [true, false]) test(`the final question receipt survives the real completion pipeline with review ${enabled}`, async () => {
  const reply = 'Tenemos suites y departamentos. ¿Cuál de estas opciones desea conocer primero?'
  const question = { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'tipo de vivienda', next_decision: 'Mostrar opciones',
    continuation_id: 'property_category', continuation_act: 'choose_category' }
  const tasks: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply({ current: 'Quiero conocer las opciones',
    baseReply: reply, verified: { catalogo: [], solicitudes_interpretadas: [{ domain: 'property', evidence: 'Quiero conocer las opciones', request: 'Opciones', confidence: 'high' }] },
    audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, _input, schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    if (task === 'writing') {
      assert.ok(object(object(object(schema).properties).question).required instanceof Array)
      assert.ok((object(object(object(schema).properties).question).required as string[]).includes('continuation_id'))
      return { reply, question, requests: [{ fragment: 'R1', intent: 'Opciones', request_type: 'general_information', status: 'answered', evidence: 'Presenta categorías', fact_key: null }] }
    }
    return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...question, offered_action: 'information' } }
  }))
  assert.equal(result.reply, reply)
  const pending = deliveredPendingQuestion(result.reply, { metadata: result.audit.question,
    plan: { question_id: 'financing_invitation', question: '¿Desea iniciar financiamiento?' } })
  assert.equal(pending.id, 'property_category')
  assert.equal(pending.act, 'choose_category')
  assert.deepEqual(tasks, enabled ? ['writing', 'review'] : ['writing'])
})

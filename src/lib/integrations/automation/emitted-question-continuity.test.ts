import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from './data'
import { replyQuestions } from './reply-question'
import { actualContinuation, reconcileContinuationMetadata, validContinuationMetadata } from './continuation-validation'
import { deliveredPendingQuestion } from './continuation-question'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'

const pass = { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: null }
const incorrect = { purpose: 'none', role: 'necessary_clarification', missing_datum: '', next_decision: 'Presupuesto', continuation_id: 'unit_choice', continuation_act: 'confirm_unit' }
const question = 'Quisiera confirmar si desea continuar con esta unidad para seguir adelante con la información y pasos correspondientes'
const reply = 'El penthouse 602 tiene tres dormitorios. '+question+'.'
const plan = { action: 'select_property', question_id: 'unit_choice', question_act: 'confirm_unit', question, selection_scope: { unit_ids: ['ph602'] } }

test('an indirect current confirmation keeps the emitted question and its unit target', () => {
  assert.deepEqual(replyQuestions(reply), [question])
  assert.equal(actualContinuation(reply).act, 'confirm_unit')
  const recovered = reconcileContinuationMetadata(incorrect, reply, plan)
  assert.equal(recovered.corrected, true)
  assert.equal(recovered.question.purpose, 'choose_property')
  const receipt = deliveredPendingQuestion(reply, { metadata: recovered.question, plan }, [{ id: 'ph602', unit_number: '602' }])
  assert.equal(receipt.act, 'confirm_unit')
  assert.deepEqual(receipt.target_ids, ['ph602'])
})

test('unknown questions and conditional or negated requests cannot borrow a planned action', () => {
  assert.equal(reconcileContinuationMetadata(incorrect, '¿Qué le parece?', plan).corrected, false)
  const plausibleTag = { ...incorrect, purpose: 'choose_property', role: 'optional_continuation' }
  assert.equal(validContinuationMetadata(plausibleTag, '¿Qué le parece?', plan), false)
  assert.deepEqual(deliveredPendingQuestion('¿Qué le parece?', { metadata: plausibleTag, plan }, [{ id: 'ph602', unit_number: '602' }]), {})
  for (const text of ['Cuando tengamos más información, quisiera confirmar si desea continuar.', 'No necesito confirmar si desea continuar.', 'La oficina permite recibir orientación sobre la distribución.', 'Quisiera confirmar que hemos recibido su entrada declarada.']) {
    assert.deepEqual(replyQuestions(text), [], text)
  }
  const finance = 'El penthouse 602 es la unidad de interés. ¿Desea que iniciemos la revisión financiera por este chat?'
  assert.notEqual(actualContinuation(finance).act, 'confirm_unit')
})

for (const mode of ['normal', 'demonstration', 'disabled']) test('unit confirmation tracking survives invalid writer metadata in '+mode, async () => {
  const observation = mode === 'demonstration'
  const tasks: string[] = []
  const audit = { semantic_review_enabled: true, business_risk_review_enabled: true, ...(observation ? { response_review_observation: { enabled: true, test_contact: true } } : {}) }
  let instructions = ''
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: observation, updatedAt: null }, () => completeTurnReply({ current: 'Sí, deme más información', baseReply: reply,
    verified: { siguiente_paso_comercial: plan, catalogo: [{ id: 'ph602', unit_number: '602', unit_type: 'penthouse', bedrooms: 3, publish_commercial: true, sale_status: 'available' }] }, audit }, async (rules, _context, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    if (task === 'writing') { instructions = String(rules); return { reply, question: incorrect, requests: [{ fragment: 'R1', intent: 'Detalles de la unidad', request_type: 'general_information', status: 'answered', evidence: 'El penthouse 602 tiene tres dormitorios', fact_key: null }] } }
    return pass
  }))
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.follow_up).usable, true, JSON.stringify(result.audit))
  assert.equal(object(result.audit.question).purpose, 'choose_property')
  assert.match(instructions, /nombre.*ocasional/)
  assert.match(instructions, /No repita la ficha/)
  assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
})

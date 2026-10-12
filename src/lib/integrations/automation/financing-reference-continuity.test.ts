import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { financingEntryQuestion, confirmedFinancingEntryReference, deliveredFinancingEntryReference,
  resolveFinancingEntryReference, rememberFinancingEntry, actualFinancingEntryQuestion } from './financing-entry'
import { deliveredPendingQuestion } from './continuation-question'
import { reconcileContinuationMetadata } from './continuation-validation'
import { normalizeTurnSemantics } from './turn-semantics'
import { financingAmounts } from './financing-amounts'
import { financingInputs } from './financing'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { interpretationSourceIssues } from './turn-interpretation-input'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import fixture from './fixtures/extractor-profile-turn.json'

const total = { amount: 100000, evidence: 'Tengo más o menos unos 100 mil de presupuesto' }
const proposal = financingEntryQuestion({ hechos_confirmados: { budget: { ...total, status: 'maximum_total', confidence: 'high' } } })
const plan = { action: 'clarify_financing_down_payment', question_id: 'financing_down_payment', question_act: 'financing',
  question: proposal.question, question_amount_reference: proposal.amount_reference }
const reply = 'Carlos, para continuar con el proceso de financiamiento, quisiera saber si el presupuesto aproximado de $100,000 que nos indicó estaría destinado a la entrada inicial del crédito, o si tiene prevista otra cantidad para ello. Esta información nos ayudará a orientarle mejor. ¿Podría confirmarlo, por favor?'
const wrongMetadata = { text: '¿Podría confirmarlo, por favor?', purpose: 'clarify_request', role: 'necessary_clarification',
  continuation_id: 'financing_down_payment', continuation_act: 'financing' }

function extraction(current: string, amount: number | null = 100000, confidence = 'high'): Row {
  const raw = structuredClone(fixture) as Row
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'financing', request: 'Confirmar importe de entrada', evidence: current, confidence }]
  raw.financing_amounts = amount === null ? [] : [{ role: 'down_payment', amount, evidence: current, replaces_role: null }]
  object(raw.qualification).presupuesto_texto = null
  raw.turn_semantics = { ...object(raw.turn_semantics), primary_intent: 'answer_previous', primary_evidence: current, confidence,
    answer_to_previous: { question_id: 'financing_down_payment', kind: 'affirmative', evidence: current, confidence },
    budget: { status: amount === null ? 'not_discussed' : 'initial_capital', amount,
      evidence: amount === null ? '' : current, confidence } }
  return raw
}

test('the actual indirect entry question survives wrong editorial purpose and generic confirmation wording', () => {
  const reconciled = reconcileContinuationMetadata(wrongMetadata, reply, plan)
  assert.equal(reconciled.corrected, true)
  assert.equal(reconciled.question.purpose, 'collect_financing_required')
  const receipts = [
    deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan }),
    deliveredPendingQuestion(reply, { metadata: reconciled.question, plan }),
    deliveredPendingQuestion(reply, { plan }),
  ]
  for (const pending of receipts) {
    assert.equal(pending.id, 'financing_down_payment')
    assert.match(String(pending.question), /quisiera saber si.*entrada inicial/)
    assert.equal(object(pending.amount_reference).amount, 100000)
    assert.equal(object(pending.amount_reference).question_source, reply)
  }
})

for (const mode of ['normal', 'demonstration', 'disabled']) test('the outgoing entry receipt remains usable with invalid metadata in ' + mode, async () => {
  const observed = mode === 'demonstration'
  const audit: Row = { semantic_review_enabled: true, business_risk_review_enabled: true,
    ...(observed ? { response_review_observation: { enabled: true, test_contact: true } } : {}) }
  const tasks: string[] = []
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: observed, updatedAt: null }, () => completeTurnReply({
    current: 'Sí me parece bien el financiamiento', baseReply: reply,
    verified: { siguiente_paso_comercial: plan }, audit,
  }, async (_instructions, _context, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    if (task === 'writing') return { reply, question: wrongMetadata, requests: [{ fragment: 'R1', intent: 'Continuar orientación financiera',
      request_type: 'general_information', status: 'answered', evidence: 'para continuar con el proceso de financiamiento', fact_key: null }] }
    return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: null }
  }))
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.follow_up).usable, true, JSON.stringify(result.audit))
  assert.equal(object(result.audit.question).purpose, 'collect_financing_required')
  assert.equal(object(deliveredPendingQuestion(result.reply, { metadata: result.audit.question, plan }).amount_reference).amount, 100000)
  assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
})

test('two real interpretation turns resolve current entry confirmation once and keep total, entry and consent distinct', async () => {
  const pending = deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan })
  for (const [current, confidence] of [
    ['Si ese dinero lo usaría para al entrada', 'high'],
    ['Ese dinero que le comenté lo emplearía como entrada inicial', 'medium'],
    ['Para la entrada utilizaría el presupuesto que le indiqué', 'high'],
    ['Sí, usaré el importe que le indiqué', 'high'],
  ]) {
    const raw = extraction(current, 100000, confidence)
    assert.deepEqual(interpretationSourceIssues(raw, current, [], pending), [])
    const previous = { _pending_question: pending, _financing_amounts: { total_budget: total },
      _interpretation_memory: { budget: { ...total, status: 'maximum_total', confidence: 'high' } },
      _financing_journey: { accepted: true } }
    let calls = 0
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending, resumen: previous }, {
      activePrompt: async () => '', aiJson: async () => { calls++; return structuredClone(raw) },
    })
    assert.equal(calls, 1, current)
    assert.equal(interpreted.semantics.budget.amount, 100000)
    assert.equal(interpreted.semantics.budget.evidence, current)
    const summary = rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics)
    assert.equal(object(object(summary._financing_amounts).total_budget).amount, 100000)
    assert.equal(object(object(summary._financing_amounts).down_payment).amount, 100000)
    assert.equal(object(summary._financing_journey).accepted, true)
    assert.equal(rememberFinancingEntry({}, current, interpreted.extracted, pending, 'entry-confirmed').amount, 100000)
    assert.equal(financingInputs(interpreted.extracted, current, reply, { partners: ['Cooperativa JEP'], current: {} }).consent, null,
      'Entry confirmation does not newly authorize financing or a lender operation')
    const neutralNext = normalizeTurnSemantics({}, 'Quisiera tres dormitorios', {})
    assert.notEqual(neutralNext.budget.status, 'initial_capital', 'The prior entry is memory, not a new current monetary declaration')
  }
})

test('a semantic affirmative can confirm the demonstrated amount without repeating its role or inventing a current numeric statement', () => {
  const pending = deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan })
  for (const current of ['Sí, ese monto', 'Sí, esa cantidad', 'Correcto, ese presupuesto', 'El mismo importe']) {
    const raw = extraction(current, null)
    const resolved = resolveFinancingEntryReference(raw, current, pending)
    assert.equal(object(object(resolved.turn_semantics).budget).amount, 100000, current)
    assert.equal(object(object(resolved.turn_semantics).budget).evidence, current)
    assert.deepEqual(interpretationSourceIssues(resolved, current, [], pending), [])
    assert.equal(rememberFinancingEntry({}, current, resolved, pending, 'confirmed-reference').amount, 100000)
  }
})

test('a current explicit different amount remains authoritative instead of adopting the delivered proposal', () => {
  const current = 'No, para la entrada tendría 60 mil'
  const raw = extraction(current, 60000)
  object(object(raw.turn_semantics).answer_to_previous).kind = 'negative'
  const pending = deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan })
  assert.equal(confirmedFinancingEntryReference(raw, current, pending), null)
  assert.deepEqual(resolveFinancingEntryReference(raw, current, pending), raw)
  assert.deepEqual(interpretationSourceIssues(raw, current, [], pending), [])
  const amounts = financingAmounts({ total_budget: total }, raw.financing_amounts, current)
  assert.equal(object(amounts.total_budget).amount, 100000)
  assert.equal(object(amounts.down_payment).amount, 60000)
})

test('affirmative labels cannot override a negation, condition, partial amount or competing numeric referent', () => {
  const pending = deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan })
  for (const current of [
    'No usaría ese dinero para la entrada', 'Sí, si es necesario usaría ese dinero para la entrada',
    'Si ese dinero fuera suficiente lo usaría para la entrada',
    'Sí, pero solo una parte de ese dinero para la entrada', 'Otro monto para la entrada',
    'Sí ese dinero para la entrada serían 60 mil', '¿Ese dinero sería para la entrada?',
  ]) {
    assert.equal(confirmedFinancingEntryReference(extraction(current), current, pending), null, current)
    assert.ok(interpretationSourceIssues(extraction(current), current, [], pending).includes('invalid_budget_amount'), current)
  }
})

test('a planned or fake generic question cannot manufacture a delivered entry amount', () => {
  const current = 'Sí'
  for (const actualReply of [
    'Su presupuesto es $100,000. ¿Podría confirmarlo?',
    'Tiene $100,000. ¿Qué dormitorios busca?',
    'La entrada sería $100,000. ¿Desea continuar con el financiamiento?',
    '¿Cuánto dinero tendrá para la entrada inicial?',
    'Quisiera saber si su presupuesto sería para la entrada inicial. ¿Podría confirmarlo?',
    reply.replace('$100,000', '$120,000'),
    reply.replace('$100,000', '$100,000 o $60,000'),
  ]) {
    const pending = deliveredPendingQuestion(actualReply, { metadata: wrongMetadata, plan })
    assert.equal(object(pending.amount_reference).amount, undefined, actualReply)
    assert.equal(confirmedFinancingEntryReference(extraction(current), current, pending), null, actualReply)
  }
  const pending = deliveredPendingQuestion(reply, { metadata: wrongMetadata, plan })
  const stale = { ...pending, question: '¿Qué dormitorios busca?' }
  assert.equal(confirmedFinancingEntryReference(extraction(current), current, stale), null)
  assert.equal(confirmedFinancingEntryReference(extraction(current), current, { ...pending, id: 'budget_amount' }), null)
  assert.equal(deliveredFinancingEntryReference('¿Podría confirmarlo?', object(proposal.amount_reference)), null)
  assert.equal(actualFinancingEntryQuestion('¿Cuál es la entrada mínima que exige el banco?'), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { budgetKindQuestion, budgetQuestion, leadBudget } from './budget-state'
import { budgetQuestionBasis } from './budget-question-context'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { interpretationInput, TurnInterpretationError } from './turn-interpretation-input'
import { pendingQuestionFromReply } from './turn-semantics'

const totalQuestion = { id: 'budget_amount', act: 'budget', question: budgetQuestion({}) }

function extraction(current: string, status: string, amount: number | null = 200000): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = []
  raw.events = []
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'discuss_budget'; semantics.primary_evidence = current
  semantics.answer_to_previous = { question_id: 'budget_amount', kind: amount ? 'value' : 'negative', evidence: current, confidence: 'high' }
  semantics.budget = { status, amount, evidence: current, confidence: 'high' }
  object(raw.qualification).presupuesto_texto = current
  return raw
}

test('asking total approximate budget is an amount question; choosing total versus entry is a different question', () => {
  for (const question of [totalQuestion.question, '¿De cuánto es el presupuesto total aproximado que tiene previsto para la compra?',
    '¿Cuánto presupuesto tiene para toda la compra?']) {
    assert.equal(pendingQuestionFromReply(question).id, 'budget_amount', question)
  }
  assert.equal(budgetQuestionBasis(totalQuestion), 'total_budget')
  assert.equal(pendingQuestionFromReply('¿Ese monto corresponde a su presupuesto total para la compra o al dinero disponible para la entrada?').id, 'budget_kind')
  assert.equal(pendingQuestionFromReply('¿De cuánto dispone para la entrada?').id, 'budget_amount')
  assert.equal(budgetQuestionBasis({ id: 'budget_amount', question: '¿De cuánto dispone para la entrada?' }), 'down_payment')
  assert.equal(budgetQuestionBasis({ id: 'budget_amount', question: '¿Qué presupuesto tiene?' }), null)
  assert.equal(budgetQuestionBasis({ id: 'budget_amount', question: '¿Es presupuesto total o entrada?' }), null)
  assert.equal(budgetQuestionBasis({ id: 'unit_choice', question: totalQuestion.question }), null)
})

test('a direct total-budget answer uses its current amount and quote and does not authorize financing', async () => {
  const current = 'unos 200 mil', raw = extraction(current, 'maximum_total'), before = structuredClone(raw)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
    activePrompt: async () => 'Extract', aiJson: async (rules, input) => {
      calls++
      assert.ok(rules.includes('una respuesta monetaria directa'))
      assert.equal(object(object(input).contexto_pregunta_presupuesto).role_asked, 'total_budget')
      assert.equal(object(input).mensaje_actual, current)
      return raw
    },
  })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).status, 'maximum_total')
  assert.equal(object(result.semantics.budget).evidence, current)
  assert.equal(object(result.semantics.budget).amount, 200000)
  assert.equal((result.extracted.financing_amounts as Row[])[0].role, 'total_budget')
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(object(result.semantics.property).operation, 'none')
  assert.deepEqual(raw, before)
})

test('a role omitted by the extractor gets one focused check, keeping unrelated permissions protected', async () => {
  const current = '200 mil', raw = extraction(current, 'amount')
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
    activePrompt: async () => 'Extract', aiJson: async (_rules, input, schema) => {
      if (++calls === 1) return raw
      assert.deepEqual(object(object(input).recuperacion_interpretacion).issues, ['unresolved_budget_role'])
      assert.equal(object(schema?.properties).financing_consent, undefined)
      assert.equal(object(input).pregunta_pendiente && object(object(input).pregunta_pendiente).question, totalQuestion.question)
      return { turn_semantics: { budget: { status: 'maximum_total', amount: 200000, evidence: current, confidence: 'high' } },
        financing_amounts: [{ role: 'total_budget', amount: 200000, evidence: current, replaces_role: null }],
        qualification: { presupuesto_texto: current }, financing_consent: true }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).status, 'maximum_total')
  assert.equal(result.extracted.financing_consent, null)
})

test('an explicit entry overrides a total-budget question and survives a later acceptance without another kind question', async () => {
  const current = 'Bueno, esos 200 mil serían para la entrada', raw = extraction(current, 'initial_capital')
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  })
  const summary = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
  const acceptance = 'Sí, está bien', followup = extraction(acceptance, 'not_discussed', null)
  object(followup.turn_semantics).primary_intent = 'answer_previous'
  object(followup.turn_semantics).answer_to_previous = { question_id: 'financing_invitation', kind: 'affirmative', evidence: acceptance, confidence: 'high' }
  object(followup.turn_semantics).budget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' }
  object(followup.qualification).presupuesto_texto = null
  const next = await interpretConversationTurn({ mensaje_actual: acceptance, resumen: summary,
    pregunta_pendiente: { id: 'financing_invitation', act: 'financing', question: '¿Desea que le ayudemos a analizar financiamiento?' } }, {
    activePrompt: async () => 'Extract', aiJson: async () => followup,
  })
  const remembered = rememberInterpretedTurn(summary, acceptance, next.extracted, next.semantics)
  const budget = leadBudget({ hechos_confirmados: remembered._interpretation_memory })
  assert.equal(budget.status, 'initial_capital')
  assert.equal(budget.amount, 200000)
  assert.equal(budgetKindQuestion(budget), '')
  assert.equal(object(object(remembered._financing_amounts).down_payment).amount, 200000)
  assert.equal(object(confirmedInterpretationMemory(remembered).budget).evidence, current)
})

test('a generic amount question preserves a genuinely ambiguous role without guessing total or entry', async () => {
  const current = '200 mil', raw = extraction(current, 'amount')
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current,
    pregunta_pendiente: { id: 'budget_amount', question: '¿Con cuánto dinero cuenta?' } }, {
    activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).status, 'amount')
  assert.equal(leadBudget({ semantica_turno: result.semantics }).status, 'amount')
  assert.deepEqual(result.extracted.financing_amounts, [])
})

for (const [status, current] of [['no_defined_budget', 'Todavía no tengo un presupuesto definido'],
  ['declines_to_disclose', 'Por ahora prefiero no decir mi presupuesto']]) test(`${status} remains answered without inventing funds or retaining an old amount`, async () => {
  const raw = extraction(current, status, null)
  raw.requests = [{ domain: 'property', request: totalQuestion.question, evidence: totalQuestion.question, confidence: 'high' }]
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
    activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.deepEqual(result.requests, [])
  const remembered = rememberInterpretedTurn({ _interpretation_memory: { budget: {
    status: 'maximum_total', amount: 200000, evidence: 'Tengo 200 mil', confidence: 'high' } } }, current, result.extracted, result.semantics)
  const budget = leadBudget({ hechos_confirmados: remembered._interpretation_memory })
  assert.equal(budget.status, status)
  assert.equal(budget.answered, true)
  assert.equal(budget.amount, null)
  assert.equal(result.extracted.financing_consent, null)
})

test('approximate declarations and range wording remain intact in durable evidence', async () => {
  for (const current of ['Unos 200 mil aproximadamente', 'Entre 200 mil y 300 mil, todavía es una estimación']) {
    const raw = extraction(current, 'maximum_total')
    const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
      activePrompt: async () => 'Extract', aiJson: async rules => {
        assert.ok(rules.includes('no convierte toda estimación en un máximo rígido'))
        return raw
      },
    })
    const summary = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
    assert.equal(object(confirmedInterpretationMemory(summary).budget).evidence, current)
  }
})

test('a current entry correction revokes a remembered total budget independently of the pending question', async () => {
  const current = 'Esos 200 mil no son para toda la compra, son para la entrada', raw = extraction(current, 'initial_capital')
  raw.financing_amounts = [{ role: 'down_payment', amount: 200000, evidence: current, replaces_role: 'total_budget' }]
  const previous = { _interpretation_memory: { budget: {
    status: 'maximum_total', amount: 200000, evidence: 'Tengo 200 mil para toda la compra', confidence: 'high' } },
    _financing_amounts: { total_budget: { amount: 200000, evidence: 'Tengo 200 mil para toda la compra' } } }
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion, resumen: previous }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  })
  const summary = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
  assert.equal(object(summary._financing_amounts).total_budget, undefined)
  assert.equal(object(object(summary._financing_amounts).down_payment).amount, 200000)
  assert.equal(object(confirmedInterpretationMemory(summary).budget).status, 'initial_capital')
})

test('question context never legitimizes a historical monetary citation', async () => {
  const current = 'No estoy seguro', raw = extraction('Tengo 200 mil', 'maximum_total')
  object(raw.turn_semantics).primary_evidence = current
  object(raw.turn_semantics).answer_to_previous = { kind: 'none', question_id: 'none', evidence: '', confidence: 'low' }
  raw.qualification = {}
  await assert.rejects(interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: totalQuestion }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('non_current_evidence:budget'))
})

test('current question context takes precedence over a different historical question and carries no fictitious amount', () => {
  const input = interpretationInput({ pregunta_pendiente: totalQuestion,
    contexto_propiedades: { pending_question: { id: 'budget_amount', question: '¿Cuánto tiene para la entrada?' } } }, 'No lo sé')
  assert.equal(object(input.contexto_pregunta_presupuesto).role_asked, 'total_budget')
  assert.equal(object(input.contexto_pregunta_presupuesto).amount, undefined)
})

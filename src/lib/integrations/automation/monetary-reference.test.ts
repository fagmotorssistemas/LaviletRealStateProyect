import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { confirmedMonetaryReferences } from './monetary-reference'
import { financingEntryQuestion, rememberFinancingEntry } from './financing-entry'
import { deliveredPendingQuestion } from './continuation-question'
import { interpretationInput, interpretationSourceIssues } from './turn-interpretation-input'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { financingStage } from './financing-stage'
import fixture from './fixtures/extractor-profile-turn.json'

const total = { amount: 100000, evidence: 'Tengo unos 100 mil dólares de presupuesto' }
const proposal = financingEntryQuestion({ hechos_confirmados: { budget: { ...total, status: 'maximum_total', confidence: 'high' } } })
const plan = { question_id: 'financing_down_payment', question_act: 'financing', question: proposal.question,
  question_amount_reference: proposal.amount_reference }
const pending = deliveredPendingQuestion(String(proposal.question), { plan })
const previous = { _pending_question: pending, _financing_amounts: { total_budget: total },
  _interpretation_memory: { budget: { ...total, status: 'maximum_total', confidence: 'high' } },
  _financing_journey: { accepted: true } }
const input = { pregunta_pendiente: pending, resumen: previous }
const references = confirmedMonetaryReferences(input)
const referenceId = String(references.find(reference => reference.role === 'total_budget')!.id)

function extraction(current: string, reference: string | null = referenceId, amount = 100000): Row {
  const raw = structuredClone(fixture) as Row
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'financing', request: 'Confirmar importe disponible para la entrada', evidence: current, confidence: 'high' }]
  raw.financing_amounts = [{ role: 'down_payment', amount, amount_reference_id: reference, evidence: current, replaces_role: null }]
  object(raw.qualification).presupuesto_texto = null
  raw.turn_semantics = { ...object(raw.turn_semantics), primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: 'financing_down_payment', kind: 'value', evidence: current, confidence: 'high' },
    budget: { status: 'initial_capital', amount, amount_reference_id: reference, evidence: current, confidence: 'high' } }
  return raw
}

test('canonical monetary references exclude history, catalogue prices, foreign registries and conflicting facts', () => {
  const projected = interpretationInput({ ...input, historial: [{ content: 'Tengo 600 mil' }],
    catalogo_unidades: [{ published_commercial_price: 310000 }], referencias_monetarias_confirmadas: [{ id: 'fake', amount: 600000 }] }, 'Ese dinero')
  assert.deepEqual(projected.referencias_monetarias_confirmadas, references)
  const conflict = { resumen: { ...previous, _financing_amounts: { total_budget: { ...total, amount: 200000 } } } }
  assert.deepEqual(confirmedMonetaryReferences(conflict), [])
  assert.deepEqual(confirmedMonetaryReferences({ resumen: { _interpretation_memory: { budget_revocation: { role: 'total_budget' } },
    _turn_intent: { budget: { ...total, status: 'maximum_total', confidence: 'high' } } } }), [])
})

test('contextual entry references advance in one extraction without reparsing abbreviated quantities or wording', async () => {
  for (const current of ['si esos 100 son serian para entrada.', 'Los cien que le comenté serían mi aporte inicial',
    'Utilizaría exactamente lo que le indiqué', 'La totalidad del importe anterior iría como anticipo']) {
    const raw = extraction(current)
    assert.deepEqual(interpretationSourceIssues(raw, current, [], pending, references), [])
    let calls = 0
    const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async (instructions, context, schema) => {
        calls++
        assert.match(instructions, /amount_reference_id/)
        assert.deepEqual(object(context).referencias_monetarias_confirmadas, references)
        assert.ok(object(object(object(object(schema).properties).turn_semantics).properties).budget)
        return structuredClone(raw)
      },
    })
    assert.equal(calls, 1, current)
    assert.equal(result.semantics.budget.amount, 100000)
    assert.equal(result.semantics.budget.amount_reference_id, referenceId)
    assert.equal(result.semantics.budget.evidence, current)
    const summary = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
    assert.equal(object(object(summary._financing_amounts).total_budget).amount, 100000)
    assert.equal(object(object(summary._financing_amounts).down_payment).amount, 100000)
    const entry = rememberFinancingEntry({}, current, result.extracted, pending, 'current-entry')
    assert.equal(entry.amount, 100000)
    const next = financingStage({ financing_amounts: summary._financing_amounts,
      financiamiento: { enabled: true, flow: { enabled: true }, journey: { accepted: true }, entry },
      property_context: { selected_ids: [] } })
    assert.equal(next.stage, 'select_property')
    assert.equal(next.entry_status, 'amount')
  }
})

test('medium-confidence interpretation retains a verified reference and accepts a different semantic answer label', async () => {
  const current = 'Lo mismo que le comenté sería mi entrada', raw = extraction(current)
  object(object(raw.turn_semantics).budget).confidence = 'medium'
  object(object(raw.turn_semantics).answer_to_previous).confidence = 'medium'
  object(object(raw.turn_semantics).answer_to_previous).kind = 'affirmative'
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => structuredClone(raw),
  })
  assert.equal(result.semantics.budget.amount, 100000)
  assert.equal(result.semantics.budget.confidence, 'medium')
})

test('a known amount can be referenced as total or loan without merging their monetary roles', async () => {
  for (const role of ['total_budget', 'loan']) {
    const current = role === 'loan' ? 'Esa cantidad es lo que pediría prestado' : 'El mismo monto sería mi presupuesto total'
    const raw = extraction(current)
    object((raw.financing_amounts as Row[])[0]).role = role
    object(raw.turn_semantics).primary_intent = 'discuss_budget'
    object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
    object(raw.turn_semantics).budget = role === 'loan'
      ? { status: 'not_discussed', amount: null, amount_reference_id: null, evidence: '', confidence: 'low' }
      : { ...object(object(raw.turn_semantics).budget), status: 'maximum_total' }
    const result = await interpretConversationTurn({ resumen: previous, mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async () => structuredClone(raw),
    })
    const summary = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
    assert.equal(object(object(summary._financing_amounts)[role]).amount, 100000)
    assert.equal(object(object(summary._financing_amounts).down_payment).amount, undefined)
  }
})

test('a partial or uncertain allocation does not reuse the whole known amount as entry', async () => {
  const current = 'Tal vez usaría una parte, todavía no sé cuánto', raw = extraction(current, null)
  raw.financing_amounts = []
  object(raw.turn_semantics).budget = { status: 'amount_pending', amount: null, amount_reference_id: null,
    evidence: current, confidence: 'high' }
  object(object(raw.turn_semantics).answer_to_previous).kind = 'uncertain'
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => structuredClone(raw),
  })
  assert.equal(result.semantics.budget.amount, null)
  const summary = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
  assert.equal(object(object(summary._financing_amounts).down_payment).amount, undefined)
})

test('a different direct entry remains a new value and never overwrites the confirmed total', async () => {
  const current = 'No, para la entrada tendría 60 mil', raw = extraction(current, null, 60000)
  object(object(raw.turn_semantics).answer_to_previous).kind = 'negative'
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => structuredClone(raw),
  })
  const summary = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
  assert.equal(object(object(summary._financing_amounts).total_budget).amount, 100000)
  assert.equal(object(object(summary._financing_amounts).down_payment).amount, 60000)
})

test('unknown, stale, malformed and mismatching references cannot pass via literal amount or legacy confirmation', () => {
  const current = 'Sí, los 100 mil para la entrada'
  for (const [id, amount] of [['unknown', 100000], [referenceId, 60000], ['', 100000], [123, 100000]] as const) {
    const raw = extraction(current, referenceId, amount)
    object(object(raw.turn_semantics).budget).amount_reference_id = id
    const issues = interpretationSourceIssues(raw, current, [], pending, references)
    assert.ok(issues.includes('invalid_monetary_reference:budget'))
    assert.ok(issues.includes('invalid_budget_amount'))
  }
  assert.ok(interpretationSourceIssues(extraction(current), current, [], pending, [])
    .includes('invalid_monetary_reference:budget'))
  const wrongStatement = extraction(current)
  object((wrongStatement.financing_amounts as Row[])[0]).amount_reference_id = 'unknown'
  assert.ok(interpretationSourceIssues(wrongStatement, current, [], pending, references)
    .includes('invalid_monetary_reference:financing_amounts.0'))
  const contradictory = extraction(current)
  object((contradictory.financing_amounts as Row[])[0]).amount = 60000
  object((contradictory.financing_amounts as Row[])[0]).amount_reference_id = null
  assert.ok(interpretationSourceIssues(contradictory, current, [], pending, references)
    .includes('invalid_monetary_reference:budget'))
  const historicalQuote = extraction('Tengo unos 100 mil dólares de presupuesto')
  assert.ok(interpretationSourceIssues(historicalQuote, 'Sería para la entrada', [], pending, references)
    .includes('invalid_monetary_reference:budget'))
})

test('a focused repair receives canonical reference IDs and can resolve the amount without touching unrelated facts', async () => {
  const current = 'Si esos 100 serían para la entrada'
  const invalid = extraction(current, 'unavailable'), repaired = extraction(current)
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async (_instructions, context) => {
      calls++
      assert.deepEqual((object(context).referencias_monetarias_confirmadas as Row[]).map(reference => reference.id), [referenceId])
      if (calls === 1) return structuredClone(invalid)
      return { turn_semantics: { budget: object(repaired.turn_semantics).budget }, financing_amounts: repaired.financing_amounts,
        budget_turn_use: { kind: 'current_update', evidence: current, confidence: 'high' }, qualification: { presupuesto_texto: null } }
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.budget.amount, 100000)
})

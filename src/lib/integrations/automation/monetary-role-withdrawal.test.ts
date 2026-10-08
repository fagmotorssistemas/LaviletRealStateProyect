import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { financingAmounts, financingAmountStatements, financingBalance, FINANCING_AMOUNTS_SCHEMA } from './financing-amounts'
import { rememberInterpretationFacts } from './interpretation-memory'
import { leadBudget } from './budget-state'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { TurnInterpretationError } from './turn-interpretation-input'

const initial: Row = { _financing_amounts: {
  down_payment: { amount: 200000, evidence: 'Tengo 200 mil para la entrada' },
  loan: { amount: 350000, evidence: 'Quiero financiar 350 mil' },
}, _interpretation_memory: { qualification: { presupuesto_texto: 'Tengo 200 mil para la entrada' }, budget: { status: 'initial_capital', amount: 200000,
  evidence: 'Tengo 200 mil para la entrada', confidence: 'high' } } }
const noBudget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' }
function money(current: string, statements: Row[], budget: Row = noBudget): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'financing', request: 'Corregir la finalidad del importe', evidence: current, confidence: 'high' }]
  raw.financing_amounts = statements
  raw.turn_semantics = { ...object(raw.turn_semantics), primary_intent: 'discuss_budget', primary_evidence: current,
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }, budget }
  object(raw.qualification).presupuesto_texto = budget.status === 'not_discussed' ? null : current
  return raw
}
async function interpret(current: string, statements: Row[], budget: Row = noBudget) {
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, resumen: initial }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return money(current, statements, budget) },
  })
  return { ...result, calls, summary: rememberInterpretedTurn(initial, current, result.extracted, result.semantics) }
}

test('replacement output is a closed nullable contract; legacy independent declarations remain valid', () => {
  const item = FINANCING_AMOUNTS_SCHEMA.items
  assert.equal(item.additionalProperties, false)
  assert.deepEqual(item.required, ['role', 'amount', 'evidence', 'replaces_role'])
  assert.deepEqual(item.properties.replaces_role.type, ['string', 'null'])
  assert.deepEqual(item.properties.amount.type, ['number', 'null'])
  assert.deepEqual(financingAmountStatements([{ role: 'loan', amount: 200000, evidence: 'Quiero financiar 200 mil' }],
    'Quiero financiar 200 mil'), [{ role: 'loan', amount: 200000, evidence: 'Quiero financiar 200 mil' }])
})

test('current explicit reassignment retires entry, preserves the loan meaning and invalidates saved funds', async () => {
  const current = 'Esos 200 mil no son entrada, son el préstamo que solicitaría'
  const result = await interpret(current, [{ role: 'loan', amount: 200000, evidence: current, replaces_role: 'down_payment' }])
  assert.equal(result.calls, 1)
  const amounts = object(result.summary._financing_amounts)
  assert.equal(amounts.down_payment, undefined)
  assert.equal(object(amounts.loan).amount, 200000)
  const memory = object(result.summary._interpretation_memory)
  assert.deepEqual(object(memory.budget), {})
  assert.equal(object(memory.budget_revocation).role, 'down_payment')
  assert.equal(object(memory.qualification).presupuesto_texto, undefined, 'a duplicate stale budget citation is retired too')
  assert.equal(leadBudget({ hechos_confirmados: memory, lead: { budget_max: 200000 } }).status, 'not_discussed')
  assert.equal(financingBalance(amounts, { id: 'ph602', published_commercial_price: 550000 }, true), null)
})

test('withdrawing a role without replacement persists across another turn and prevents CRM resurrection', async () => {
  const current = 'Ya no voy a aportar entrada, todavía no sé de qué fondos dispondré'
  const withdrawal = { role: null, amount: null, evidence: current, replaces_role: 'down_payment' }
  const result = await interpret(current, [withdrawal])
  assert.equal(result.calls, 1)
  assert.deepEqual(result.semantics.financing_amounts, [withdrawal])
  assert.equal(object(result.summary._financing_amounts).down_payment, undefined)
  assert.equal(object(object(result.summary._financing_amounts).loan).amount, 350000)
  const next = rememberInterpretedTurn(result.summary, 'Quiero detalles del penthouse', {}, { budget: noBudget, financing_amounts: [] })
  assert.equal(leadBudget({ hechos_confirmados: next._interpretation_memory, lead: { budget_max: 200000 } }).source,
    'withdrawn_lead_statement')
})

test('a withdrawn entry may remain an ambiguous known amount but never establishes available funds', async () => {
  const current = 'Los 200 mil no son entrada y todavía no sé cómo repartirlos'
  const budget = { status: 'amount', amount: 200000, evidence: current, confidence: 'high' }
  const result = await interpret(current, [{ role: null, amount: null, evidence: current, replaces_role: 'down_payment' }], budget)
  assert.equal(object(result.semantics.budget).status, 'amount')
  assert.equal(object(result.summary._financing_amounts).down_payment, undefined)
  assert.equal(leadBudget({ hechos_confirmados: result.summary._interpretation_memory }).status, 'amount')
  assert.equal(financingBalance(object(result.summary._financing_amounts), { published_commercial_price: 550000 }, true), null)
})

test('an independent loan declaration never revokes entry because its amount happens to coincide', async () => {
  const current = 'Además quiero solicitar un préstamo de 200 mil'
  const result = await interpret(current, [{ role: 'loan', amount: 200000, evidence: current, replaces_role: null }])
  assert.equal(object(object(result.summary._financing_amounts).down_payment).amount, 200000)
  assert.equal(object(object(result.summary._financing_amounts).loan).amount, 200000)
  assert.equal(leadBudget({ hechos_confirmados: result.summary._interpretation_memory }).status, 'initial_capital')
})

test('a correction changes only the identified role and new actual funds restore a valid budget', async () => {
  const current = 'Corrijo la entrada: serán 100 mil, y el préstamo seguirá siendo 350 mil'
  const result = await interpret(current, [{ role: 'down_payment', amount: 100000, evidence: 'Corrijo la entrada: serán 100 mil', replaces_role: 'down_payment' }],
    { status: 'initial_capital', amount: 100000, evidence: 'Corrijo la entrada: serán 100 mil', confidence: 'high' })
  assert.equal(object(object(result.summary._financing_amounts).down_payment).amount, 100000)
  assert.equal(object(object(result.summary._financing_amounts).loan).amount, 350000)
  assert.equal(object(result.summary._interpretation_memory).budget_revocation, undefined)
  assert.equal(leadBudget({ hechos_confirmados: result.summary._interpretation_memory }).amount, 100000)
})

test('non-current, malformed and guessed withdrawals cannot remove prior facts', () => {
  for (const statement of [
    { role: 'loan', amount: 200000, evidence: 'No son entrada, son préstamo', replaces_role: 'down_payment' },
    { role: null, amount: 0, evidence: 'Quiero más información', replaces_role: 'down_payment' },
    { role: 'loan', amount: null, evidence: 'Quiero más información', replaces_role: 'down_payment' },
    { role: 'loan', amount: 200000, evidence: 'Quiero más información', replaces_role: 'invented' },
  ]) {
    const current = 'Quiero más información'
    assert.deepEqual(financingAmounts(object(initial._financing_amounts), [statement], current), initial._financing_amounts)
    assert.deepEqual(rememberInterpretationFacts(initial, current, { financing_amounts: [statement] }, { budget: noBudget }),
      initial._interpretation_memory)
  }
})

test('an explicit total-budget withdrawal does not delete independent entry or loan roles', () => {
  const current = 'Retiro el presupuesto total anterior, todavía no lo he definido'
  const previous = { ...object(initial._financing_amounts), total_budget: { amount: 550000, evidence: 'Presupuesto total 550 mil' } }
  const next = financingAmounts(previous, [{ role: null, amount: null, evidence: current, replaces_role: 'total_budget' }], current)
  assert.equal(next.total_budget, undefined)
  assert.equal(object(next.down_payment).amount, 200000)
  assert.equal(object(next.loan).amount, 350000)
})

test('contradictory entry and explicit entry-to-loan correction require semantic repair and remain blocked if unrepaired', async () => {
  const current = 'Esos 200 mil no son entrada, son el préstamo que solicitaría'
  const statements = [{ role: 'loan', amount: 200000, evidence: current, replaces_role: 'down_payment' }]
  const raw = money(current, statements, { status: 'initial_capital', amount: 200000, evidence: current, confidence: 'high' })
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, resumen: initial }, {
    activePrompt: async () => '', aiJson: async (_rules, input) => {
      calls++
      if (calls === 1) return raw
      assert.deepEqual(object(object(input).recuperacion_interpretacion).issues, ['inconsistent_budget_role'])
      return { financing_amounts: statements, turn_semantics: { budget: noBudget }, qualification: { presupuesto_texto: null } }
    },
  })
  assert.equal(calls, 2)
  const remembered = rememberInterpretedTurn(initial, current, result.extracted, result.semantics)
  assert.equal(object(remembered._financing_amounts).down_payment, undefined)
  await assert.rejects(interpretConversationTurn({ mensaje_actual: current, resumen: initial }, {
    activePrompt: async () => '', aiJson: async () => raw,
  }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('inconsistent_budget_role'))
})

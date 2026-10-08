import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { TurnInterpretationError } from './turn-interpretation-input'
import { leadBudget } from './budget-state'
import { reconcileMonetaryInterpretation } from './financing-amounts'

function moneyTurn(message: string, status = 'amount'): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ request: 'Aclarar el importe disponible', domain: 'financing', evidence: message, confidence: 'high' }]
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'discuss_budget'; semantics.primary_evidence = message
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
  semantics.budget = { status, amount: 200000, evidence: message, confidence: 'high' }
  object(raw.qualification).presupuesto_texto = message
  return raw
}

test('a role clarification is checked with one focused call even when question metadata was lost', async () => {
  for (const message of ['Claro, bueno yo pensaba esos 200 mil como entrada inicial',
    'pero esto tamnien ya le dije que los 200 mil son de entrada']) {
    const raw = moneyTurn(message), original = structuredClone(raw)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: message, pregunta_pendiente: {},
      ultima_pregunta: '¿Los 200 mil corresponden a su presupuesto total o a la entrada?', }, {
      activePrompt: async () => 'Extract', aiJson: async (_instructions, input, schema) => {
        calls++
        if (calls === 1) return raw
        const context = object(input), properties = object(schema?.properties)
        assert.deepEqual(object(context.recuperacion_interpretacion).issues, ['unresolved_budget_role'])
        assert.ok(properties.financing_amounts)
        assert.equal(properties.requested_advisor, undefined)
        assert.equal(properties.financing_consent, undefined)
        assert.equal(properties.full_name, undefined)
        assert.equal(context.historial, undefined)
        return { financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: message }],
          turn_semantics: { budget: { status: 'initial_capital', amount: 200000, evidence: message, confidence: 'high' } },
          qualification: { presupuesto_texto: message } }
      },
    })
    assert.equal(calls, 2)
    assert.equal(object(result.semantics.budget).status, 'initial_capital')
    const summary = rememberInterpretedTurn({}, message, result.extracted, result.semantics)
    assert.equal(object(object(summary._financing_amounts).down_payment).amount, 200000)
    assert.equal(object(object(summary._interpretation_memory).budget).status, 'initial_capital')
    assert.equal(leadBudget({ hechos_confirmados: summary._interpretation_memory }).status, 'initial_capital')
    assert.deepEqual(raw, original)
    assert.equal(result.extracted.financing_consent, null)
    assert.equal(result.extracted.requested_advisor, false)
  }
})

test('current role cues trigger semantic checking without choosing a role by keyword', async () => {
  const message = 'Esos 200 mil no son para la entrada; todavía no sé cómo repartirlos'
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async () => {
      calls++
      return moneyTurn(message)
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).status, 'amount')
  assert.deepEqual(result.extracted.financing_amounts, [])
})

test('a bare monetary amount remains ambiguous and uses one extraction', async () => {
  const message = 'Tengo 200 mil', raw = moneyTurn(message)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).status, 'amount')
  assert.deepEqual(result.extracted.financing_amounts, [])
})

test('structured entry and total roles reconcile once without erasing the budget declaration', async () => {
  for (const [role, status, message] of [
    ['down_payment', 'initial_capital', 'Tengo 200 mil para la entrada'],
    ['total_budget', 'maximum_total', 'Tengo 200 mil como presupuesto total'],
  ]) {
    const raw = moneyTurn(message)
    raw.financing_amounts = [{ role, amount: 200000, evidence: message }]
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: message }, {
      activePrompt: async () => '', aiJson: async () => { calls++; return raw },
    })
    assert.equal(calls, 1)
    assert.equal(object(result.semantics.budget).status, status)
    assert.equal(object(result.semantics.budget).amount, 200000)
    assert.equal(leadBudget({ semantica_turno: result.semantics }).status, status)
  }
})

test('an explicit budget role supplies its corresponding financing amount; loan never becomes available money', () => {
  for (const [status, role] of [['initial_capital', 'down_payment'], ['maximum_total', 'total_budget']]) {
    const message = 'Estos 200 mil son la cantidad que puedo aportar'
    const reconciled = reconcileMonetaryInterpretation(moneyTurn(message, status), message)
    assert.equal((reconciled.financing_amounts as Row[])[0].role, role)
  }
  const message = 'Quiero financiar 200 mil', raw = moneyTurn(message)
  raw.financing_amounts = [{ role: 'loan', amount: 200000, evidence: message }]
  const reconciled = reconcileMonetaryInterpretation(raw, message)
  assert.equal(object(object(reconciled.turn_semantics).budget).status, 'not_discussed')
  assert.equal(leadBudget({ semantica_turno: { budget: { status: 'not_discussed' },
    financing_amounts: reconciled.financing_amounts } }).status, 'not_discussed')
})

test('a historical property error repairs only its block and the current monetary clarification', async () => {
  const message = 'pero esto tamnien ya le dije que los 200 mil son de entrada', raw = moneyTurn(message)
  const property = object(object(raw.turn_semantics).property)
  Object.assign(property, { operation: 'select', query_scope: 'selected', category: 'penthouse',
    unit_numbers: ['602'], evidence: 'pero esto tamnien ya le dije que la 602', confidence: 'high' })
  raw.requests = [{ domain: 'property', request: 'Más información', evidence: 'si deme mas informacion', confidence: 'high' }]
  raw.full_name = 'Carlos'; object(raw.profile_evidence).full_name = 'Carlos'
  const untouchedPermission = { requested_advisor: true, opt_out: false, consent_granted: false }
  Object.assign(raw, untouchedPermission)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message,
    contexto_propiedades: { selected_ids: ['ph602'] },
    catalogo_unidades: [{ id: 'ph602', unit_number: '602', category: 'penthouse' }],
    historial: [{ role: 'cliente', content: 'si deme mas informacion' }] }, {
    activePrompt: async () => '', aiJson: async (_instructions, input, schema) => {
      calls++
      if (calls === 1) return raw
      assert.equal(object(input).historial, undefined)
      assert.deepEqual(object(object(input).contexto_propiedades).selected_ids, ['ph602'])
      assert.equal(object(schema?.properties).requested_advisor, undefined)
      const repaired = moneyTurn(message, 'initial_capital')
      repaired.financing_amounts = [{ role: 'down_payment', amount: 200000, evidence: message }]
      repaired.requests = []
      repaired.full_name = 'Nombre inventado por la reparación'
      repaired.financing_consent = true
      return repaired
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.property).operation, 'none')
  assert.deepEqual(object(result.semantics.property).unit_numbers, [])
  assert.equal(object(result.semantics.budget).status, 'initial_capital')
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(object(result.extracted.lead_profile).full_name, null)
})

test('an invalid active property remains blocked if its focused recovery is still invalid', async () => {
  const message = 'Tengo 200 mil', raw = moneyTurn(message)
  Object.assign(object(object(raw.turn_semantics).property), { operation: 'select', unit_numbers: ['602'],
    confidence: 'high', evidence: 'quiero la 602' })
  await assert.rejects(interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async () => raw,
  }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('non_current_evidence:property'))
})

test('conflicting typed monetary roles need semantic recovery rather than a silent winner', async () => {
  const message = 'Estos 200 mil son mi presupuesto total', raw = moneyTurn(message, 'initial_capital')
  raw.financing_amounts = [{ role: 'total_budget', amount: 200000, evidence: message }]
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async (_rules, input) => {
      calls++
      if (calls === 1) return raw
      assert.deepEqual(object(object(input).recuperacion_interpretacion).issues, ['inconsistent_budget_role'])
      return { turn_semantics: { budget: { status: 'maximum_total', amount: 200000, evidence: message, confidence: 'high' } },
        financing_amounts: raw.financing_amounts, qualification: { presupuesto_texto: message } }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).status, 'maximum_total')
  assert.equal((result.extracted.financing_amounts as Row[])[0].role, 'total_budget')
  await assert.rejects(interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async () => raw,
  }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('inconsistent_budget_role'))
})

test('a property repair preserves independently evidenced profile and human-contact permission', async () => {
  const message = 'Me llamo Carlos. Tengo 200 mil para la entrada. Quiero hablar con un asesor'
  const raw = moneyTurn(message, 'initial_capital')
  raw.full_name = 'Carlos'; object(raw.profile_evidence).full_name = 'Me llamo Carlos'
  raw.requested_advisor = true; object(raw.action_evidence).requested_advisor = 'Quiero hablar con un asesor'
  raw.requests = [{ domain: 'advisor', request: 'Hablar con asesor', evidence: 'Quiero hablar con un asesor', confidence: 'high' }]
  Object.assign(object(object(raw.turn_semantics).property), { operation: 'select', unit_numbers: ['602'],
    evidence: 'Quiero la 602', confidence: 'high' })
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, {
    activePrompt: async () => '', aiJson: async () => {
      if (++calls === 1) return raw
      const corrected = moneyTurn(message, 'initial_capital')
      corrected.requests = []
      corrected.requested_advisor = false
      corrected.full_name = 'Nombre ajeno'
      return corrected
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.extracted.requested_advisor, true)
  assert.equal(object(result.extracted.lead_profile).full_name, 'Carlos')
  assert.ok(result.requests.some(request => request.domain === 'advisor'))
})

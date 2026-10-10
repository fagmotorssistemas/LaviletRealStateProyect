import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { interpretationInput, interpretationRepairContext } from './turn-interpretation-input'

const budget = { status: 'maximum_total', amount: 300000, evidence: 'Tengo 300 mil para toda la compra', confidence: 'high' }
const pending = { id: 'property_bedrooms', act: 'collect_property_bedrooms', question: '¿Cuántos dormitorios necesita?' }

test('extractor input separates a known budget from the previous turn objective and the actual unanswered question', () => {
  const input: Row = {
    resumen: { datos_confirmados: { proposito: 'vivir' }, _turn_intent: {
      objective: 'discuss_budget', budget, subject: { category: null, unit_numbers: [], filters: {} },
      continuation_goal: null, pending_question: { id: 'budget_total', question: '¿Cuál es su presupuesto?' },
    } },
    pregunta_pendiente: pending, ultima_pregunta: pending.question,
    contexto_propiedades: { query: { group: 'residential' }, pending_question: pending },
    historial: [{ role: 'cliente', content: budget.evidence }, { role: 'bot', content: pending.question }],
  }
  const original = structuredClone(input)
  const projected = interpretationInput(input, 'Quiero algo de 2 dormitorios')
  const priorTurn = object(object(projected.resumen)._turn_intent)
  assert.equal(priorTurn.objective, undefined)
  assert.equal(priorTurn.pending_question, undefined)
  assert.equal(priorTurn.budget, undefined, 'A legacy budget must have a single canonical fact location')
  assert.deepEqual(object(projected.hechos_confirmados).budget, budget)
  assert.deepEqual(projected.pregunta_pendiente, pending)
  assert.deepEqual(object(projected.contexto_propiedades).pending_question, pending)
  assert.equal(projected.mensaje_actual, 'Quiero algo de 2 dormitorios')
  assert.deepEqual(projected.historial, input.historial, 'History remains available only for resolving references')
  assert.deepEqual(input, original, 'Projection must not destroy the stored turn contract')
})

test('input keeps pending price continuity, selected unit references and the actual question without reusing the last objective', () => {
  const question = { id: 'property_category', act: 'collect_property_category', question: '¿Departamentos o penthouses?',
    candidate_ids: ['unit-602', 'unit-605'] }
  const subject = { category: 'penthouse', unit_numbers: ['602'], filters: { bedrooms: 3 } }
  const input = { resumen: { _interpretation_memory: { budget }, _turn_intent: {
    objective: 'ask_price', subject, continuation_goal: 'ask_price', pending_question: pending,
  } }, pregunta_pendiente: question,
  contexto_propiedades: { query: { group: 'residential', category: 'penthouse' }, selected_ids: ['unit-602'],
    offered_ids: ['unit-602', 'unit-605'], pending_question: question },
  catalogo_unidades: [{ id: 'unit-602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6 }],
  unidades_identificadas: [{ id: 'unit-602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6 }],
  consultas_pendientes: [{ domain: 'property', topics: ['purchase_price'], evidence: '¿Cuánto cuesta?', source: 'pending' }] }
  const result = interpretationInput(input, 'No, los penthouses')
  assert.deepEqual(object(object(result.resumen)._turn_intent), { subject, continuation_goal: 'ask_price' })
  assert.deepEqual(object(result.contexto_propiedades).selected_ids, ['unit-602'])
  assert.deepEqual(result.unidades_identificadas, input.unidades_identificadas)
  assert.deepEqual(result.consultas_pendientes, input.consultas_pendientes)
  assert.deepEqual(result.pregunta_pendiente, question)
})

test('monetary role clarification retains known amounts and financial state without promoting earlier consent into current extraction', () => {
  const financialState = { statements: [{ role: 'total_budget', amount: 300000, evidence: budget.evidence }] }
  const journey = { consent_status: 'accepted', unit_id: 'unit-602', pending_field: 'partner' }
  const input = { resumen: { _interpretation_memory: { budget }, _financing_amounts: financialState,
    _financing_journey: journey, _turn_intent: { objective: 'discuss_budget', budget,
      requested_action: 'financing', reservation: { kind: 'request' }, pending_question: pending } },
  pregunta_pendiente: { id: 'budget_role', act: 'clarify_budget_role', question: '¿Es el total o la entrada?' },
  contexto_propiedades: { selected_ids: ['unit-602'] }, financiamiento: { partner_choices: ['pichincha', 'jep'] } }
  const result = interpretationInput(input, 'Ese monto sería para la entrada')
  assert.deepEqual(object(result.hechos_confirmados).budget, budget)
  assert.deepEqual(object(result.resumen)._financing_amounts, financialState)
  assert.deepEqual(object(result.resumen)._financing_journey, journey)
  assert.deepEqual(result.financiamiento, input.financiamiento)
  assert.equal(object(result.hechos_confirmados).financing_consent, undefined)
  assert.equal(object(object(result.resumen)._turn_intent).requested_action, undefined)
  assert.equal(object(object(result.resumen)._turn_intent).reservation, undefined)
  assert.deepEqual(object(result.contexto_propiedades).selected_ids, ['unit-602'])
})

test('an explicit canonical revocation cannot fall back to an older turn budget after context projection', () => {
  const marker = { role: 'total_budget', evidence: 'Ya no tengo ese dinero' }
  const input = { resumen: { _interpretation_memory: { budget: {}, budget_revocation: marker },
    _turn_intent: { objective: 'discuss_budget', budget, subject: {} } } }
  const result = interpretationInput(input, 'Quiero dos dormitorios')
  assert.equal(object(result.hechos_confirmados).budget, undefined)
  assert.deepEqual(object(result.hechos_confirmados).budget_revocation, marker)
  assert.equal(object(object(result.resumen)._turn_intent).budget, undefined)
})

test('repair projection retains canonical budget values, referents and current pending question without historical evidence', () => {
  const input = { resumen: { _turn_intent: { objective: 'discuss_budget', budget, pending_question: { id: 'budget_total' } } },
    pregunta_pendiente: pending, contexto_propiedades: { selected_ids: ['unit-602'], pending_question: pending },
    historial: [{ role: 'cliente', content: budget.evidence }] }
  const repair = object(interpretationRepairContext(interpretationInput(input, 'Quiero dos dormitorios')))
  const facts = object(object(repair.hechos_confirmados).budget)
  assert.equal(facts.amount, 300000)
  assert.equal(facts.status, 'maximum_total')
  assert.equal(facts.evidence, undefined)
  assert.equal(repair.historial, undefined)
  assert.deepEqual(repair.pregunta_pendiente, pending)
  assert.deepEqual(object(repair.contexto_propiedades).selected_ids, ['unit-602'])
  assert.equal(object(object(repair.resumen)._turn_intent).objective, undefined)
  assert.equal(object(object(repair.resumen)._turn_intent).pending_question, undefined)
})

const oldProposal = { id: 'property_requirements', act: 'explore_alternatives',
  question: '¿Revisamos los departamentos de la segunda planta alta?', candidate_ids: ['unit-202'],
  proposed_query: { group: 'residential', category: 'departamento', filters: { floor_number: 2, bedrooms: 3 } } }
const proposalInput = () => ({ contexto_propiedades: {
  query: { group: 'residential', filters: { floor_number: 0, bedrooms: 3 } }, pending_question: oldProposal,
}, catalogo_unidades: [{ id: 'unit-202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2 }] })

test('the actual delivered question supersedes a stale property proposal throughout extractor input', () => {
  const actual = { id: 'budget_amount', act: 'collect_budget', question: '¿Qué presupuesto total tiene para la compra?' }
  const input = { ...proposalInput(), pregunta_pendiente: actual }
  const original = structuredClone(input)
  const result = interpretationInput(input, 'Unos 300 mil dólares')
  assert.deepEqual(result.pregunta_pendiente, actual)
  assert.deepEqual(object(result.contexto_propiedades).pending_question, actual)
  assert.equal(result.propuesta_pendiente, undefined, 'A question no longer active must not authorize alternative acceptance')
  assert.equal(object(result.contexto_pregunta_presupuesto).role_asked, 'total_budget')
  assert.deepEqual(input, original)
})

test('an explicitly empty current question suppresses historical proposal and monetary question context', () => {
  const result = interpretationInput({ ...proposalInput(), pregunta_pendiente: {} }, 'Sí, gracias')
  assert.deepEqual(result.pregunta_pendiente, {})
  assert.deepEqual(object(result.contexto_propiedades).pending_question, {})
  assert.equal(result.propuesta_pendiente, undefined)
  assert.equal(result.contexto_pregunta_presupuesto, undefined)
})

test('legacy input lacking a current question retains the remembered proposal as its single pending referent', () => {
  const result = interpretationInput(proposalInput(), '¿Cuánto cuesta esa opción?')
  assert.deepEqual(result.pregunta_pendiente, oldProposal)
  assert.deepEqual(object(result.contexto_propiedades).pending_question, oldProposal)
  const proposal = object(result.propuesta_pendiente)
  assert.deepEqual(proposal.proposed_query, oldProposal.proposed_query)
  assert.deepEqual(proposal.candidate_units, proposalInput().catalogo_unidades)
  assert.equal(proposal.consent_status, 'pending')
})

test('legacy accepted funds retain their monetary role without inventing a current declaration', () => {
  for (const [role, status] of [['total_budget', 'maximum_total'], ['down_payment', 'initial_capital']]) {
    const stored = { amount: 300000, evidence: role === 'total_budget' ? budget.evidence : 'Dispongo de 300 mil para la entrada' }
    const input = { resumen: { _turn_intent: { objective: 'select_property', subject: { category: 'departamento' } },
      _financing_amounts: { [role]: stored } }, pregunta_pendiente: pending }
    const result = interpretationInput(input, 'Quiero dos dormitorios')
    assert.deepEqual(object(result.hechos_confirmados).budget, { ...stored, status, confidence: 'high' })
    assert.deepEqual(object(result.resumen)._financing_amounts, input.resumen._financing_amounts)
    assert.equal(object(object(result.resumen)._turn_intent).objective, undefined)
    assert.equal(result.mensaje_actual, 'Quiero dos dormitorios')
  }
})

test('legacy funding ambiguity, credit and revocation never manufacture a budget fact', () => {
  const funds = { amount: 300000, evidence: budget.evidence }
  const scenarios: Row[] = [
    { _financing_amounts: { loan: funds } },
    { _financing_amounts: { total_budget: funds, down_payment: { amount: 100000, evidence: 'La entrada sería de 100 mil' } } },
    { _financing_amounts: { total_budget: { amount: 300000, evidence: '' } } },
    { _financing_amounts: { total_budget: funds }, _interpretation_memory: { budget: {} } },
    { _financing_amounts: { total_budget: funds }, _interpretation_memory: {
      budget_revocation: { role: 'total_budget', evidence: 'Ya no tengo ese presupuesto' },
    } },
  ]
  for (const resumen of scenarios) {
    const result = interpretationInput({ resumen, pregunta_pendiente: pending }, 'Quiero dos dormitorios')
    assert.equal(object(result.hechos_confirmados).budget, undefined, JSON.stringify(resumen))
  }
})

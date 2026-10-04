import test from 'node:test'
import assert from 'node:assert/strict'
import { financingIdentity, financingNameQuestion, financingDocument } from './financing-identity'
import { financingAmounts, financingBalance } from './financing-amounts'
import { normalizeEvents } from './conversation-rules'
import { interpretConversationTurn } from './turn-interpretation'
import { reconcileFinancingReference, interpretationSourceIssues } from './turn-interpretation-input'
import { object, type Row } from './data'

test('presentation alone is incomplete; legal names can arrive across messages and be confirmed', () => {
  const name = financingIdentity({}, { given_names: 'Carlos', evidence: 'mi nombre es Carlos' }, 'ya mi nombre es Carlos')
  assert.equal(name.complete, false)
  assert.match(financingNameQuestion(name), /apellidos completos/)
  const surnames = financingIdentity(name, { surnames: 'Del Río', evidence: 'mi apellido es Del Río' }, 'mi apellido es Del Río')
  assert.equal(surnames.full_name, 'Carlos Del Río')
  assert.equal(surnames.complete, false)
  const complete = financingIdentity(surnames, { complete_name_confirmation: 'sí, solo tengo un nombre y un apellido' },
    'sí, solo tengo un nombre y un apellido', financingNameQuestion(surnames))
  assert.equal(complete.complete, true)
  assert.equal(financingIdentity(complete, null, 'soy independiente').complete, true)
  assert.equal(financingIdentity(complete, { given_names: 'Carlos', evidence: 'soy Carlos' }, 'soy Carlos').complete, true)
  assert.equal(financingIdentity(complete, { given_names: 'Juan', evidence: 'me llamo Juan' }, 'me llamo Juan').complete, false)
  assert.equal(financingIdentity({}, { given_names: 'Inventado', surnames: 'Falso', evidence: 'mi nombre es Carlos',
    complete_name_confirmation: 'completo' }, 'mi nombre es Carlos').full_name, null)
})

test('one or two names/surnames and compound surnames are accepted without a four-word rule', () => {
  for (const [given_names, surnames] of [['Ana', 'Paz'], ['Ana María', 'De la Cruz'], ['José Luis', 'Pérez Gómez']]) {
    const evidence = `Mi nombre completo es ${given_names} ${surnames}`
    assert.equal(financingIdentity({}, { given_names, surnames, evidence, complete_name_confirmation: evidence }, evidence).complete, true)
  }
  const known = { given_names: 'Ana', surnames: 'Paz', full_name: 'Ana Paz', complete: false }
  assert.equal(financingIdentity(known, { complete_name_confirmation: 'sí' }, 'sí', '¿Desea conocer los precios?').complete, false)
})

test('document validation preserves leading zeros and rejects truncation, companies and invalid lengths', () => {
  for (const [raw, status, id] of [
    ['0102030405', 'accepted', '0102030405'], ['0102030405001', 'accepted', '0102030405'],
    ['0102030405002', 'invalid_length', null], ['0192030405001', 'invalid_length', null],
    ['0162030405001', 'invalid_length', null], ['01010203120312031203', 'invalid_length', null],
    ['01020304', 'incomplete', null], ['01020304050', 'invalid_length', null],
  ]) {
    const result = financingDocument(raw, `Mi documento es ${raw}`)
    assert.equal(result.status, status, String(raw))
    assert.equal(result.national_id, id)
  }
  assert.equal(financingDocument('0101020312', '01010203120312031203').status, 'unsubstantiated')
  assert.equal(financingDocument('010 203 0405', '010 203 0405').national_id, '0102030405')
  assert.equal(normalizeEvents({}, '100000').document_validation && object(normalizeEvents({}, '100000').document_validation).status, 'absent')
  assert.equal(object(normalizeEvents({}, '01010203120312031203', true).document_validation).status, 'invalid_length')
  const normalized = normalizeEvents({ financing_identity: { document: '0102030405001' } }, 'Mi RUC es 0102030405001')
  assert.equal(normalized.national_id, '0102030405')
  assert.equal(normalized.ruc, null)
})

test('amounts preserve roles and only reconcile declared down payment and loan against an authorized unit', () => {
  const current = 'financiar 10 mil, mejor 100 mil'
  const amounts = financingAmounts({ total_budget: { amount: 300000 } }, [
    { role: 'loan', amount: 10000, evidence: 'financiar 10 mil' },
    { role: 'loan', amount: 100000, evidence: 'mejor 100 mil' },
    { role: 'down_payment', amount: 200000, evidence: 'inventado' },
  ], current)
  assert.equal(object(amounts.loan).amount, 100000)
  assert.equal(object(amounts.total_budget).amount, 300000)
  assert.equal(amounts.down_payment, undefined)
  const unit = { id: 'd502', unit_number: '502', published_commercial_price: 310000 }
  assert.equal(financingBalance(amounts, unit, true), null)
  const next = financingAmounts(amounts, [{ role: 'down_payment', amount: 200000, evidence: 'entrada de 200 mil' }], 'entrada de 200 mil')
  assert.equal(financingBalance(next, unit, true)?.difference, 10000)
  assert.equal(financingBalance(next, unit, true)?.status, 'shortfall')
  assert.equal(financingBalance(next, unit, false), null)
  assert.equal(financingBalance({ ...next, loan: { amount: 110000 } }, unit, true)?.status, 'balanced')
})

const input = { contexto_propiedades: { selected_ids: ['d502'] },
  catalogo_unidades: [{ id: 'd502', unit_number: '502', category: 'departamento' }] }
function financingEcho(current: string): Row {
  return { requests: [{ domain: 'financing', request: 'Cambiar el importe a financiar', evidence: current }],
    turn_semantics: { primary_intent: 'ask_financing', primary_evidence: current, confidence: 'high',
      property: { operation: 'details', category: 'departamento', unit_numbers: ['502'], confidence: 'high', evidence: '' },
      budget: { status: 'not_discussed', amount: null, evidence: '' } } }
}

test('reported financing correction does not require re-declaring a selected unit from history', async () => {
  const current = 'pero podre financiar los 10 mil que me faltarian? mejor financiar 100 mil'
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return { ...financingEcho(current),
      financing_amounts: [{ role: 'loan', amount: 100000, evidence: 'financiar 100 mil' }] } },
  })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.property).operation, 'none')
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  for (const [message, changed] of [
    ['Quiero financiar el 502', {}], ['financiar otra unidad', { unit_numbers: ['602'] }],
    ['selecciono otro', { operation: 'select' }], ['financiar uno con tres cuartos', { filters: { bedrooms: 3 } }],
  ] as [string, Row][]) {
    const raw = financingEcho(message)
    object(raw.turn_semantics).property = { ...object(object(raw.turn_semantics).property), ...changed }
    assert.ok(interpretationSourceIssues(reconcileFinancingReference(raw, input, message), message).includes('missing_current_evidence:property'), message)
  }
})

test('loan self-correction does not overwrite budget, while explicit total or initial capital stays available', async () => {
  for (const [status, amountRole, expected] of [
    ['amount', 'loan', 'not_discussed'], ['amount', 'total_budget', 'amount'], ['initial_capital', 'down_payment', 'initial_capital'],
  ]) {
    const current = 'ahora prefiero 100 mil'
    const raw = financingEcho(current)
    object(raw.turn_semantics).budget = { status, amount: 100000, evidence: current, confidence: 'high' }
    raw.financing_amounts = [{ role: amountRole, amount: 100000, evidence: current }]
    const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, { activePrompt: async () => '', aiJson: async () => raw })
    assert.equal(object(result.semantics.budget).status, expected)
  }
})

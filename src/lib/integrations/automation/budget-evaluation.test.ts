import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateBudgetOptions } from './budget-evaluation'
import { commercialJourneyPlan } from './commercial-journey'
import { budgetForCommercialPlan, turnBudgetAssessment } from './turn-budget'
import { validateBusinessFacts, factFindings } from './business-facts'
import { turnEvidence } from './turn-evidence'
import { businessRiskSchemaForSources, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import Ajv from 'ajv'
import { object, type Row } from './data'

const catalog: Row[] = [250000, 270000, 290000, 310000].map((price, index) => ({
  id: `d${index}`, category: 'departamento', unit_number: `${index + 2}02`, bedrooms: 3,
  floor_number: index + 2, published_commercial_price: price, status: 'disponible', is_published: true,
})).concat([
  { id: '602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6,
    published_commercial_price: 550000, status: 'disponible', is_published: true },
  { id: '605', category: 'penthouse', unit_number: '605', bedrooms: 3, floor_number: 6,
    published_commercial_price: 539900, status: 'disponible', is_published: true },
])
const budget = (amount = 400000, status = 'maximum_total') => ({ status, amount, confidence: 'high', evidence: `Tengo ${amount} de presupuesto total` })
const context = (amount = 400000): Row => ({
  lead: { purchase_purpose: 'vivir' }, catalogo: catalog, catalogo_verificacion: catalog,
  catalog_read: { complete: true }, catalog_verification_read: { complete: true },
  politica_comercial: { precios_autorizados: true }, property_context: {
    query: { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }, selected_ids: [],
  }, financiamiento: { partners: ['Cooperativa JEP'], journey: {} },
  semantica_turno: { budget: budget(amount), primary_intent: 'discuss_budget' },
})
const coverageFact = (subject = 'group:budget_candidates:all:range'): Row => ({
  statement: 'Estas opciones se ajustan a su presupuesto de 400 mil dólares.', kind: 'budget_coverage',
  field: 'published_commercial_price', value: 400000, upper_value: null, relation: 'lte', unit: 'USD',
  subject_id: subject, scope: null,
})

for (const [amount, matching] of [[300000, ['d0', 'd1', 'd2']], [400000, ['d0', 'd1', 'd2', 'd3']]] as const) {
  test(`${amount} total has a scoped partial coverage shared by journey and turn assessment`, () => {
    const info = context(amount), plan = commercialJourneyPlan(info)
    const standalone = turnBudgetAssessment(info, {})!
    const joined = budgetForCommercialPlan(standalone, plan)
    const guidance = object(plan.budget_guidance)
    assert.equal(guidance.coverage, 'some')
    assert.equal(guidance.universal_affordability_allowed, false)
    assert.deepEqual(guidance.matching_unit_ids, matching)
    assert.deepEqual(guidance.outside_unit_ids, amount === 400000 ? ['602', '605'] : ['d3', '602', '605'])
    assert.deepEqual(standalone.candidate_unit_ids, guidance.candidate_unit_ids)
    assert.deepEqual(standalone.matching_unit_ids, guidance.matching_unit_ids)
    assert.deepEqual(joined.categories, guidance.categories)
    assert.equal(object((guidance.categories as Row[]).find(item => item.category === 'penthouse')).coverage, 'none')
    assert.equal(plan.question_id, 'property_category')
    assert.match(String(plan.question), /exploremos los departamentos/)
  })
}

test('code checks every member of the described set instead of a group minimum', () => {
  const info = context(), plan = commercialJourneyPlan(info)
  const evidence = turnEvidence({ ...info, siguiente_paso_comercial: plan,
    presupuesto_del_turno: budgetForCommercialPlan(turnBudgetAssessment(info, {})!, plan) })
  const results = validateBusinessFacts([coverageFact(), coverageFact('group:budget_candidates:departamento:range'),
    coverageFact('group:budget_candidates:penthouse:range')], evidence.units, evidence.groups, budget())
  assert.deepEqual(results.map(result => result.status), ['contradiction', 'verified', 'contradiction'])
  const concealedSubset = validateBusinessFacts([coverageFact('group:budget_matching:all:range')], evidence.units, evidence.groups, budget())
  assert.equal(concealedSubset[0].status, 'unverified')
  assert.equal(factFindings(concealedSubset).length, 1)
  const schema = businessRiskSchemaForSources(evidence.units, evidence.groups)
  const validate = new Ajv({ strict: false }).compile(schema)
  assert.equal(validate({ review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', facts: [coverageFact()],
    findings: [], question: null }), true, JSON.stringify(validate.errors))
})

test('all affordable requires complete membership, every price and confirmed total role', () => {
  const departments = catalog.filter(unit => unit.category === 'departamento')
  const evaluate = (units = departments, overrides = {}) => evaluateBudgetOptions({ budget: budget(), units,
    pricesAuthorized: true, membershipComplete: true, ...overrides })
  assert.equal(evaluate().universal_affordability_allowed, true)
  const noPrice = departments.map((unit, index) => index === 0 ? { ...unit, published_commercial_price: null } : unit)
  assert.equal(evaluate(noPrice).coverage, 'unknown')
  assert.equal(evaluate(noPrice).universal_affordability_allowed, false)
  assert.deepEqual(evaluate(noPrice).unknown_price_unit_ids, ['d0'])
  assert.equal(evaluate(departments, { membershipComplete: false }).coverage, 'unknown')
  assert.equal(evaluate(departments, { unknownUnitIds: ['unverified'] }).universal_affordability_allowed, false)
  assert.equal(evaluate(departments, { pricesAuthorized: false }).status, 'prices_not_authorized')
  for (const role of ['initial_capital', 'monthly_payment', 'amount']) {
    const result = evaluate(departments, { budget: budget(400000, role) })
    assert.equal(result.comparable, false)
    assert.deepEqual(result.matching_unit_ids, [])
    assert.equal(result.universal_affordability_allowed, false)
  }
})

test('missing prices and partial source cannot validate universal claims', () => {
  const units = catalog.map(unit => unit.id === 'd3' ? { ...unit, published_commercial_price: null } : unit)
  const source = { id: 'all', aggregation: 'min', member_ids: units.map(unit => unit.id),
    complete_for_query: true, published_commercial_price: 250000 }
  const absentPrice = validateBusinessFacts([coverageFact('all')], units, [source], budget())
  assert.equal(absentPrice[0].status, 'unverified')
  assert.equal(factFindings(absentPrice).length, 1)
  const partial = validateBusinessFacts([coverageFact('all')], catalog, [{ ...source, complete_for_query: false }], budget())
  assert.equal(partial[0].status, 'unverified')
})

test('historical budget guides selection without requiring a money topic again', () => {
  const info = context()
  info.hechos_confirmados = { budget: budget() }
  info.semantica_turno = { budget: { status: 'not_discussed' }, primary_intent: 'answer_previous',
    requests: [{ domain: 'property', confidence: 'high', topics: ['property_options'], evidence: 'Quiero tres dormitorios' }] }
  const plan = commercialJourneyPlan(info)
  assert.deepEqual(object(plan.budget_guidance).matching_unit_ids, ['d0', 'd1', 'd2', 'd3'])
  assert.equal(object(plan.budget_guidance).mention_required, false)
  assert.equal(object(plan.budget_guidance).mention_allowed, false)
  const joined = budgetForCommercialPlan(turnBudgetAssessment(info, {})!, plan)
  assert.equal(joined.mention_required, false)
  assert.equal(joined.continuation, 'commercial_next_step')
})

test('accepted financing keeps the penthouse scope and never reuses a cash gap as rejection', () => {
  const info = context()
  object(info.property_context).query = { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } }
  object(info.property_context).category_preference = { category: 'penthouse', confirmed: true }
  info.financiamiento = { partners: ['Cooperativa JEP'], journey: { accepted: true, status: 'accepted' } }
  const entry = commercialJourneyPlan(info)
  assert.equal(entry.action, 'clarify_financing_down_payment')
  assert.equal(entry.financing_offer_allowed, false)
  object(info.financiamiento).entry = { status: 'amount', amount: 400000,
    evidence: 'Sí, esos 400 mil serían para la entrada', source_message_id: 'entry-confirmation' }
  const plan = commercialJourneyPlan(info)
  assert.equal(plan.action, 'select_property')
  assert.equal(object(plan.budget_guidance).comparison_required, false)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['602', '605'])
  assert.equal(plan.question_id, 'unit_choice')
})

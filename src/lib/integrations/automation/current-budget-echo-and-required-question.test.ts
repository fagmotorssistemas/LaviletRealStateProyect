import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { reconcileConfirmedBudgetEcho } from './historical-budget-isolation'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { completeRequiredContinuation } from './continuation-validation'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { progressivePendingQuestion } from './progressive-options'
import { deliveredPendingQuestion } from './continuation-question'
import { financingEntryQuestion } from './financing-entry'
import { responseContentScope, projectContentForWriter } from './response-content-scope'

const moneyQuote = 'tengo un presupeusto de 400 mil dolates'
const storedBudget = { status: 'maximum_total', amount: 400000, evidence: moneyQuote, confidence: 'high' }
const summary = (): Row => ({ _interpretation_memory: { budget: storedBudget },
  _financing_amounts: { total_budget: { amount: 400000, evidence: moneyQuote } },
  _financing_journey: { accepted: false }, _property_context: { query: { group: 'residential', filters: {} }, selected_ids: [] } })

function bedroomTurn(current: string, count: number): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = []
  object(raw.qualification).presupuesto_texto = moneyQuote
  object(raw.qualification).dormitorios_texto = current
  const semantic = object(raw.turn_semantics)
  Object.assign(semantic, { primary_intent: 'discuss_budget', primary_evidence: current, confidence: 'high',
    budget: { ...storedBudget }, answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' },
    housing_quantities: [{ dimension: 'bedrooms', values: [count], role: 'requirement', count_basis: 'unspecified', evidence: current, confidence: 'high' }] })
  const property = object(semantic.property)
  Object.assign(property, { group: 'residential', operation: 'none', reference_kind: 'none', evidence: current })
  object(property.filters).bedrooms = count; object(property.filters).bedrooms_operator = 'eq'
  object(property.filter_evidence).bedrooms = current; object(property.filter_evidence).bedrooms_operator = current
  raw.catalog_request = { purpose: 'search', metric: null, evidence: current, confidence: 'high', semantic_preferences: [],
    requirements: [{ field: 'bedrooms', operator: 'eq', value: count, upper_value: null, strength: 'required', evidence: current }] }
  return raw
}

for (const [current, count] of [['oh esta bien, bueno busco algo de 3 dormitorio', 3], ['quisiera dos habitaciones', 2]] as const) {
  test(`a current typed catalogue requirement isolates a proven old budget before a retry: ${count}`, async () => {
    const raw = bedroomTurn(current, count), stored = summary(), before = structuredClone({ raw, stored })
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current, resumen: stored, pregunta_pendiente: {} }, {
      activePrompt: async () => 'Extractor', aiJson: async () => { calls++; return raw },
    })
    assert.equal(calls, 1)
    assert.equal(result.semantics.primary_intent, 'project_information')
    assert.equal(object(result.semantics.budget).status, 'not_discussed')
    assert.equal(object(object(result.semantics.property).filters).bedrooms, count)
    assert.equal(object(result.extracted.qualification).presupuesto_texto, null)
    assert.equal(result.extracted.financing_consent, null)
    assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
    assert.ok((object(result.diagnostic.historical_reconciliation).fields as string[]).includes('primary_intent'))
    const saved = rememberInterpretedTurn(stored, current, result.extracted, result.semantics)
    assert.deepEqual(object(confirmedInterpretationMemory(saved).budget), storedBudget)
    assert.deepEqual(object(saved._financing_amounts).total_budget, object(stored._financing_amounts).total_budget)
    assert.deepEqual({ raw, stored }, before)
  })
}

test('proven echoes can have an inconsistent role label without converting that saved budget into a new entry', () => {
  const current = 'quiero tres habitaciones', raw = bedroomTurn(current, 3)
  object(object(raw.turn_semantics).budget).status = 'initial_capital'
  const result = reconcileConfirmedBudgetEcho(raw, { resumen: summary() }, current)
  assert.equal(object(object(result.raw.turn_semantics).budget).status, 'not_discussed')
  assert.equal(object(summary()._financing_amounts).down_payment, undefined)
})

test('a first extraction quoting the actual old bot answer isolates the delta, without using the bot to establish funds', async () => {
  const current = 'oh esta bien, bueno busco algo de 3 dormitorio', raw = bedroomTurn(current, 3)
  const botQuote = 'Con un presupuesto de 400 mil dólares, dispone de varias alternativas dentro del proyecto que incluyen suites, departamentos y un penthouse que se ajustan a ese importe.'
  object(object(raw.turn_semantics).budget).evidence = botQuote
  object(raw.qualification).presupuesto_texto = null
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, resumen: summary(),
    historial: [{ role: 'bot', content: botQuote }] }, { activePrompt: async () => '', aiJson: async () => { calls++; return raw } })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).status, 'not_discussed')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 3)
  const saved = rememberInterpretedTurn(summary(), current, result.extracted, result.semantics)
  assert.deepEqual(object(confirmedInterpretationMemory(saved).budget), storedBudget)
})

for (const scenario of ['absent_history', 'wrong_amount_in_quote', 'nonnumeric_quote', 'current_withdrawal']) {
  test(`a bot message is not monetary evidence for a new budget: ${scenario}`, () => {
    const current = scenario === 'current_withdrawal' ? 'Quiero tres habitaciones y retiro mis fondos anteriores' : 'Quiero tres habitaciones'
    const raw = bedroomTurn(current, 3), budget = object(object(raw.turn_semantics).budget)
    budget.evidence = scenario === 'wrong_amount_in_quote' ? 'Su presupuesto es de 500 mil dólares'
      : scenario === 'nonnumeric_quote' ? 'Las opciones requieren revisar su importe'
        : 'Considerando un presupuesto de 400 mil dólares'
    object(raw.qualification).presupuesto_texto = null
    const input = { resumen: summary(), historial: scenario === 'absent_history' ? [] : [{ role: 'bot', content: budget.evidence }] }
    assert.deepEqual(reconcileConfirmedBudgetEcho(raw, input, current), { raw, fields: [] })
  })
}

for (const scenario of ['different_amount', 'unknown_quote', 'current_amount', 'unclassified_new_amount', 'current_entry_reference', 'withdrawal', 'unknown_budget', 'unverified_memory']) {
  test(`an old amount cannot hide a genuine or unresolved monetary change: ${scenario}`, () => {
    let current = 'quiero tres habitaciones'
    if (scenario === 'current_amount') current += '; ahora tengo 400 mil dólares'
    if (scenario === 'unclassified_new_amount') current += '; ahora tengo 250 mil'
    if (scenario === 'current_entry_reference') current += '; ese dinero era para la entrada'
    if (scenario === 'withdrawal') current += '; retiro mi presupuesto anterior'
    if (scenario === 'unknown_budget') current += '; aún no sé cuánto puedo invertir'
    const raw = bedroomTurn(current, 3), stored = summary()
    if (scenario === 'different_amount') object(object(raw.turn_semantics).budget).amount = 300000
    if (scenario === 'unknown_quote') object(object(raw.turn_semantics).budget).evidence = 'Tengo ese importe'
    if (scenario === 'withdrawal') raw.financing_amounts = [{ role: null, amount: null, replaces_role: 'total_budget', evidence: 'retiro mi presupuesto anterior' }]
    if (scenario === 'unverified_memory') { delete stored._interpretation_memory; delete stored._financing_amounts }
    const before = structuredClone(raw)
    assert.deepEqual(reconcileConfirmedBudgetEcho(raw, { resumen: stored }, current), { raw, fields: [] })
    assert.deepEqual(raw, before)
  })
}

const plan = { action: 'discover_bedrooms', question_id: 'property_bedrooms', question_act: 'other',
  continuation_required: true, question: '¿Cuántos dormitorios necesita?' }
const draft = 'Hay opciones que se ajustan al importe. Aún necesitamos saber cuántos dormitorios requiere para orientar la búsqueda.'

for (const mode of ['normal', 'demonstration', 'disabled'] as const) for (const metadataKind of ['absent', 'none'])
test(`a missing required question is completed without another writer call and tracked: ${mode}/${metadataKind}`, async () => {
  const calls: string[] = [], verified: Row = { siguiente_paso_comercial: plan, catalogo: [],
    semantica_turno: { primary_intent: 'discuss_budget', primary_evidence: moneyQuote, confidence: 'high', budget: storedBudget } }
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
    () => completeTurnReply({ current: moneyQuote, baseReply: draft, verified,
      audit: { source: 'catalog_search', semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_rules, _raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      if (task === 'writing') return { reply: draft, requests: [], question: metadataKind === 'absent' ? null
        : { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    }))
  assert.equal(result.reply, `${draft} ${plan.question}`, JSON.stringify(result.audit.final_validation))
  assert.equal(result.needsAdvisor, false)
  assert.equal(calls.filter(task => task === 'writing').length, 1)
  assert.deepEqual(calls, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
  const correction = object(result.audit.server_continuation_completion)
  assert.equal(correction.original_reply, draft)
  assert.equal(correction.model_calls, 0)
  assert.equal(correction.question_id, 'property_bedrooms')
  const pending = progressivePendingQuestion(result.reply, { commercial_journey: plan, turn_completeness: result.audit })
  assert.equal(pending.id, 'property_bedrooms')
  assert.equal(object(result.audit.follow_up).usable, true)
  assert.equal(object(result.audit.question).continuation_id, 'property_bedrooms')
})

test('completion cannot replace an actual question, closed step, priority operation or unrecognized plan', () => {
  for (const [reply, candidate] of [
    [`${draft} ¿Desea más información?`, plan],
    [draft, { ...plan, continuation_required: false }],
    [draft, { ...plan, action: 'current_operation' }],
    [draft, { ...plan, action: 'leave_open' }],
    [draft, { ...plan, question: '¿Qué hacemos con esto?' }],
    [draft, { ...plan, question: '¿Cuántos dormitorios quiere? ¿En qué planta?' }],
  ] as Array<[string, Row]>) assert.deepEqual(completeRequiredContinuation(reply, candidate), { reply, audit: null })
})

test('a later writer attempt with its own question does not inherit a previous completion audit', async () => {
  const second = 'Continuemos con la búsqueda. ¿Cuántos dormitorios necesita para su vivienda?'
  let writerCalls = 0, reviewCalls = 0
  const result = await completeTurnReply({ current: moneyQuote, baseReply: draft,
    verified: { siguiente_paso_comercial: plan, catalogo: [] },
    audit: { source: 'catalog_search', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    if (task === 'writing') return { reply: ++writerCalls === 1 ? draft : second, requests: [], question: null }
    return ++reviewCalls === 1 ? { review_contract: 'business-risk-v2', verdict: 'block', facts: [], question: null,
      findings: [{ category: 'turn_goal', statement: draft, reason: 'Simplifique la respuesta para retomar la búsqueda.',
        authoritative_fact: 'Conserve únicamente la continuación de dormitorios.' }] }
      : { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
  })
  assert.equal(result.reply, second)
  assert.equal(writerCalls, 2)
  assert.equal(result.audit.server_continuation_completion, null)
})

test('completion retains the delivered concrete entry proposal and its amount reference', () => {
  const entry = financingEntryQuestion({ hechos_confirmados: { budget: storedBudget } })
  const candidate = { action: 'clarify_financing_down_payment', question_id: 'financing_down_payment', question_act: 'financing',
    question: entry.question, question_amount_reference: entry.amount_reference }
  const completed = completeRequiredContinuation('Continuemos con la orientación financiera.', candidate)
  assert.ok(completed.audit)
  const pending = deliveredPendingQuestion(completed.reply, { plan: candidate })
  assert.equal(pending.id, 'financing_down_payment')
  assert.equal(object(pending.amount_reference).amount, 400000)
  assert.ok(String(object(pending.amount_reference).question_source).includes('presupuesto'))
})

test('latest discovery scope keeps the approved initial summary but withholds dimensions on a housing answer', () => {
  const current = 'estoy buscando algo para vivienda', verified = { siguiente_paso_comercial: { ...plan, action: 'ask_budget' },
    catalogo: [{ id: 's1', category: 'suite', area_internal_m2: 49.86 }],
    solicitudes_interpretadas: [{ domain: 'property', request: current, evidence: current, confidence: 'high', topics: ['property_options'] }],
    semantica_turno: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high', property: { operation: 'none' } } }
  const scope = responseContentScope(current, verified, { source: 'catalog_search' })
  assert.equal(object(scope.property_presentation).kind, 'discovery_brief')
  assert.equal(object(object(scope.topics).project_intro).allowed, false)
  assert.equal(object((projectContentForWriter({ catalogo: verified.catalogo }, scope).catalogo as Row[])[0]).area_internal_m2, undefined)
  const first = 'Saludos, quiero información por favor', presentation = { available: true,
    summary: 'La Vilet es un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca.', source: 'approved_settings' }
  const request = { domain: 'property', request: first, evidence: first, confidence: 'high', topics: ['project_overview'] }
  const initial = { presentacion_general_proyecto: presentation, contrato_turno: { objective: 'project_information', requests: [request] },
    semantica_turno: { primary_intent: 'project_information', confidence: 'high', primary_evidence: first,
      property: { operation: 'none', reference_kind: 'none' }, budget: { status: 'not_discussed' } } }
  const firstScope = responseContentScope(first, initial)
  assert.equal(object(object(firstScope.topics).project_intro).allowed, true)
  assert.deepEqual(projectContentForWriter(initial, firstScope).presentacion_general_proyecto, presentation)
})

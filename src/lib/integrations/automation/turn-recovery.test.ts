import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { interpretConversationTurn } from './turn-interpretation'
import { interpretationInput, TurnInterpretationError } from './turn-interpretation-input'
import { validateBusinessScope, reconcilePropertyScope } from './business-scope'
import { scopePolicyContext } from './scope-response'
import { turnBudgetAssessment } from './turn-budget'
import { completeTurnReply } from './turn-completeness'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const current = 'bueno yo estoy interesado en algo para vivienda. tengo una familai de 5 personas no se si tenga algo para mi, y tengo un presupeusto de unos 100 dolares'
const history = [{ role: 'cliente', content: 'entiendo y cual es el precio??' }]
const units = [
  { id: 'd301', unit_number: '301', category: 'departamento', bedrooms: 3, floor_number: 3, published_commercial_price: 250000 },
  { id: 's201', unit_number: '201', category: 'suite', bedrooms: 1, floor_number: 2, published_commercial_price: 145000 },
]
const extraction = {
  requests: [{ domain: 'property', request: 'Vivienda para la familia y presupuesto', evidence: current, confidence: 'high' }],
  turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', operation: 'search', query_scope: 'catalog', evidence: current, confidence: 'high', filters: {} },
    housing_quantities: [{ dimension: 'people', values: [5], role: 'context', count_basis: 'total', evidence: 'familai de 5 personas', confidence: 'high' }],
    budget: { status: 'amount', amount: 100, confidence: 'high', evidence: 'presupeusto de unos 100 dolares' } },
}
const stale = { requests: [{ domain: 'property', request: history[0].content, evidence: history[0].content, confidence: 'high' }],
  turn_semantics: { primary_intent: 'ask_price', primary_evidence: history[0].content, confidence: 'high', budget: { status: 'not_discussed' } } }
function context(amount = 100): Row {
  return { catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true },
    politica_comercial: { precios_autorizados: true }, financiamiento: { partners: ['Entidad autorizada'] },
    semantica_turno: { ...extraction.turn_semantics, budget: { ...extraction.turn_semantics.budget, amount } } }
}

test('extractor input keeps current text and durable references without duplicating commercial inventory or history', () => {
  const compact = interpretationInput({ historial: history, historial_reciente: history,
    catalogo_unidades: [{ ...units[0], description: 'Large commercial description', area_internal_m2: 120 }],
    contexto_propiedades: { offered_ids: ['d301'], selected_ids: [], focused_ids: ['d301'], phase: 'selecting', query: { category: 'departamento' } },
    resumen: { datos_confirmados: { household: { occupants: 5 } }, solicitud_actual: history[0].content, long_old_prose: 'Old conclusion' },
    pregunta_pendiente: { id: 'property_selection', question: '¿Cuál desea conocer?' } }, current)
  assert.equal(compact.mensaje_actual, current)
  assert.deepEqual(compact.historial, history)
  assert.equal(compact.historial_reciente, undefined)
  assert.deepEqual(object(compact.contexto_propiedades).offered_ids, ['d301'])
  assert.equal(object(compact.pregunta_pendiente).id, 'property_selection')
  assert.equal(rows(compact.catalogo_unidades)[0].description, undefined)
  assert.equal(object(compact.resumen).solicitud_actual, undefined)
  assert.deepEqual(object(object(compact.resumen).datos_confirmados).household, { occupants: 5 })
})

test('old request is recovered once; current family and exact low budget survive and repair provisional scope', async () => {
  let calls = 0
  const interpreted = await interpretConversationTurn({ mensaje_actual: current, historial: history }, {
    activePrompt: async () => 'Extract current data', aiJson: async (_rules, input) => {
      calls++
      if (calls === 2) assert.ok(object(input).recuperacion_interpretacion)
      return calls === 1 ? stale : extraction
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(interpreted.semantics.budget).amount, 100)
  assert.equal(object(interpreted.semantics.property).group, 'residential')
  assert.equal(object(object(interpreted.semantics.property).filters).bedrooms, null)
  assert.equal(object(interpreted.semantics.household).occupants, 5)
  assert.equal(object(interpreted.diagnostic.interpretation_recovery).status, 'recovered')
  const scope = validateBusinessScope({ kind: 'mixed', confidence: 'high', property_fragments: [current], outside_subject: '', outside_source: 'none' }, current)
  const resolved = reconcilePropertyScope(scope, current, interpreted.requests)
  assert.equal(resolved.kind, 'property')
  assert.equal(resolved.uncertain, false)
})

test('valid extraction costs one call and repeated invalid extraction is a distinct failure, never not_discussed', async () => {
  let calls = 0
  const dependencies = { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return extraction } }
  await interpretConversationTurn({ mensaje_actual: current }, dependencies)
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(interpretConversationTurn({ mensaje_actual: current }, { ...dependencies,
    aiJson: async () => { calls++; return stale } }), TurnInterpretationError)
  assert.equal(calls, 2)
})

test('neutral classification can be corrected by evidence but genuine outside boundaries remain', () => {
  const neutral = { kind: 'neutral' as const, uncertain: false, property_message: '', reply: '' }
  assert.equal(reconcilePropertyScope(neutral, current, extraction.requests).kind, 'property')
  const outside = { ...neutral, uncertain: true, outside_evidence: { fragment: 'vuelo', source: 'current' as const }, confidence: 'high' as const }
  assert.equal(reconcilePropertyScope(outside, 'Cambiar mi vuelo y ver una suite', [
    { domain: 'property', evidence: 'ver una suite', confidence: 'high' },
    { domain: 'other', evidence: 'Cambiar mi vuelo', confidence: 'high' },
  ]), outside)
  const provisional = scopePolicyContext(context(), { ...neutral, uncertain: true })
  assert.deepEqual(provisional.catalogo, units)
  assert.deepEqual(provisional.financiamiento, { partners: ['Entidad autorizada'] })
  assert.equal(scopePolicyContext(context(), outside).catalogo, undefined)
})

test('budget continuation prioritizes affordable units, then alternatives, then authorized financing', () => {
  assert.equal(turnBudgetAssessment(context(), {})?.continuation, 'offer_financing')
  assert.equal(turnBudgetAssessment(context(150000), {})?.continuation, 'present_affordable_options')
  assert.equal(turnBudgetAssessment({ ...context(), semantica_turno: {
    ...extraction.turn_semantics, budget: { ...extraction.turn_semantics.budget, status: 'maximum_total' } } }, {})?.continuation, 'offer_financing')
  const selected = context(150000)
  const audit = { verified_catalog: true, catalog_query: { category: 'departamento', group: 'residential', operation: 'search' },
    catalog_results: { units: [units[0]], complete: true, unknown_unit_ids: [] } }
  const assessment = turnBudgetAssessment(selected, audit)!
  assert.equal(assessment.continuation, 'present_affordable_alternatives')
  assert.deepEqual(rows(assessment.alternatives).map(unit => unit.id), ['s201'])
  const strict = { ...audit, catalog_query: { ...audit.catalog_query, filters: { bedrooms: 3 } } }
  assert.equal(turnBudgetAssessment(selected, strict)?.continuation, 'offer_financing', 'A cheaper suite cannot silently replace a bedroom requirement.')
  assert.equal(turnBudgetAssessment({ ...context(), catalog_read: { complete: false } }, audit)?.minimum_price, null)
})

test('missing prices, partial catalog and unauthorized finance cannot support global affordability claims', () => {
  for (const verified of [
    { ...context(), catalog_read: { complete: false } },
    { ...context(), catalogo: [{ ...units[0], published_commercial_price: null }] },
    { ...context(), politica_comercial: { precios_autorizados: false } },
  ]) {
    const assessment = turnBudgetAssessment(verified, {})!
    assert.equal(assessment.minimum_price, null)
    assert.equal(assessment.continuation, 'clarify_available_information')
  }
  assert.equal(turnBudgetAssessment({ ...context(), financiamiento: { partners: [] } }, {})?.continuation, 'clarify_requirements')
  for (const status of ['initial_capital', 'unknown']) {
    const assessment = turnBudgetAssessment({ ...context(), semantica_turno: { budget: { status, confidence: 'high', amount: 100, evidence: 'Tengo 100 para la entrada' } } }, {})!
    assert.equal(assessment.continuation, 'clarify_budget')
    assert.equal(assessment.minimum_price, undefined)
  }
})

test('writer and reviewer receive the same budget and financing obligation; a supported first response passes', async () => {
  const reply = 'El presupuesto indicado está por debajo de los precios publicados de las viviendas disponibles. Podemos revisar alternativas de financiamiento con las entidades disponibles y acompañarle en el proceso. ¿Le gustaría conocerlas?'
  const tasks: string[] = [], failures: string[] = []
  const verified = { ...context(), solicitudes_interpretadas: extraction.requests }
  const result = await completeTurnReply({ current, history, baseReply: '¿Qué opciones desea revisar?', verified,
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, async (_rules, input, _schema, _image, _file, _tone, task) => {
    try {
      tasks.push(String(task))
      const model = object(input)
      if (task === 'writing') {
        assert.equal(object(object(model.contexto_verificado).presupuesto_del_turno).continuation, 'offer_financing')
        assert.equal(object(object(model.contexto_verificado).presupuesto_del_turno).amount, 100)
        return { reply, requests: rows(model.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Orientar sobre vivienda y presupuesto',
          request_type: 'general_information', status: 'answered', evidence: 'Orientación financiera con datos autorizados', fact_key: null })),
          question: { role: 'optional_continuation', purpose: 'offer_help', missing_datum: '', next_decision: 'Revisar financiamiento' } }
      }
      assert.ok(rows(model.obligaciones_del_turno).some(row => row.id === 'budget_continuation' && row.action === 'offer_financing'))
      assert.ok(JSON.stringify(model).includes('Entidad autorizada'))
      assert.ok(JSON.stringify(model).includes('145000'))
      return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [] }
    } catch (error) { failures.push(String(error)); throw error }
  })
  assert.deepEqual(failures, [])
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.needsAdvisor, false)
})

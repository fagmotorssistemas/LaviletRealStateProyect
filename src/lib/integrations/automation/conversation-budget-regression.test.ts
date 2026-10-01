import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { normalizeTurnSemantics } from './turn-semantics'
import { resolvePropertyTurn } from './property-context'
import { catalogDialogueReply, catalogQuery, filterCatalog } from './catalog-dialogue'
import { completeTurnReply } from './turn-completeness'
import { turnBudgetAssessment } from './turn-budget'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { buildNumericReferences, numericCoverageSchema, numericCoverageIssues } from './focused-numeric-coverage'
import { structuredFactIssues } from './structured-facts'
import { verifiedAbsenceReply } from './catalog-absence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const units = [
  { id: 'd304', unit_number: '304', category: 'departamento', floor_number: 3, bedrooms: 2, published_commercial_price: 180000 },
  { id: 'd404', unit_number: '404', category: 'departamento', floor_number: 4, bedrooms: 2, published_commercial_price: 185000 },
  { id: 'd504', unit_number: '504', category: 'departamento', floor_number: 5, bedrooms: 2, published_commercial_price: 190000 },
  { id: 'd402', unit_number: '402', category: 'departamento', floor_number: 4, bedrooms: 3, published_commercial_price: 220000 },
]
const current = 'muchas gracias, bueno quiero algo en las plantas altas, algo con unos 2 cuartos minimo. tengo un presuuesto de 50 mil dolares.'
const history = [{ role: 'cliente', content: 'Estoy interesado.' },
  { role: 'bot', content: '¿Cómo se llama y dónde vive?' },
  { role: 'cliente', content: 'Soy Carlos, vivo en Cuenca y quiero un departamento.' },
  { role: 'bot', content: '¿En qué planta le gustaría revisar las opciones?' }]
function semantics(message = current, operator = 'gte', upper: number | null = null) {
  return normalizeTurnSemantics({ turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: message, confidence: 'high',
    property: { category: 'departamento', group: 'residential', operation: 'search', query_scope: 'catalog', confidence: 'high', evidence: message,
      filters: { bedrooms: 2, bedrooms_operator: operator, bedrooms_upper: upper },
      filter_evidence: { bedrooms: message, bedrooms_operator: message, bedrooms_upper: upper === null ? '' : message } },
    housing_quantities: [{ dimension: 'bedrooms', role: 'requirement', values: upper ? [2, upper] : [2], confidence: 'high', evidence: message, count_basis: 'unspecified' }],
    budget: { status: 'amount', amount: 50000, confidence: 'high', evidence: message },
  } }, message, { id: 'property_floor' })
}
function turn() {
  const semantic = semantics()
  const property = resolvePropertyTurn(units, current, {}, history, semantic)
  const verified = { catalogo: units, semantica_turno: semantic, referencia_unidad: property, property_context: property.context,
    politica_comercial: { precios_autorizados: true }, historial: history }
  const route = catalogDialogueReply(verified, current)!
  assert.ok(route)
  return { verified, route, property }
}

test('minimum, maximum, interval and exact bedroom requirements survive extraction, search and a later preference change', () => {
  for (const [message, operator, upper, count] of [
    ['quiero 2 cuartos mínimo, tengo 50000 dólares', 'gte', null, 4],
    ['no necesito más de 2 dormitorios, tengo 50000 dólares', 'lte', null, 3],
    ['entre 2 y 3 dormitorios, tengo 50000 dólares', 'between', 3, 4],
    ['exactamente 2 dormitorios, tengo 50000 dólares', 'eq', null, 3],
  ] as const) {
    const semantic = semantics(message, operator, upper)
    const property = resolvePropertyTurn(units, message, {}, history, semantic)
    assert.equal(filterCatalog(units, catalogQuery(property.query)).length, count)
  }
  const initial = turn()
  assert.equal(rows(object(initial.route.audit.catalog_results).units).length, 4, 'Mínimo dos también incluye tres.')
  const message = 'Ahora prefiero exactamente 2 dormitorios, tengo 50000 dólares'
  const changed = resolvePropertyTurn(units, message, { _property_context: initial.property.context }, history, semantics(message, 'eq'))
  assert.equal(object(object(changed.query).filters).bedrooms_operator, undefined)
  assert.equal(filterCatalog(units, catalogQuery(changed.query)).length, 3)
  const followup = resolvePropertyTurn(units, '¿Y en la cuarta planta?', { _property_context: initial.property.context }, history,
    { property: { category: 'departamento', operation: 'search', query_scope: 'catalog', confidence: 'high',
      filters: { floor_number: 4 }, filter_evidence: { floor_number: 'cuarta planta' } } })
  assert.equal(object(object(followup.query).filters).bedrooms_operator, 'gte')
  assert.equal(filterCatalog(units, catalogQuery(followup.query)).length, 2)
})

test('catalogue evidence preserves authorized prices and budget assessment never invents missing or disallowed prices', () => {
  const { verified, route } = turn()
  const scoped = rows(object(route.audit.catalog_results).units)
  assert.equal(scoped[0].published_commercial_price, 180000)
  assert.equal(turnBudgetAssessment(verified, route.audit)?.status, 'below_available_prices')
  assert.equal(turnBudgetAssessment(verified, route.audit)?.minimum_price, 180000)
  const missing = { ...route.audit, catalog_results: { ...object(route.audit.catalog_results), units: scoped.map(row => ({ ...row, published_commercial_price: undefined })) } }
  assert.equal(turnBudgetAssessment(verified, missing)?.status, 'incomplete_prices')
  const hidden = { ...verified, politica_comercial: { precios_autorizados: false } }
  const hiddenRoute = catalogDialogueReply(hidden, current)!
  assert.ok(rows(object(hiddenRoute.audit.catalog_results).units).every(row => !('published_commercial_price' in row)))
  assert.deepEqual(turnBudgetAssessment(hidden, hiddenRoute.audit)?.prices, [])
  const affordable = { ...verified, semantica_turno: { ...verified.semantica_turno,
    budget: { status: 'amount', confidence: 'high', amount: 185000, evidence: '185000 dólares' } } }
  assert.deepEqual(turnBudgetAssessment(affordable, route.audit)?.matching_unit_ids, ['d304', 'd404'])
})

test('strict live schema excludes treating ordinal floors as unit numbers; old malformed reviews receive concrete repair evidence', () => {
  const sentences = [{ id: 'S1', text: 'Tercera, cuarta y quinta planta; departamento 304.' }]
  const refs = buildNumericReferences(sentences)
  const validate = new Ajv().compile(numericCoverageSchema({ type: 'object', properties: {}, required: [], additionalProperties: false }, refs, units))
  const checks = refs.map((ref, index) => ({ numeric_id: ref.id, classification: index === 3 ? 'unit_identifier' : 'business_quantity',
    factual_value_indexes: index === 3 ? [] : [index], project_value_indexes: [], unit_ids: index === 3 ? ['d304'] : [], reason: 'Referencia al atributo o al número comercial.' }))
  assert.equal(validate({ numeric_checks: checks }), true, JSON.stringify(validate.errors))
  const bad = checks.map((row, i) => i === 0 ? { ...row, classification: 'unit_identifier', factual_value_indexes: [], unit_ids: ['d304'] } : row)
  assert.equal(validate({ numeric_checks: bad }), false)
  const issue = numericCoverageIssues({ numeric_checks: bad }, refs, units).find(row => row.code === 'numeric_unit_identifier_unverified')!
  assert.equal(issue.received, 3)
  assert.deepEqual(issue.expected_identifiers, [{ unit_id: 'd304', unit_number: '304' }])
  assert.deepEqual(issue.candidate_attributes, [{ unit_id: 'd304', field: 'floor_number', value: 3 }])
  assert.equal(structuredFactIssues([{ unit_id: 'd304', field: 'floor_number', value: 4, operator: 'eq', upper_value: null, measurement_unit: 'floor' }], units)[0].code, 'catalog_value_mismatch')
})

test('a complete empty search explains the original comparison, never an exact bedroom count substituted for a minimum', () => {
  const audit = { source: 'catalog_search', verified_catalog: true, catalog_query: catalogQuery({ operation: 'search', category: 'departamento',
    filters: { bedrooms: 5, bedrooms_operator: 'gte' } }), catalog_results: { units: [], complete: true, unknown_unit_ids: [] } }
  assert.match(verifiedAbsenceReply(audit) || '', /al menos 5/)
  assert.equal(verifiedAbsenceReply({ ...audit, catalog_query: catalogQuery({ operation: 'search', filters: { bedrooms: 5, bedrooms_operator: 'between', bedrooms_upper: 2 } }) }), null)
})

test('multi-turn budget and floor response passes exact review; omitting the budget triggers writer repair without exact-text rules', async () => {
  for (const omitBudget of [false, true]) {
    const { verified, route } = turn()
    const reply = 'Hay departamentos de al menos 2 dormitorios. Las opciones están en tercera, cuarta y quinta planta. Los precios parten de $180.000, por encima de su presupuesto de $50.000. ¿Desea revisar las opciones?'
    const noBudget = 'Hay departamentos de al menos 2 dormitorios. Las opciones están en tercera, cuarta y quinta planta. ¿Desea revisar las opciones?'
    const ajv = new Ajv({ allErrors: true }), tasks: string[] = [], failures: string[] = []
    let writers = 0
    const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_instructions, input, schema, _image, _file, _tone, task = 'data') => {
      try {
        const context = object(input)
        tasks.push(task)
        assert.ok(schema)
        let answer: Row
        if (task === 'writing') {
          writers++
          assert.equal(object(object(context.contexto_verificado).presupuesto_del_turno).minimum_price, 180000)
          if (writers === 2) assert.ok(JSON.stringify(context.reparacion).includes('current_budget_answer'))
          answer = { reply: omitBudget && writers === 1 ? noBudget : reply,
            requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Atender preferencias y presupuesto', request_type: 'specific_fact',
              status: 'answered', evidence: 'Información de las opciones solicitadas', fact_key: null })),
            question: { role: 'optional_continuation', purpose: 'choose_property', missing_datum: '', next_decision: 'Revisar opciones tras explicar el presupuesto.' } }
        } else {
          assert.ok(rows(context.obligaciones_del_turno).some(row => row.id === 'current_budget_answer'))
          const missing = omitBudget && writers === 1
          answer = { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: missing ? 'block' : 'pass',
            findings: missing ? [{ category: 'turn_goal', statement: 'El borrador omite el presupuesto.',
              reason: 'Enumera características sin responder si el presupuesto alcanza.',
              authoritative_fact: 'La obligación current_budget_answer exige atender el presupuesto actual.' }] : [] }
        }
        const validate = ajv.compile(schema)
        assert.ok(validate(answer), ajv.errorsText(validate.errors))
        return answer
      } catch (error) { failures.push(String(error)); throw error }
    }
    const result = await completeTurnReply({ current, history, baseReply: route.reply, verified,
      audit: { ...route.audit, semantic_review_enabled: true, business_risk_review_enabled: true } }, generate)
    assert.deepEqual(failures, [])
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, reply)
    assert.deepEqual(tasks, omitBudget ? ['writing', 'review', 'writing', 'review'] : ['writing', 'review'])
    assert.equal(result.needsAdvisor, false)
  }
})

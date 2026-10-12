import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { progressivePendingQuestion } from './progressive-options'
import { evaluateBudgetOptions, budgetClaimContract } from './budget-evaluation'
import { projectContentForWriter, responseContentScope } from './response-content-scope'
import { object, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const catalog: Row[] = [
  { id: 's101', unit_number: '101', category: 'suite', bedrooms: 1, floor_number: 1, area_internal_m2: 49.86,
    area_exterior_m2: 9.34, published_commercial_price: 160000 },
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, area_internal_m2: 120.83,
    area_exterior_m2: 27.03, published_commercial_price: 250000 },
  { id: 'p604', unit_number: '604', category: 'penthouse', bedrooms: 2, floor_number: 6, area_internal_m2: 99.71,
    published_commercial_price: 389750 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09,
    area_exterior_m2: 25.3, published_commercial_price: 550000 },
].map(unit => ({ ...unit, is_published: true, status: 'disponible' }))
const history = [{ role: 'bot', content: 'Las suites tienen desde 49,86 m² interiores. ¿Qué presupuesto tiene?' }]
const budget = { status: 'maximum_total', amount: 400000, confidence: 'high', evidence: 'Tengo un presupuesto de 400 mil dólares' }

function verified(current: string, action: 'ask_budget' | 'discover_bedrooms', topics = ['property_options']): Row {
  const bedrooms = action === 'discover_bedrooms'
  const evaluation = evaluateBudgetOptions({ budget, units: catalog, pricesAuthorized: true, membershipComplete: true })
  return { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true },
    politica_comercial: { precios_autorizados: true },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    property_context: { selected_ids: [], query: { group: 'residential', operation: 'search', filters: {} } },
    siguiente_paso_comercial: { action, question_id: bedrooms ? 'property_bedrooms' : 'budget_amount',
      question_act: bedrooms ? 'other' : 'budget', continuation_required: true,
      question: bedrooms ? '¿Cuántos dormitorios necesita?' : '¿Qué presupuesto total aproximado tiene previsto para la compra?',
      instruction: 'Atienda la respuesta y conserve el siguiente dato pendiente.',
      ...(bedrooms ? { budget_guidance: { ...evaluation, claim_contract: budgetClaimContract(evaluation),
        comparison_required: false, mention_allowed: true, mention_required: false } } : {}) },
    ...(bedrooms ? { hechos_confirmados: { budget } } : {}),
    solicitudes_interpretadas: [{ domain: 'property', request: current, evidence: current, confidence: 'high', topics }],
    semantica_turno: { primary_intent: bedrooms ? 'discuss_budget' : 'answer_previous', primary_evidence: current, confidence: 'high',
      budget: bedrooms ? budget : { status: 'not_discussed' },
      property: { operation: 'search', group: 'residential', reference_kind: 'none' },
      catalog_request: { purpose: 'search', requirements: [], semantic_preferences: [] } } }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  for (const action of ['ask_budget', 'discover_bedrooms'] as const) {
    test(`${action} advances without repeating catalogue areas through the actual writer and receipt: ${mode}`, async () => {
      const current = action === 'ask_budget' ? 'Busco algo para vivienda' : budget.evidence
      const input = verified(current, action), original = structuredClone(input), plan = object(input.siguiente_paso_comercial)
      const reply = 'Con gusto le orientamos. ' + plan.question
      const metadata = { purpose: 'clarify_request', role: 'necessary_clarification',
        missing_datum: action === 'ask_budget' ? 'Presupuesto total' : 'Dormitorios', next_decision: 'Continuar la búsqueda',
        continuation_id: plan.question_id, continuation_act: plan.question_act }
      const tasks: string[] = [], contexts: Row[] = []
      const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
        () => completeTurnReply({ current, baseReply: 'Las suites tienen 49,86 m². ' + plan.question, verified: input, history,
          audit: { source: 'catalog_search', semantic_review_enabled: true, business_risk_review_enabled: true } },
        async (_rules, raw, _schema, _image, _file, _tone, task) => {
          tasks.push(task || ''); contexts.push(object(raw))
          if (task === 'writing') return { reply, question: metadata, requests: rows(object(raw).referencias_solicitud)
            .map(ref => ({ fragment: ref.id, intent: 'Atender la respuesta', request_type: 'general_information',
              status: 'answered', evidence: reply, fact_key: null })) }
          return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [],
            question: { ...metadata, offered_action: 'none' } }
        }))
      assert.equal(result.reply, reply, JSON.stringify(result.audit.final_validation))
      assert.equal(result.needsAdvisor, false)
      assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
      const scope = object(contexts[0].response_content_scope)
      assert.equal(object(scope.property_presentation).kind, 'discovery_brief')
      assert.equal(object(scope.property_presentation).dimensions_allowed, false)
      assert.deepEqual(object(scope.property_presentation).available_residential_categories, ['suite', 'departamento', 'penthouse'])
      for (const unit of rows(object(contexts[0].evidencia_turno).units)) {
        assert.equal(unit.area_internal_m2, undefined)
        assert.equal(unit.area_exterior_m2, undefined)
      }
      const source = object(contexts[0].contexto_verificado)
      for (const unit of rows(source.catalogo)) assert.equal(unit.area_internal_m2, undefined)
      if (action === 'discover_bedrooms') {
        assert.deepEqual(object(object(source.siguiente_paso_comercial).budget_guidance).matching_unit_ids, ['101', '202', '604'])
        assert.deepEqual(object(object(source.siguiente_paso_comercial).budget_guidance).outside_unit_ids, ['602'])
      }
      if (contexts.length > 1) {
        const reviewUnits = rows(object(contexts[1].fuentes_autorizadas).unidades)
        assert.equal(reviewUnits.find(unit => unit.id === 's101')?.area_internal_m2, 49.86,
          'The complete catalogue remains available for verification and decision making')
      }
      const pending = progressivePendingQuestion(result.reply, { commercial_journey: plan, turn_completeness: result.audit })
      assert.equal(pending.id, plan.question_id)
      assert.equal(pending.act, plan.question_act)
      assert.deepEqual(input, original)
    })
  }
}

for (const topic of ['property_features', 'spatial_fit', 'accessibility', 'visualization']) {
  test(`a current ${topic} query retains useful dimensions while the pending discovery question continues`, () => {
    const current = 'Busco vivienda; además quiero revisar las dimensiones', input = verified(current, 'ask_budget', ['property_options', topic])
    const scope = responseContentScope(current, input), projected = projectContentForWriter({ contexto_verificado: input }, scope)
    assert.equal(object(scope.property_presentation).dimensions_allowed, true)
    assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].area_internal_m2, 49.86)
    assert.equal(object(object(projected.contexto_verificado).siguiente_paso_comercial).question_id, 'budget_amount')
  })
}

test('a verified general residential enumeration preserves all available categories without detailed area sheets', () => {
  const current = 'Quisiera conocer las opciones de vivienda', input = verified(current, 'ask_budget')
  delete input.siguiente_paso_comercial
  object(input.semantica_turno).primary_intent = 'project_information'
  const original = structuredClone(input), scope = responseContentScope(current, input, { source: 'catalog_search' })
  const projected = projectContentForWriter({ contexto_verificado: input, response_content_scope: scope }, scope)
  assert.equal(object(scope.property_presentation).kind, 'general_categories')
  assert.deepEqual(object(scope.property_presentation).available_residential_categories, ['suite', 'departamento', 'penthouse'])
  assert.deepEqual([...new Set(rows(object(projected.contexto_verificado).catalogo).map(unit => unit.category))], ['suite', 'departamento', 'penthouse'])
  assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].area_internal_m2, undefined)
  assert.deepEqual(input, original)
})

test('legacy detailed requests and current comparisons keep dimensions without relying on a historical recital', () => {
  for (const operation of ['details', 'compare']) {
    const current = 'Quiero revisar las opciones', input = verified(current, 'ask_budget')
    rows(input.solicitudes_interpretadas).forEach(request => { delete request.topics })
    object(object(input.semantica_turno).property).operation = operation
    object(object(input.semantica_turno).catalog_request).purpose = operation
    const scope = responseContentScope(current, input)
    const projected = projectContentForWriter({ contexto_verificado: input }, scope)
    assert.equal(object(scope.property_presentation).dimensions_allowed, true)
    assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].area_internal_m2, 49.86)
  }
})

test('discovery projection omits grouped measurement facts as well as unit areas', () => {
  const current = 'Busco vivienda', input = verified(current, 'ask_budget'), scope = responseContentScope(current, input)
  const original = { response_content_scope: scope, evidencia_turno: { groups: [
    { id: 'group:area', field: 'area_internal_m2', value: 49.86 },
    { id: 'group:category', category: 'suite', area_internal_m2: 49.86, upper_values: { area_internal_m2: 73.86 } },
  ], project_facts: [{ field: 'area_internal_m2', value: 49.86 }] } }
  const projected = projectContentForWriter(original, scope), evidence = object(projected.evidencia_turno)
  assert.deepEqual(evidence.groups, [{ id: 'group:category', category: 'suite', upper_values: {} }])
  assert.deepEqual(evidence.project_facts, [])
  assert.equal(rows(object(original.evidencia_turno).groups).length, 2)
})

test('400000 budget suitability is per unit and bedrooms rather than a category-wide penthouse exclusion', () => {
  const evaluation = evaluateBudgetOptions({ budget, units: catalog, pricesAuthorized: true, membershipComplete: true })
  assert.deepEqual(evaluation.matching_unit_ids, ['s101', 'd202', 'p604'])
  assert.deepEqual(evaluation.outside_unit_ids, ['p602'])
  const threeBedrooms = evaluateBudgetOptions({ budget, units: catalog.filter(unit => unit.bedrooms === 3),
    pricesAuthorized: true, membershipComplete: true })
  assert.deepEqual(threeBedrooms.matching_unit_ids, ['d202'])
  assert.deepEqual(threeBedrooms.outside_unit_ids, ['p602'])
  const penthouse = rows(threeBedrooms.categories).find(category => category.category === 'penthouse')!
  assert.equal(penthouse.coverage, 'none')
  assert.equal(penthouse.universal_affordability_allowed, false)
})

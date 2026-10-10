import test from 'node:test'
import assert from 'node:assert/strict'
import { object, scope, type Row } from './data'
import { retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { catalogDialogueReply } from './catalog-dialogue'
import { commercialJourneyPlan } from './commercial-journey'
import { turnBudgetAssessment, budgetForCommercialPlan } from './turn-budget'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { completeTurnReply } from './turn-completeness'
import { semanticCatalogContext } from './semantic-catalog-context'
import { FINANCING_PROCESS_RULES } from './financing-guidance'

const units: Row[] = [
  ...[2, 3, 4, 5].map(floor => ({ id: `d${floor}02`, unit_number: `${floor}02`, category: 'departamento', bedrooms: 3,
    floor_number: floor, bathrooms_full: 2, area_internal_m2: 120, published_commercial_price: 300000 })),
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, bathrooms_full: 3,
    area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, bathrooms_full: 3,
    area_internal_m2: 140.53, published_commercial_price: 539900 },
].map(unit => ({ ...unit, spaces: ['Balcón'], status: 'disponible', is_published: true }))
const never = { embed: async (): Promise<{ vector: number[]; tokens: number }> => { throw Error('unnecessary vector call') },
  match: async (): Promise<Row[]> => { throw Error('unnecessary index call') } }
const info = (operation = 'details', enabled = true): Row => ({ catalogo: units, catalogo_verificacion: units,
  catalog_read: { complete: true }, catalog_search: { embeddingsEnabled: enabled },
  politica_comercial: { precios_autorizados: true }, recorrido_comercial: {},
  lead: { purchase_purpose: 'vivir' }, financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'], journey: {} },
  property_context: { query: { group: 'residential', category: 'penthouse', operation, scope: 'catalog', filters: { bedrooms: 3 } } },
  hechos_confirmados: { property: { category: 'penthouse', group: 'residential', confidence: 'high', evidence: 'Me interesan los penthouses' } },
  referencia_unidad: {}, contrato_turno: { objective: 'project_information', requests: [{ domain: 'property', confidence: 'high' }] },
  semantica_turno: { primary_intent: 'project_information', confidence: 'high', catalog_request: null, catalog_request_status: 'not_requested',
    property: { group: 'residential', category: 'penthouse', operation, confidence: 'high', reference_kind: 'followup' },
    household: { people: 6 }, housing_quantities: [{ dimension: 'people', values: [6] }],
    budget: { status: 'amount', amount: 460000, confidence: 'high', evidence: 'unos 460 mil' } } })
const hits = () => units.map((unit, index) => ({ similarity: .7 + index * .01,
  metadata: { ...unit, ...scope, unit_id: unit.id, embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536, index_version: 'unit-facts-v1' } }))

test('details with inherited bedrooms, household and budget use the resolved exact query with either switch setting', async () => {
  for (const enabled of [true, false]) {
    const input = info('details', enabled), before = structuredClone(input)
    const result = await retrieveCatalogByEmbeddings(input, 'Mejor detalle las opciones', never)
    assert.deepEqual(result.units?.map(u => u.id), ['p602', 'p605'])
    assert.equal(result.audit.optimized, true)
    assert.equal(result.audit.exact_filter_applied, true)
    assert.equal(result.audit.query_source, 'resolved_property_query')
    assert.equal(result.audit.embedding_requested, false)
    assert.equal(result.audit.embedding_model_consulted, null)
    assert.equal(object(result.audit.catalog_summary).matching_count, 2)
    assert.deepEqual(input, before)
  }
})

test('descriptive preferences can be ranked after exact filtering during a budget follow-up; failure preserves the same result', async () => {
  const input = info()
  object(input.semantica_turno).catalog_request = { version: 'catalog-request-v1', purpose: 'details', confidence: 'high',
    requirements: [], semantic_preferences: ['vistas abiertas'], metric: null, evidence: 'vistas abiertas' }
  let calls = 0
  const provider = { embed: async () => { calls++; return { vector: [1], tokens: 7 } }, match: async () => hits() }
  const ranked = await retrieveCatalogByEmbeddings(input, 'Detalles con vistas abiertas', provider)
  assert.equal(calls, 1)
  assert.equal(ranked.audit.applied, true)
  assert.equal(ranked.audit.embedding_model_consulted, 'text-embedding-3-small')
  assert.ok(ranked.units?.every(u => u.category === 'penthouse' && u.bedrooms === 3))
  const failed = await retrieveCatalogByEmbeddings(input, 'Detalles con vistas abiertas', { ...provider, match: async () => [] })
  assert.equal(failed.audit.applied, false)
  assert.equal(failed.audit.ranking_reason, 'semantic_ranking_unavailable')
  assert.deepEqual(failed.units?.map(u => u.id), ['p602', 'p605'])
  const off = await retrieveCatalogByEmbeddings({ ...input, catalog_search: { embeddingsEnabled: false } }, 'Detalles', never)
  assert.deepEqual(off.units, failed.units)
})

test('every explicit comparison subject survives a large context and stays a comparison rather than a new selection', async () => {
  const input = info('compare')
  input.catalogo = units.map(u => ({ ...u, description: 'x'.repeat(18000) }))
  input.property_context = { query: { group: 'residential', category: 'penthouse', operation: 'compare', scope: 'comparison', filters: {} },
    comparison_ids: ['p602', 'p605'], selected_ids: [] }
  input.referencia_unidad = { explicit: true, matches: (input.catalogo as Row[]).filter(u => u.category === 'penthouse') }
  const retrieval = await retrieveCatalogByEmbeddings(input, 'Compare ambas', never)
  assert.equal(retrieval.units?.length, 2)
  assert.equal(retrieval.audit.selection_reason, 'all_requested_subjects')
  const reply = catalogDialogueReply({ ...input, catalogo: retrieval.units }, 'Compare ambas')!
  assert.equal(reply.audit.source, 'catalog_compare')
  assert.deepEqual(reply.audit.selected_unit_ids, [])
  assert.equal(object(reply.audit.catalog_results).complete, true)
})

test('independent catalogue scopes, ambiguous references, invalid conditions and partial reads keep conservative routes', async () => {
  const changes: [Row, string][] = [
    [{ contrato_turno: { requests: [{ domain: 'property', confidence: 'high' }, { domain: 'property', confidence: 'high' }] } }, 'multiple_catalog_scopes'],
    [{ referencia_unidad: { needsClarification: true } }, 'unresolved_property_reference'],
    [{ semantica_turno: { ...object(info().semantica_turno), catalog_request_status: 'invalid' } }, 'invalid_structured_requirements'],
    [{ semantica_turno: { ...object(info().semantica_turno), catalog_request: { version: 'catalog-request-v1', purpose: 'details', confidence: 'low' } } }, 'uncertain_interpretation'],
    [{ catalog_read: { complete: false } }, 'incomplete_catalog'],
  ]
  for (const [change, reason] of changes) {
    const result = await retrieveCatalogByEmbeddings({ ...info(), ...change }, 'Detalles', never)
    assert.equal(result.units, null)
    assert.equal(result.audit.reason, reason)
  }
})

test('unknown mandatory fields are not certified by vector similarity or turned into absence', async () => {
  const input = info()
  object(input.semantica_turno).catalog_request = { version: 'catalog-request-v1', purpose: 'details', confidence: 'high',
    requirements: [{ field: 'unmodeled', operator: 'contains', value: 'vista panorámica', strength: 'required' }],
    semantic_preferences: ['vista panorámica'], metric: null }
  const result = await retrieveCatalogByEmbeddings(input, 'Vista panorámica', never)
  assert.deepEqual(result.units, [])
  assert.equal(object(result.audit.catalog_summary).unknown_count, 2)
  assert.equal(object(result.audit.catalog_summary).exact_count, false)
  assert.equal(result.audit.embedding_requested, false)
})

test('compound and pending requests preserve their policy and amenity facts when the current message is a short follow-up', async () => {
  const input = info()
  input.contrato_turno = { requests: [{ domain: 'property', confidence: 'high', request: 'Detalles de penthouses' },
    { domain: 'financing', confidence: 'high', request: 'Condiciones de pago' }] }
  input.consultas_pendientes = [{ request: 'Uso de piscina' }]
  input.politicas_negocio = [{ topic: 'financiamiento', policy_content: 'Condición verificada' }, { topic: 'pagos', policy_content: 'Instrucciones' }]
  input.instalaciones = [{ amenity_name: 'Piscina', description: 'Exclusiva de residentes' }]
  const retrieval = await retrieveCatalogByEmbeddings(input, 'Sí, detalles', never)
  assert.equal(retrieval.audit.optimized, true)
  const projected = semanticCatalogContext({ ...input, catalog_context_scope: semanticCatalogScope(retrieval.audit) },
    { catalog_retrieval: retrieval.audit }, 'Sí, detalles')
  assert.equal((projected.politicas_negocio as Row[]).length, 2)
  assert.equal((projected.instalaciones as Row[]).length, 1)
})

test('a retrieval category without declaration evidence cannot establish an over-budget purchase preference', () => {
  const input = info('search')
  delete input.hechos_confirmados
  object(input.semantica_turno).budget = { status: 'maximum_total', amount: 460000, confidence: 'high',
    evidence: 'Mi presupuesto total para la compra es de 460000' }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'select_property')
  assert.equal(plan.question_id, 'property_category')
  assert.equal(plan.financing_offer_allowed, false)
  assert.deepEqual(object(plan.selection_scope).categories, ['departamento'])
  assert.equal(object(plan.proposed_query).category, 'departamento')
})

test('a detailed category request has one commercial plan and omits unrelated affordable alternatives and duplicate aggregates', async () => {
  let input = info()
  object(input.semantica_turno).budget = { status: 'maximum_total', amount: 460000, confidence: 'high',
    evidence: 'Mi presupuesto total para la compra es de 460000' }
  const retrieval = await retrieveCatalogByEmbeddings(input, 'Detalles de penthouses', never)
  const answer = catalogDialogueReply({ ...input, catalogo: retrieval.units }, 'Detalles de penthouses')!
  const audit = { ...answer.audit, catalog_retrieval: retrieval.audit, catalog_summary: retrieval.audit.catalog_summary,
    catalog_aggregate_groups: retrieval.audit.catalog_aggregate_groups }
  input = { ...input, catalogo: retrieval.units, catalog_context_scope: semanticCatalogScope(retrieval.audit) }
  const assessment = turnBudgetAssessment(input, audit)!
  assert.equal((assessment.alternatives as Row[]).length, 4, 'The full snapshot still supports internal comparisons.')
  const plan = commercialJourneyPlan({ ...input, presupuesto_del_turno: assessment }, audit)
  assert.equal(plan.action, 'offer_financing')
  const scopedBudget = budgetForCommercialPlan(assessment, plan)
  assert.equal(scopedBudget.continuation, 'commercial_next_step')
  assert.deepEqual(scopedBudget.alternatives, [])
  const verified = { ...taskVerifiedContext(input, audit, 'Detalles de penthouses'), presupuesto_del_turno: scopedBudget, siguiente_paso_comercial: plan }
  const canonical = turnEvidence(verified, audit), projected = taskModelEvidence(canonical, verified)
  assert.deepEqual(projected.units.map(u => u.id), ['p602', 'p605'])
  assert.ok(projected.groups.length < canonical.groups.length)
  assert.ok(projected.groups.every(g => g.aggregation === 'range'))
  assert.ok(projected.groups.some(g => g.source_scope === 'complete_query'))

  const calls: { task: string; data: Row; rules: string }[] = []
  const reply = 'Los penthouses tienen 3 dormitorios. Para revisar su financiamiento podemos continuar con JEP o Banco Pichincha; primero elegiríamos la unidad. ¿Desea continuar?'
  const result = await completeTurnReply({ current: 'Detalles de penthouses', baseReply: answer.reply, verified: input,
    audit: { ...audit, semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (rules, data, _schema, _image, _file, _tone, task) => {
      calls.push({ task: task!, data: object(data), rules })
      if (task === 'writing') return { reply, requests: [{ fragment: 'R1', intent: 'Detalles', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null }],
        question: { purpose: 'permission_to_continue', role: 'optional_continuation', missing_datum: '', next_decision: 'Financiamiento' } }
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    })
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls.map(c => c.task), ['writing', 'review'])
  assert.ok(calls.every(c => !c.rules.includes(FINANCING_PROCESS_RULES)), 'An offer based on budget does not require collection rules in either agent.')
  assert.equal((object(calls[0].data.evidencia_turno).units as Row[]).length, 2)
  assert.equal((object(calls[1].data.fuentes_autorizadas).unidades as Row[]).length, 2)
  assert.deepEqual(object(object(calls[0].data.contexto_verificado).presupuesto_del_turno).alternatives, [])
})

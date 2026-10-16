import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { resolveTurnIntent } from './turn-intent'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { responseContentScope, projectContentForWriter } from './response-content-scope'
import { taskVerifiedContext } from './task-context'
import { semanticCatalogContext } from './semantic-catalog-context'
import { projectQuantityEvidence } from './project-quantities'
import { verifiedClaimSources } from './turn-evidence'
import { withProjectObjectionContext, PROJECT_OBJECTION_WRITER_RULES } from './project-objections'
import { salesIssues, salesPlan } from './sales-policy'

const unit = { id: 'lc11', unit_number: 'LC-11', category: 'local', floor_number: 1,
  area_internal_m2: 46.65, published_commercial_price: 145000, is_published: true, status: 'disponible' }
const subjects = [
  ['¿Por qué tan caro?', ['value_objection', 'property_features']],
  ['El proyecto me queda lejos.', ['value_objection', 'location']],
  ['Me preocupa la inseguridad de esa zona.', ['value_objection', 'property_features']],
  ['En otro proyecto me ofrecen algo parecido más barato.', ['value_objection', 'property_features']],
  ['Me preocupa que el local no se arriende.', ['value_objection', 'property_features']],
  ['Me preocupa comprar antes de que empiece la obra.', ['value_objection', 'construction_status']],
] as const

function fixture(current: string, topics: readonly string[]): Row {
  const requests = [{ domain: 'property', request: current, evidence: current,
    confidence: 'high', source: 'current', topics: [...topics] }]
  const semantics = { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
    property: { operation: 'none', reference_kind: 'none', category: null, unit_numbers: [], filters: {} },
    budget: { status: 'not_discussed', amount: null },
    catalog_request: { purpose: 'none', requirements: [], semantic_preferences: [] } }
  return { catalogo: [unit], catalogo_verificacion: [unit], catalog_read: { complete: true },
    catalog_search: { embeddingsEnabled: false },
    proyecto: { name: 'La Vilet', address: 'Dirección exacta reservada', sector: 'Puertas del Sol', city: 'Cuenca' },
    ubicacion_general: { sector: 'Puertas del Sol', city: 'Cuenca' }, ubicacion: 'https://maps.example/project',
    instalaciones: [{ name: 'Control de acceso', description: 'Acceso controlado del edificio.' }],
    lugares_cercanos: [{ name: 'Comercio cercano', description: 'Servicios del sector, fuera del proyecto.' }],
    contexto_sector: [{ title: 'Sector', description: 'Sector residencial.' }],
    politica_comercial: { precios_autorizados: true },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    lead: { preferred_category: 'local' }, recorrido_comercial: {},
    financiamiento: { partners: ['Cooperativa JEP'], current: {}, journey: {} },
    property_context: { selected_ids: [unit.id], offered_ids: [unit.id],
      query: { category: 'local', group: 'commercial', operation: 'details', scope: 'selected', filters: {} },
      pending_question: { id: 'budget_amount', act: 'budget', question: '¿Qué presupuesto tiene previsto?' } },
    semantica_turno: semantics, solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'property' } }) }
}

test('objection sources survive both source selectors without opening prices, exact location or map disclosure', () => {
  const [current, topics] = subjects[0], raw = fixture(current, topics), before = structuredClone(raw)
  const info = withProjectObjectionContext(raw, current)
  const semantic = semanticCatalogContext({ ...info, catalog_context_scope: { kind: 'optimized_catalog' } },
    { catalog_retrieval: { optimized: true } }, current)
  const compact = taskVerifiedContext(semantic, {}, current)
  assert.deepEqual(compact.instalaciones, raw.instalaciones)
  assert.equal(object(object(compact.objeciones_proyecto).project_facts).commercial_floors, 2)
  const scope = responseContentScope(current, compact)
  const writing = projectContentForWriter({ contexto_verificado: compact }, scope)
  const source = object(writing.contexto_verificado)
  assert.equal(object(object(scope.topics).purchase_prices).allowed, false)
  assert.equal(object(source.proyecto).address, undefined)
  assert.equal(source.ubicacion, undefined)
  assert.equal(object((source.catalogo as Row[])[0]).published_commercial_price, undefined)
  assert.equal(object(object(source.objeciones_proyecto).project_facts).commercial_floors, 2)
  const claims = verifiedClaimSources(compact, {}, {})
  assert.ok(claims.some(row => row.path === 'contexto_verificado.objeciones_proyecto.project_facts'))
  assert.ok(!claims.some(row => String(row.path).includes('guidance')))
  const quantity = projectQuantityEvidence(compact).find(row => row.value === 2 && row.unit === 'floor')
  assert.ok(quantity)
  assert.equal(quantity.dimension, 'count')
  assert.deepEqual(raw, before)
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  for (const [current, topics] of subjects) {
    test(`the final writer receives grounded objection guidance: ${mode}, ${topics.at(-1)}`, async () => {
      const verified = fixture(current, topics), before = structuredClone(verified)
      const reply = 'La propuesta reúne viviendas y comercio. Podemos comparar qué aporta a su objetivo con las características de cada opción.'
      const contexts: Row[] = [], reviews: Row[] = [], rulesSeen: string[] = []
      const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
        () => completeTurnReply({ current, baseReply: '', verified,
          audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true,
            ...(mode === 'demonstration' ? { response_review_observation: { enabled: true, test_contact: true } } : {}) } },
        async (rules, raw, _schema, _image, _file, _tone, task) => {
          const context = object(raw)
          if (task === 'writing') {
            contexts.push(context); rulesSeen.push(rules)
            const refs = context.referencias_solicitud as Row[]
            return { reply, question: null, requests: refs.map(ref => ({ fragment: ref.id,
              intent: 'Atender preocupación actual', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
          }
          reviews.push(context)
          const sources = object(context.fuentes_autorizadas).otros_hechos_y_politicas as Row[]
          assert.ok(sources.some(source => source.path === 'contexto_verificado.objeciones_proyecto.project_facts'))
          assert.ok(!sources.some(source => String(source.path).includes('objeciones_proyecto.guidance')))
          assert.ok((object(context.fuentes_autorizadas).hechos_con_cantidades as Row[])
            .some(fact => fact.value === 2 && fact.unit === 'floor'))
          return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: null }
        }))
      assert.equal(result.reply, reply, JSON.stringify(result.audit))
      assert.equal(result.needsAdvisor, false)
      assert.equal(contexts.length, 1)
      assert.equal(reviews.length, mode === 'disabled' ? 0 : 1)
      assert.ok(rulesSeen[0].includes(PROJECT_OBJECTION_WRITER_RULES))
      const source = object(contexts[0].contexto_verificado)
      assert.equal(object(object(source.objeciones_proyecto).project_facts).commercial_floors, 2)
      assert.deepEqual((object(source.objeciones_proyecto).requests as Row[]).map(request => request.evidence), [current])
      assert.equal(object(object(contexts[0].contrato_redaccion).continuacion_del_turno).required, false)
      const scope = object(object(contexts[0].response_content_scope).topics)
      assert.equal(object(scope.purchase_prices).allowed, false)
      assert.equal(object(scope.general_location).allowed, topics.some(topic => topic === 'location'))
      assert.equal(object(scope.construction_status).allowed, topics.some(topic => topic === 'construction_status'))
      assert.deepEqual(verified, before)
    })
  }
}

test('an explicit price request accompanying an objection keeps the requested price scope', () => {
  const current = '¿Por qué tan caro y cuánto cuesta el LC-11?', verified = fixture(current, ['value_objection', 'purchase_price'])
  const scope = responseContentScope(current, verified)
  assert.equal(object(object(scope.topics).purchase_prices).allowed, true)
})

test('the secondary sales route cannot append a unit offer or brochure while the objection is being answered', () => {
  const [current, topics] = subjects[0], verified = fixture(current, topics)
  verified.historial = [
    { role: 'bot', content: '¿Busca una vivienda o un local comercial?' },
    { role: 'cliente', content: 'Un local.' },
    { role: 'bot', content: '¿Qué presupuesto tiene previsto para la compra?' },
  ]
  verified.precio_cotizado = true
  verified.unidades_cotizadas = [unit]
  const plan = salesPlan(verified, current, {})
  assert.equal(plan.action, 'answer_only')
  assert.equal(plan.closing, '')
  assert.equal(plan.max_questions, 1)
  assert.ok(!salesIssues('¿Qué recorrido le preocupa?', plan).includes('repeated_question'))
  assert.equal(plan.question_purpose, null)
})

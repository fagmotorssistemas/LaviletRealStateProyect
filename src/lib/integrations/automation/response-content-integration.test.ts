import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { RESPONSE_CONTENT_SCOPE_RULES } from './response-content-scope'
import { leadBudget } from './budget-state'
import { resolveTurnIntent, rememberTurnIntentAfterReply } from './turn-intent'
import { object, type Row } from './data'

const unit = { id: 'ph602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
  area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000, is_published: true, status: 'disponible' }
const bankQuestion = '¿Con qué entidad desea iniciar la revisión: Banco Pichincha o Cooperativa JEP?'
const bankPlan = { action: 'continue_financing', question_id: 'financing_partner', question_act: 'financing', question: bankQuestion,
  continuation_required: true, selected_unit_id: unit.id }
const bankMetadata = { purpose: 'choose_financing_partner', role: 'optional_continuation', missing_datum: '',
  next_decision: 'Elegir la entidad de la revisión aceptada', continuation_id: 'financing_partner', continuation_act: 'financing' }
const historical = [{ role: 'user', content: '¿Cuál es el precio y dónde está el proyecto? ¿Ya inició su construcción?' },
  { role: 'bot', content: 'El PH602 cuesta USD 550000, en Puertas del Sol, Cuenca. La construcción aún no inició. ¿Qué tipo de vivienda prefiere?' }]
const allTopics = ['project_intro', 'general_location', 'exact_location', 'purchase_prices', 'commercial_stage',
  'construction_status', 'delivery', 'spatial_caveat']
const topicAllowed = (context: Row, name: string) => object(object(object(context.response_content_scope).topics)[name]).allowed

function fixture(current: string, topics: string[], compact = false): Row {
  const requests = [{ domain: compact ? 'financing' : 'property', request: current, evidence: current,
    confidence: 'high', source: 'current', topics }]
  return { catalogo: [unit], catalog_read: { complete: true },
    proyecto: { name: 'La Vilet', sector: 'Puertas del Sol', city: 'Cuenca', address: 'Dirección comercial exacta' },
    ubicacion_general: { sector: 'Puertas del Sol', city: 'Cuenca' }, ubicacion: 'https://maps.example/project',
    configuracion_presentacion_proyecto: { available: true, summary: 'La Vilet integra viviendas y espacios comerciales.', source: 'Resumen aprobado' },
    politica_comercial: { precios_autorizados: true, precios_aproximados: true },
    modo_comercial: 'preventa', estado_proyecto: { stage: 'not_started', enabledPlaces: ['office'] }, entrega_proyecto: { date: '2029' },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    hechos_confirmados: { budget: { status: 'initial_capital', amount: 200000, confidence: 'high', evidence: 'Tengo 200 mil para la entrada' } },
    financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: 'Tengo 200 mil para la entrada', confidence: 'high' }],
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: { accepted: true } },
    siguiente_paso_comercial: bankPlan,
    property_context: { selected_ids: [unit.id], offered_ids: [unit.id],
      query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected', filters: { bedrooms: 3 } } },
    solicitudes_interpretadas: requests, consultas_pendientes: [],
    contrato_turno: { objective: compact ? 'ask_financing' : 'project_information', requests },
    semantica_turno: { primary_intent: compact ? 'ask_financing' : 'project_information', primary_evidence: current, confidence: 'high',
      budget: { status: 'not_discussed', amount: null }, property: { operation: compact ? 'none' : 'details', reference_kind: 'followup' },
      catalog_request: { purpose: compact ? 'none' : 'details', requirements: [], semantic_preferences: [] } } }
}

type Mode = 'normal' | 'demonstration' | 'disabled'
async function run(current: string, reply: string, verified: Row, mode: Mode = 'normal', extra: Row = {}, facts: Row[] = [], history = historical) {
  const calls: string[] = [], writerContexts: Row[] = [], reviewerContexts: Row[] = [], writerRules: string[] = []
  const original = structuredClone(verified)
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
    () => completeTurnReply({ current, baseReply: reply, verified, history,
      audit: { source: 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true,
        ...(mode === 'demonstration' ? { response_review_observation: { enabled: true, test_contact: true } } : {}), ...extra } },
    async (rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      const context = object(raw)
      if (task === 'writing') {
        writerContexts.push(context); writerRules.push(String(rules))
        const refs = Array.isArray(context.referencias_solicitud) ? context.referencias_solicitud as Row[] : []
        return { reply, question: verified.siguiente_paso_comercial ? bankMetadata : null,
          requests: refs.map(ref => ({ fragment: ref.id, intent: 'Solicitud actual', request_type: 'specific_fact',
            status: 'answered', evidence: reply, fact_key: null })) }
      }
      reviewerContexts.push(context)
      return { review_contract: 'business-risk-v2', verdict: 'pass', facts, findings: [],
        question: verified.siguiente_paso_comercial ? { ...bankMetadata, offered_action: 'none' } : null }
    }))
  assert.deepEqual(verified, original, 'Writer projection must not change the verification snapshot or declared choices')
  assert.equal(result.reply, reply, JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(calls, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
  return { result, context: writerContexts[0], reviewer: reviewerContexts[0], rules: writerRules[0] }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test('current selection cannot re-disclose answered project facts through the actual writer: '+mode, async () => {
    const current = 'Prefiero penthouse', verified = fixture(current, ['property_options'])
    const reply = 'Continuamos con la opción elegida. '+bankQuestion
    const { result, context, reviewer, rules } = await run(current, reply, verified, mode)
    for (const name of allTopics) assert.equal(topicAllowed(context, name), false, name)
    assert.ok(rules.includes(RESPONSE_CONTENT_SCOPE_RULES))
    const source = object(context.contexto_verificado), project = object(source.proyecto)
    assert.equal(project.sector, undefined); assert.equal(project.city, undefined); assert.equal(project.address, undefined)
    assert.equal(source.ubicacion, undefined); assert.equal(source.ubicacion_general, undefined)
    assert.equal(source.presentacion_general_proyecto, undefined)
    const evidenceUnit = (object(context.evidencia_turno).units as Row[])[0]
    assert.equal(evidenceUnit.published_commercial_price, undefined)
    assert.equal(evidenceUnit.area_internal_m2, 142.09, 'Removing price recital does not remove relevant property characteristics')
    assert.deepEqual(context.historial_reciente, historical, 'History remains continuity data rather than price authority')
    assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
    assert.equal(leadBudget(verified).status, 'initial_capital')
    assert.equal(leadBudget(verified).amount, 200000)
    if (reviewer) {
      const reviewedUnit = (object(reviewer.fuentes_autorizadas).unidades as Row[])[0]
      assert.equal(reviewedUnit.published_commercial_price, 550000, 'Reviewer still verifies complete authorized property facts')
      const obligations = reviewer.obligaciones_del_turno as Row[]
      const scope = obligations.find(row => row.id === 'response_content_scope')!
      assert.deepEqual(scope.topics, object(context.response_content_scope).topics)
      assert.match(String(scope.instruction), /dato verdadero también puede incumplir/)
    }
  })
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test('a current price request keeps the verified price and generic referential notice: '+mode, async () => {
    const current = '¿Cuánto cuesta el penthouse elegido?', verified = fixture(current, ['purchase_price'])
    const reply = 'El penthouse 602 tiene un precio de USD 550000. Estos son los precios referenciales vigentes y pueden cambiar. '+bankQuestion
    const fact = { statement: 'El penthouse 602 tiene un precio de USD 550000', kind: 'catalog_value', subject_id: unit.id,
      scope: null, field: 'published_commercial_price', value: 550000, upper_value: null, relation: 'eq', unit: 'USD' }
    const { context, rules } = await run(current, reply, verified, mode, {}, [fact])
    assert.equal(topicAllowed(context, 'purchase_prices'), true)
    for (const name of allTopics.filter(name => name !== 'purchase_prices')) assert.equal(topicAllowed(context, name), false, name)
    assert.equal(((object(context.evidencia_turno).units as Row[])[0]).published_commercial_price, 550000)
    assert.ok(rules.includes(RESPONSE_CONTENT_SCOPE_RULES))
    assert.doesNotMatch(reply, /lanzamiento|preventa|obra|entrega|Cuenca/)
  })
}

test('a comparable current total budget authorizes only its indispensable price comparison', async () => {
  const current = 'Mi presupuesto total es 300000 dólares', verified = fixture(current, ['financing'])
  object(verified.semantica_turno).budget = { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: current }
  verified.hechos_confirmados = { budget: object(verified.semantica_turno).budget }
  const reply = 'El precio de la opción elegida es USD 550000 y supera su presupuesto total. Estos son los precios referenciales vigentes y pueden cambiar. '+bankQuestion
  const facts = [{ statement: 'El precio de la opción elegida es USD 550000', kind: 'catalog_value', subject_id: unit.id,
    scope: null, field: 'published_commercial_price', value: 550000, upper_value: null, relation: 'eq', unit: 'USD' }]
  const { context } = await run(current, reply, verified, 'normal', {}, facts)
  assert.equal(topicAllowed(context, 'purchase_prices'), true)
  assert.equal(object(object(object(context.response_content_scope).topics).purchase_prices).reason, 'current_budget_comparison')
  for (const name of allTopics.filter(name => name !== 'purchase_prices')) assert.equal(topicAllowed(context, name), false, name)
  assert.equal(((object(context.evidencia_turno).units as Row[])[0]).published_commercial_price, 550000)
})

for (const fit of [false, true]) test('spatial caution follows a real fit query, not an ordinary bedrooms preference; fit='+fit, async () => {
  const current = fit ? '¿Caben dos camas en esa habitación?' : 'Prefiero tres dormitorios'
  const verified = fixture(current, [fit ? 'spatial_fit' : 'property_options'])
  const reply = (fit ? 'Para comprobar la cabida hacen falta las medidas de la habitación y de las camas.' : 'Continuamos con su preferencia de dormitorios.')+' '+bankQuestion
  const { context } = await run(current, reply, verified)
  assert.equal(topicAllowed(context, 'spatial_caveat'), fit)
  for (const name of allTopics.filter(name => name !== 'spatial_caveat')) assert.equal(topicAllowed(context, name), false, name)
})

test('compact financial collection keeps the scope, personal amount and pending bank choice without reintroducing purchase prices', async () => {
  const current = '¿Qué se necesita para revisar el financiamiento?', verified = fixture(current, ['financing'], true)
  const reply = 'Para avanzar con la revisión necesitamos elegir la entidad. '+bankQuestion
  const { context, rules, result } = await run(current, reply, verified, 'normal', { source: 'financing_intake',
    financing_collection: { collection_allowed: true, requested_fields: ['selected_partner_name'], pending_fields: ['selected_partner_name'] } })
  for (const name of allTopics) assert.equal(topicAllowed(context, name), false, name)
  const source = object(context.contexto_verificado)
  assert.equal(object(source.prompt_context_selection).task, 'financing')
  assert.match(rules, /response_content_scope/)
  assert.equal(object(source.proyecto).city, undefined)
  assert.equal(((object(context.evidencia_turno).units as Row[])[0])?.published_commercial_price, undefined)
  assert.deepEqual(source.financing_amounts, verified.financing_amounts, 'Structured down payment and its monetary role survive compaction')
  assert.equal(leadBudget(verified).amount, 200000)
  assert.equal(leadBudget(verified).status, 'initial_capital')
  assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
  assert.deepEqual(object(verified.property_context).selected_ids, ['ph602'])
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) test('an approved initial overview is available without automatically authorizing a price or stage inventory: '+mode, async () => {
  const current = 'Quiero información general del proyecto', verified = fixture(current, ['project_overview'])
  delete verified.siguiente_paso_comercial
  delete verified.hechos_confirmados
  delete verified.financing_amounts
  verified.financiamiento = {}
  verified.perfil_lead = {}
  verified.property_context = { query: {}, selected_ids: [], offered_ids: [] }
  object(verified.semantica_turno).property = { operation: 'none', reference_kind: 'none' }
  object(verified.semantica_turno).catalog_request = { purpose: 'none', requirements: [], semantic_preferences: [] }
  const reply = 'La Vilet integra viviendas y espacios comerciales.'
  const { context, rules } = await run(current, reply, verified, mode, { source: 'project_overview' }, [], [])
  assert.equal(topicAllowed(context, 'project_intro'), true)
  assert.equal(topicAllowed(context, 'general_location'), true)
  for (const name of allTopics.filter(name => !['project_intro', 'general_location'].includes(name))) assert.equal(topicAllowed(context, name), false, name)
  assert.equal(object(object(context.contexto_verificado).presentacion_general_proyecto).summary, reply)
  assert.match(rules, /Presentación general del proyecto/)
  assert.equal(object(object(context.contexto_verificado).proyecto).city, 'Cuenca')
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) test('a delivered price answer closes its inherited permission before the next preference: '+mode, async () => {
  const priceCurrent = '¿Cuánto cuesta el penthouse?', first = fixture(priceCurrent, ['purchase_price'])
  first.contrato_turno = resolveTurnIntent({ current: priceCurrent, semantics: object(first.semantica_turno),
    requests: first.solicitudes_interpretadas as Row[], scope: { kind: 'property', uncertain: false } })
  const priceReply = 'El penthouse 602 cuesta USD 550000. Estos son los precios referenciales vigentes y pueden cambiar. '+bankQuestion
  const priceFact = { statement: 'El penthouse 602 cuesta USD 550000', kind: 'catalog_value', subject_id: unit.id,
    scope: null, field: 'published_commercial_price', value: 550000, upper_value: null, relation: 'eq', unit: 'USD' }
  const answered = await run(priceCurrent, priceReply, first, mode, {}, [priceFact])
  const remembered = rememberTurnIntentAfterReply(first.contrato_turno, answered.result.audit, { accepted: true, recovery: false })
  assert.equal(remembered.price_request_status, 'answered', JSON.stringify(answered.result.audit))
  const current = 'Prefiero penthouse', next = fixture(current, ['property_options'])
  object(next.semantica_turno).primary_intent = 'select_property'
  object(next.semantica_turno).property = { operation: 'search', reference_kind: 'none', category: 'penthouse', confidence: 'high' }
  next.contrato_turno = resolveTurnIntent({ current, semantics: object(next.semantica_turno),
    requests: next.solicitudes_interpretadas as Row[], scope: { kind: 'property', uncertain: false }, previous: remembered,
    pendingQuestion: { id: 'property_category', act: 'choose_category' } })
  assert.notEqual(object(next.contrato_turno).objective, 'ask_price')
  const deliveredHistory = [{ role: 'user', content: priceCurrent }, { role: 'bot', content: priceReply }]
  const following = await run(current, 'Continuamos con la opción elegida. '+bankQuestion, next, mode, {}, [], deliveredHistory)
  assert.equal(topicAllowed(following.context, 'purchase_prices'), false)
  assert.equal(((object(following.context.evidencia_turno).units as Row[])[0]).published_commercial_price, undefined)
  assert.equal(object(following.result.audit.question).continuation_id, 'financing_partner')
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) test('irrelevant true prices are corrected by active semantic review while diagnostic controls retain their own behavior: '+mode, async () => {
  const current = 'Prefiero penthouse', verified = fixture(current, ['property_options'])
  const original = structuredClone(verified), calls: string[] = [], contexts: Row[] = []
  const validReply = 'Continuamos con la opción elegida. '+bankQuestion
  const unwantedStatement = 'El penthouse 602 cuesta USD 550000'
  const badReply = unwantedStatement+'. Estos son los precios referenciales vigentes y pueden cambiar. '+validReply
  let drafts = 0, reviews = 0
  const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
    () => completeTurnReply({ current, baseReply: validReply, verified, history: historical,
      audit: { source: 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true,
        ...(mode === 'demonstration' ? { response_review_observation: { enabled: true, test_contact: true } } : {}) } },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      const context = object(raw)
      if (task === 'writing') {
        contexts.push(context)
        const refs = context.referencias_solicitud as Row[]
        return { reply: ++drafts === 1 ? badReply : validReply, question: bankMetadata,
          requests: refs.map(ref => ({ fragment: ref.id, intent: 'Selección de categoría', request_type: 'specific_fact',
            status: 'answered', evidence: 'Continuamos con la opción elegida.', fact_key: null })) }
      }
      const first = ++reviews === 1
      return { review_contract: 'business-risk-v2', verdict: first ? 'block' : 'pass',
        facts: first ? [{ statement: unwantedStatement, kind: 'catalog_value', subject_id: unit.id, scope: null,
          field: 'published_commercial_price', value: 550000, upper_value: null, relation: 'eq', unit: 'USD' }] : [],
        findings: first ? [{ category: 'turn_goal', statement: unwantedStatement,
          reason: 'response_content_scope: purchase_prices.allowed=false; a previously answered price was added instead of following only the current preference.',
          authoritative_fact: 'The current request selects a category; it does not request a price or compare a current budget.' }] : [],
        question: { ...bankMetadata, offered_action: 'none' } }
    }))
  assert.deepEqual(verified, original)
  assert.equal(topicAllowed(contexts[0], 'purchase_prices'), false)
  assert.equal(result.reply, mode === 'normal' ? validReply : badReply, JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(calls, mode === 'normal' ? ['writing', 'review', 'writing', 'review']
    : mode === 'disabled' ? ['writing'] : ['writing', 'review'])
  assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
  assert.deepEqual(object(verified.property_context).selected_ids, ['ph602'])
  assert.equal(leadBudget(verified).status, 'initial_capital')
})

import { writerFixture } from './fixtures/writer-response.fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'
import { deliveredPendingQuestion } from './continuation-question'
import { actualContinuation, continuationContentIssues, continuationMetadataIssues } from './continuation-validation'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'
import { commercialJourneyPlan } from './commercial-journey'
import { OpenAIRequestError } from './openai-request'
import { requireReviewedResponse, ResponseReviewRecoveryError } from './response-review-recovery'

const pass = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
const writer = (reply: string, question: Row) => (writerFixture({ reply, question, requests: [{ fragment: 'R1', intent: 'Atender consulta', request_type: 'general_information', status: 'answered', evidence: 'Respuesta contextual', fact_key: null }] }))
const profileQuestion = { purpose: 'collect_lead_profile', role: 'required_collection', missing_datum: 'Nombre y residencia', next_decision: 'Orientar necesidades', continuation_id: 'lead_profile', continuation_act: 'profile' }
const audit = { semantic_review_enabled: true, business_risk_review_enabled: true }
const profileAudit = { ...audit, profile_introduction: { question_purpose: 'collect_profile', generic_introduction: false, brochure_deferred: false } }

for (const scenario of [
  { id: 'lead_profile', act: 'profile', purpose: 'collect_lead_profile', question: '¿Cuál es su nombre y en qué ciudad vive actualmente?' },
  { id: 'budget_amount', act: 'budget', purpose: 'choose_property', question: '¿Tiene un presupuesto establecido?' },
  { id: 'property_floor', act: 'choose_floor', purpose: 'choose_property', question: '¿En qué planta le gustaría revisar las opciones?' },
  { id: 'property_purpose', act: 'choose_category', purpose: 'choose_property', question: '¿Lo busca para vivir o como inversión?' },
  { id: 'financing_invitation', act: 'financing', purpose: 'permission_to_continue', question: '¿Desea que continuemos con el proceso de financiamiento?' },
  { id: 'visit_date_time', act: 'visit', purpose: 'coordinate_visit', question: '¿Qué día y a qué hora le gustaría visitarnos?' },
]) test('review metadata cannot change the emitted '+scenario.id+' question without rewriting valid content', async () => {
  const reply = 'Con gusto podemos orientarle. '+scenario.question
  const question = { purpose: scenario.purpose, role: 'optional_continuation', missing_datum: 'Dato pendiente', next_decision: 'Continuar', continuation_id: scenario.id, continuation_act: scenario.act }
  const tasks: string[] = []
  let reviews = 0
  const result = await completeTurnReply({ current: 'Quiero conocer más', baseReply: reply, verified: {}, audit: scenario.id === 'lead_profile' ? profileAudit : audit }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    const context = object(raw)
    if (task === 'writing') return writer(reply, question)
    assert.equal(context.borrador, reply)
    if (++reviews === 1) return { ...pass }
    assert.ok(Array.isArray(context.comprobaciones_a_revisar))
    return { ...pass }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(object(result.audit.semantic_review).metadata_retries, 0)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(deliveredPendingQuestion(result.reply, { metadata: result.audit.question }).id, scenario.id)
})

test('a repaired writer preserves its profile metadata without another reviewer classification', async () => {
  const wrong = 'El precio del departamento es $999. ¿Cuál es su nombre y en qué ciudad vive actualmente?'
  const correct = 'El precio se verificará en el catálogo. ¿Cuál es su nombre y en qué ciudad vive actualmente?'
  const tasks: string[] = []
  let writes = 0, reviews = 0
  const result = await completeTurnReply({ current: 'Quiero información del departamento', baseReply: correct, verified: {}, audit: profileAudit }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    const context = object(raw)
    if (task === 'writing') return writer(++writes === 1 ? wrong : correct, profileQuestion)
    if (++reviews === 1) return { ...pass, verdict: 'block', findings: [{ category: 'hard_fact', statement: '$999', reason: 'Precio inventado', authoritative_fact: 'No hay precio verificado' }] }
    assert.equal(context.borrador, correct)
    return { ...pass }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, correct)
  assert.deepEqual(tasks, ['writing', 'review', 'writing', 'review'])
  assert.equal(object(result.audit.semantic_review).metadata_retries, 0)
  assert.equal((result.audit.repair_attempts as Row[]).length, 1)
  assert.equal(deliveredPendingQuestion(result.reply, { metadata: result.audit.question }).id, 'lead_profile')
})

test('an approved draft keeps validated writer metadata if optional reviewer metadata recovery is unavailable', async () => {
  const reply = 'Con gusto. ¿Cuál es su nombre y en qué ciudad vive actualmente?'
  let reviews = 0
  const result = await completeTurnReply({ current: 'Necesito información', baseReply: reply, verified: {}, audit: profileAudit }, async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    if (task === 'writing') return writer(reply, profileQuestion)
    if (++reviews > 1) throw new OpenAIRequestError(504, true, 1, 'timeout')
    return { ...pass }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.question).continuation_id, 'lead_profile')
  assert.equal(object(result.audit.semantic_review).metadata_retries, 0)
  assert.equal(deliveredPendingQuestion(result.reply, { metadata: result.audit.question }).id, 'lead_profile')
})

test('a concrete commercial block survives reviewer metadata repair', async () => {
  const reply = 'Su unidad ya está reservada. ¿Cuál es su nombre y en qué ciudad vive actualmente?'
  const result = await completeTurnReply({ current: 'Quiero saber de la unidad', baseReply: reply, verified: {}, audit }, async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    if (task === 'writing') return writer(reply, profileQuestion)
    return { ...pass, verdict: 'block', findings: [{ category: 'business_guardrail', statement: 'ya está reservada', reason: 'No existe reserva', authoritative_fact: 'Ninguna reserva confirmada' }] }
  })
  assert.notEqual(result.audit.status, 'checked')
  assert.equal(result.reply, reply, 'a blocked internal draft is not rewritten or replaced by server prose')
  assert.equal(object(result.audit.recovery).pending, true)
  assert.throws(() => requireReviewedResponse(result.audit), ResponseReviewRecoveryError)
})

test('the server does not veto writer questions through lexical inference when the factual reviewer passes', async () => {
  const wrong = 'Disponemos de departamentos de tres dormitorios. ¿Cuántos dormitorios necesita finalmente?'
  const correct = 'Disponemos de departamentos de tres dormitorios. ¿En qué planta le gustaría revisar las opciones?'
  const question = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Planta', next_decision: 'Mostrar unidades', continuation_id: 'property_floor', continuation_act: 'choose_floor' }
  const catalogo = [2,3].map(floor => ({ id: 'd'+floor+'02', unit_number: floor+'02', category: 'departamento', floor_number: floor, bedrooms: 3, is_published: true, status: 'disponible' }))
  let writes = 0
  const tasks: string[] = []
  const result = await completeTurnReply({ current: 'Necesito cinco, pero quiero conocer los de tres dormitorios', baseReply: correct,
    verified: { catalogo, recorrido_comercial: {}, lead: { purchase_purpose: 'vivir', preferred_category: 'departamento' },
      hechos_confirmados: { budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'Tengo un presupuesto total de 300000 dólares' } },
      property_context: { query: { category: 'departamento', group: 'residential', operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } } } }, audit },
  async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    if (task === 'writing') return writer(++writes === 1 ? wrong : correct, question)
    return { ...pass }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, wrong)
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(object(result.audit.question).continuation_id, 'property_floor')
})

test('unknown paraphrases are not relabeled from the plan and exploration is distinct from choosing a type', () => {
  const plan = { action: 'select_property', question_id: 'property_category', question_act: 'choose_category', question: '¿Prefiere departamentos o penthouses?' }
  assert.deepEqual(continuationContentIssues('¿Le gustaría revisar alternativas de tres dormitorios?', plan), [])
  assert.deepEqual(continuationContentIssues('¿Prefiere departamentos o penthouses?', plan), [])
  assert.ok(continuationMetadataIssues({ ...profileQuestion, continuation_act: 'choose_unit' }, '¿Cuál es su nombre y dónde vive actualmente?').length)
})

for (const [question, id] of [
  ['¿En qué planta le gustaría revisar los departamentos de tres dormitorios?', 'property_floor'],
  ['¿Cuál piso prefiere para revisar departamentos de 3 dormitorios?', 'property_floor'],
  ['¿Qué presupuesto contempla para revisar opciones de tres dormitorios?', 'budget_amount'],
  ['¿Desea revisar departamentos o penthouses de tres dormitorios?', 'property_category'],
  ['¿Cuál departamento o penthouse de tres dormitorios prefiere?', 'property_category'],
  ['¿Le gustaría que revisemos las alternativas de tres dormitorios en departamentos y penthouses?', 'property_requirements'],
] as const) test('a structured delivered question preserves '+id+' for this paraphrase: '+question, () => {
  const acts = { property_floor: 'choose_floor', budget_amount: 'budget', property_category: 'choose_category', property_requirements: 'explore_alternatives' }
  assert.deepEqual(actualContinuation(question), {}, 'the retired prose reader must remain inert')
  const saved = deliveredPendingQuestion(question, { metadata: { text: question, continuation_id: id,
    continuation_act: acts[id], purpose: 'choose_property' } })
  assert.equal(saved.id, id)
  assert.equal(saved.question, question)
})

test('writer metadata cannot be reclassified by a lexical system veto or by the factual reviewer', async () => {
  const reply = '¿Cuál es su nombre y dónde vive actualmente?'
  const wrong = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Unidad', next_decision: 'Continuar', continuation_id: 'unit_choice', continuation_act: 'choose_unit' }
  const result = await completeTurnReply({ current: 'No quiero dar datos, quiero información', baseReply: reply, verified: {}, audit }, async (_rules, _raw, _schema, _image, _file, _tone, task) => task === 'writing' ? writer(reply, wrong) : { ...pass })
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  const pending = deliveredPendingQuestion(result.reply, { metadata: result.audit.question })
  assert.equal(pending.id, 'unit_choice', 'the server cannot lexically replace the writer meaning')
  assert.equal(pending.question, reply)
})

test('the full completion route retains the proposal through 360, then a yes asks type and a department preference asks floor', async () => {
  const catalogo: Row[] = [
    { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2 },
    { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3 },
    { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6 },
    { id: 'd204', unit_number: '204', category: 'departamento', bedrooms: 2, floor_number: 2 },
  ]
  const original = { group: 'residential', category: null, scope: 'catalog', operation: 'search', filters: { bedrooms: 5, bedrooms_required: false } }
  let property: Row = { query: original, original_query: original, selected_ids: [], offered_ids: [], comparison_ids: [] }
  let pending: Row = { id: 'property_requirements', act: 'explore_alternatives', question: '¿Le gustaría revisar las opciones de tres dormitorios?',
    candidate_ids: ['d202', 'd302', 'p602'], proposed_query: { ...original, filters: { bedrooms: 3 } } }
  const turns = [
    { current: 'Bueno gracias, ¿cómo puedo ver el departamento?', category: 'departamento', operation: 'details', expected: 'property_requirements', act: 'explore_alternatives', answer: 'none', source: 'virtual_showroom' },
    { current: 'Sí', category: null, operation: 'none', expected: 'property_category', act: 'choose_category', answer: 'affirmative', source: 'catalog_search' },
    { current: 'Me interesan más los departamentos', category: 'departamento', operation: 'search', expected: 'property_floor', act: 'choose_floor', answer: 'value', source: 'catalog_search' },
  ]
  for (const turn of turns) {
    const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: turn.answer === 'none' ? 'project_information' : 'answer_previous', primary_evidence: turn.current, confidence: 'high',
      answer_to_previous: { question_id: pending.id, kind: turn.answer, evidence: turn.current, confidence: 'high' },
      property: { group: 'residential', category: turn.category, operation: turn.operation, filters: {}, query_scope: 'offered', reference_kind: 'followup', evidence: turn.current, confidence: 'high' } } }, turn.current, pending)
    const resolved = resolvePropertyTurn(catalogo, turn.current, { _property_context: property, _pending_question: pending }, [], semantics)
    const info: Row = { catalogo, catalogo_verificacion: catalogo, catalog_read: { complete: true }, recorrido_comercial: {},
      lead: { purchase_purpose: 'vivir' },
      hechos_confirmados: { budget: { status: 'maximum_total', amount: 700000, confidence: 'high', evidence: 'Tengo un presupuesto total de 700000 dólares' } },
      property_context: resolved.context, referencia_unidad: resolved, semantica_turno: semantics, financiamiento: { partners: [] } }
    const planned = commercialJourneyPlan(info)
    assert.equal(planned.question_id, turn.expected)
    const reply = 'Podemos revisar estas alternativas. '+String(planned.question)
    const question = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Decisión pendiente', next_decision: 'Continuar con las opciones', continuation_id: turn.expected, continuation_act: turn.act }
    const result = await completeTurnReply({ current: turn.current, baseReply: reply, verified: info, audit: { ...audit, source: turn.source,
      ...(turn.source === 'virtual_showroom' ? { unit_model: { unit_id: null } } : {}) } },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      if (task === 'writing') assert.equal(object(object(object(raw).contrato_redaccion).continuacion_del_turno).question_id, turn.expected)
      else assert.equal(object(object(raw).fuentes_autorizadas).siguiente_paso_comercial, undefined)
      return task === 'writing' ? writer(reply, question) : { ...pass }
    })
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(object(result.audit.question).continuation_id, turn.expected)
    pending = deliveredPendingQuestion(result.reply, { metadata: result.audit.question, plan: result.audit.commercial_journey }, catalogo)
    property = rememberPropertyReply(catalogo, resolved.context, result.reply, { pending_question: pending })
    assert.deepEqual(property.selected_ids, [])
    assert.equal(object(object(property.original_query).filters).bedrooms, 5)
    if (turn.expected !== 'property_requirements') assert.equal(object(object(property.query).filters).bedrooms, 3)
  }
})

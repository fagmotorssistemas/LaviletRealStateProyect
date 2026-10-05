import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'
import { BUSINESS_RISK_REVIEW_VERSION, businessRiskDecision } from './business-risk-review'
import { AIRequestGuardError, OpenAIRequestError } from './openai-request'
import { requireReviewedResponse, ResponseReviewRecoveryError } from './response-review-recovery'
import { validateCatalogReply } from './catalog-dialogue'
import { leadIntroductionTurn, rememberLeadIntroduction } from './lead-introduction'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const unit = { id: 'd202', unit_number: '202', category: 'departamento', status: 'disponible', is_published: true,
  area_internal_m2: 120.83, bedrooms: 3, floor_number: 2, published_commercial_price: 245123 }
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '' }
const pass = { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
const block = (category: string, statement: string, reason: string, authoritative_fact: string) => ({
  review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'block',
  facts: [], question: null,
  findings: [{ category, statement, reason, authoritative_fact }],
})
function writer(context: Row, reply: string): Row {
  const reference = rows(context.referencias_solicitud)[0]
  assert.ok(reference?.id)
  return { reply, requests: [{ fragment: reference.id, intent: 'Atender la consulta actual', request_type: 'general_information',
    status: 'answered', evidence: 'El mensaje responde a la consulta.', fact_key: null }], question: noQuestion }
}
function harness(handle: (context: Row, task: string) => Row) {
  const calls: { context: Row; task: string }[] = []
  const ajv = new Ajv({ allErrors: true })
  const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_instructions, input, schema, _image, _file, _tone, task = 'data') => {
    const context = object(input)
    calls.push({ context, task })
    const answer = handle(context, task)
    assert.ok(schema)
    const validate = ajv.compile(schema)
    assert.ok(validate(answer), ajv.errorsText(validate.errors))
    return answer
  }
  return { calls, generate }
}

test('outside-to-property transition carries both profile obligations through the live review contract and delivery memory', async () => {
  const current = 'disuculpe me equivoque de numero, si esta bien ayudame con informacion del prpyecto inmobiliario'
  const history = [{ role: 'cliente', content: 'Hola quiero informacion sobre vehiculos' },
    { role: 'bot', content: 'Solo puedo ofrecer información del proyecto inmobiliario La Vilet.' }]
  const opening = leadIntroductionTurn({ current, history, summary: {}, extracted: {},
    reply: 'La Vilet está en Cuenca.', audit: { source: 'project_overview' } })
  const reply = 'La Vilet está en Cuenca. Para compartirle el brochure y darle una guía personalizada, ¿cómo se llama y dónde vive actualmente?'
  const mock = harness((context, task) => {
    const obligations = rows(context.obligaciones_del_turno).map(row => row.id)
    assert.ok(obligations.includes('profile_full_name'))
    assert.ok(obligations.includes('profile_current_residence'))
    assert.equal(obligations.includes('profile_phone'), false)
    if (task === 'review') return pass
    return { ...writer(context, reply), question: { role: 'required_collection', purpose: 'collect_lead_profile',
      missing_datum: 'Nombre y residencia actual', next_decision: 'Compartir el brochure y orientar al cliente' } }
  })
  const result = await completeTurnReply({ current, history, baseReply: opening.reply,
    verified: { proyecto: { ubicacion: 'Cuenca' } },
    audit: { ...opening.audit, semantic_review_enabled: true, business_risk_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, `Con mucho gusto le comparto información. ${reply}`)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  const audit = { ...opening.audit, semantic_review_enabled: true, turn_completeness: result.audit }
  assert.deepEqual(rememberLeadIntroduction({ previous: {}, planned: opening.state, profile: {}, reply: result.reply, audit,
    accepted: false, followUpUsable: true }), {})
  const delivered = rememberLeadIntroduction({ previous: {}, planned: opening.state, profile: {}, reply: result.reply, audit,
    accepted: true, followUpUsable: true })
  assert.equal(delivered.collection_status, 'awaiting')
  assert.deepEqual(delivered.requested_fields, ['full_name', 'residence'])
})

test('a valid commercial draft passes the first review without sentence or numeric-ID sheets', async () => {
  const reply = 'El departamento 202 tiene 3 dormitorios, 120,83 m² interiores y un precio publicado de $245.123 USD.'
  const mock = harness((context, task) => {
    if (task === 'writing') return writer(context, reply)
    assert.equal(context.borrador, reply)
    assert.equal(rows(object(context.fuentes_autorizadas).unidades)[0].published_commercial_price, 245123)
    assert.equal('referencias_numericas' in context, false)
    assert.equal('oraciones_borrador' in context, false)
    assert.equal('evidencia_afirmaciones' in context, false)
    return pass
  })
  const result = await completeTurnReply({ current: '¿Cuánto cuesta el departamento 202?', baseReply: reply,
    verified: { catalogo: [unit], politica_comercial: { precios_autorizados: true } },
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review'])
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(object(result.audit.semantic_review).review_contract, BUSINESS_RISK_REVIEW_VERSION)
  assert.equal(validateCatalogReply(reply, { semantic_review: result.audit.semantic_review }).valid, true)
})

test('an invented price is blocked, corrected against the catalogue and reviewed once more', async () => {
  const wrong = 'El departamento 202 cuesta $245.124 USD.'
  const correct = 'El departamento 202 cuesta $245.123 USD.'
  let writes = 0
  const mock = harness((context, task) => {
    if (task === 'writing') {
      writes++
      if (writes === 2) assert.match(JSON.stringify(context.reparacion), /245\.123/)
      return writer(context, writes === 1 ? wrong : correct)
    }
    return context.borrador === wrong
      ? block('hard_fact', 'Precio de $245.124', 'No coincide con el precio publicado de esta unidad.', '$245.123 USD')
      : pass
  })
  const result = await completeTurnReply({ current: '¿Qué precio tiene el departamento 202?', baseReply: correct,
    verified: { catalogo: [unit], politica_comercial: { precios_autorizados: true } },
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, correct)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'writing', 'review'])
})

test('an approved model verdict cannot send a rounded surface absent from authorized facts', async () => {
  const rounded = 'El departamento 202 tiene 121 m² interiores.'
  const exact = 'El departamento 202 tiene 120,83 m² interiores.'
  let writes = 0
  const mock = harness((context, task) => task === 'writing' ? writer(context, ++writes === 1 ? rounded : exact)
    : { ...pass, facts: [{ statement: context.borrador, kind: 'catalog_value', subject_id: unit.id, scope: null,
      field: 'area_internal_m2', value: writes === 1 ? 121 : 120.83, upper_value: null, relation: 'eq', unit: 'm2' }] })
  const result = await completeTurnReply({ current: '¿Qué superficie tiene el departamento 202?', baseReply: exact,
    verified: { catalogo: [unit] }, audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, exact)
  assert.deepEqual(mock.calls.map(call => call.task), ['writing', 'review', 'review', 'writing', 'review'])
  assert.equal(rows(result.audit.repair_attempts)[0].target, 'review_metadata')
  assert.equal(rows(rows(result.audit.repair_attempts)[1].issues)[0].owner, 'system')
})

test('a material price error that remains unchanged is never sent', async () => {
  const wrong = 'El departamento 202 cuesta $245.124 USD.'
  const mock = harness((context, task) => task === 'writing' ? writer(context, wrong)
    : block('hard_fact', 'Precio de $245.124', 'Contradice la ficha.', '$245.123 USD'))
  const result = await completeTurnReply({ current: '¿Qué precio tiene el departamento 202?', baseReply: wrong,
    verified: { catalogo: [unit], politica_comercial: { precios_autorizados: true } },
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, mock.generate)
  assert.notEqual(result.audit.status, 'checked')
  assert.notEqual(result.reply, wrong)
  assert.throws(() => requireReviewedResponse(result.audit), ResponseReviewRecoveryError)
})

test('the same review gate catches unverified promises and missing turn obligations', async () => {
  for (const scenario of [
    { bad: 'Su departamento 202 ya quedó reservado.', good: 'Puedo ayudarle a consultar cómo reservar el departamento 202.',
      category: 'business_guardrail', fact: 'No hay reserva confirmada.' },
    { bad: 'La Vilet se encuentra en Puertas del Sol, Cuenca.',
      good: 'La Vilet se encuentra en Puertas del Sol, Cuenca. ¿Cuál es su nombre y dónde vive actualmente para compartirle el brochure y orientarle?',
      category: 'turn_goal', fact: 'La etapa exige pedir nombre y residencia actual.' },
  ]) {
    let writes = 0
    const mock = harness((context, task) => {
      if (task === 'writing') return writer(context, ++writes === 1 ? scenario.bad : scenario.good)
      if (scenario.category === 'turn_goal') assert.ok(rows(context.obligaciones_del_turno).some(row => row.id === 'profile_full_name'))
      return context.borrador === scenario.bad
        ? block(scenario.category, scenario.bad, 'El borrador incumple la regla aplicable.', scenario.fact) : pass
    })
    const result = await completeTurnReply({ current: 'Me interesa el proyecto.', baseReply: scenario.good,
      verified: { catalogo: [unit], proyecto: { ubicacion: 'Puertas del Sol, Cuenca' }, perfil_lead: {} },
      audit: { semantic_review_enabled: true, business_risk_review_enabled: true, ...(scenario.category === 'turn_goal' ? { source: 'project_overview',
        profile_introduction: { generic_introduction: true, question_purpose: 'collect_profile', brochure_deferred: true } } : {}) },
    }, mock.generate)
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, scenario.good)
  }
})

test('the short reviewer contract cannot veto style or invent cross-reference requirements', () => {
  assert.deepEqual(businessRiskDecision(pass), { valid: true, approved: true, findings: [] })
  assert.equal(businessRiskDecision({ review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'block',
    findings: [{ category: 'style', statement: 'Cambiar el saludo', reason: 'Suena mejor', authoritative_fact: '' }] }).valid, false)
  assert.equal(businessRiskDecision({ review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'block', findings: [] }).valid, false)
})

test('a reviewer transport failure propagates to operational recovery without rewriting the draft', async () => {
  for (const failure of [new OpenAIRequestError(0, true, 2, '', 'timeout'), new OpenAIRequestError(503, true, 2), new AIRequestGuardError()]) {
    const calls: string[] = []
    const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_instructions, input, _schema, _image, _file, _tone, task = 'data') => {
      calls.push(task)
      if (task === 'writing') return writer(object(input), 'La Vilet se encuentra en Cuenca.')
      throw failure
    }
    await assert.rejects(() => completeTurnReply({ current: 'Me interesa el proyecto.', baseReply: 'Información del proyecto.',
      verified: { proyecto: { ubicacion: 'Cuenca' } }, audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, generate), error => error === failure)
    assert.deepEqual(calls, ['writing', 'review'])
  }
})

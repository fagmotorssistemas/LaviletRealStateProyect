import assert from 'node:assert/strict'
import test from 'node:test'
import Ajv from 'ajv'
import { businessRiskReviewSchema, businessRiskContext, businessRiskDecision, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { REVIEWER_AUTHORITY_VERSION, factualReviewObligations, factualReviewResult } from './reviewer-authority'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'

const unit = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5,
  published_commercial_price: 310000, is_published: true, status: 'disponible' }
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const pass = { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
const audit = { semantic_review_enabled: true, business_risk_review_enabled: true }
const verified = { catalogo: [unit], hechos_confirmados: { property: { filters: { bedrooms: 3 } } },
  politica_comercial: { precios_autorizados: true, aviso_precios_referenciales: false },
  property_context: { selected_ids: ['u502'] } }

function writer(input: Row, reply: string) {
  return { reply, question: noQuestion, requests: (input.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id,
    intent: 'Responder la consulta', request_type: 'general_information', status: 'answered', evidence: 'Respuesta actual', fact_key: null })) }
}

test('the model schema excludes workflow vetoes and reviewer questions while preserving factual and promise findings', () => {
  const validate = new Ajv({ allErrors: true }).compile(businessRiskReviewSchema)
  assert.equal(validate(pass), true)
  assert.equal(validate({ ...pass, question: { ...noQuestion, offered_action: 'none' } }), false)
  for (const category of ['turn_goal', 'style', 'missing_profile', 'repetition']) assert.equal(validate({ ...pass, verdict: 'block',
    findings: [{ category, statement: 'Pregunta', reason: 'Cambie el siguiente paso', authoritative_fact: '' }] }), false)
  for (const category of ['hard_fact', 'business_guardrail']) assert.equal(validate({ ...pass, verdict: 'block',
    findings: [{ category, statement: 'Reserva confirmada', reason: 'No existe comprobante', authoritative_fact: 'Sin reserva' }] }), true)
})

test('reviewer inputs keep discount evidence and operational receipts but exclude client capture and next-step instructions', () => {
  const obligations = [{ id: 'commercial_next_step', question: '¿Cuántos dormitorios necesita?' },
    { id: 'profile_collection', required_data: ['full_name', 'current_residence'] },
    { id: 'early_purchase_discount', policy: { percent: 10, base_mode: 'included_in_catalog', instruction: 'Pida una reserva' } }]
  const context = businessRiskContext({ current: 'Me interesa el 502', reply: 'El 502 cuesta USD 310.000.', obligations, units: [unit], groups: [], projectFacts: [],
    claimSources: [{ path: 'contexto_verificado.siguiente_paso_comercial', kind: 'project_fact', value: obligations[0] },
      { path: 'materiales_configurados.brochure', kind: 'project_fact', value: { contains_floor_plans: true } }],
    verified: { ...verified, siguiente_paso_comercial: obligations[0] },
    audit: { reservation: { request_id: 'r1', handoff_verified: true, inventory_reserved: false }, profile_introduction: obligations[1] }, allowedLinks: [] })
  assert.equal(context.mensaje_actual, undefined)
  assert.equal(object(context.reviewer_authority).version, REVIEWER_AUTHORITY_VERSION)
  assert.equal(object(context.fuentes_autorizadas).siguiente_paso_comercial, undefined)
  assert.equal(object(context.estado_del_turno).introduccion, undefined)
  assert.equal(object(object(context.estado_del_turno).reserva).inventory_reserved, false)
  assert.equal((context.obligaciones_del_turno as Row[]).length, 1)
  assert.equal(object((context.obligaciones_del_turno as Row[])[0].policy).percent, 10)
  assert.equal(JSON.stringify(context).includes('¿Cuántos dormitorios necesita?'), false)
  assert.ok(JSON.stringify(context).includes('contains_floor_plans'))
  assert.equal(factualReviewObligations(obligations).some(row => row.id === 'profile_collection'), false)
})

test('an out-of-contract flow rejection cannot rewrite valid content, change the saved question or create an advisor gap', async () => {
  const reply = 'El departamento 502, de tres dormitorios, cuesta USD 310.000.'
  const calls: string[] = []
  const result = await completeTurnReply({ current: '¿Qué precio tiene el 502?', baseReply: reply, verified, audit }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    calls.push(String(task)); const input = object(raw)
    if (task === 'writing') return writer(input, reply)
    return { ...pass, verdict: 'block', findings: [{ category: 'turn_goal', statement: reply,
      reason: 'Debe preguntar dormitorios antes de seguir', authoritative_fact: 'discover_bedrooms' }],
      question: { ...noQuestion, purpose: 'choose_property', continuation_id: 'property_bedrooms', continuation_act: 'confirm_bedrooms' },
      missing_fact_fragments: ['¿Qué precio tiene el 502?'] }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, false)
  assert.equal(object(result.audit.question).purpose, 'none')
  assert.equal(object(result.audit.semantic_review).reviewer_authority, REVIEWER_AUTHORITY_VERSION)
  assert.equal((object(result.audit.semantic_review).ignored_findings as Row[])[0].category, 'turn_goal')
})

for (const defect of ['price', 'reservation']) test(`a real ${defect} defect still requires a corrected writer draft`, async () => {
  const bad = defect === 'price' ? 'El departamento 502 cuesta USD 250.000.' : 'El departamento 502 ya está reservado para usted.'
  const good = defect === 'price' ? 'El departamento 502 cuesta USD 310.000.' : 'Podemos ayudarle a iniciar la solicitud de reserva del departamento 502.'
  let writes = 0; const calls: string[] = []
  const result = await completeTurnReply({ current: 'Quisiera información del 502', baseReply: good, verified, audit }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    calls.push(String(task)); const input = object(raw)
    if (task === 'writing') return writer(input, ++writes === 1 ? bad : good)
    if (input.borrador !== bad) return pass
    return { ...pass, verdict: 'block', findings: [{ category: defect === 'price' ? 'hard_fact' : 'business_guardrail', statement: bad,
      reason: defect === 'price' ? 'El precio no coincide con el catálogo' : 'No existe reserva confirmada',
      authoritative_fact: defect === 'price' ? 'Precio publicado USD 310.000' : 'Sin comprobante de reserva' }] }
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, good)
  assert.deepEqual(calls, defect === 'reservation' ? ['writing', 'writing', 'review'] : ['writing', 'review', 'writing', 'review'])
  assert.equal(result.needsAdvisor, false)
})

test('legacy reviewer fields cannot generate capture, omission or advisor controls', async () => {
  const reply = 'Con gusto, podemos orientarle sobre las opciones.'
  const result = await completeTurnReply({ current: 'Quiero información', baseReply: reply, verified: {}, audit: { source: 'commercial' } }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    if (task === 'writing') return writer(object(raw), reply)
    return { answers_supported: true, all_requests_considered: false, operational_goal_preserved: false, question_has_purpose: false,
      answered_content_preserved: false, missing_fact_fragments: ['Quiero información'],
      review_issues: [{ check: 'operational_goal_preserved', kind: 'content', source: 'current_request', fragment: 'R1', reason: 'Derive al asesor y pida datos' }],
      question: { purpose: 'offer_advisor', role: 'required_collection', missing_datum: 'Nombre', next_decision: 'Derivar' } }
  })
  assert.equal(result.needsAdvisor, false, JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(result.unresolved, [])
  assert.equal(factualReviewResult({ missing_fact_fragments: ['consulta'], question: { purpose: 'offer_advisor' } }).question, null)
  const decision = businessRiskDecision({ ...pass, verdict: 'block', findings: [{ category: 'turn_goal', statement: 'Pregunta', reason: 'Cambie la pregunta' }] })
  assert.equal(decision.approved, true)
})

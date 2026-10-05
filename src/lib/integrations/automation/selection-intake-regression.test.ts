import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { normalizeTurnSemantics } from './turn-semantics'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { catalogDialogueReply, filterCatalog, catalogQuery } from './catalog-dialogue'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { financingInputs, financingPartnerAnswer } from './financing'
import { financingIdentity, financingDocument } from './financing-identity'
import { financingCollection, personalDataFragments } from './financing-intake'
import { financingStage } from './financing-stage'
import { assessMissingFacts } from './coverage-evidence'
import { unresolvedChoice } from './conversation-next-step'
import { completeTurnReply } from './turn-completeness'
import { businessRiskSchemaForSources, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { validateBusinessFacts } from './business-facts'

const units: Row[] = [
  ...[3, 4, 5].map(floor => ({ id: `d${floor}04`, unit_number: `${floor}04`, category: 'departamento',
    bedrooms: 2, bathrooms_full: 2, floor_number: floor, area_internal_m2: 109.69, area_exterior_m2: 34.59,
    published_commercial_price: 210000 + 20000 * floor })),
  ...[['601', 106.58, 21.42], ['603', 109.69, 34.59], ['604', 99.71, 25.37], ['606', 124.41, 27.93]].map(([number, inside, outside]) => ({
    id: `p${number}`, unit_number: number, category: 'penthouse', bedrooms: 2, bathrooms_full: 2, floor_number: 6,
    area_internal_m2: inside, area_exterior_m2: outside, published_commercial_price: 405000,
  })),
]
const finance = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: { accepted: true } }
const baseQuery = { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 2 } }
const baseInfo = (): Row => ({ catalogo: units, politica_comercial: { precios_autorizados: true }, catalog_read: { complete: true },
  lead: { purchase_purpose: 'vivir' }, perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
  property_context: { query: baseQuery, selected_ids: [] }, financiamiento: finance, recorrido_comercial: {},
  hechos_confirmados: { budget: { status: 'amount', amount: 200000, confidence: 'high', evidence: 'tengo 200 mil' } } })

test('bedroom evidence keeps all compatible types and inherits only a previously chosen category', () => {
  const current = 'prefiero algo de 2 dormitorios'
  const semantics = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', category: 'departamento', operation: 'select', reference_kind: 'none',
      filters: { bedrooms: 2 }, evidence: current, confidence: 'high' },
  } }, current, { id: 'property_bedrooms' })
  assert.equal(object(semantics.property).category, null)
  assert.equal(object(semantics.property).operation, 'search')
  const reference = resolvePropertyTurn(units, current, { _property_context: { query: { group: 'residential' } } }, [], semantics)
  const candidates = filterCatalog(units, catalogQuery(reference.query))
  assert.equal(candidates.length, 7)
  const response = catalogDialogueReply({ ...baseInfo(), referencia_unidad: reference, property_context: reference.context, semantica_turno: semantics }, current)!
  assert.match(response.reply, /departamentos.*penthouses/)
  assert.match(response.reply, /En qué planta/)
  assert.doesNotMatch(response.reply, /304|404|504|601|603|604|606/)
  assert.equal(object(response.audit.progressive_selection).stage, 'choose_floor')
  const remembered = resolvePropertyTurn(units, current, { _property_context: { query: { group: 'residential', category: 'departamento' } } }, [], semantics)
  assert.equal(object(remembered.query).category, 'departamento')
})

test('a floor with a single compatible unit shows its features and protected 360 link without selecting it', () => {
  const pending = { id: 'property_floor', act: 'choose_floor', question: '¿En qué planta le gustaría revisar las opciones?', candidate_ids: units.map(u => u.id) }
  const current = 'prefiero en la quinta planta alta'
  const semantics = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', operation: 'select', reference_kind: 'none', filters: { floor_number: 5 }, evidence: current, confidence: 'high' },
    answer_to_previous: { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' },
  } }, current, pending)
  const reference = resolvePropertyTurn(units, current, { _property_context: { query: baseQuery, offered_ids: units.map(u => u.id), selected_ids: [], pending_question: pending } }, [], semantics)
  assert.deepEqual(reference.context.selected_ids, [])
  const info = { ...baseInfo(), referencia_unidad: reference, property_context: reference.context, semantica_turno: semantics }
  const response = catalogDialogueReply(info, current)!
  assert.match(response.reply, /departamento 504/i)
  assert.match(response.reply, /109[.,]69.*34[.,]59/)
  assert.match(response.reply, /tour\?unidad=504/)
  assert.equal(object(response.audit.unit_model).delivery_required, true)
  assert.deepEqual(response.audit.selected_unit_ids, [])
  assert.equal(financingStage(info).collection_allowed, false)
  const plan = commercialJourneyPlan(info)
  assert.equal(plan.question_act, 'confirm_unit')
  const saved = rememberPropertyReply(units, reference.context, response.reply, response.audit)
  assert.deepEqual(saved.selected_ids, [])
  const followup = journeyPendingQuestion(String(plan.question), plan, true)
  const yes = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: 'si claro', confidence: 'high',
    answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', evidence: 'si claro', confidence: 'high' } } }, 'si claro', followup)
  const selected = resolvePropertyTurn(units, 'si claro', { _property_context: saved, _pending_question: followup }, [], yes)
  assert.deepEqual(selected.context.selected_ids, ['d504'])
  assert.equal(financingStage({ ...info, property_context: selected.context, referencia_unidad: selected }).collection_allowed, true)
})

test('several units on a chosen floor show their own dimensions and numbers, without sending several tours', () => {
  const query = { ...baseQuery, filters: { bedrooms: 2, floor_number: 6 } }
  const result = catalogDialogueReply({ ...baseInfo(), property_context: { query }, referencia_unidad: { query } })!
  for (const code of ['601', '603', '604', '606']) assert.ok(result.reply.includes(code))
  for (const measurement of ['106,58', '109,69', '99,71', '124,41']) assert.ok(result.reply.includes(measurement))
  assert.doesNotMatch(result.reply, /https?:/)
  assert.equal(object(result.audit.pending_question).act, 'choose_unit')
  assert.equal(unresolvedChoice('si hay una unidad que me interesa revisar primero', object(result.audit.pending_question))?.question,
    '¿Cuál de las unidades le interesa revisar primero?')
  assert.ok(unresolvedChoice('si claro', object(result.audit.pending_question)))
})

test('JEP is intake data when answering the actual lender question even if primary intent says ask_financing', () => {
  const current = 'gracias, prefieoro jep', pending = { id: 'financing_partner', act: 'financing' }
  const extracted = { financing_partner: 'Cooperativa JEP', turn_semantics: normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'ask_financing', confidence: 'high', primary_evidence: current,
    answer_to_previous: { question_id: pending.id, kind: 'value', confidence: 'high', evidence: current },
  } }, current, pending) }
  const input = financingInputs(extracted, current, '¿Con cuál entidad desea continuar?', finance)
  assert.equal(input.partner, 'Cooperativa JEP')
  assert.equal(financingPartnerAnswer(extracted, input), true)
  assert.equal(input.consent, null)
  const question = { financing_partner: 'Cooperativa JEP', turn_semantics: { primary_intent: 'ask_financing',
    answer_to_previous: { question_id: 'none', kind: 'none', confidence: 'high' } } }
  assert.equal(financingPartnerAnswer(question, financingInputs(question, '¿Qué ofrece JEP?', '', finance)), false)
  assert.equal(financingPartnerAnswer({ turn_semantics: { answer_to_previous: { question_id: 'financing_data', kind: 'value', confidence: 'high' } } }, input), false)
})

test('invalid identity remains a clarification with all basic pending fields, never a business-gap handoff', async () => {
  const current = 'me llamo Carlos\n\n01020304051'
  const identity = financingIdentity({}, { given_names: 'Carlos', evidence: 'me llamo Carlos' }, current)
  const document = financingDocument('01020304051', current)
  const fin = { state: 'nombre_pendiente', selected_partner_name: 'Cooperativa JEP', full_name: 'Carlos', legal_name_confirmed: false }
  const intake = financingCollection(fin, identity, document, finance.partners)
  assert.deepEqual(intake.collection.requested_fields, ['legal_name', 'national_id', 'applicant_type'])
  assert.match(intake.reply, /diez dígitos.*nombres y apellidos.*dependencia/)
  assert.doesNotMatch(intake.reply, /RUC|01020304051|asesor|entidad desea/)
  const audit = { source: 'financing', semantic_review_enabled: true, business_risk_review_enabled: true,
    financing_collection: { ...intake.collection, client_data_fragments: personalDataFragments(current, identity, document) } }
  assert.deepEqual(assessMissingFacts([current], audit).unresolved, [])
  assert.deepEqual(assessMissingFacts(['¿Qué comisión cobra el banco?'], audit).unresolved, ['¿Qué comisión cobra el banco?'])
  const mixed = current + '\n¿Cuánto cuesta el seguro?'
  assert.deepEqual(assessMissingFacts([mixed], { ...audit, financing_collection: {
    ...intake.collection, client_data_fragments: personalDataFragments(mixed, identity, document) } }).unresolved, [mixed])
  const calls: string[] = []
  const result = await completeTurnReply({ current, baseReply: intake.reply, audit,
    verified: { ...baseInfo(), property_context: { selected_ids: ['d504'] } } },
  async (_rules, input, _schema, _image, _file, _tone, task) => {
    calls.push(String(task))
    if (task === 'writing') return { reply: intake.reply, requests: [{ fragment: 'R1', intent: 'Aportar identidad', request_type: 'general_information',
      status: 'missing_fact', fact_key: 'other', evidence: 'La cédula tiene once dígitos' }],
      question: { role: 'required_collection', purpose: 'collect_financing_required', missing_datum: 'identidad y empleo', next_decision: 'seguir recopilando' } }
    const obligations = object(input).obligaciones_del_turno as Row[]
    assert.equal(obligations.find(o => o.id === 'financing_collection')?.selected_partner, 'Cooperativa JEP')
    return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
  })
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(calls, ['writing', 'review'])
  const valid = financingCollection({ ...fin, national_id: '0102030405' }, identity, { status: 'accepted' }, finance.partners)
  assert.deepEqual(valid.collection.requested_fields, ['legal_name', 'applicant_type'])
  assert.doesNotMatch(valid.reply, /número de cédula/)
})

test('the generation contract prevents missing catalog subjects and self-comparison of a declared budget', () => {
  const validate = new Ajv({ allErrors: true }).compile(businessRiskSchemaForSources(units, []))
  const fact = { kind: 'catalog_value', statement: 'Dos dormitorios', subject_id: 'd504', scope: null,
    field: 'bedrooms', value: 2, upper_value: null, relation: 'eq', unit: 'count' }
  const review = { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [fact], question: null }
  assert.equal(validate(review), true)
  assert.equal(validate({ ...review, facts: [{ ...fact, subject_id: null }] }), false)
  assert.equal(validate({ ...review, facts: [{ ...fact, subject_id: 'invented-unit' }] }), false)
  const budgetFact = { ...fact, kind: 'lead_budget', subject_id: null, field: 'amount', value: 200000, unit: 'USD', statement: 'Presupuesto de 200 mil' }
  assert.equal(validate({ ...review, facts: [budgetFact] }), true)
  assert.equal(validate({ ...review, facts: [{ ...budgetFact, relation: 'lt' }] }), false)
  assert.equal(validateBusinessFacts([{ ...fact, value: 3 }], units, [], {})[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([{ ...fact, field: 'published_commercial_price', value: 290000, unit: 'USD' }], units, [], {})[0].status, 'contradiction')
})

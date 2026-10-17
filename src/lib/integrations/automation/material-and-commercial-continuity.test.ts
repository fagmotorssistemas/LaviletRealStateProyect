import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { typedTurnFixture } from './fixtures/typed-turn.fixture'
import { brochureDeliveryIntent, BROCHURE_URL } from './project-material'
import { leadIntroductionTurn, rememberLeadIntroduction } from './lead-introduction'
import { finalWriterContract, replyLinkContract } from './response-plan'
import { commercialJourneyPlan } from './commercial-journey'
import { validateBusinessScope } from './business-scope'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { propertyAnswerConsistencyIssues } from './interpretation-consistency'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { confirmedInterpretationMemory } from './interpretation-memory'

const prior: Row = { version: 3, status: 'pending', presentation_sent: true, request_sent: true,
  requested_fields: ['full_name', 'residence'], reminder_count: 0, brochure_sent: false }
const pending: Row = { id: 'property_category', act: 'choose_category', question: '¿Le interesa una vivienda o un local comercial?' }
const contentQuestion = 'Qué incluye ese brochure para ver si le comparto mi información'
function material(current: string, kind = 'inquiry') {
  return typedTurnFixture(current, { material_request: { kind, evidence: current, confidence: 'high' } })
}
const query = (current: string, raw: Row, previous = prior, profile: Row = {}) => leadIntroductionTurn({
  current, extracted: raw, profile, summary: { _lead_introduction: previous }, reply: 'Incluye información del proyecto y planos.',
})
function delivered(previous: Row, result: ReturnType<typeof leadIntroductionTurn>) {
  return rememberLeadIntroduction({ previous, planned: result.state, profile: {}, reply: result.reply,
    accepted: true, followUpUsable: true, audit: { ...result.audit, turn_completeness: {
      status: 'review_disabled', writer_receipts: { brochure_shared: false },
      review_control: { enabled: false, source: 'project_setting' }, final_validation: { passed: true, policy: 'transport_only' },
    } } })
}

test('a brochure contents question preserves the profile decision and creates no delivery obligation', () => {
  const raw = material(contentQuestion), result = query(contentQuestion, raw)
  assert.equal(brochureDeliveryIntent(contentQuestion, [], raw).reason, 'content_inquiry')
  assert.equal(object(result.audit.profile_introduction).brochure_required, false)
  assert.equal(result.state.brochure_decision_pending, true)
  assert.equal(result.state.status, 'pending')
  assert.equal(object(result.audit.profile_collection_decision).action, 'defer')
  assert.equal(result.state.reminder_count, 0)
  const links = replyLinkContract('', result.audit)
  assert.ok(!links.allowed_links.includes(BROCHURE_URL))
  assert.deepEqual(links.required_links, [])
  const contract = finalWriterContract('', result.audit)
  assert.equal(object(object(contract.estado_comercial).brochure).accion, 'explain_content')
  assert.equal(object(object(contract.estado_comercial).brochure).url, null)
  const plan = commercialJourneyPlan({}, result.audit)
  assert.equal(plan.action, 'answer_material_question')
  assert.equal(plan.question_id, '')
})

test('saved uncertainty survives a later acknowledgement and an unrelated commercial inquiry', () => {
  const first = query(contentQuestion, material(contentQuestion)), saved = delivered(prior, first)
  assert.equal(saved.brochure_decision_pending, true)
  assert.equal(saved.brochure_sent, false)
  assert.equal(saved.request_sent, true)
  for (const current of ['Oh ya', '¿Y qué precio tiene?']) {
    const next = query(current, material(current, 'none'), saved)
    assert.equal(object(next.audit.profile_introduction).brochure_required, false)
    assert.equal(next.state.brochure_decision_pending, true)
    assert.equal(next.state.reminder_count, 0)
    assert.ok(!replyLinkContract('', next.audit).allowed_links.includes(BROCHURE_URL))
  }
})

test('an actual courtesy interpretation retains the brochure wait in the writer and link contracts', () => {
  const current = 'Oh ya', raw = material(current, 'none')
  raw.communication = { kind: 'courtesy_only', evidence: current, confidence: 'high', greeting_present: false }
  const result = query(current, raw, { ...prior, brochure_decision_pending: true })
  assert.equal(result.state.brochure_decision_pending, true)
  assert.equal(result.state.reminder_count, 0)
  assert.equal(object(object(finalWriterContract('', result.audit).estado_comercial).brochure).accion, 'wait_for_decision')
  assert.ok(!replyLinkContract('', result.audit).allowed_links.includes(BROCHURE_URL))
})

for (const kind of ['inquiry', 'defer']) test('a material decision requires current evidence: ' + kind, () => {
  assert.equal(brochureDeliveryIntent('Otra consulta', [], material('Texto histórico', kind)).reason, 'not_requested')
})

test('an explicit material request releases the wait without requiring profile disclosure', () => {
  const current = 'Envíemelo por favor', result = query(current, material(current, 'request'), { ...prior, brochure_decision_pending: true })
  assert.equal(result.state.brochure_decision_pending, false)
  assert.equal(object(result.audit.profile_introduction).brochure_required, true)
  assert.ok(replyLinkContract('', result.audit).required_links.includes(BROCHURE_URL))
})

const profile: Row = { full_name: 'Elena', name_status: 'confirmed', residence_city: 'Loja', residence_status: 'confirmed',
  sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Elena' },
    residence_city: { source: 'lead_declaration', evidence: 'resido en Loja' } }, evidence: { full_name: 'Soy Elena' } }
test('confirmed complete profile releases the wait and delivers in the same turn', () => {
  const current = 'Soy Elena y resido en Loja', raw = material(current, 'none')
  raw.lead_profile = profile
  const result = query(current, raw, { ...prior, brochure_decision_pending: true }, profile)
  assert.equal(result.state.brochure_decision_pending, false)
  assert.equal(object(result.audit.profile_introduction).brochure_required, true)
  assert.equal(object(result.audit.profile_collection_decision).action, 'complete')
})

test('a partial name answer allows only the missing residence reminder while retaining the wait', () => {
  const current = 'Soy Elena', raw = material(current, 'none')
  const name = { ...profile, residence_city: null, residence_status: 'unknown', sources: { full_name: profile.sources && object(profile.sources).full_name } }
  raw.lead_profile = name
  const result = query(current, raw, { ...prior, brochure_decision_pending: true }, name)
  assert.equal(object(result.audit.profile_collection_decision).action, 'remind')
  assert.deepEqual(object(result.audit.profile_collection_decision).allowed_fields, ['current_residence'])
  assert.equal(object(result.audit.profile_introduction).brochure_required, false)
})

test('postponing material is respected even with a complete profile and does not invent a content inquiry', () => {
  const current = 'El brochure me lo manda después', result = query(current, material(current, 'defer'), prior, profile)
  const contract = finalWriterContract('', result.audit)
  assert.equal(result.state.brochure_delivery_postponed, true)
  assert.equal(object(result.audit.profile_introduction).material_question, false)
  assert.equal(object(object(contract.estado_comercial).brochure).accion, 'wait_for_decision')
  assert.ok(!replyLinkContract('', result.audit).allowed_links.includes(BROCHURE_URL))
  const next = query('¿Qué opciones tienen?', material('¿Qué opciones tienen?', 'none'), result.state, profile)
  assert.equal(object(next.audit.profile_introduction).brochure_required, false)
  const accepted = query('Ahora sí envíemelo', material('Ahora sí envíemelo', 'request'), next.state, profile)
  assert.equal(object(accepted.audit.profile_introduction).brochure_required, true)
  assert.equal(accepted.state.brochure_delivery_postponed, false)
})

test('explicit profile refusal retains the authorized exception without pretending profile completion', () => {
  const current = 'Prefiero no compartir mis datos', raw = material(current, 'none')
  raw.lead_profile = { name_response: { status: 'declined', confidence: 'high', evidence: current }, residence_status: 'declined' }
  const result = query(current, raw, { ...prior, brochure_decision_pending: true })
  assert.equal(result.state.brochure_decision_pending, false)
  assert.equal(object(result.audit.profile_collection_decision).action, 'declined')
})

test('overlapping mixed-domain evidence is invalid instead of an instruction to strip a choice', () => {
  const current = 'bueno me interesa algo comercial'
  const result = validateBusinessScope({ kind: 'mixed', confidence: 'high', property_fragments: ['me interesa algo comercial'],
    outside_subject: 'algo comercial', outside_source: 'current', ambiguous_price_reference: false }, current)
  assert.equal(result.uncertain, true)
  assert.equal(result.boundary_invalid, true)
  assert.equal(result.property_message, '')
})

test('independent mixed requests retain their disjoint literal boundary', () => {
  const current = 'Quiero un local y además vender mi moto'
  const result = validateBusinessScope({ kind: 'mixed', confidence: 'high', property_fragments: ['Quiero un local'],
    outside_subject: 'vender mi moto', outside_source: 'current', ambiguous_price_reference: false }, current)
  assert.equal(result.kind, 'mixed')
  assert.equal(result.uncertain, false)
})

test('repeated text can identify a disjoint outside occurrence without judging its meaning', () => {
  const current = 'Mi local tiene acceso para motos y además quiero comprar motos'
  const result = validateBusinessScope({ kind: 'mixed', confidence: 'high', property_fragments: ['Mi local tiene acceso para motos'],
    outside_subject: 'motos', outside_source: 'current', ambiguous_price_reference: false }, current)
  assert.equal(result.kind, 'mixed')
  assert.equal(result.uncertain, false)
})

const catalog: Row[] = [{ id: 'local1', category: 'local', unit_number: 'L01', status: 'disponible', is_published: true,
  published_commercial_price: 155000, area_internal_m2: 70 }]
function spaceAnswer(current: string, group = 'commercial', category: string | null = 'local') {
  const raw = typedTurnFixture(current)
  Object.assign(object(raw.turn_semantics), { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: pending.id, kind: 'value', confidence: 'high', evidence: current },
    property: { ...object(object(raw.turn_semantics).property), operation: 'search', group, category, confidence: 'high', evidence: current } })
  return raw
}
test('a contextual commercial choice advances and survives a later detail inquiry', () => {
  const current = 'bueno me interesa algo comercial', raw = spaceAnswer(current)
  const resolved = resolvePropertyTurn(catalog, current, {}, [], raw.turn_semantics, pending)
  const saved = rememberPropertyReply(catalog, resolved.context, 'Tenemos locales comerciales.', { pending_question: {} })
  const memory = confirmedInterpretationMemory(rememberInterpretedTurn({}, current, raw, object(raw.turn_semantics)))
  for (const info of [
    { semantica_turno: raw.turn_semantics, property_context: resolved.context },
    { semantica_turno: {}, property_context: saved, hechos_confirmados: memory },
  ]) {
    const plan = commercialJourneyPlan({ ...info, catalogo: catalog, lead: {}, mensaje_actual: current })
    assert.notEqual(plan.action, 'discover_use')
    assert.notEqual(plan.question_id, 'property_category')
  }
  assert.equal(resolved.query.group, 'commercial')
})
test('a residential broad choice advances without selecting a residential category', () => {
  const current = 'Para vivienda', raw = spaceAnswer(current, 'residential', null)
  assert.deepEqual(propertyAnswerConsistencyIssues(raw, current, pending), [])
  const plan = commercialJourneyPlan({ semantica_turno: raw.turn_semantics, catalogo: catalog, lead: {}, mensaje_actual: current })
  assert.notEqual(plan.action, 'discover_use')
  assert.equal(object(object(raw.turn_semantics).property).category, null)
})
test('a typed category answer lacking its property meaning is repaired without touching permissions', async () => {
  const current = 'bueno me interesa algo comercial', broken = spaceAnswer(current)
  object(broken.turn_semantics).property = object(typedTurnFixture(current).turn_semantics).property
  const originalAuthority = structuredClone(broken.action_authority)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending, historial: [], resumen: {} }, {
    activePrompt: async () => 'Extract current typed meaning.',
    aiJson: async (_rules, _input, schema) => {
      if (++calls === 1) return broken
      assert.equal(object(schema?.properties).action_authority, undefined)
      assert.ok(object(object(object(schema?.properties).turn_semantics).properties).answer_to_previous)
      return { ...spaceAnswer(current), recovery_outcome: 'repaired' }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.property).group, 'commercial')
  assert.deepEqual(result.extracted.action_authority, { ...object(originalAuthority), status: 'valid' })
})

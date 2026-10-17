import assert from 'node:assert/strict'
import test from 'node:test'
import { typedTurnFixture } from './fixtures/typed-turn.fixture'
import { object, type Row } from './data'
import { taskVerifiedContext } from './task-context'
import { semanticCatalogContext } from './semantic-catalog-context'
import { interactionGoalIssues, interactionMode } from './interaction-mode'
import { leadIntroductionTurn, rememberLeadIntroduction } from './lead-introduction'
import { interpretConversationTurn } from './turn-interpretation'
import { reviewedPauseRepair } from './reviewed-pause-repair'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { visitPreferenceFixture } from './fixtures/visit-preference.fixture'
import { resolveCatalogReference } from './catalog-reference'
import { normalizeTurnSemantics } from './turn-semantics'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { commercialJourneyPlan } from './commercial-journey'
import { catalogQuery, filterCatalog } from './catalog-dialogue'

const facts: Row = {
  proyecto: { name: 'La Vilet', description: 'Proyecto de uso mixto en Cuenca.' }, catalogo: [],
  instalaciones: [
    { id: 'security', amenity_name: 'Sistemas de seguridad 24h', description: 'Vigilancia permanente y sistemas de monitoreo' },
    { id: 'rest', amenity_name: 'Espacios de descanso', description: 'Zonas para esparcimiento' },
    { id: 'access', amenity_name: 'Ascensores', description: 'Accesos independientes para viviendas y comercios' },
  ],
  contexto_sector: [{ id: 'sector', description: 'Sector residencial y comercial' }],
  lugares_cercanos: [{ id: 'park', name: 'Parque' }],
  politicas_negocio: [{ id: 'reservation', topic: 'reserva', policy: 'Solicitud sujeta a gestión del equipo' }],
}
const request = (current: string, topics = ['project_overview']) => ({ domain: 'property', topics,
  request: current, evidence: current, confidence: 'high' })
const goal = (overrides: Row = {}) => ({ mode: 'unchanged', qualification_decision: 'unchanged', mode_evidence: '',
  catalog_scope: 'current', scope_evidence: '', excluded_categories: [], specific_topic: true,
  topic_evidence: 'Quiero información', confidence: 'high', ...overrides })

for (const current of ['pero es una zona segura ?', '¿Cómo protegen a quienes viven allí?', 'no me da confianza']) {
  test('security evidence survives paraphrases on both context paths: ' + current, () => {
    const requests = [request(current, ['location', 'property_features'])]
    const verified = { ...facts, solicitudes_interpretadas: requests, semantica_turno: { primary_intent: 'project_information' },
      catalog_context_scope: { kind: 'semantic_candidates' } }
    for (const context of [taskVerifiedContext(verified, {}, current),
      semanticCatalogContext(verified, { catalog_retrieval: { applied: true } }, current)]) {
      assert.deepEqual(context.instalaciones, facts.instalaciones)
      assert.deepEqual(context.politicas_negocio, facts.politicas_negocio)
      assert.deepEqual(context.contexto_sector, facts.contexto_sector)
    }
  })
}

test('ordinary overview preserves the introduction, brochure offer and missing profile collection', () => {
  const current = 'Saludos\nQuieor información porfavor', raw = typedTurnFixture(current)
  raw.requests = [request(current)]
  Object.assign(object(raw.turn_semantics), { primary_intent: 'project_information', primary_evidence: current,
    confidence: 'high', interaction_goal: goal({ topic_evidence: current }) })
  const mode = interactionMode({}, raw.turn_semantics)
  const result = leadIntroductionTurn({ current, reply: 'El proyecto combina viviendas y espacios comerciales.',
    extracted: raw, audit: { source: 'project_overview' }, projectInfo: facts, engagement: { interaction_mode: mode } })
  assert.equal(mode.mode, 'guided_search')
  assert.equal(result.applied, true)
  assert.equal(object(result.audit.profile_collection_decision).action, 'capture')
  assert.deepEqual(object(result.audit.profile_collection_decision).allowed_fields, ['full_name', 'current_residence'])
  assert.equal(object(result.audit.profile_introduction).brochure_deferred, true)
})

test('volunteered complete profile finishes the brochure exchange after unusable question metadata', () => {
  const current = 'Quiero información', raw = typedTurnFixture(current)
  raw.requests = [request(current)]
  Object.assign(object(raw.turn_semantics), { primary_intent: 'project_information', primary_evidence: current, confidence: 'high' })
  const introduction = leadIntroductionTurn({ current, extracted: raw, reply: '', projectInfo: facts })
  const question = '¿Cómo se llama y dónde reside actualmente?'
  const saved = rememberLeadIntroduction({ previous: {}, planned: introduction.state, profile: {}, reply: question,
    accepted: true, followUpUsable: true, audit: { ...introduction.audit, turn_completeness: {
      status: 'review_disabled', review_control: { enabled: false, source: 'project_setting' },
      final_validation: { passed: true, policy: 'transport_only' }, writer_receipts: { project_presented: true },
      question: { text: question, purpose: 'collect_lead_profile', continuation_id: 'lead_profile_name', continuation_act: 'profile' } } } })
  assert.equal(saved.presentation_sent, true)
  assert.equal(saved.request_sent, false, 'invalid metadata must not invent an authorized delivered question')
  const answer = 'Me llamo Elena y resido actualmente en Loja'
  const profile = { full_name: 'Elena', name_status: 'confirmed', residence_city: 'Loja', residence_status: 'confirmed',
    sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Elena' },
      residence_city: { source: 'lead_declaration', evidence: 'resido actualmente en Loja' } }, evidence: { full_name: 'Me llamo Elena' } }
  const response = typedTurnFixture(answer, { lead_profile: profile })
  object(response.turn_semantics).primary_intent = 'answer_previous'
  const result = leadIntroductionTurn({ current: answer, extracted: response, profile,
    summary: { _lead_introduction: saved }, reply: '', projectInfo: facts })
  assert.equal(result.applied, true)
  assert.equal(object(result.audit.profile_introduction).brochure_required, true)
  assert.equal(object(result.audit.profile_collection_decision).action, 'complete')
  assert.equal(object(result.audit.profile_introduction).question_purpose, 'none')
})

test('contextual unit numbers do not become a newly explicit reference', () => {
  const current = '¿Qué cambia entre las dos opciones?', units = [{ id: 'u602', unit_number: '602' }, { id: 'u605', unit_number: '605' }]
  const reference = resolveCatalogReference(units, current, {}, [], { property: { unit_numbers: ['602', '605'],
    reference_kind: 'comparison', evidence: current, confidence: 'high' } })
  assert.equal(reference.hasUnitMention, false)
  assert.equal(reference.explicit, false)
})

test('people and suitability roles cannot overwrite the selected bedroom requirement', () => {
  const current = '¿Alcanzarían tres dormitorios para seis personas?'
  const raw = typedTurnFixture(current)
  Object.assign(object(raw.turn_semantics), { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
    housing_quantities: [{ dimension: 'people', values: [6], role: 'context', count_basis: 'total', evidence: 'seis personas', confidence: 'high' },
      { dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'total', evidence: 'tres dormitorios', confidence: 'high' }],
    property: { operation: 'details', reference_kind: 'followup', filters: { bedrooms: 3 },
      filter_evidence: { bedrooms: 'tres dormitorios' }, evidence: current, confidence: 'high' } })
  const semantics = normalizeTurnSemantics(raw, current, {})
  assert.equal(object(semantics.household).occupants, 6)
  assert.equal(object(object(semantics.property).filters).bedrooms, null)
})

for (const [questionId, act] of [['property_requirements', 'explore_alternatives'], ['property_category', 'explore_alternatives'],
  ['property_bedrooms', 'confirm_bedrooms']]) for (const choosesCategory of [false, true]) test('accepting a structured alternative precedes generic search: ' + questionId + '/' + act + '/category=' + choosesCategory, () => {
  const units = [{ id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3 },
    { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3 },
    { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3 }]
  const original = { group: 'residential', category: 'departamento', scope: 'catalog', operation: 'search',
    filters: { bedrooms: 5 }, requirements: [{ field: 'bedrooms', operator: 'eq', value: 5,
      upper_value: null, strength: 'required', evidence: 'cinco dormitorios' }] }
  const pending = { id: questionId, act, candidate_ids: units.map(unit => unit.id),
    proposed_query: { group: 'residential', category: null, scope: 'catalog', operation: 'search', filters: { bedrooms: 3, bedrooms_required: false } } }
  const current = choosesCategory ? 'Sí, prefiero penthouses de tres dormitorios' : 'Sí, podemos revisar opciones de tres dormitorios', raw = typedTurnFixture(current)
  Object.assign(object(raw.turn_semantics), { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' },
    property: { group: 'residential', category: choosesCategory ? 'penthouse' : null, operation: 'search', query_scope: 'offered', reference_kind: 'followup',
      filters: {}, evidence: current, confidence: 'high' },
    catalog_request: { version: 'catalog-request-v1', purpose: 'search', metric: null,
      requirements: [], semantic_preferences: [], evidence: current, confidence: 'high' } })
  if (choosesCategory) object(raw.turn_semantics).category_choice = { kind: 'selected', category: 'penthouse', evidence: current, confidence: 'high' }
  const accepted = resolvePropertyTurn(units, current, { _pending_question: pending,
    _property_context: { query: original, pending_question: pending } }, [], normalizeTurnSemantics(raw, current, pending))
  assert.equal(accepted.reason, act === 'confirm_bedrooms' ? 'accepted_bedroom_confirmation' : 'accepted_alternative_query')
  assert.equal(object(accepted.query.filters).bedrooms, 3)
  assert.equal(accepted.query.category, choosesCategory ? 'penthouse' : null)
  assert.equal(accepted.query.requirements, undefined)
  assert.equal(object(object(accepted.context.exploration_state).accepted_filters).bedrooms, 3)
  assert.equal(object(object(accepted.context.original_query).filters).bedrooms, 5, 'the original need remains historical')
  assert.deepEqual(accepted.context.selected_ids, [])
  const saved = rememberPropertyReply(units, accepted.context, 'Podemos revisar las opciones de tres dormitorios.', {
    source: 'catalog_search', catalog_query: accepted.query, offered_unit_ids: units.map(unit => unit.id), pending_question: {} })
  const next = 'Prefiero penthouse porque busco más espacio'
  const reference = resolvePropertyTurn(units, next, { _property_context: saved }, [], {
    primary_intent: 'select_property', primary_evidence: next, confidence: 'high',
    property: { category: 'penthouse', operation: 'search', reference_kind: 'followup', query_scope: 'offered',
      filters: {}, evidence: next, confidence: 'high' } })
  assert.deepEqual(filterCatalog(units, catalogQuery(reference.query)).map(unit => unit.id), ['p602', 'p605'])
  assert.equal(reference.query.requirements, undefined)
  const plan = commercialJourneyPlan({ catalogo: units, catalog_read: { complete: true },
    property_context: reference.context, referencia_unidad: reference })
  assert.notEqual(plan.action, 'clarify_requirements')
})

test('a pause requires its own explicit AI decision; a later information query preserves a genuine pause', () => {
  const paused = interactionMode({}, { interaction_goal: goal({ mode: 'information_only', qualification_decision: 'pause',
    mode_evidence: 'No quiero preguntas comerciales por ahora' }) })
  assert.equal(paused.mode, 'information_only')
  assert.equal(interactionMode(paused, { interaction_goal: goal() }).mode, 'information_only')
  assert.equal(interactionMode({}, { interaction_goal: goal({ mode: 'information_only', mode_evidence: 'Quiero información' }) }).mode, 'guided_search')
  assert.equal(interactionMode(paused, { interaction_goal: goal({ mode: 'guided_search', qualification_decision: 'resume',
    mode_evidence: 'Quiero que me recomiende opciones para comprar' }) }).mode, 'guided_search')
})

test('a contradictory interaction goal is repaired independently, preserving profile and action authority', async () => {
  const current = 'Quiero información', raw = typedTurnFixture(current)
  raw.requests = [request(current)]
  Object.assign(object(raw.turn_semantics), { primary_intent: 'project_information', primary_evidence: current,
    confidence: 'high', interaction_goal: goal({ mode: 'information_only', mode_evidence: current, specific_topic: false }) })
  const authority = structuredClone(raw.action_authority)
  assert.deepEqual(interactionGoalIssues(raw, current), ['inconsistent_interaction_goal:interaction_goal'])
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async (_instructions, _input, schema) => {
      if (++calls === 1) return raw
      assert.equal(Object.hasOwn(object(schema?.properties), 'action_authority'), false)
      assert.deepEqual(Object.keys(object(object(object(schema?.properties).turn_semantics).properties)), ['interaction_goal'])
      return { recovery_outcome: 'repaired', turn_semantics: { interaction_goal: goal() } }
    },
  })
  assert.equal(calls, 2)
  assert.deepEqual(result.extracted.action_authority, { ...object(authority), status: 'valid' })
  assert.equal(interactionMode({}, result.semantics).mode, 'guided_search')
  assert.equal(result.requests[0].topics?.[0], 'project_overview')
})

test('an unresolved interaction contradiction cannot reach planning with an arbitrary pause', async () => {
  const current = 'Quiero información', raw = typedTurnFixture(current)
  object(raw.turn_semantics).interaction_goal = goal({ mode: 'information_only', mode_evidence: current })
  let calls = 0
  await assert.rejects(interpretConversationTurn({ mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => { calls++; return raw },
  }), /TURN_INTERPRETATION_INVALID/)
  assert.equal(calls, 2)
})

test('visit source repair receives the original message text and the provider schema permits only actual message IDs', async () => {
  const current = 'A las tres de la tarde', raw = typedTurnFixture(current)
  raw.visit_preference = visitPreferenceFixture({ evidence: current, time: { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' },
    source: { kind: 'current', message_id: 'current:1' } })
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, source_message_id: 'real-message', source_at: '2026-10-16T21:00:00Z',
    current_messages: [{ external_message_id: 'real-message', content: current, sent_at: '2026-10-16T21:00:00Z' }] }, {
    activePrompt: async () => '', aiJson: async (_rules, input, schema) => {
      const sourceSchema = object(object(object(object(schema?.properties).visit_preference).properties).source)
      assert.deepEqual(object(object(sourceSchema.properties).message_id).enum, ['real-message', null])
      if (++calls === 1) return raw
      assert.equal(object((object(input).current_messages as Row[])[0]).content, current)
      return { recovery_outcome: 'repaired', visit_preference: { ...object(raw.visit_preference),
        source: { kind: 'current', message_id: 'real-message' } }, visit_preferences: [] }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(object(result.extracted.visit_preference).source).message_id, 'real-message')
  assert.equal(object(object(result.extracted.visit_preference).time).hour, 3)
})

test('reviewed pause repair changes only the reviewed mode and its dependent passive flag', () => {
  const mode = { version: 'interaction-mode-v1', mode: 'information_only', evidence: 'Quiero información' }
  const summary = { _interaction_mode: mode, _sales_memory: { interaction_mode: mode, passive_sales: true, financing_mentioned: true },
    _lead_profile: { full_name: 'Elena' }, _property_context: { selected_ids: ['u605'] },
    _reservation_operation: { request_id: 'reserve', active: true } }
  const before = structuredClone(summary)
  const result = reviewedPauseRepair(summary, { evidence: 'Quiero información', sourceEventId: 'reviewed-event' }, '2026-10-16T23:00:00Z')
  assert.equal(result.applicable, true)
  assert.equal(object(result.summary._interaction_mode).mode, 'guided_search')
  assert.equal(object(result.summary._sales_memory).passive_sales, false)
  assert.equal(object(result.summary._sales_memory).financing_mentioned, true)
  for (const key of ['_lead_profile', '_property_context', '_reservation_operation']) assert.deepEqual(result.summary[key], summary[key as keyof typeof summary])
  assert.deepEqual(summary, before)
})

for (const [name, summary] of Object.entries({
  changed_evidence: { _interaction_mode: { mode: 'information_only', evidence: 'No quiero preguntas de compra' } },
  verified_pause: { _interaction_mode: { mode: 'information_only', qualification_decision: 'pause', evidence: 'Quiero información' } },
  active_nurture: { _interaction_mode: { mode: 'information_only', evidence: 'Quiero información' }, _lead_nurture: { active: true } },
  no_pause: { _interaction_mode: { mode: 'guided_search' } },
})) test('reviewed repair preserves a different or genuine decision: ' + name, () => {
  const result = reviewedPauseRepair(summary, { evidence: 'Quiero información', sourceEventId: 'reviewed-event' }, '2026-10-16T23:00:00Z')
  assert.equal(result.applicable, false)
  assert.deepEqual(result.summary, summary)
})

test('production consumers explicitly pass interpreted context after the prose readers were retired', () => {
  const arities: Record<string, number> = { explicitlyRequestsVisit: 2, hasUnrelatedAppointmentTarget: 2,
    isCourtesyOnly: 2, asksVisitStatus: 3, needsVisitHelp: 2, isVisitDetail: 2, visitTurnIntent: 2,
    asksTeamAttendance: 2, statedBudget: 2, unitModelDelivery: 5 }
  const directory = 'src/lib/integrations/automation', omissions: string[] = []
  const names = readdirSync(directory).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  const program = ts.createProgram(names.map(name => join(directory, name)), { noResolve: true, skipLibCheck: true })
  const checker = program.getTypeChecker()
  for (const name of names) {
    const ast = program.getSourceFile(join(directory, name))!
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && checker.getSymbolAtLocation(node.expression)?.declarations?.some(declaration => ts.isImportSpecifier(declaration))
        && node.arguments.length < (arities[node.expression.text] || 0))
        omissions.push(name + ':' + (ast.getLineAndCharacterOfPosition(node.getStart()).line + 1) + ' ' + node.getText(ast))
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  assert.deepEqual(omissions, [], 'An interpreted decision must not silently become false because its consumer omitted the metadata')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn } from './turn-interpretation'
import { interpretationInput } from './turn-interpretation-input'
import { resolvePropertyTurn } from './property-context'

const catalog: Row[] = [
  { id: 'p602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 142.09, status: 'disponible' },
  { id: 'p601', unit_number: '601', category: 'penthouse', floor_number: 6, bedrooms: 2, area_internal_m2: 110, status: 'disponible' },
]
const pending = { id: 'financing_invitation', act: 'financing', question: '¿Desea iniciar la revisión de financiamiento?', target_ids: ['p602'], candidate_ids: [] }
const state: Row = { version: 2, selected_ids: ['p602'], offered_ids: ['p602'], comparison_ids: [], focused_ids: ['p602'],
  pending_question: pending, query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected', filters: { bedrooms: 3 } } }
const request = (evidence: string): Row => ({ domain: 'property', request: evidence, evidence, confidence: 'high' })
function extraction(message: string): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [request(message)]
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'project_information'
  semantics.primary_evidence = message
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }
  Object.assign(object(semantics.property), { group: 'residential', operation: 'details', reference_kind: 'followup',
    query_scope: 'selected', unit_numbers: ['602'], evidence: message, confidence: 'high' })
  return raw
}
async function interpret(message: string, raw: Row, changes: Row = {}) {
  const original = structuredClone(raw)
  const context = { mensaje_actual: message, pregunta_pendiente: pending, contexto_propiedades: state,
    resumen: { _property_context: state, _pending_question: pending }, catalogo_unidades: catalog, ...changes }
  const originalContext = structuredClone(context)
  let calls = 0
  const result = await interpretConversationTurn(context, { activePrompt: async () => 'Extractor', aiJson: async rules => {
    calls++
    assert.ok(rules.includes('NECESIDADES Y EVALUACIÓN'), 'The semantic needs contract must reach the extractor')
    assert.ok(rules.includes('SITUACIONES PERSONALES'), 'Current-turn interpretation must preserve the same boundary')
    return raw
  } })
  assert.equal(calls, 1)
  assert.deepEqual(raw, original)
  assert.deepEqual(context, originalContext)
  return result
}

for (const message of [
  'Tengo una cama king y dos camas individuales. ¿Caben en esa unidad dejando paso al clóset?',
  'Tengo 70 años. ¿Cómo es el acceso y la circulación en esa unidad?',
  'Uso silla de ruedas. ¿Cómo es el acceso a esa unidad?',
  'Tengo dos perros. ¿Permiten mascotas en esa unidad?',
  'Tengo dos niños. ¿Cómo podemos distribuirnos en esa unidad?',
]) test('a personal needs query keeps the chosen subject and pending commercial decision: ' + message, async () => {
  const raw = extraction(message)
  // A mistaken action claim must not turn an informative question into consent.
  raw.financing_consent = true
  raw.requested_advisor = true
  raw.action_evidence = { requested_advisor: message, opt_out: null, consent_granted: null }
  raw.events = ['requested_visit']
  raw.visit_intent = { kind: 'request_visit', purpose: 'coordination', target: 'project', destination: 'office', evidence: message, confidence: 'high' }
  const result = await interpret(message, raw)
  assert.equal(object(result.semantics.property).operation, 'details')
  assert.equal(object(result.semantics.property).query_scope, 'selected')
  assert.deepEqual(result.semantics.housing_quantities, [])
  assert.equal(object(result.semantics.answer_to_previous).kind, 'none')
  assert.notEqual(result.extracted.financing_consent, true)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.visit_intent, null)
  assert.ok(!(result.extracted.events as string[]).includes('requested_visit'))
  assert.deepEqual(result.requests.map(row => row.evidence), [message])
  const resolved = resolvePropertyTurn(catalog, message, { _property_context: state, _pending_question: pending }, [], result.semantics)
  assert.deepEqual(resolved.context.selected_ids, ['p602'])
  assert.deepEqual(resolved.matches.map(row => row.id), ['p602'])
  assert.equal(resolved.query.filters.bedrooms, 3, 'Known requirements remain in state without becoming new declarations')
  assert.deepEqual(resolved.context.pending_question, pending)
})

test('evaluating three bedrooms for six people cannot create a replacement bedroom requirement', async () => {
  const message = 'Somos seis. ¿Alcanzarán tres dormitorios en esa unidad?', raw = extraction(message)
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  semantics.housing_quantities = [
    { dimension: 'people', values: [6], role: 'context', count_basis: 'total', evidence: 'Somos seis', confidence: 'high' },
    { dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'unspecified', evidence: '¿Alcanzarán tres dormitorios en esa unidad?', confidence: 'high' },
  ]
  Object.assign(object(property.filters), { bedrooms: 3 })
  Object.assign(object(property.filter_evidence), { bedrooms: 'tres dormitorios' })
  const result = await interpret(message, raw)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
  assert.equal(object(result.semantics.household).occupants, 6)
  assert.equal((result.semantics.housing_quantities as Row[])[1].role, 'evaluation')
  assert.equal(object(result.semantics.answer_to_previous).kind, 'none')
  const resolved = resolvePropertyTurn(catalog, message, { _property_context: state }, [], result.semantics)
  assert.deepEqual(resolved.context.selected_ids, ['p602'])
  assert.deepEqual(resolved.matches.map(row => row.id), ['p602'])
  assert.deepEqual(resolved.context.pending_question, pending)
})

test('multiple needs questions and an unanswered earlier query preserve their own evidence and shared referent', async () => {
  const furniture = '¿Caben dos camas individuales en esa unidad?', pets = '¿Permiten mascotas?', previous = '¿Qué incluye la terraza?'
  const message = furniture + ' ' + pets, raw = extraction(message)
  raw.requests = [request(furniture), request(pets), request(previous)]
  const queued = [{ message_id: 'pending-terrace', content: previous }]
  const result = await interpret(message, raw, { consultas_pendientes: queued })
  assert.deepEqual(result.requests.map(row => row.evidence), [furniture, pets, previous])
  assert.equal(result.requests[2].source, 'pending')
  assert.equal(result.requests[2].source_message_id, 'pending-terrace')
  assert.deepEqual(object(result.semantics.property).unit_numbers, ['602'])
  assert.equal(object(result.semantics.answer_to_previous).kind, 'none')
  const compact = interpretationInput({ contexto_propiedades: state, pregunta_pendiente: pending, consultas_pendientes: queued }, message)
  assert.deepEqual(compact.consultas_pendientes, queued)
  assert.deepEqual(object(compact.contexto_propiedades).selected_ids, ['p602'])
  assert.deepEqual(compact.pregunta_pendiente, pending)
})

test('a personal situation beside an explicit minimum bedroom request preserves only the actual restriction', async () => {
  const evidence = 'Busco al menos tres dormitorios', message = 'Tengo dos niños. ' + evidence, raw = extraction(message)
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  semantics.housing_quantities = [{ dimension: 'bedrooms', values: [3], role: 'requirement', count_basis: 'unspecified', evidence, confidence: 'high' }]
  Object.assign(property, { category: null, operation: 'search', reference_kind: 'none', query_scope: 'catalog', unit_numbers: [] })
  Object.assign(object(property.filters), { bedrooms: 3, bedrooms_operator: 'gte' })
  Object.assign(object(property.filter_evidence), { bedrooms: evidence, bedrooms_operator: evidence })
  raw.catalog_request = { purpose: 'search', metric: null, requirements: [{ field: 'bedrooms', operator: 'gte', value: 3,
    upper_value: null, strength: 'required', evidence }], semantic_preferences: [], evidence, confidence: 'high' }
  const result = await interpret(message, raw)
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 3)
  assert.equal(object(object(result.semantics.property).filters).bedrooms_operator, 'gte')
  assert.equal(object(object(result.semantics.property).filters).bedrooms_required, null)
  assert.equal(object(result.semantics.household).occupants, undefined, 'Two children do not establish a total household size')
  assert.equal(object(result.semantics.answer_to_previous).kind, 'none')
})

for (const scope of ['offered', 'comparison']) test('an accessibility question retains the scope of the presented alternatives: ' + scope, async () => {
  const message = 'Tengo movilidad reducida. ¿Cuál de esas opciones tiene acceso más cómodo?', raw = extraction(message)
  const property = object(object(raw.turn_semantics).property)
  Object.assign(property, { operation: 'compare', reference_kind: 'comparison', query_scope: scope, unit_numbers: ['602', '601'] })
  const known = { ...state, selected_ids: [], offered_ids: ['p602', 'p601'],
    comparison_ids: scope === 'comparison' ? ['p602', 'p601'] : [], focused_ids: [] }
  const result = await interpret(message, raw, { contexto_propiedades: known, resumen: { _property_context: known } })
  assert.equal(object(result.semantics.property).operation, 'compare')
  assert.equal(object(result.semantics.property).query_scope, scope)
  assert.deepEqual(object(result.semantics.property).unit_numbers, ['602', '601'])
  assert.equal(object(object(result.semantics.property).filters).floor_number, null)
  assert.equal(object(result.semantics.answer_to_previous).kind, 'none')
  assert.deepEqual(result.semantics.housing_quantities, [])
})

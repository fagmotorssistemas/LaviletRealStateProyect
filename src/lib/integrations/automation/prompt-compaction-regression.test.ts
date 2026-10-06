import assert from 'node:assert/strict'
import test from 'node:test'
import { compactTurnPromptContext } from './turn-prompt-context'
import { TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { TURN_SEMANTIC_EXTRACTION_RULES } from './turn-semantics'
import { object, type Row } from './data'

// Resolve the model's internal references independently of the compactor. A
// cycle, dangling path or missing value fails instead of silently disappearing.
function expanded(value: unknown, root: Row, stack: string[] = []): unknown {
  if (Array.isArray(value)) return value.map(entry => expanded(entry, root, stack))
  if (!value || typeof value !== 'object') return value
  const row = object(value)
  if (Object.keys(row).length === 1 && typeof row.ref === 'string') {
    assert.ok(!stack.includes(row.ref), `cyclic reference: ${row.ref}`)
    const target = row.ref.split('.').reduce<unknown>((entry, key) => object(entry)[key], root)
    assert.notEqual(target, undefined, `dangling reference: ${row.ref}`)
    return expanded(target, root, [...stack, row.ref])
  }
  if (row.unit_ref) {
    const units = object(root.evidencia_turno).units as Row[]
    const target = units.find(unit => unit.id === row.unit_ref)
    assert.ok(target)
    const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'unit_ref'))
    return expanded({ ...target, ...rest }, root, stack)
  }
  return Object.fromEntries(Object.entries(row).map(([key, entry]) => [key, expanded(entry, root, stack)]))
}

const stages = [
  ['lead_profile', 'collect_profile'], ['lead_profile_name', 'collect_name'],
  ['lead_profile_residence', 'collect_residence'], ['lead_residence_confirmation', 'confirm_residence'],
  ['property_category', 'choose_category'], ['property_floor', 'choose_floor'],
  ['property_bedrooms', 'choose_bedrooms'], ['property_area', 'collect_area'],
  ['property_requirements', 'explore_alternatives'], ['unit_choice', 'choose_unit'],
  ['budget_amount', 'collect_budget'], ['budget_kind', 'clarify_budget'],
  ['financing_invitation', 'offer_financing'], ['financing_partner', 'choose_partner'],
  ['financing_data', 'collect_financing_data'], ['visit_invitation', 'offer_visit'],
  ['visit_date_time', 'collect_visit_date'], ['purchase_timing', 'collect_timing'],
]

for (const [id, act] of stages) for (const complete of [false, true]) {
  test(`lossless shared state: ${id}; complete=${complete}`, () => {
    const pending = { id, act, candidate_ids: ['d302', 'p602'], target_ids: [],
      question: '¿Le interesa revisar estas alternativas antes de continuar con el siguiente paso?',
      proposed_query: { filters: { bedrooms: 3 }, operation: 'details', scope: 'offered' } }
    const query = { filters: { bedrooms: 5, min_area_m2: 0, bedrooms_required: false },
      operation: 'search', scope: 'catalog', requirements: [{ field: 'bedrooms', value: 5,
        evidence: 'unos 5 cuartos', strength: 'required' }] }
    const requests = [{ domain: 'property', request: '¿Qué precios tienen las opciones propuestas?',
      evidence: '¿Qué precios tienen las opciones propuestas?', confidence: 'high' },
    { domain: 'financing', request: '¿Qué entrada exige JEP?', evidence: '¿Qué entrada exige JEP?', confidence: 'high' }]
    const next = { allowed: false, partner: 'Cooperativa JEP', consent: false,
      missing_fields: ['legal_full_name', 'applicant_type'], rationale: 'La consulta informativa no autoriza iniciar una evaluación financiera.' }
    const source: Row = { property_context: { query, pending_question: pending },
      contrato_turno: { pending_question: pending, requests, next_financing_step: next },
      estado_operativo: { pending_question: pending, query, next_financing_step: next },
      contexto_verificado: { another_request: { pending_question: pending, query, requests, next_financing_step: next },
        catalog_read: { complete }, authorized_links: ['https://example.invalid/tour/302'],
        national_id: '0109876543', legal_full_name: null, contact_name: 'Carlos' },
      historial_reciente: [{ content: '¿Qué precios tienen las opciones propuestas?' }],
      evidencia_turno: { units: [{ id: 'd302', unit_number: '302', bedrooms: 3, published_commercial_price: 300000 },
        { id: 'p602', unit_number: '602', bedrooms: 3, published_commercial_price: null }], groups: [] } }
    const saved = JSON.stringify(source)
    const before = compactTurnPromptContext(source, { preserveUnitIds: true, deduplicateSharedState: false })
    const after = compactTurnPromptContext(source, { preserveUnitIds: true, deduplicateSharedState: true })
    assert.deepEqual(expanded(after, after), expanded(before, before))
    assert.equal(JSON.stringify(source), saved, 'memory and validation remain intact')
    assert.ok(JSON.stringify(after).length < JSON.stringify(before).length)
  })
}

test('conflicting, incomplete and tiny state is never collapsed into another decision', () => {
  const query = { operation: 'details', scope: 'offered', filters: { bedrooms: 3 },
    evidence: 'Consultar lo propuesto sin aceptar la alternativa ni elegir una unidad.' }
  const source = { property_context: { query }, contexto_verificado: {
    query: { ...query, filters: { bedrooms: 5 } }, readiness: { allowed: false },
    pending_question: { id: 'none' }, unknown: null, empty: [], price: 0 },
  estado_operativo: { readiness: { allowed: true }, pending_question: { id: 'none' } } }
  const result = compactTurnPromptContext(source, { preserveUnitIds: true })
  assert.deepEqual(result, source)
})

test('array references, forward canonical references and repeated parent state remain acyclic', () => {
  const requests = [{ request: 'No deseo una visita, solo quiero información de los precios.',
    domain: 'property', confidence: 'high', evidence: 'solo quiero información de los precios' }]
  const pending = { id: 'property_requirements', act: 'explore_alternatives', requests }
  const contract = { requests, pending_question: pending }
  const source = { contexto_verificado: { contrato_turno: contract, requests }, contrato_turno: contract,
    property_context: { pending_question: pending }, estado_operativo: { pending_question: pending } }
  const before = compactTurnPromptContext(source, { preserveUnitIds: true, deduplicateSharedState: false })
  const after = compactTurnPromptContext(source, { preserveUnitIds: true, deduplicateSharedState: true })
  assert.deepEqual(expanded(after, after), expanded(before, before))
})

test('semantic format uses the actual strict schema while preserving domain distinctions', () => {
  assert.match(TURN_SEMANTIC_EXTRACTION_RULES, /esquema JSON estricto adjunto/)
  assert.doesNotMatch(TURN_SEMANTIC_EXTRACTION_RULES, /con esta forma:/)
  for (const rule of ['Nunca convierta personas en dormitorios', 'answer_to_previous',
    'bedrooms_operator', 'reservation', 'ACTUAL', 'proposed_query']) {
    assert.ok(TURN_SEMANTIC_EXTRACTION_RULES.includes(rule), rule)
  }
  const semantics = object(object(TURN_EXTRACTION_SCHEMA.properties).turn_semantics)
  for (const key of ['primary_intent', 'housing_quantities', 'answer_to_previous', 'reservation', 'property', 'budget']) {
    assert.ok(object(semantics.properties)[key], key)
    assert.ok((semantics.required as string[]).includes(key), key)
  }
})

test('production keeps the prior context; extended semantic references require an explicit experimental opt-in', () => {
  const query = { operation: 'details', scope: 'offered', filters: { bedrooms: 3 },
    evidence: 'Consultar alternativas propuestas sin aceptar el cambio del requisito original.' }
  const source = { property_context: { query }, estado_operativo: { query } }
  assert.deepEqual(compactTurnPromptContext(source), compactTurnPromptContext(source, { deduplicateSharedState: false }))
  assert.deepEqual(compactTurnPromptContext(source), source)
  assert.deepEqual(object(compactTurnPromptContext(source, { deduplicateSharedState: true }).estado_operativo).query,
    { ref: 'property_context.query' })
})

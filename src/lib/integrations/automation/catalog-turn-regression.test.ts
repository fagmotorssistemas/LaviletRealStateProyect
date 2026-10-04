import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { normalizeTurnSemantics } from './turn-semantics'
import { resolvePropertyTurn } from './property-context'
import { catalogDialogueReply, catalogQuery, partitionCatalog } from './catalog-dialogue'
import { retrieveCatalogByEmbeddings } from './catalog-embeddings'
import { turnBudgetAssessment } from './turn-budget'
import { reviewObligations } from './focused-review'
import { resolveCatalogRequirements, completeCatalogResult } from './catalog-result'
import { validateBusinessFacts } from './business-facts'
import { completeTurnReply } from './turn-completeness'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import profileFixture from './fixtures/extractor-profile-turn.json'

// Sanitized regression: an exterior-local search followed by a residential
// requirement. Identifiers are synthetic; no lead profile or production writes.
const message = 'Bueno busco algo de mínimo 3 cuartos y en los pisos superiores, tengo un presupuesto de unos 200 mil.'
const requirement = (field: string, operator: string, value: number, strength = 'required'): Row => ({
  field, operator, value, upper_value: null, strength, evidence: field === 'bedrooms' ? 'mínimo 3 cuartos' : 'pisos superiores',
})
const req: Row = { version: 'catalog-request-v1', purpose: 'search', metric: null, confidence: 'high', evidence: message,
  requirements: [requirement('bedrooms', 'gte', 3), requirement('floor_number', 'gte', 1, 'preferred')],
  semantic_preferences: ['en los pisos superiores'] }
const units: Row[] = [
  { id: 'local', unit_number: 'LC01', category: 'local', bedrooms: null, floor_number: 1, area_exterior_m2: 30, published_commercial_price: 145000 },
  { id: 'small', unit_number: '201', category: 'departamento', bedrooms: 2, floor_number: 2, area_exterior_m2: null, published_commercial_price: 190000 },
  { id: 'home', unit_number: '402', category: 'departamento', bedrooms: 3, floor_number: 4, area_exterior_m2: null, published_commercial_price: 250000 },
  { id: 'larger', unit_number: '601', category: 'penthouse', bedrooms: 4, floor_number: 6, area_exterior_m2: 25, published_commercial_price: 400000 },
].map(u => ({ ...u, is_published: true, status: 'disponible' }))
const prior = { _property_context: { preference_category: 'local', offered_ids: ['local'], selected_ids: [],
  query: { group: 'commercial', category: 'local', operation: 'search', scope: 'catalog', filters: {},
    requirements: [{ ...requirement('area_exterior_m2', 'gt', 0), evidence: 'espacio exterior' }] } } }

function interpreted() {
  const raw: Row = structuredClone(profileFixture)
  raw.catalog_request = req
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  Object.assign(semantics, { primary_intent: 'project_information', primary_evidence: message,
    housing_quantities: [{ dimension: 'bedrooms', values: [3], role: 'requirement', count_basis: 'unspecified', confidence: 'high', evidence: 'mínimo 3 cuartos' }],
    budget: { status: 'amount', amount: 200000, confidence: 'high', evidence: 'presupuesto de unos 200 mil' } })
  Object.assign(property, { group: null, category: null, operation: 'search', query_scope: 'catalog', evidence: message,
    filters: { ...object(property.filters), bedrooms: 3, bedrooms_operator: 'gte', bedrooms_required: true, floor_number: 1 },
    filter_evidence: { ...object(property.filter_evidence), bedrooms: 'mínimo 3 cuartos', bedrooms_operator: 'mínimo 3 cuartos',
      bedrooms_required: 'mínimo 3 cuartos', floor_number: 'pisos superiores' } })
  return { ...normalizeTurnSemantics(raw, message), catalog_request: req }
}

test('bedroom follow-up replaces commercial context and respects minimum plus floor preference on both routes', async () => {
  for (const enabled of [true, false]) {
    const semantics = interpreted()
    assert.equal(object(semantics.property).group, 'residential')
    const resolved = resolvePropertyTurn(units, message, prior, [], semantics)
    assert.equal(resolved.query.group, 'residential')
    assert.equal(resolved.query.category, null)
    assert.equal(object(resolved.query.filters).floor_number, null, 'higher floors must not become exact floor 1')
    assert.deepEqual(resolved.context.offered_ids, [])
    assert.ok(!(resolved.query.requirements as Row[]).some(r => r.field === 'area_exterior_m2'), 'obsolete commercial constraint is removed')
    const info: Row = { catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true },
      catalog_search: { embeddingsEnabled: enabled }, semantica_turno: semantics, property_context: resolved.context,
      referencia_unidad: resolved, politica_comercial: { precios_autorizados: true }, financiamiento: { partners: ['Entidad autorizada'] },
      contrato_turno: { objective: 'project_information', requests: [{ domain: 'property', confidence: 'high', evidence: message, request: message }] } }
    let calls = 0
    const retrieval = await retrieveCatalogByEmbeddings(info, message, {
      embed: async () => { calls++; return { vector: [1], tokens: 1 } }, match: async () => [],
    })
    assert.equal(calls, 0, 'budget query follows the full commercial route')
    assert.equal(retrieval.audit.applied, false)
    const result = catalogDialogueReply(info, message)!
    assert.ok(result)
    assert.deepEqual(object(result.audit.catalog_results).unit_ids, ['home', 'larger'])
    assert.doesNotMatch(result.reply, /local comercial|LC01/)
    const budget = turnBudgetAssessment(info, result.audit)!
    assert.equal(budget.continuation, 'offer_financing')
    assert.equal(budget.minimum_price, 250000)
    assert.deepEqual(budget.matching_unit_ids, [])
  }
})

test('typed numeric bounds and unknown measurements behave identically on normal and optimized queries', () => {
  const query = catalogQuery({ group: 'residential', operation: 'search', requirements: [
    requirement('bedrooms', 'gte', 3), { ...requirement('floor_number', 'between', 2), upper_value: 5 },
  ] })
  const normal = partitionCatalog(units, query)
  assert.deepEqual(normal.units.map(u => u.id), ['home'])
  const resolved = resolveCatalogRequirements({ semantica_turno: {} }, query, { ...req, requirements: [] })
  const optimized = completeCatalogResult({ catalogo: units, catalog_read: { complete: true } }, resolved.query, resolved.request)
  assert.deepEqual(optimized.units.map(u => u.id), ['home'])
  const unknownQuery = catalogQuery({ group: 'commercial', operation: 'search', requirements: [requirement('bedrooms', 'gte', 3)] })
  const answer = catalogDialogueReply({ catalogo: units, property_context: { query: unknownQuery } })!
  assert.equal(object(answer.audit.catalog_results).complete, false)
  assert.deepEqual(object(answer.audit.catalog_results).unknown_unit_ids, ['local'])
  assert.equal(object(answer.audit.catalog_coverage).status, 'unknown')
  assert.doesNotMatch(answer.reply, /no contamos|no tiene|no hay|sin dormitorios/i)
})

test('household size does not create bedrooms or a residential category from a numeric coincidence', () => {
  const current = 'Somos 3 personas'
  const raw = { turn_semantics: { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
    property: { confidence: 'high', evidence: current, filters: { bedrooms: 3 }, group: null, category: null },
    housing_quantities: [{ dimension: 'people', values: [3], role: 'requirement', count_basis: 'total', evidence: current, confidence: 'high' }] } }
  const semantics = normalizeTurnSemantics(raw, current)
  assert.equal(object(object(semantics.property).filters).bedrooms, null)
  assert.equal(object(semantics.property).group, null)
})

const floorUnits = [
  { id: 'ground', category: 'local', floor_number: 0, area_internal_m2: 137.98, published_commercial_price: 535000 },
  { id: 'upper-small', category: 'local', floor_number: 1, area_internal_m2: 46.65, published_commercial_price: 145000 },
  { id: 'upper-large', category: 'local', floor_number: 1, area_internal_m2: 109.07, published_commercial_price: 355000 },
]
const group: Row = { id: 'group:local:unknown:range', aggregation: 'range', member_ids: floorUnits.map(u => u.id),
  area_internal_m2: 46.65, published_commercial_price: 145000, upper_values: { area_internal_m2: 137.98, published_commercial_price: 535000 } }
const floorScope = { category: 'local', filters: [{ field: 'floor_number', operator: 'eq', value: 1, upper_value: null }] }
const floorFact = { kind: 'catalog_value', subject_id: group.id, scope: floorScope, statement: 'En planta 1 hay locales entre 145000 y 355000.',
  field: 'published_commercial_price', value: 145000, upper_value: 355000, relation: 'range', unit: 'USD' }

test('floor-specific ranges validate their own members while wrong extrema still fail', () => {
  const checks = validateBusinessFacts([floorFact, { ...floorFact, field: 'area_internal_m2', unit: 'm2', value: 46.65, upper_value: 109.07 },
    { ...floorFact, upper_value: 535000 }], floorUnits, [group], {})
  assert.deepEqual(checks.map(c => c.status), ['verified', 'verified', 'contradiction'])
  assert.deepEqual(checks[0].source?.member_ids, ['upper-small', 'upper-large'])
  assert.equal(validateBusinessFacts([floorFact], floorUnits.slice(1), [group], {})[0].status, 'unverified', 'partial facts cannot certify a full range')
})

test('a reviewer scope repair keeps the correct floor reply without calling the writer twice', async () => {
  const draft = 'En la primera planta alta hay locales de $145,000 a $355,000.'
  const calls: string[] = []
  const result = await completeTurnReply({ current: '¿Qué precios tienen los locales de la primera planta?', baseReply: draft,
    verified: { catalogo: floorUnits, politica_comercial: { precios_autorizados: true }, catalog_read: { complete: true } },
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_rules, data, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      if (task === 'writing') return { reply: draft, question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '' },
        requests: [{ fragment: 'R1', intent: 'Precios de locales de primera planta', status: 'answered', evidence: draft, fact_key: 'price', request_type: 'specific_fact' }] }
      const groups = object(object(data).fuentes_autorizadas).grupos as Row[]
      const source = groups.find(g => g.aggregation === 'range' && g.category === 'local')!
      assert.ok(source)
      return { verdict: 'pass', review_contract: BUSINESS_RISK_REVIEW_VERSION, findings: [], question: null,
        facts: [{ ...floorFact, subject_id: source.id, scope: calls.length === 2 ? null : floorScope }] }
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, draft)
  assert.deepEqual(calls, ['writing', 'review', 'review'])
})

test('budget goal review uses the selected continuation when incompatible low-price properties exist', () => {
  const assessment = { continuation: 'clarify_requirements', status: 'no_matching_features', matching_unit_ids: [] }
  const obligations = reviewObligations({}, { presupuesto_del_turno: assessment }, {})
  const continuation = obligations.find(o => o.id === 'budget_continuation')!
  assert.equal(continuation.action, 'clarify_requirements')
  assert.match(String(continuation.instruction), /No exija listar inmuebles incompatibles/)
  assert.doesNotMatch(String(continuation.instruction), /si no alcanza.*ofrezca/)
})

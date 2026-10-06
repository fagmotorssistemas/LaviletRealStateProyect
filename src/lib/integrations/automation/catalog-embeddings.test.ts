import test from 'node:test'
import assert from 'node:assert/strict'
import { embeddingSearchPlan, retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { catalogDialogueReply } from './catalog-dialogue'
import { turnEvidence } from './turn-evidence'
import { businessRiskContext } from './business-risk-review'
import { catalogSearchSettings, changeCatalogSearch } from '../../inmobiliaria/catalogSearch'
import { object, scope, type Row } from './data'

const units = Array.from({ length: 9 }, (_, i) => ({ id: `unit-${i}`, unit_number: `20${i}`, category: 'departamento',
  bedrooms: 3, floor_number: 2, floor: 'Segunda planta', bathrooms_full: 2, area_internal_m2: 120,
  area_exterior_m2: 20, area_total_m2: null, description: null, spaces: ['Balcón'], published_commercial_price: 250000 }))
const semantic = { confidence: 'high', primary_intent: 'other', housing_quantities: [], budget: { status: 'not_discussed', amount: null },
  property: { confidence: 'high', category: 'departamento', operation: 'search', query_scope: 'catalog', reference_kind: 'none', unit_numbers: [], filters: {} } }
const info = (): Row => ({ catalog_search: { embeddingsEnabled: true }, catalogo: units, catalog_read: { complete: true },
  semantica_turno: semantic, contrato_turno: { objective: 'other', required_facts: [], requests: [{ domain: 'property', confidence: 'high' }] },
  property_context: {}, referencia_unidad: {}, politica_comercial: { precios_autorizados: true } })
const hits = () => units.map((unit, i) => ({ similarity: .8 - i * .005,
  metadata: { ...unit, unit_id: unit.id, ...scope, embedding_model: 'text-embedding-3-small', embedding_dimensions: 1536, index_version: 'unit-facts-v1' } }))
const provider = (match = async () => hits()) => ({ embed: async () => ({ vector: [1], tokens: 10 }), match })
const semanticPreference = (): Row => {
  const value = info()
  value.semantica_turno = { ...semantic, catalog_request: { version: 'catalog-request-v1', purpose: 'search', metric: null,
    requirements: [], semantic_preferences: ['buenas vistas'], confidence: 'high', evidence: 'buenas vistas' } }
  return value
}
const never = { embed: async () => { throw Error('must not call') }, match: async () => { throw Error('must not call') } }

test('switch defaults off, rejects strings and preserves unrelated business policies when saving', () => {
  assert.equal(catalogSearchSettings({}).embeddingsEnabled, false)
  assert.equal(catalogSearchSettings({ catalog_search: { embeddings_enabled: 'true' } }).embeddingsEnabled, false)
  const old = { business_policies: { items: ['keep'] }, pricing: { visible: true } }
  const enabled = changeCatalogSearch(old, true, 'admin', 'now')
  assert.deepEqual(enabled.business_policies, old.business_policies)
  assert.deepEqual(enabled.pricing, old.pricing)
  assert.equal(catalogSearchSettings(enabled).embeddingsEnabled, true)
  assert.equal(catalogSearchSettings(changeCatalogSearch(enabled, false, 'admin', 'later')).embeddingsEnabled, false)
  assert.throws(() => changeCatalogSearch(old, 'true' as unknown as boolean, 'admin', 'now'))
})

test('switch off keeps exact catalogue filtering without any embedding or remote search call', async () => {
  const input = { ...info(), catalog_search: { embeddingsEnabled: false } }
  const result = await retrieveCatalogByEmbeddings(input, 'Opciones con balcón', never)
  assert.deepEqual(result.units, units)
  assert.equal(result.audit.exact_filter_applied, true)
  assert.equal(result.audit.method, 'structured_catalog')
  assert.equal(result.audit.ranking_reason, 'disabled')
  assert.equal(result.audit.embedding_requested, false)
  assert.equal(result.audit.embedding_input_tokens, 0)
  assert.equal(result.audit.exhaustive, true)
  assert.equal(input.catalogo, units)
})

test('unresolved references, multiple catalogue scopes and uncertain interpretation remain on the conservative route', () => {
  const changes: Row[] = [
    { contrato_turno: { objective: 'ask_price' } },
    { semantica_turno: { ...semantic, property: { ...semantic.property, operation: 'compare' } } },
    { referencia_unidad: { needsClarification: true } },
    { property_context: { preference_transition: { active: true } } },
    { catalog_read: { complete: false } },
    { semantica_turno: { ...semantic, confidence: 'low' } },
    { semantica_turno: { ...semantic, catalog_request_status: 'invalid' } },
    { contrato_turno: { scope: { kind: 'out_of_scope' }, requests: [{ domain: 'property', confidence: 'high' }] } },
    { contrato_turno: { objective: 'other', requests: [{ domain: 'property', confidence: 'high' }, { domain: 'property', confidence: 'high' }] } },
  ]
  for (const change of changes) assert.notEqual(embeddingSearchPlan({ ...info(), ...change }).reason, 'eligible')
  // The interpreter owns scope and operation; retrieval does not classify prose.
  assert.equal(embeddingSearchPlan(info(), '¿Cuántos departamentos tienen balcón?').reason, 'eligible')
  assert.equal(embeddingSearchPlan(info(), 'Quiero ver todas las suites').query.category, 'departamento')
})

test('budget, household and independent non-catalogue topics never relax an exact property query', async () => {
  for (const change of [
    { semantica_turno: { ...semantic, housing_quantities: [{ dimension: 'people', values: [5] }] } },
    { semantica_turno: { ...semantic, budget: { status: 'amount', amount: 100000 } } },
    { lead: { budget: 100000 } },
    { contrato_turno: { objective: 'other', requests: [{ domain: 'property', confidence: 'high' }, { domain: 'financing', confidence: 'high' }] } },
  ]) {
    const input = { ...info(), ...change }
    const result = await retrieveCatalogByEmbeddings(input, 'Opciones', never)
    assert.equal(result.audit.exact_filter_applied, true)
    assert.deepEqual(result.units?.map(unit => unit.id), units.map(unit => unit.id))
    assert.equal(result.audit.embedding_requested, false)
  }
})

test('numeric filters remain exact; a request for 5 bedrooms does not return the available 3-bedroom homes', async () => {
  const input = { ...info(), semantica_turno: { ...semantic, property: { ...semantic.property, filters: { bedrooms: 5, bedrooms_required: true } } } }
  const result = await retrieveCatalogByEmbeddings(input, '5 dormitorios', never)
  assert.deepEqual(result.units, [])
  assert.equal(result.audit.exact_filter_applied, true)
  assert.equal(result.audit.matched_count, 0)
  assert.equal(result.audit.unknown_count, 0)
  assert.equal(result.audit.exhaustive, true)
  assert.equal(result.audit.embedding_requested, false)
})

test('missing required measurements remain unknown instead of being zero or proof of absence', async () => {
  const input = info()
  input.catalogo = units.map((unit, index) => index === 0 ? { ...unit, bedrooms: null } : unit)
  input.semantica_turno = { ...semantic, property: { ...semantic.property, filters: { bedrooms: 3, bedrooms_required: true } } }
  const result = await retrieveCatalogByEmbeddings(input, '3 dormitorios', never)
  assert.equal(result.units?.length, 8)
  assert.equal(result.audit.unknown_count, 1)
  assert.equal(result.audit.exhaustive, false)
  assert.equal(object(result.audit.catalog_summary).exact_count, false)
  assert.equal((object(result.audit.catalog_summary).unknown_units as Row[])[0].unit_id, 'unit-0')
})

test('search selects fresh unit facts, not the prices copied into embedding metadata', async () => {
  const result = await retrieveCatalogByEmbeddings(semanticPreference(), 'Opciones con buenas vistas', provider(async () =>
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, published_commercial_price: 15 } }))))
  assert.equal(result.units?.length, 9)
  assert.equal(result.units?.[0].published_commercial_price, 250000)
  assert.equal(result.audit.exhaustive, true)
  assert.equal(result.audit.applied, true)
  assert.equal(result.audit.embedding_input_tokens, 10)
  assert.equal(result.audit.embedding_model_consulted, 'text-embedding-3-small')
})

test('empty, stale, foreign, incomplete or failed vector ranking retains the complete exact result', async () => {
  const invalid: Row[][] = [[], hits().slice(0, 2),
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, tenant_id: 'other' } })),
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, bedrooms: 5 } })),
  ]
  for (const values of invalid) {
    const result = await retrieveCatalogByEmbeddings(semanticPreference(), 'Opciones con buenas vistas', provider(async () => values))
    assert.deepEqual(result.units, units)
    assert.equal(result.audit.exact_filter_applied, true)
    assert.equal(result.audit.applied, false)
    assert.equal(result.audit.ranking_reason, 'semantic_ranking_unavailable')
    assert.equal(result.audit.embedding_requested, true)
    assert.equal(result.audit.embedding_input_tokens, 10)
    assert.equal(result.audit.exhaustive, true)
  }
  const failed = await retrieveCatalogByEmbeddings(semanticPreference(), 'Opciones con buenas vistas', provider(async () => { throw Error('timeout') }))
  assert.deepEqual(failed.units, units)
  assert.equal(failed.audit.ranking_reason, 'semantic_ranking_unavailable')
  const weak = await retrieveCatalogByEmbeddings(semanticPreference(), 'Opciones con buenas vistas', provider(async () =>
    hits().map(hit => ({ ...hit, similarity: .1 }))))
  assert.equal(weak.audit.applied, true)
  assert.deepEqual(weak.units, units)
})

test('shared writer and reviewer evidence use confirmed exact results instead of treating vector order as a partial inventory', async () => {
  const retrieval = await retrieveCatalogByEmbeddings(info(), 'Opciones con balcón', never)
  const selected = { ...info(), catalogo: retrieval.units, catalogo_verificacion: retrieval.units,
    catalog_retrieval: retrieval.audit, catalog_context_scope: semanticCatalogScope(retrieval.audit) }
  const answer = catalogDialogueReply(selected, 'Opciones con balcón')!
  assert.equal((answer.audit.catalog_results as Row).complete, true)
  assert.equal(semanticCatalogScope(retrieval.audit).kind, 'optimized_catalog')
  assert.equal(turnEvidence(selected, answer.audit).units.length, 9)
  assert.equal((answer.audit.offered_unit_ids as string[]).length, 8)
  const reviewer = businessRiskContext({ current: 'Opciones con balcón', reply: answer.reply,
    units: retrieval.units!, groups: [], projectFacts: [], claimSources: [], verified: selected,
    audit: answer.audit, obligations: [], allowedLinks: [] })
  assert.deepEqual(((reviewer.fuentes_autorizadas as Row).unidades as Row[])[0].spaces, ['Balcón'])
  assert.equal(((reviewer.estado_del_turno as Row).alcance_catalogo as Row).kind, 'optimized_catalog')
  assert.equal(((reviewer.fuentes_autorizadas as Row).unidades as Row[]).length, 9)
})

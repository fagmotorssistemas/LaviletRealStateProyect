import test from 'node:test'
import assert from 'node:assert/strict'
import { embeddingSearchPlan, retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { catalogDialogueReply } from './catalog-dialogue'
import { turnEvidence } from './turn-evidence'
import { businessRiskContext } from './business-risk-review'
import { catalogSearchSettings, changeCatalogSearch } from '../../inmobiliaria/catalogSearch'
import { scope, type Row } from './data'

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

test('off returns to the original catalog without any embedding or search call', async () => {
  const input = { ...info(), catalog_search: { embeddingsEnabled: false } }
  const result = await retrieveCatalogByEmbeddings(input, 'Opciones con balcón', {
    embed: async () => { throw Error('must not call') }, match: async () => { throw Error('must not call') },
  })
  assert.equal(result.units, null)
  assert.equal(result.audit.reason, 'disabled')
  assert.equal(result.audit.embedding_input_tokens, 0)
  assert.equal(input.catalogo, units)
})

test('prices, ranking, comparisons, household needs, budget, ambiguous references and multi-topic turns use existing search', () => {
  const changes: Row[] = [
    { contrato_turno: { objective: 'ask_price' } },
    { semantica_turno: { ...semantic, property: { ...semantic.property, operation: 'rank', selector: 'largest' } } },
    { semantica_turno: { ...semantic, property: { ...semantic.property, operation: 'compare' } } },
    { semantica_turno: { ...semantic, housing_quantities: [{ dimension: 'people', values: [5] }] } },
    { semantica_turno: { ...semantic, budget: { status: 'amount', amount: 100000 } } },
    { lead: { budget: 100000 } }, { referencia_unidad: { needsClarification: true } },
    { property_context: { selected_ids: ['unit-1'] } }, { consultas_pendientes: [{ request: 'financiamiento' }] },
    { contrato_turno: { objective: 'other', requests: [{ domain: 'property', confidence: 'high' }, { domain: 'financing', confidence: 'high' }] } },
  ]
  for (const change of changes) assert.notEqual(embeddingSearchPlan({ ...info(), ...change }).reason, 'eligible')
  assert.equal(embeddingSearchPlan(info(), '¿Cuántos departamentos tienen balcón?').reason, 'requires_complete_catalog')
  assert.equal(embeddingSearchPlan(info(), 'Quiero ver todas las suites').reason, 'requires_complete_catalog')
})

test('numeric filters remain exact; a request for 5 bedrooms does not return the available 3-bedroom homes', async () => {
  const input = { ...info(), semantica_turno: { ...semantic, property: { ...semantic.property, filters: { bedrooms: 5, bedrooms_required: true } } } }
  const result = await retrieveCatalogByEmbeddings(input, '5 dormitorios', provider())
  assert.equal(result.units, null)
  assert.equal(result.audit.reason, 'no_exact_candidates')
})

test('search selects fresh unit facts, not the prices copied into embedding metadata', async () => {
  const result = await retrieveCatalogByEmbeddings(info(), 'Opciones con balcón', provider(async () =>
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, published_commercial_price: 15 } }))))
  assert.equal(result.units?.length, 6)
  assert.equal(result.units?.[0].published_commercial_price, 250000)
  assert.equal(result.audit.exhaustive, false)
  assert.equal(result.audit.embedding_input_tokens, 10)
})

test('empty, stale, foreign, incomplete, weak or failed retrieval continues through the existing path', async () => {
  const invalid: Row[][] = [[], hits().slice(0, 2),
    hits().map(hit => ({ ...hit, similarity: .1 })),
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, tenant_id: 'other' } })),
    hits().map(hit => ({ ...hit, metadata: { ...hit.metadata, bedrooms: 5 } })),
  ]
  for (const values of invalid) assert.equal((await retrieveCatalogByEmbeddings(info(), 'Opciones con balcón', provider(async () => values))).units, null)
  const failed = await retrieveCatalogByEmbeddings(info(), 'Opciones con balcón', provider(async () => { throw Error('timeout') }))
  assert.equal(failed.units, null)
  assert.equal(failed.audit.reason, 'search_unavailable')
})

test('retrieved results remain explicitly partial in base copy and the shared writer/reviewer evidence', async () => {
  const retrieval = await retrieveCatalogByEmbeddings(info(), 'Opciones con balcón', provider())
  const selected = { ...info(), catalogo: retrieval.units, catalogo_verificacion: retrieval.units,
    catalog_retrieval: retrieval.audit, catalog_context_scope: semanticCatalogScope(retrieval.audit) }
  const answer = catalogDialogueReply(selected, 'Opciones con balcón')!
  assert.match(answer.reply, /algunas opciones/)
  assert.equal((answer.audit.catalog_results as Row).complete, false)
  assert.equal((answer.audit.catalog_context_scope as Row).kind, 'semantic_candidates')
  assert.equal(turnEvidence(selected, answer.audit).units.length, 6)
  assert.equal((answer.audit.offered_unit_ids as string[]).length, 6)
  const reviewer = businessRiskContext({ current: 'Opciones con balcón', reply: answer.reply,
    units: retrieval.units!, groups: [], projectFacts: [], claimSources: [], verified: selected,
    audit: answer.audit, obligations: [], allowedLinks: [] })
  assert.deepEqual(((reviewer.fuentes_autorizadas as Row).unidades as Row[])[0].spaces, ['Balcón'])
  assert.equal(((reviewer.estado_del_turno as Row).alcance_catalogo as Row).kind, 'semantic_candidates')
})

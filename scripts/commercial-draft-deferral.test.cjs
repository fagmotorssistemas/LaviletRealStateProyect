/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module')
require('./test-typescript.cjs')
const original = Module._load
let drafts = 0
Module._load = function(id, parent, main) {
  if (id === './ai' && parent?.filename.endsWith('sdr.ts')) return {
    activePrompt: async () => 'Reglas', aiJson: async () => { throw new Error('Unexpected separate review') },
    draftReply: async () => { drafts++; return 'Podemos continuar revisando las opciones disponibles.' },
  }
  if (id === './catalog-embeddings' && parent?.filename.endsWith('sdr.ts')) return {
    retrieveCatalogByEmbeddings: async () => ({ audit: { applied: false, reason: 'not_a_catalog_query' } }),
    semanticCatalogScope: () => ({}),
  }
  return original.call(this, id, parent, main)
}
const { commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
Module._load = original

test('optimized path skips preliminary draft and legacy path retains its draft', async () => {
  for (const optimized of [true, false]) {
    drafts = 0
    const info = { final_review_follows: true, catalog_search: { embeddingsEnabled: optimized },
      lead: { name: 'Carlos', name_confirmed: true }, catalogo: [], historial: [],
      politica_comercial: { precios_autorizados: true }, alcance_negocio: 'property',
      referencia_unidad: { reason: 'no_reference', matches: [] },
      property_context: { selected_ids: [] }, semantica_turno: { primary_intent: 'other' } }
    const result = await commercialReply(info, 'Ayúdeme a comprender ese detalle por favor', {}, async () => {})
    assert.equal(drafts, optimized ? 0 : 1)
    assert.equal(result.audit.requires_advisor, undefined)
    assert.equal(result.audit.drafting_deferred_to_final_writer === true, optimized)
    if (optimized) assert.equal(result.reply, '')
  }
})


const { withResponseReviewPolicy, configuredResponseReviewEnabled, responseReviewEnabled } = require('../src/lib/integrations/automation/response-review-policy.ts')
for (const enabled of [false, true]) for (const embeddingsEnabled of [false, true])
  test('normal/demo preserve preliminary drafting when general review=' + enabled + ' and embeddings=' + embeddingsEnabled, async () => {
    const results = [], draftCounts = []
    for (const observationOnly of [false, true]) {
      drafts = 0
      const info = { final_review_follows: true, catalog_search: { embeddingsEnabled },
        lead: { name: 'Carlos', name_confirmed: true }, catalogo: [], historial: [],
        politica_comercial: { precios_autorizados: true }, alcance_negocio: 'property',
        referencia_unidad: { reason: 'no_reference', matches: [] },
        property_context: { selected_ids: [] }, semantica_turno: { primary_intent: 'other' } }
      results.push(await withResponseReviewPolicy({ enabled, observationOnly, updatedAt: null }, async () => {
        assert.equal(configuredResponseReviewEnabled(), enabled)
        assert.equal(responseReviewEnabled(), observationOnly || enabled)
        return commercialReply(info, 'Ayúdeme a comprender ese detalle por favor', {}, async () => {})
      }))
      draftCounts.push(drafts)
    }
    const deferred = embeddingsEnabled || !enabled
    assert.deepEqual(draftCounts, [deferred ? 0 : 1, deferred ? 0 : 1])
    assert.deepEqual(results[1], results[0])
    assert.equal(results[1].audit.drafting_deferred_to_final_writer === true, deferred)
  })

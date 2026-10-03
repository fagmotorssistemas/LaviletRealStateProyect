import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { embeddingSearchPlan, retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { semanticCatalogContext } from './semantic-catalog-context'
import { catalogDialogueReply } from './catalog-dialogue'
import { leadIntroductionTurn } from './lead-introduction'
import { completeTurnReply } from './turn-completeness'
import { object, scope, type Row } from './data'

const fixture = JSON.parse(readFileSync('scripts/fixtures/semantic-local-search.json', 'utf8'))
const units = Array.from({ length: 65 }, (_, i) => ({ id: `unit-${i}`, unit_number: i < 16 ? `LC-${i + 1}` : `SU-${i + 1}`,
  category: i < 16 ? 'local' : 'suite', floor: 'Planta Baja', floor_number: 0, bedrooms: i < 16 ? null : 1,
  bathrooms_full: null, area_internal_m2: 60 + i, area_exterior_m2: 20, area_total_m2: null,
  description: null, spaces: ['Área exterior'], published_commercial_price: 145000 + i * 1000 }))
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : []
function input(enabled = true): Row {
  return { catalog_search: { embeddingsEnabled: enabled }, catalogo: units, catalog_read: { complete: true },
    semantica_turno: fixture.semantics, contrato_turno: fixture.intent, referencia_unidad: { reason: 'category_change', explicit: false },
    property_context: {}, consultas_pendientes: [], lead: { budget: null, budget_max: null },
    proyecto: { name: 'La Vilet', address: 'Puertas del Sol, Cuenca', description: 'Proyecto con viviendas y comercios.' },
    politica_comercial: { precios_autorizados: true, garantizar_disponibilidad_sin_reserva: false },
    politica_financiera: { credito_directo: false },
    politicas_negocio: ['compra_exterior', 'reserva', 'pagos', 'cancelacion'].map(topic => ({ topic, policy_id: topic, policy_content: `Política ${topic}` })),
    instalaciones: [{ amenity_name: 'Piscina', description: 'Exclusiva para residentes.' }],
    lugares_cercanos: [{ poi_name: 'Supermercado', poi_category: 'Comercio' }],
    contexto_sector: [{ headline: 'Educación', safe_sales_text: 'Universidad cercana.' }],
    posicionamiento_proyecto: { builder: 'Agmen' } }
}
const provider = () => ({ embed: async () => ({ vector: [1], tokens: 9 }), match: async () => units.map((unit, i) => ({
  similarity: .8 - i * .002, metadata: { ...unit, ...scope, unit_id: unit.id,
    embedding_model: 'text-embedding-3-small', embedding_dimensions: 1536, index_version: 'unit-facts-v1' } })) })

test('real first-message interpretation reaches embeddings without changing the extractor objective', async () => {
  assert.equal(embeddingSearchPlan(input(), fixture.message).reason, 'eligible')
  const result = await retrieveCatalogByEmbeddings(input(), fixture.message, provider())
  assert.equal(result.audit.applied, true)
  assert.equal(result.units?.length, 6)
  assert.ok(result.units?.every(u => u.category === 'local'))
  assert.equal(fixture.intent.objective, 'project_information')
})

test('off and failed retrieval preserve the entire original context, including every policy', () => {
  const original = input(false), before = structuredClone(original)
  assert.equal(semanticCatalogContext(original, { catalog_retrieval: { applied: true } }, fixture.message), original)
  assert.deepEqual(original, before)
  const on = input(true)
  assert.equal(semanticCatalogContext(on, { catalog_retrieval: { applied: false } }, fixture.message), on)
})

test('supplementary evidence retains applicable facts, restrictions and unknown policies', () => {
  const verified = { ...input(), catalog_context_scope: { kind: 'semantic_candidates' },
    politicas_negocio: [...rows(input().politicas_negocio), { topic: 'otros', policy_content: 'No permitir usos industriales.' }] }
  const audit = { catalog_retrieval: { applied: true } }
  const slim = semanticCatalogContext(verified, audit, fixture.message)
  assert.deepEqual(slim.instalaciones, [])
  assert.deepEqual(slim.lugares_cercanos, [])
  assert.deepEqual(slim.contexto_sector, [])
  assert.equal(rows(slim.politicas_negocio).length, 1)
  assert.equal(rows(slim.politicas_negocio)[0].topic, 'otros')
  assert.deepEqual(slim.politica_comercial, verified.politica_comercial)
  assert.deepEqual(slim.politica_financiera, verified.politica_financiera)
  const pool = semanticCatalogContext(verified, audit, 'Busco una suite con piscina')
  assert.deepEqual(pool.instalaciones, verified.instalaciones) // includes resident-only restriction
  const park = semanticCatalogContext({ ...verified, lugares_cercanos: [{ poi_name: 'Parques', poi_category: 'Zona verde' }] }, audit, 'Busco una suite junto a un parque')
  assert.equal(rows(park.lugares_cercanos).length, 1)
  const payment = semanticCatalogContext(verified, audit, 'Busco local para pagar al contado')
  assert.ok(rows(payment.politicas_negocio).some(p => p.topic === 'pagos'))
  assert.equal(rows(verified.instalaciones).length, 1)
})

async function run(enabled: boolean, failSearch = false) {
  const info = input(enabled)
  let embeddings = 0
  const dependencies = provider()
  const retrieved = await retrieveCatalogByEmbeddings(info, fixture.message, { ...dependencies,
    embed: async () => { embeddings++; if (failSearch) throw Error('unavailable'); return dependencies.embed() } })
  const selected: Row = retrieved.units ? { ...info, catalogo: retrieved.units,
    catalog_retrieval: retrieved.audit, catalog_context_scope: semanticCatalogScope(retrieved.audit) } : info
  const base = catalogDialogueReply(selected, fixture.message)!
  const opening = leadIntroductionTurn({ current: fixture.message, history: [], summary: {}, catalog: units,
    extracted: { turn_semantics: fixture.semantics, preferred_category: 'local' }, reply: base.reply, audit: base.audit })
  const verified: Row = { ...selected, catalogo: object(base.audit.catalog_results).units,
    catalogo_verificacion: retrieved.units || units, estado_operativo: opening.audit }
  const calls: { task: string; instructions: string; context: Row }[] = []
  const reply = 'En La Vilet contamos con locales con espacio exterior. Para compartirle el brochure y una guía personalizada, ¿podría indicarme su nombre y en qué ciudad o país reside actualmente?'
  const result = await completeTurnReply({ current: fixture.message, history: [], baseReply: opening.reply, verified,
    audit: { ...opening.audit, resolved_turn_intent: fixture.intent, semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (instructions, context, _schema, _image, _file, _tone, task) => {
    const data = object(context)
    calls.push({ task: task!, instructions, context: data })
    if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    return { reply, question: { role: 'required_collection', purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia actual', next_decision: 'Compartir el brochure' },
      requests: rows(data.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Buscar local', status: 'answered', evidence: 'Locales con espacio exterior.', fact_key: null, request_type: 'general_information' })) }
  })
  return { calls, result, embeddings }
}

test('real-message pipeline sends six candidates to both agents, preserves capture and restores the old prompts after switch off', async () => {
  const off = await run(false), on = await run(true), offAgain = await run(false), failure = await run(true, true)
  for (const r of [off, on, offAgain, failure]) {
    assert.equal(r.result.audit.status, 'checked')
    assert.deepEqual(r.calls.map(c => c.task), ['writing', 'review'])
    for (const call of r.calls) {
      const obligations = rows(call.context.obligaciones_del_turno).map(o => o.id)
      assert.ok(obligations.includes('profile_full_name'))
      assert.ok(obligations.includes('profile_current_residence'))
    }
  }
  assert.equal(off.embeddings, 0)
  assert.equal(on.embeddings, 1)
  assert.deepEqual(offAgain.calls, off.calls)
  const writer = on.calls[0].context, reviewer = on.calls[1].context
  assert.equal(rows(object(writer.evidencia_turno).units).length, 6)
  assert.equal(rows(object(reviewer.fuentes_autorizadas).unidades).length, 6)
  assert.equal(rows(object(off.calls[0].context.evidencia_turno).units).length, 16)
  assert.equal(rows(object(failure.calls[0].context.evidencia_turno).units).length, 16)
  assert.equal(rows(object(writer.contexto_verificado).politicas_negocio).length, 0)
  assert.equal(rows(object(off.calls[0].context.contexto_verificado).politicas_negocio).length, 4)
  assert.equal(rows(object(failure.calls[0].context.contexto_verificado).politicas_negocio).length, 4)
  assert.ok(JSON.stringify(on.calls).length < JSON.stringify(off.calls).length)
  assert.equal(object(on.result.audit.prompt_context_selection).mode, 'semantic_candidates')
})

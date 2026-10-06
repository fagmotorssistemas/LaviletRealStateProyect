import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { embeddingSearchPlan, retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { semanticCatalogContext } from './semantic-catalog-context'
import { catalogDialogueReply } from './catalog-dialogue'
import { leadIntroductionTurn } from './lead-introduction'
import { completeTurnReply } from './turn-completeness'
import { object, scope, type Row } from './data'
import { promptCostComparison } from './prompt-cost-comparison'

const fixture = JSON.parse(readFileSync('scripts/fixtures/semantic-local-search.json', 'utf8'))
const units = Array.from({ length: 65 }, (_, i) => ({ id: `unit-${i}`, unit_number: i < 16 ? `LC-${i + 1}` : `SU-${i + 1}`,
  category: i < 16 ? 'local' : 'suite', floor: 'Planta Baja', floor_number: 0, bedrooms: i < 16 ? null : 1,
  bathrooms_full: null, area_internal_m2: 60 + i, area_exterior_m2: 20, area_total_m2: null,
  description: null, spaces: ['Área exterior'], published_commercial_price: 145000 + i * 1000 }))
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : []
function input(enabled = true, withPreference = false): Row {
  return { catalog_search: { embeddingsEnabled: enabled }, catalogo: units, catalog_read: { complete: true },
    semantica_turno: { ...fixture.semantics, catalog_request: { version: 'catalog-request-v1', purpose: 'search', metric: null,
      requirements: [{ field: 'area_exterior_m2', operator: 'gt', value: 0, upper_value: null, strength: 'required', evidence: 'espacio exterior' }],
      semantic_preferences: withPreference ? ['buenas vistas'] : [], confidence: 'high', evidence: fixture.message } },
    contrato_turno: fixture.intent, referencia_unidad: { reason: 'category_change', explicit: false },
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

test('interpreted exterior requirement uses the exact catalogue without a needless embedding request or objective change', async () => {
  assert.equal(embeddingSearchPlan(input(), fixture.message).reason, 'eligible')
  const result = await retrieveCatalogByEmbeddings(input(), fixture.message, provider())
  assert.equal(result.audit.applied, false)
  assert.equal(result.audit.embedding_requested, false)
  assert.equal(result.audit.exact_filter_applied, true)
  assert.equal(result.units?.length, 16)
  assert.ok(result.units?.every(u => u.category === 'local'))
  assert.equal(fixture.intent.objective, 'project_information')
})

test('an unscoped or skipped retrieval cannot project the original context, including its policies', () => {
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

async function run(enabled: boolean, failSearch = false, compareCosts = false, withPreference = false) {
  const info = input(enabled, withPreference)
  const message = fixture.message + (withPreference ? ', con buenas vistas' : '')
  let embeddings = 0
  const dependencies = provider()
  const retrieved = await retrieveCatalogByEmbeddings(info, message, { ...dependencies,
    embed: async () => { embeddings++; if (failSearch) throw Error('unavailable'); return dependencies.embed() } })
  retrieved.audit.duration_ms = 0 // Independently timed runs compare behavior, not wall-clock noise.
  const selected: Row = retrieved.units ? { ...info, catalogo: retrieved.units,
    catalog_retrieval: retrieved.audit, catalog_context_scope: semanticCatalogScope(retrieved.audit) } : info
  const original = catalogDialogueReply(selected, message)!
  const base = { ...original, audit: { ...original.audit, catalog_retrieval: retrieved.audit,
    catalog_summary: retrieved.audit.catalog_summary, catalog_aggregate_groups: retrieved.audit.catalog_aggregate_groups,
    catalog_context_scope: semanticCatalogScope(retrieved.audit) } }
  const opening = leadIntroductionTurn({ current: message, history: [], summary: {}, catalog: units,
    extracted: { turn_semantics: info.semantica_turno, preferred_category: 'local' }, reply: base.reply, audit: base.audit })
  const verified: Row = { ...selected, catalogo: object(base.audit.catalog_results).units,
    catalogo_verificacion: retrieved.units || units, estado_operativo: opening.audit }
  const calls: { task: string; instructions: string; context: Row }[] = []
  const costComparisons: unknown[] = []
  const reply = 'En La Vilet contamos con locales con espacio exterior. Para compartirle el brochure y una guía personalizada, ¿podría indicarme su nombre y en qué ciudad o país reside actualmente?'
  const result = await completeTurnReply({ current: message, history: [], baseReply: opening.reply, verified,
    costBaseline: compareCosts ? { ...info, catalogo_verificacion: units } : undefined,
    audit: { ...opening.audit, resolved_turn_intent: fixture.intent, semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (instructions, context, _schema, _image, _file, _tone, task) => {
    const data = object(context)
    costComparisons.push(promptCostComparison(instructions, context, _schema))
    calls.push({ task: task!, instructions, context: data })
    if (task === 'review') return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    return { reply, question: { role: 'required_collection', purpose: 'collect_lead_profile', missing_datum: 'Nombre y residencia actual', next_decision: 'Compartir el brochure' },
      requests: rows(data.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Buscar local', status: 'answered', evidence: 'Locales con espacio exterior.', fact_key: null, request_type: 'general_information' })) }
  })
  return { calls, result, embeddings, costComparisons }
}

test('exact contexts are compact with the switch on or off; optional ranking failure never loses matches or capture', async () => {
  const off = await run(false), on = await run(true), offAgain = await run(false)
  const ranked = await run(true, false, false, true), failure = await run(true, true, false, true)
  for (const r of [off, on, offAgain, ranked, failure]) {
    assert.equal(r.result.audit.status, 'checked')
    assert.deepEqual(r.calls.map(c => c.task), ['writing', 'review'])
    for (const call of r.calls) {
      const obligations = rows(call.context.obligaciones_del_turno).map(o => o.id)
      assert.ok(obligations.includes('profile_full_name'))
      assert.ok(obligations.includes('profile_current_residence'))
    }
  }
  assert.equal(off.embeddings, 0)
  assert.equal(on.embeddings, 0)
  assert.equal(ranked.embeddings, 1)
  assert.equal(failure.embeddings, 1)
  assert.deepEqual(offAgain.calls, off.calls)
  const writer = on.calls[0].context, reviewer = on.calls[1].context
  assert.equal(rows(object(writer.evidencia_turno).units).length, 16)
  assert.equal(rows(object(reviewer.fuentes_autorizadas).unidades).length, 16)
  assert.equal(rows(object(off.calls[0].context.evidencia_turno).units).length, 16)
  assert.equal(rows(object(failure.calls[0].context.evidencia_turno).units).length, 16)
  assert.equal(rows(object(writer.contexto_verificado).politicas_negocio).length, 0)
  assert.equal(rows(object(off.calls[0].context.contexto_verificado).politicas_negocio).length, 0)
  assert.equal(rows(object(failure.calls[0].context.contexto_verificado).politicas_negocio).length, 0)
  const withoutVectorSwitch = (calls: typeof on.calls) => calls.map(call => call.task === 'writing' ? {
    ...call, context: { ...call.context, contexto_verificado: { ...object(call.context.contexto_verificado),
      catalog_search: { ...object(object(call.context.contexto_verificado).catalog_search), embeddingsEnabled: false } } },
  } : call)
  assert.deepEqual(withoutVectorSwitch(on.calls), withoutVectorSwitch(off.calls))
  assert.equal(object(on.result.audit.prompt_context_selection).mode, 'task_context')
})

test('cost comparison observes both agents without changing their inputs, output, calls or off behavior', async () => {
  const plain = await run(true), observed = await run(true, false, true)
  assert.deepEqual(observed.calls, plain.calls)
  assert.deepEqual(observed.result, plain.result)
  assert.equal(observed.embeddings, plain.embeddings)
  assert.equal(observed.costComparisons.length, 2)
  for (const value of observed.costComparisons) {
    const comparison = object(value)
    assert.equal(comparison.version, 'context-size-v1')
    assert.ok(Number(comparison.normal_prompt_characters) > Number(comparison.actual_prompt_characters))
  }
  const off = await run(false, false, true)
  assert.ok(off.costComparisons.every(c => object(c).version === 'context-size-v1'))
  assert.equal(off.costComparisons.length, 2)
  assert.deepEqual(off.calls, (await run(false)).calls)
})

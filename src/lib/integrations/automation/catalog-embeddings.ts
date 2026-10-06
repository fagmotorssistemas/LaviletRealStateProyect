import 'server-only'
import { db, object, scope, text, type Row } from './data'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { completeCatalogResult, selectCatalogExamples } from './catalog-result'

const MODEL = 'text-embedding-3-small'
const DIMENSIONS = 1536
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
/** Exact query resolution does not depend on the vector-search switch. */
export function embeddingSearchPlan(info: Row, current = '') {
  void current // Interpretation, not a second prose classifier, owns the query.
  const resolved = resolvedCatalogQuery(info)
  if (resolved.reason !== 'eligible') return { ...resolved, candidates: [] as Row[] }
  if (object(info.catalog_read).complete !== true) return { ...resolved, reason: 'incomplete_catalog', candidates: [] as Row[] }
  if ((resolved.request.metric === 'published_commercial_price' || rows(resolved.request.requirements).some(r => r.field === 'published_commercial_price'))
    && object(info.politica_comercial).precios_autorizados !== true)
    return { ...resolved, reason: 'prices_not_authorized', candidates: [] as Row[] }
  return { ...resolved, candidates: rows(info.catalogo), optimized: true }
}

type Dependencies = { embed: (query: string) => Promise<{ vector: number[]; tokens: number }>;
  match: (vector: number[], count: number) => Promise<Row[]> }

function liveDependencies(): Dependencies {
  // Both remote operations share a small total allowance. Search failures never
  // replace the normal answer with a recovery message.
  const signal = AbortSignal.timeout(8000)
  return {
    async embed(query) {
      const key = process.env.OPENAI_API_KEY
      if (!key) throw Error('EMBEDDINGS_NOT_CONFIGURED')
      const response = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, encoding_format: 'float', input: query }) })
      if (!response.ok) throw Error(`EMBEDDINGS_HTTP_${response.status}`)
      const result = object(await response.json()), data = rows(result.data)
      const vector = data[0]?.embedding
      if (result.model !== MODEL || data.length !== 1 || data[0].index !== 0 || !Array.isArray(vector)
        || vector.length !== DIMENSIONS || !vector.every(n => typeof n === 'number' && Number.isFinite(n))
        || !vector.some(n => n !== 0)) throw Error('EMBEDDINGS_INVALID_VECTOR')
      return { vector, tokens: Number(object(result.usage).total_tokens) || 0 }
    },
    async match(vector, count) {
      const { data, error } = await db().rpc('match_units', { query_embedding: JSON.stringify(vector),
        match_count: count, filter: { ...scope, embedding_model: MODEL, embedding_dimensions: DIMENSIONS, index_version: 'unit-facts-v1' } })
        .abortSignal(signal)
      if (error) throw Error('EMBEDDINGS_SEARCH_FAILED')
      return rows(data)
    },
  }
}

export async function retrieveCatalogByEmbeddings(info: Row, current: string, dependencies?: Dependencies) {
  const plan = embeddingSearchPlan(info, current)
  if (plan.reason === 'eligible') return retrieveCompleteCatalog(info, current, plan, dependencies)
  return { units: null, audit: { version: 'catalog-retrieval-v3', enabled: object(info.catalog_search).embeddingsEnabled === true,
    model: MODEL, embedding_model_planned: MODEL, embedding_model_consulted: null,
    applied: false, optimized: false, exact_filter_applied: false, reason: plan.reason,
    query_source: plan.source, resolved_query: plan.query,
    embedding_requested: false, embedding_usage_recorded: false, embedding_input_tokens: 0,
    method: 'current_catalog', candidate_count: 0, duration_ms: 0 } as Row }
}

async function retrieveCompleteCatalog(info: Row, current: string, plan: ReturnType<typeof resolvedCatalogQuery>, dependencies?: Dependencies) {
  const { query, request } = plan
  const started = Date.now(), result = completeCatalogResult(info, query, request, plan.scopedIds)
  const scores = new Map<string, number>()
  const enabled = object(info.catalog_search).embeddingsEnabled === true
  let requested = false, applied = false, tokens = 0, usageRecorded = false
  let rankingReason = !enabled ? 'disabled' : !result.units.length ? 'no_confirmed_matches' : 'not_needed_for_exact_query'
  if (enabled && ['search', 'details', 'list'].includes(text(request.purpose)) && result.units.length
    && current.trim() && current.length <= 4000
    && Array.isArray(request.semantic_preferences) && request.semantic_preferences.length) {
    try {
      const provider = dependencies ?? liveDependencies(); requested = true
      const embedded = await provider.embed(current); tokens = embedded.tokens; usageRecorded = Number.isSafeInteger(tokens) && tokens >= 0
      const matches = await provider.match(embedded.vector, rows(info.catalogo).length)
      const live = new Map(result.candidates.map(unit => [text(unit.id), unit])), seen = new Set<string>()
      const snapshotFields = ['unit_number', 'category', 'floor', 'floor_number', 'bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'area_total_m2', 'description', 'spaces']
      for (const hit of matches) {
        const meta = object(hit.metadata), id = text(meta.unit_id), unit = live.get(id)
        if (!unit) continue
        if (seen.has(id) || meta.tenant_id !== scope.tenant_id || meta.project_id !== scope.project_id
          || meta.embedding_model !== MODEL || meta.embedding_dimensions !== DIMENSIONS || meta.index_version !== 'unit-facts-v1'
          || snapshotFields.some(field => JSON.stringify(meta[field] ?? null) !== JSON.stringify(unit[field] ?? null))
          || typeof hit.similarity !== 'number' || !Number.isFinite(hit.similarity)) throw Error('invalid_index')
        seen.add(id); scores.set(id, hit.similarity)
      }
      if (seen.size !== live.size) throw Error('incomplete_index')
      applied = true; rankingReason = 'similarity_orders_confirmed_matches'
    } catch { scores.clear(); rankingReason = 'semantic_ranking_unavailable' }
  }
  // Every explicitly requested subject must survive comparison/details. Only
  // broad searches may use a bounded set of examples plus complete aggregates.
  const selection = ['details', 'compare', 'select'].includes(query.operation)
    ? { units: result.units, complete: true, reason: 'all_requested_subjects' }
    : selectCatalogExamples(result.units, request, scores)
  return { units: selection.units, audit: {
    version: 'catalog-retrieval-v3', enabled, optimized: true, applied, model: MODEL,
    exact_filter_applied: true, query_source: plan.source, resolved_query: query,
    embedding_model_planned: MODEL, embedding_model_consulted: requested ? MODEL : null,
    method: applied ? 'structured_catalog_and_embeddings' : 'structured_catalog', reason: applied ? 'complete_filtered_catalog' : 'exact_catalog_query',
    embedding_requested: requested, embedding_usage_recorded: usageRecorded, embedding_input_tokens: tokens,
    duration_ms: Date.now() - started, ranking_reason: rankingReason, selection_reason: selection.reason,
    context_character_allowance: 24000, exhaustive: result.summary.exact_count === true && selection.complete,
    candidate_count: result.candidates.length, matched_count: result.units.length, unknown_count: result.unknown.length,
    excluded_count: result.summary.excluded_count, selected_unit_ids: selection.units.map(u => u.id),
    selected_unit_numbers: selection.units.map(u => u.unit_number), selected_count: selection.units.length,
    examples_complete: selection.complete, catalog_summary: { ...result.summary, included_unit_count: selection.units.length,
      examples_complete: selection.complete }, catalog_aggregate_groups: result.groups,
    similarities: applied ? selection.units.map(u => scores.get(text(u.id)) ?? null) : [],
  } as Row }
}

export function semanticCatalogScope(retrieval: Row) {
  if (retrieval.optimized === true) return { kind: 'optimized_catalog', method: retrieval.method,
    complete: retrieval.exhaustive === true, summary_complete: object(retrieval.catalog_summary).exact_count === true,
    included_unit_count: retrieval.selected_count, matching_unit_count: retrieval.matched_count, unknown_unit_count: retrieval.unknown_count,
    note: 'El resumen se calcula sobre todas las coincidencias confirmadas antes de elegir fichas. Las fichas pueden ser ejemplos. Los requisitos sin dato permanecen sin confirmar; no se afirma ausencia a partir de información faltante.' }
  return { kind: 'semantic_candidates', complete: false, included_unit_count: Array.isArray(retrieval.selected_unit_ids) ? retrieval.selected_unit_ids.length : 0,
    note: 'Selección parcial por similitud, no inventario completo ni prueba de que cumpla todo lo solicitado. Contraste las características de cada ficha con la pregunta. No afirme totales, extremos del proyecto ni ausencia de alternativas a partir de esta selección.' }
}

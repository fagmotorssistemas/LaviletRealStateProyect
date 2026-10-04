import 'server-only'
import { db, object, scope, text, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { completeCatalogResult, selectCatalogExamples, resolveCatalogRequirements } from './catalog-result'

const MODEL = 'text-embedding-3-small'
const DIMENSIONS = 1536
const LIMIT = 6
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const hasValue = (value: unknown): boolean => value != null && value !== '' &&
  (Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.values(object(value)).some(hasValue) : true)

// The existing extractor remains the interpreter. This first stage does not
// truncate comparisons, extrema, references, affordability or family advice.
export function embeddingSearchPlan(info: Row, current = '') {
  const semantics = object(info.semantica_turno), property = object(semantics.property)
  const intent = object(info.contrato_turno), context = object(info.property_context)
  const reference = object(info.referencia_unidad), budget = object(semantics.budget)
  const requests = rows(intent.requests)
  const query = catalogQuery(reference.query || context.query || property)
  const catalog = rows(info.catalogo)
  if (object(info.catalog_search).embeddingsEnabled !== true) return { reason: 'disabled', candidates: [], query }
  const request = object(semantics.catalog_request)
  if (request.version === 'catalog-request-v1') {
    const unsupported = requests.length !== 1 || requests[0]?.domain !== 'property' || requests[0]?.confidence !== 'high'
      || !['other', 'select_property', 'project_information', 'ask_price'].includes(text(intent.objective))
      || semantics.confidence !== 'high' || property.confidence !== 'high' || request.confidence !== 'high'
      || !['search', 'count', 'list', 'range', 'min', 'max'].includes(text(request.purpose))
      || !['search', 'rank'].includes(text(query.operation)) || query.scope !== 'catalog'
      || hasValue(property.unit_numbers) || reference.needsClarification === true || reference.explicit === true
      || hasValue(context.selected_ids) || ['relative', 'comparison', 'followup'].includes(text(property.reference_kind))
      || hasValue(context.journey) || object(context.preference_transition).active === true || hasValue(info.consultas_pendientes)
      || rows(semantics.housing_quantities).some(q => q.dimension !== 'bedrooms' || q.role !== 'requirement')
      || !['', 'not_discussed'].includes(text(budget.status)) || hasValue(object(info.lead).budget) || hasValue(object(info.lead).budget_max)
    if (unsupported) return { reason: 'requires_full_commercial_context', candidates: [], query }
    if (object(info.catalog_read).complete !== true) return { reason: 'incomplete_catalog', candidates: [], query }
    if ((request.metric === 'published_commercial_price' || rows(request.requirements).some(r => r.field === 'published_commercial_price'))
      && object(info.politica_comercial).precios_autorizados !== true) return { reason: 'prices_not_authorized', candidates: [], query }
    const resolved = resolveCatalogRequirements(info, query, request)
    return { reason: 'eligible', candidates: catalog, ...resolved, optimized: true }
  }
  if (Object.hasOwn(semantics, 'catalog_request')) return { reason: 'structured_query_unavailable', candidates: [], query }
  // Conservative bypass only: never answer counts or global extrema from top-k.
  // The normal interpreter/catalogue remains responsible for these questions.
  const normalized = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:todos?|todas?|cuantos?|cuantas?|total(?:es)?|promedio|rango|minimo|maximo|mas grande|mas pequeno|mas barato|mas caro)\b/.test(normalized)) {
    return { reason: 'requires_complete_catalog', candidates: [], query }
  }
  // A first property search can legitimately have the broad objective
  // project_information. Its actual operation, scope and requests decide here.
  const exclusions: [boolean, string][] = [
    [info.catalogue_price_requested === true || hasValue(intent.required_facts), 'specific_facts_required'],
    [!['other', 'select_property', 'project_information'].includes(text(intent.objective)), 'unsupported_objective'],
    [requests.length !== 1 || requests[0]?.domain !== 'property', 'multiple_or_non_property_requests'],
    [requests[0]?.confidence !== 'high' || semantics.confidence !== 'high' || property.confidence !== 'high', 'uncertain_interpretation'],
    [property.operation !== 'search' || query.operation !== 'search' || query.scope !== 'catalog' || !!query.selector, 'operation_requires_current_search'],
    [hasValue(property.unit_numbers) || ['relative', 'comparison', 'followup'].includes(text(property.reference_kind))
      || reference.needsClarification === true || reference.explicit === true || hasValue(context.selected_ids), 'unit_reference_or_selection'],
    [hasValue(context.original_query) || hasValue(context.journey) || object(context.preference_transition).active === true, 'active_property_journey'],
    [hasValue(info.consultas_pendientes), 'pending_requests'],
    [rows(semantics.housing_quantities).some(quantity => quantity.dimension !== 'bedrooms' || quantity.role !== 'requirement'), 'household_recommendation'],
    [!['', 'not_discussed'].includes(text(budget.status)) || hasValue(object(info.lead).budget) || hasValue(object(info.lead).budget_max), 'budget_context'],
  ]
  const exclusion = exclusions.find(([excluded]) => excluded)
  if (exclusion) return { reason: exclusion[1], candidates: [], query }
  if (object(info.catalog_read).complete !== true || !catalog.length) return { reason: 'incomplete_catalog', candidates: [], query }
  const excluded = Array.isArray(property.excluded_categories) ? property.excluded_categories : []
  const candidates = filterCatalog(catalog, query).filter(unit => !excluded.includes(unit.category))
  return { reason: candidates.length ? 'eligible' : 'no_exact_candidates', candidates, query }
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
  if ('optimized' in plan && plan.optimized === true) return retrieveCompleteCatalog(info, current, plan.query, plan.request, dependencies)
  const started = Date.now()
  let tokens = 0
  let embeddingRequested = false, embeddingUsageRecorded = false
  const base = { enabled: object(info.catalog_search).embeddingsEnabled === true, model: MODEL,
    candidate_count: plan.candidates.length, selection_limit: LIMIT }
  const fallback = (reason: string) => ({ units: null, audit: { ...base, applied: false, reason,
    embedding_requested: embeddingRequested, embedding_usage_recorded: embeddingUsageRecorded,
    method: 'current_catalog', embedding_input_tokens: tokens, duration_ms: Date.now() - started } as Row })
  if (plan.reason !== 'eligible') return fallback(plan.reason)
  // An oversized or missing query uses the existing path without truncation.
  if (!current.trim() || current.length > 4000) return fallback('query_not_supported')
  try {
    const provider = dependencies ?? liveDependencies()
    embeddingRequested = true
    const embedded = await provider.embed(current)
    tokens = embedded.tokens
    embeddingUsageRecorded = Number.isSafeInteger(tokens) && tokens >= 0
    // At this catalog size, retrieve all scores within the authorized project,
    // then apply hard SQL-snapshot filters before limiting the writer's input.
    const matches = await provider.match(embedded.vector, rows(info.catalogo).length)
    const live = new Map(plan.candidates.map(unit => [text(unit.id), unit]))
    const ranked: { unit: Row; score: number }[] = []
    const seen = new Set<string>()
    const snapshotFields = ['unit_number', 'category', 'floor', 'floor_number', 'bedrooms', 'bathrooms_full',
      'area_internal_m2', 'area_exterior_m2', 'area_total_m2', 'description', 'spaces']
    for (const hit of matches) {
      const meta = object(hit.metadata), id = text(meta.unit_id), unit = live.get(id)
      if (!unit) continue
      if (seen.has(id) || meta.tenant_id !== scope.tenant_id || meta.project_id !== scope.project_id
        || meta.embedding_model !== MODEL || meta.embedding_dimensions !== DIMENSIONS || meta.index_version !== 'unit-facts-v1'
        || snapshotFields.some(key => JSON.stringify(meta[key] ?? null) !== JSON.stringify(unit[key] ?? null))
        || typeof hit.similarity !== 'number' || !Number.isFinite(hit.similarity)) return fallback('stale_or_invalid_index')
      seen.add(id)
      ranked.push({ unit, score: hit.similarity })
    }
    if (seen.size !== live.size) return fallback('incomplete_index')
    ranked.sort((a, b) => b.score - a.score || text(a.unit.id).localeCompare(text(b.unit.id)))
    const selected = ranked.filter(item => item.score >= 0.3 && item.score >= ranked[0].score - 0.12).slice(0, LIMIT)
    if (!selected.length) return fallback('low_similarity')
    return { units: selected.map(item => item.unit), audit: { ...base, applied: true,
      embedding_requested: embeddingRequested, embedding_usage_recorded: embeddingUsageRecorded,
      method: 'embeddings', reason: 'semantic_candidates', exhaustive: false,
      selected_unit_ids: selected.map(item => item.unit.id), similarities: selected.map(item => item.score),
      embedding_input_tokens: tokens, duration_ms: Date.now() - started } as Row }
  } catch {
    return fallback('search_unavailable')
  }
}

async function retrieveCompleteCatalog(info: Row, current: string, query: ReturnType<typeof catalogQuery>, request: Row, dependencies?: Dependencies) {
  const started = Date.now(), result = completeCatalogResult(info, query, request)
  const scores = new Map<string, number>()
  let requested = false, applied = false, tokens = 0, usageRecorded = false, rankingReason = 'not_needed_for_exact_query'
  if (request.purpose === 'search' && result.units.length && current.trim() && current.length <= 4000
    && (rows(request.requirements).length || Array.isArray(request.semantic_preferences) && request.semantic_preferences.length)) {
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
  const selection = selectCatalogExamples(result.units, request, scores)
  return { units: selection.units, audit: {
    version: 'catalog-retrieval-v2', enabled: true, optimized: true, applied, model: MODEL,
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

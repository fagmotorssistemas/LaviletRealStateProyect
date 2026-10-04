import type { WorkflowExecutionStep } from './executionWorkflow'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && !Array.isArray(v)) as Row[] : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
export const catalogNumber = (value: unknown): number | null =>
  (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null

export const CATALOG_SUMMARY_FIELDS = [
  ['area_internal_m2', 'Superficie interior', 'm²'], ['area_exterior_m2', 'Superficie exterior', 'm²'],
  ['area_total_m2', 'Superficie total', 'm²'],
  ['published_commercial_price', 'Precio publicado', 'USD'], ['floor_number', 'Planta', ''],
  ['bedrooms', 'Dormitorios', ''], ['bathrooms_full', 'Baños completos', ''],
] as const

/** Resolve only references inside this saved prompt; never consult today's catalog. */
function resolve(value: unknown, data: Row): unknown {
  const seen = new Set<string>()
  while (typeof row(value).ref === 'string') {
    const path = String(row(value).ref)
    if (seen.has(path) || seen.size >= 20) return undefined
    seen.add(path)
    value = path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object'
      && Object.prototype.hasOwnProperty.call(current, key) ? (current as Row)[key] : undefined, data)
  }
  return value
}

export function hasCatalogSummary(step: WorkflowExecutionStep) {
  const evidence = row(row(row(step.input.prompt_snapshot).data).evidencia_turno)
  return step.key === 'model_request' && ['writer', 'draft'].includes(String(step.input.ai_role))
    && (Array.isArray(evidence.units) || Array.isArray(evidence.groups))
}

const categories: Record<string, string> = { local: 'Locales comerciales', suite: 'Suites', departamento: 'Departamentos', penthouse: 'Penthouses' }
const sources: Record<string, string> = { query: 'Resultados de la consulta', context: 'Unidades del contexto', alternatives: 'Alternativas',
  complete_query: 'Todas las coincidencias confirmadas',
  comparison_context: 'Unidades de comparación', budget_alternatives: 'Alternativas de presupuesto', budget_matching: 'Dentro del presupuesto', current_price_quote: 'Cotización del turno' }

/** Display recorded aggregates verbatim. Missing ranges are never reconstructed from units. */
export function catalogSummaries(steps: WorkflowExecutionStep[]) {
  return [...steps].sort((a, b) => a.order - b.order).filter(hasCatalogSummary).map(step => {
    const snapshot = row(step.input.prompt_snapshot), data = row(snapshot.data), evidence = row(data.evidencia_turno)
    const verified = row(resolve(data.contexto_verificado, data)), scope = row(resolve(verified.catalog_context_scope, data))
    const audit = row(resolve(data.estado_operativo, data)), result = row(resolve(audit.catalog_results, data))
    const units = rows(evidence.units)
    const aggregate = row(resolve(evidence.catalog_summary, data))
    const optimized = aggregate.version === 'catalog-summary-v1'
    const partial = scope.complete === false || scope.kind === 'semantic_candidates' || result.complete === false
    const complete = !partial && scope.kind !== 'project_overview' && (scope.complete === true || result.complete === true)
    const retrieval = [...steps].filter(s => s.key === 'catalog_embedding_search' && s.order < step.order).sort((a, b) => b.order - a.order)[0]
    const groups = rows(evidence.groups).filter(g => g.aggregation === 'range' && (!optimized || g.source_scope === 'complete_query')).map(group => {
      const ids = resolve(group.member_ids, data)
      const members = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').map(id => {
        const unit = units.find(u => u.id === id || u.unit_number === id)
        const summaryIndex = Array.isArray(aggregate.matching_unit_ids) ? aggregate.matching_unit_ids.indexOf(id) : -1
        return text(unit?.unit_number) || (summaryIndex >= 0 && Array.isArray(aggregate.matching_unit_numbers) ? text(aggregate.matching_unit_numbers[summaryIndex]) : '') || id
      }) : null
      const title = [sources[text(group.source_scope)] || text(group.source_scope), categories[text(group.category)] || text(group.category),
        group.bedrooms_filter != null ? `${group.bedrooms_filter} dormitorios` : ''].filter(Boolean).join(' · ') || 'Grupo de unidades'
      return { id: text(group.id), title, members, ranges: CATALOG_SUMMARY_FIELDS.map(([field, label, unit]) => ({ field, label, unit,
        min: catalogNumber(group[field]), max: catalogNumber(row(group.upper_values)[field]) })) }
    })
    return { step: step.order, units, groups, scope, query: resolve(evidence.query, data),
      optimized, aggregate, requirements: rows(row(aggregate.request).requirements), unknownUnits: rows(aggregate.unknown_units),
      statistics: CATALOG_SUMMARY_FIELDS.map(([field, label, unit]) => { const stat = row(row(aggregate.statistics)[field]); return { field, label, unit,
        min: catalogNumber(stat.min), max: catalogNumber(stat.max), known: catalogNumber(stat.known_count), unknown: catalogNumber(stat.unknown_count) } }),
      completeness: partial ? 'partial' as const : complete ? 'complete' as const : 'unknown' as const,
      limited: snapshot.limited === true, privacyFiltered: snapshot.privacy_filtered === true,
      candidateCount: retrieval ? catalogNumber(retrieval.output.candidate_count) : null,
      retrievalApplied: retrieval?.output.applied === true, conflicts: rows(evidence.conflicts) }
  })
}

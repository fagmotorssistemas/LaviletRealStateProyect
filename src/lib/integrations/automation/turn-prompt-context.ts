import { object, text, type Row } from './data'

export const TURN_CONTEXT_REFERENCE_RULES = `El contexto usa una sola copia del catálogo en evidencia_turno.units y de sus agregaciones en evidencia_turno.groups. Un objeto con unit_ref remite a esa unidad; sus otros campos conservan datos particulares de esa aparición. Si contradicen la evidencia canónica, no los use para inventar un hecho. ref remite a la ruta indicada del mismo contexto. Son referencias internas, nunca texto para el cliente. Use las agregaciones calculadas para rangos y extremos; no convierta un rango en el precio de cada unidad. No interprete una referencia como ausencia de datos. Historial, borrador y base siguen sin ser evidencia de hechos nuevos.`
  + '\nSi catalog_context_scope.kind=semantic_candidates, se muestran algunas candidatas recuperadas por similitud, no todas las opciones. Verifique las características reales antes de presentarlas como compatibles. Los grupos y sus extremos solo describen las candidatas, nunca máximos, mínimos, totales ni ausencia de opciones en el proyecto. No atribuya una amenidad por el solo hecho de que una unidad fue recuperada.'
  + '\nSi contexto_verificado.catalog_context_scope indica complete_category, el catálogo cubre esa categoría. No deduzca que otras categorías no existen ni amplíe una afirmación a todo el proyecto. Use siempre el alcance y los miembros de la fuente citada.'
  + '\nSi catalog_context_scope.kind=project_overview, las unidades se omitieron porque esta presentación no las necesita: NO es una consulta con cero resultados ni prueba de falta de disponibilidad. No afirme precios, dimensiones, máximos ni ausencia de opciones a partir de ese catálogo omitido. Las fuentes de afirmaciones pueden referenciar su valor canónico mediante ref; consulte esa ruta, no la trate como una fuente vacía.'

export const CATALOG_SUMMARY_RULES = 'Si hay catalog_summary, matching_count es la cantidad de coincidencias confirmadas ANTES de elegir fichas; unknown_count son unidades pendientes de comprobar, no descartadas. exact_count=false impide afirmar un total exhaustivo. Use los grupos source_scope=complete_query para los rangos del conjunto confirmado: otros grupos pueden corresponder solo a ejemplos. No cuente las fichas incluidas para inferir el total. Las preferencias no garantizan características. Los límites con información faltante se describen solo entre datos conocidos. Ningún resumen autoriza afirmar disponibilidad fuera del alcance de su consulta.'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function optimizedCatalogPrompt(context: Row): boolean {
  return object(object(context.contexto_verificado).prompt_context_selection).version === 'task-context-v1'
    || ['optimized_catalog', 'semantic_candidates'].includes(text(object(object(context.contexto_verificado).catalog_context_scope).kind))
}

/** Diagnostic snapshots stay in the execution trace. This projection is used
 * only by the opt-in property retrieval route, never by validation or memory. */
function catalogModelContext(context: Row): Row {
  if (!optimizedCatalogPrompt(context)) return context
  const result = { ...context }, verified = { ...object(context.contexto_verificado) }
  const audit = object(context.estado_operativo)
  result.estado_operativo = Object.fromEntries(['source', 'profile_introduction', 'pending_question', 'catalog_coverage',
    'action', 'reservation', 'visit_result', 'handoff_result', 'action_result'].filter(k => audit[k] != null).map(k => [k, audit[k]]))
  for (const key of ['estado_operativo', 'catalog_retrieval', 'catalog_results', 'catalog_query', 'catalog_summary',
    'semantica_turno', 'solicitudes_interpretadas', 'referencia_unidad', 'hechos_confirmados', 'historial', 'catalogo',
    'siguiente_pregunta', 'continuidad_residencial', '_sales_memory', 'fecha']) delete verified[key]
  result.contexto_verificado = verified
  const contract = { ...object(result.contrato_redaccion) }
  for (const key of ['hechos_protegidos', 'hechos_disponibles', 'price_evidence']) delete contract[key]
  result.contrato_redaccion = contract
  if (object(verified.prompt_context_selection).version === 'task-context-v1') {
    const property = object(result.property_context)
    result.property_context = Object.fromEntries(['query', 'selected_ids', 'offered_ids', 'comparison_ids', 'phase',
      'preference_category', 'excluded_categories', 'pending_question', 'preference_transition'].filter(k => property[k] != null).map(k => [k, property[k]]))
    delete verified.conversacion
  }
  // Business-risk review uses current facts directly, not the former E-ID inventory.
  delete result.evidencia_afirmaciones
  const evidence = object(context.evidencia_turno)
  const groups = rows(evidence.groups)
  const complete = groups.filter(g => g.source_scope === 'complete_query')
  if (complete.length) result.evidencia_turno = { ...evidence, groups: [
    ...complete, ...groups.filter(g => g.source_scope !== 'complete_query' && !complete.some(c =>
      c.aggregation === g.aggregation && same([...rowsIds(c.member_ids)].sort(), [...rowsIds(g.member_ids)].sort()))) ] }
  // Numeric allowlists are an obsolete prose-scanning aid, not business facts.
  const protectedMaterial = object(result.material_protegido)
  if (result.material_protegido) result.material_protegido = Object.fromEntries(Object.entries(protectedMaterial).filter(([k]) => k !== 'cifras_permitidas'))
  return result
}
const rowsIds = (value: unknown): string[] => Array.isArray(value) ? value.map(text) : []

/** Model-only projection. Validation and the saved audit retain the complete original evidence. */
export function compactTurnPromptContext(context: Row, options: { preserveUnitIds?: boolean } = {}): Row {
  context = catalogModelContext(context)
  const evidence = object(context.evidencia_turno)
  const units = rows(evidence.units)
  const byId = new Map(units.map(unit => [text(unit.id), unit]))
  const alias = new Map<string, string>()
  // The reviewer normalizer already resolves unique unit numbers to real IDs.
  // Never alias ambiguous numbers or names that could collide with another ID.
  for (const unit of options.preserveUnitIds ? [] : units) {
    const id = text(unit.id), number = text(unit.unit_number)
    if (id && number && units.filter(candidate => text(candidate.unit_number) === number).length === 1
      && !units.some(candidate => text(candidate.id) === number && candidate.id !== id)) alias.set(id, number)
  }
  const canonicalPaths = ['contrato_turno', 'property_context', 'estado_operativo', 'historial_reciente']
    .filter(key => context[key] && JSON.stringify(context[key]).length > 40)
  const memberships = new Map<string, string>()
  const sourceValue = (path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, context)
  const visit = (value: unknown, path: string): unknown => {
    if (typeof value === 'string') {
      const key = path.replace(/\.\d+$/, '').split('.').at(-1) || ''
      return /^(?:id|ids|unit_ref)$|_ids?$/.test(key) ? alias.get(value) ?? value : value
    }
    if (Array.isArray(value)) {
      if (path.endsWith('.catalog_aggregate_groups') && path !== 'evidencia_turno.groups') {
        const groups = rows(evidence.groups)
        return value.map(group => { const index = groups.findIndex(g => g.id === object(group).id)
          return index >= 0 ? { ref: `evidencia_turno.groups.${index}` } : group })
      }
      if (path.startsWith('evidencia_turno.groups.') && path.endsWith('.member_ids')) {
        const key = JSON.stringify(value), previous = memberships.get(key)
        if (previous && key.length > previous.length + 12) return { ref: previous }
        if (!previous) memberships.set(key, path)
      }
      return value.map((item, index) => visit(item, `${path}.${index}`))
    }
    if (!value || typeof value !== 'object') return value
    const row = object(value)
    if (path.endsWith('.catalog_summary') && path !== 'evidencia_turno.catalog_summary'
      && evidence.catalog_summary && same(row, evidence.catalog_summary)) return { ref: 'evidencia_turno.catalog_summary' }
    // Preserve every source and its provenance, without repeating the same
    // policy/project/operation payload already available at its canonical path.
    // A stale path or differing value must remain visible to the reviewer.
    if (/^evidencia_afirmaciones\.\d+$/.test(path) && 'value' in row
      && /^(?:contexto_verificado|estado_operativo)\./.test(text(row.path))
      && same(row.value, sourceValue(text(row.path)))) return {
      ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'value')
        .map(([key, entry]) => [key, visit(entry, `${path}.${key}`)])),
      value: { ref: row.path },
    }
    const canonicalPath = !canonicalPaths.includes(path)
      ? canonicalPaths.find(key => !key.startsWith(path + '.') && same(row, context[key])) : undefined
    if (canonicalPath) return { ref: canonicalPath }
    const unit = byId.get(text(row.id))
    // Deduplicate only repeated values. Extra or conflicting fields are retained,
    // never overwritten from the canonical catalog to make an answer appear valid.
    if (unit && !path.startsWith('evidencia_turno.units.')) return {
      unit_ref: alias.get(text(unit.id)) ?? unit.id,
      ...Object.fromEntries(Object.entries(row).filter(([key, entry]) => !same(entry, unit[key]))
        .map(([key, entry]) => [key, visit(entry, `${path}.${key}`)])),
    }
    return Object.fromEntries(Object.entries(row).map(([key, entry]) => [key, visit(entry, path ? `${path}.${key}` : key)]))
  }
  return visit(context, '') as Row
}

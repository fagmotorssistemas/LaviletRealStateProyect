const reasons: Record<string, string> = {
  disabled: 'El interruptor estaba desactivado.',
  exact_catalog_query: 'El código comprobó los requisitos y calculó cantidades y rangos antes de seleccionar fichas.',
  complete_filtered_catalog: 'El código comprobó todos los requisitos; los embeddings ordenaron las coincidencias confirmadas sin excluirlas por similitud.',
  requires_full_commercial_context: 'Esta consulta combina necesidades o decisiones que todavía conservan el contexto comercial anterior.',
  prices_not_authorized: 'La política no autoriza precios; se conserva el recorrido comercial anterior.',
  structured_query_unavailable: 'No hay una consulta estructurada con certeza suficiente; se conserva el recorrido anterior completo.',
  semantic_candidates: 'Se seleccionaron candidatas por similitud y se consultaron sus fichas actuales.',
  requires_current_search: 'Esta ejecución histórica conservó la búsqueda anterior; no registró cuál condición concreta la excluyó.',
  requires_complete_catalog: 'La consulta necesita el catálogo completo para responder totales, rangos o extremos.',
  specific_facts_required: 'La consulta requiere precios u otros datos exactos de la búsqueda anterior.',
  unsupported_objective: 'El objetivo queda fuera de las búsquedas sencillas habilitadas.',
  multiple_or_non_property_requests: 'Hay varias solicitudes o una petición que no es de búsqueda de inmuebles.',
  uncertain_interpretation: 'La interpretación no tiene suficiente certeza para reducir el catálogo.',
  operation_requires_current_search: 'La operación requiere detalles, comparación, ordenación u otro recorrido del catálogo.',
  unit_reference_or_selection: 'Hay una unidad seleccionada, una referencia o una aclaración pendiente.',
  active_property_journey: 'Se está continuando una búsqueda de alternativas o un cambio de preferencias.',
  pending_requests: 'Quedan consultas anteriores pendientes de respuesta.',
  household_recommendation: 'La recomendación por necesidades familiares conserva el catálogo anterior.',
  budget_context: 'Hay un presupuesto que debe contrastarse con la búsqueda anterior.',
  incomplete_catalog: 'No se obtuvo una lectura completa del catálogo para preparar la búsqueda.',
  no_exact_candidates: 'No hay candidatas con los filtros exactos; se conserva el recorrido anterior.',
  query_not_supported: 'El texto está vacío o excede el tamaño admitido en esta etapa.',
  stale_or_invalid_index: 'El índice no coincide con las fichas actuales.',
  incomplete_index: 'El índice no cubre todas las candidatas de la consulta.',
  low_similarity: 'La búsqueda no obtuvo coincidencias con suficiente similitud.',
  search_unavailable: 'La búsqueda por embeddings no estuvo disponible; se continuó con la búsqueda anterior.',
}

const rankingReasons: Record<string, string> = {
  not_needed_for_exact_query: 'Los filtros exactos bastaron; no se solicitó ordenación por similitud.',
  disabled: 'La ordenación por similitud estaba desactivada.',
  similarity_orders_confirmed_matches: 'La similitud ordenó unidades que ya cumplían los requisitos exactos.',
  semantic_ranking_unavailable: 'La ordenación semántica no estuvo disponible; se conservaron el filtrado y el resumen completos.',
  no_confirmed_matches: 'No hubo coincidencias confirmadas que ordenar; no se solicitó una consulta vectorial.',
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

/** A configured model is not proof of a provider call. Historical records
 * without request diagnostics remain unknown, even when a model is present. */
export function catalogSearchDiagnostics(output: Record<string, unknown>) {
  const plannedModel = text(output.embedding_model_planned) || text(output.model) || 'Sin registro'
  const model = text(output.embedding_model_consulted)
  const requested = model ? true : Object.hasOwn(output, 'embedding_model_consulted')
    ? output.embedding_model_consulted === null ? false : null
    : typeof output.embedding_requested === 'boolean' ? output.embedding_requested : null
  const consultedModel = requested === true ? model || text(output.model) || 'Sin registro'
    : requested === false ? 'No se consultó' : 'Sin registro de consulta'
  const method = output.method === 'structured_catalog_and_embeddings' ? 'Filtros exactos y ordenación vectorial'
    : output.method === 'structured_catalog' || output.optimized === true && output.applied !== true ? 'Filtros exactos, sin ordenación vectorial'
      : output.method === 'embeddings' || output.applied === true ? 'Consulta vectorial por similitud'
        : output.method === 'current_catalog' ? 'Catálogo anterior, sin reducción por búsqueda' : 'Método sin registrar'
  const rankingReason = rankingReasons[String(output.ranking_reason)] || null
  const querySource = output.query_source === 'catalog_request' ? 'Solicitud estructurada del catálogo'
    : output.query_source === 'resolved_property_query' ? 'Consulta de inmuebles resuelta' : null
  return { plannedModel, consultedModel, requested, method, rankingReason, querySource }
}

export function catalogSearchExplanation(output: Record<string, unknown>) {
  const applied = output.applied === true
  const diagnostics = catalogSearchDiagnostics(output)
  if (output.optimized === true) {
    const title = applied ? 'Catálogo filtrado y ordenado por embeddings' : 'Consulta exacta con contexto reducido'
    const reason = (reasons[String(output.reason)] || reasons.exact_catalog_query)
      + (diagnostics.rankingReason ? ` ${diagnostics.rankingReason}` : '')
    return { title, reason, summary: `${title}. ${output.matched_count} coincidencias confirmadas; ${output.unknown_count} unidades sin datos suficientes; ${output.selected_count} fichas incluidas. ${reason}` }
  }
  const title = applied ? 'Embeddings utilizados' : output.applied === false ? 'Búsqueda anterior utilizada' : 'Búsqueda: resultado sin registrar'
  const reason = (reasons[String(output.reason)] || 'Consulte el motivo técnico registrado; no hay una explicación disponible para este código.')
    + (diagnostics.rankingReason ? ` ${diagnostics.rankingReason}` : '')
  const selected = Array.isArray(output.selected_unit_ids) ? output.selected_unit_ids.length : 0
  return { title, reason, summary: applied
    ? `${title}: ${selected} candidatas. ${reason} La selección no representa el catálogo completo.`
    : `${title}. ${reason} La presencia de este paso no significa que se hayan utilizado embeddings.` }
}

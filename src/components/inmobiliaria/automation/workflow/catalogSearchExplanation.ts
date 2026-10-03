const reasons: Record<string, string> = {
  disabled: 'El interruptor estaba desactivado.',
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

export function catalogSearchExplanation(output: Record<string, unknown>) {
  const applied = output.applied === true
  const title = applied ? 'Embeddings utilizados' : output.applied === false ? 'Búsqueda anterior utilizada' : 'Búsqueda: resultado sin registrar'
  const reason = reasons[String(output.reason)] || 'Consulte el motivo técnico registrado; no hay una explicación disponible para este código.'
  const selected = Array.isArray(output.selected_unit_ids) ? output.selected_unit_ids.length : 0
  return { title, reason, summary: applied
    ? `${title}: ${selected} candidatas. ${reason} La selección no representa el catálogo completo.`
    : `${title}. ${reason} La presencia de este paso no significa que se hayan utilizado embeddings.` }
}

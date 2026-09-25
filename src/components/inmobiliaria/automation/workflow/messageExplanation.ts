import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { reviewDecision } from './reviewDecision'

type Row = Record<string, unknown>
export type ExplanationFact = { label: string; value: string }
export type ExplanationSection = { title: string; description: string; facts: ExplanationFact[] }
export type CatalogSnapshot = { id: string; unit_number: string; category: string; bedrooms?: unknown; floor_number?: unknown; area_internal_m2?: unknown; area_exterior_m2?: unknown }
export type StepExplanation = {
  coverageSections: ExplanationSection[] | null,
  title: string; summary: string; used: ExplanationFact[]; found: ExplanationFact[]
  origin: string; reason: string; rule: string; outcome: string; review: string
  cause: WorkflowExecutionStep | null; missingCause: boolean
  setting: { label: string; kind: string; href: string | null; source: string | null } | null
  units: CatalogSnapshot[]; linkedActions: WorkflowExecutionStep[]
}
export const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const str = (value: unknown) => typeof value === 'string' ? value : ''
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const has = (value: Row, key: string) => Object.hasOwn(value, key)
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const labels: Record<string, string> = {
  token_usage: 'Consumo de tokens de esta llamada', input_tokens: 'Tokens de entrada', output_tokens: 'Tokens de salida', total_tokens: 'Tokens totales', cached_input_tokens: 'Tokens de entrada en caché',
  semantic_review: 'Afirmaciones y evidencia revisadas', opening_decision: 'Apertura decidida por el sistema', query_transition: 'Cambio de filtros de la consulta',
  message: 'Mensaje utilizado', original_message: 'Mensaje original', property_message: 'Parte inmobiliaria',
  scope: 'Alcance', uncertain: 'Interpretación incierta', method: 'Método', confidence: 'Confianza', primary_intent: 'Intención principal',
  operation: 'Operación', property_category: 'Categoría', property_group: 'Grupo', filters: 'Filtros', selector: 'Criterio', query_scope: 'Conjunto consultado',
  query: 'Consulta', catalog_query: 'Consulta', before: 'Antes', after: 'Después', previous_filters: 'Filtros anteriores', effective_filters: 'Filtros efectivos',
  bedrooms: 'Dormitorios', bedrooms_required: 'Dormitorios como requisito', floor_number: 'Planta', min_area_m2: 'Superficie mínima', max_area_m2: 'Superficie máxima',
  category: 'Categoría', group: 'Grupo', request_count: 'Solicitudes reconocidas', answers_question: 'Pregunta a la que responde', answer_kind: 'Sentido de la respuesta',
  reference_reason: 'Referencia utilizada', needs_clarification: 'Necesita aclaración', has_previous_summary: 'Hay memoria anterior',
  messages_in_batch: 'Mensajes procesados juntos', has_media: 'Incluye archivo', history_messages: 'Mensajes de contexto',
  catalog_units: 'Unidades consultadas', catalog_matches: 'Coincidencias', financing_partners: 'Entidades disponibles', required: 'Consulta necesaria',
  requested_advisor: 'Solicitud explícita de asesor', requested_visit: 'Solicitud de visita', opt_out: 'Baja de seguimiento',
  request_registered: 'Solicitud registrada', registration_verified: 'Registro comprobado', pending_question: 'Pregunta pendiente', question: 'Pregunta',
  target_ids: 'Referente de la pregunta', candidate_ids: 'Opciones de la pregunta', candidate_unit_ids: 'Unidades candidatas', result_unit_ids: 'Unidades encontradas',
  selected_unit_ids: 'Unidades elegidas', offered_unit_ids: 'Unidades ofrecidas', unit_ids: 'Unidades',
  response_preview: 'Vista previa de respuesta', base_preview: 'Respuesta base', proposed_preview: 'Redacción propuesta', final_preview: 'Respuesta conservada',
  base_reply_preview: 'Respuesta base', proposed_reply_preview: 'Redacción propuesta', final_reply_preview: 'Respuesta conservada',
  response_length: 'Caracteres de respuesta', status: 'Estado', action: 'Acción', reason: 'Motivo',
  coverage_status: 'Estado de la revisión', coverage_locked: 'Protección frente a revisión', turn_completeness_checked: 'Se revisó la cobertura',
  handoff_status: 'Estado de la derivación', assigned_advisor: 'Hay asesor asignado', bot_remains_enabled: 'El bot permanece activo',
  memory_saved: 'Memoria guardada', remaining_requests: 'Solicitudes pendientes', delivery_confirmed: 'Entrega al teléfono confirmada', response_registered: 'Respuesta registrada',
  requests: 'Solicitudes revisadas', fragment: 'Fragmento', request: 'Solicitud', intent: 'Intención', request_type: 'Tipo de solicitud', base_status: 'Cobertura en la base', evidence: 'Evidencia',
  missing_fact_fragments: 'Datos considerados faltantes', verified_missing_fact_fragments: 'Faltantes contrastados', unresolved: 'Consultas pendientes', needs_advisor: 'Revisión solicita asesor',
  handoff_required: 'Derivación requerida', needsAdvisor: 'Revisión solicita asesor', handoff_origin: 'Origen de derivación',
  complete: 'Datos completos', count: 'Cantidad', same: 'Valores iguales', min: 'Mínimo', max: 'Máximo', interior: 'Superficie interior', exterior: 'Superficie exterior',
  area_internal_m2: 'Superficie interior (m²)', area_exterior_m2: 'Superficie exterior (m²)', outcome: 'Resultado', facts: 'Datos contrastados',
  catalog_comparison: 'Comparación calculada', candidate_count: 'Cantidad de candidatas', reference_unit_ids: 'Unidades interpretadas', reference_needs_clarification: 'Referencia por aclarar',
  handoff_assessments: 'Contraste de los posibles faltantes', fact_key: 'Dato solicitado', review_status: 'Estado de la revisión', pending_commercial_handoff: 'Consulta comercial pendiente',
  source: 'Ruta registrada', result: 'Resultado', task: 'Tarea del modelo', model: 'Modelo utilizado', prompt_revision: 'Versión de las instrucciones utilizadas', instructions_version: 'Versión de las instrucciones utilizadas', issues: 'Controles que rechazaron el borrador',
  price_evidence: 'Precios contrastados con el catálogo actual', price_usd: 'Precio verificado en USD', approximate: 'Precio aproximado', units: 'Unidades verificadas', repair_attempts: 'Intentos de reparación del mensaje o de su ficha interna',
  property_excluded_categories: 'Categorías descartadas', unit_number: 'Número de unidad',
}
const values: Record<string, string> = {
  price_unit_mismatch: 'El importe no corresponde a la unidad mencionada', price_unit_outside_query: 'Se menciona una unidad ajena a la consulta de precios', verified_price_omitted: 'Falta un precio verificado solicitado',
  invalid_coverage: 'Borrador descartado: ficha interna de redacción inválida',
  residential: 'Viviendas', commercial: 'Locales comerciales', property: 'Consulta inmobiliaria', mixed: 'Consulta inmobiliaria y otro tema', neutral: 'Sin intención comercial definida', out_of_scope: 'Consulta ajena al proyecto',
  search: 'Buscar opciones', rank: 'Ordenar opciones', compare: 'Comparar', select: 'Elegir una unidad', details: 'Mostrar detalles', none: 'Ninguno',
  catalog: 'Catálogo disponible', offered: 'Opciones ofrecidas', comparison: 'Opciones en comparación', selected: 'Unidades elegidas',
  largest: 'Mayor superficie', smallest: 'Menor superficie', cheapest: 'Menor precio', most_expensive: 'Mayor precio', first: 'Primera opción', last: 'Última opción',
  high: 'Alta', medium: 'Media', low: 'Baja', affirmative: 'Acepta', negative: 'Rechaza', model: 'Interpretación con IA', literal_greeting: 'Saludo literal', unreadable_input: 'Entrada sin texto interpretable',
  answered: 'Atendida', unanswered: 'No atendida', missing_fact: 'Dato considerado faltante', clarification: 'Se pide aclaración', outside_scope: 'Fuera del alcance',
  checked: 'Revisión completada', rejected_guard: 'Borrador rechazado por un control', rejected_review: 'Borrador rechazado en revisión', unavailable: 'Revisión no disponible',
  rejected_catalog_guard: 'Reescritura rechazada por datos del catálogo', rejected_price_guard: 'Reescritura rechazada por precios',
  explicit_request: 'Petición explícita del cliente', customer_request: 'Petición explícita del cliente', client_request: 'Petición explícita del cliente',
  coverage: 'Revisión de cobertura', response_coverage: 'Revisión de cobertura', coverage_review: 'Revisión de cobertura', operational_failure: 'Problema operativo', operational_recovery: 'Recuperación operativa',
  deterministic_catalog: 'Consulta calculada del catálogo', catalog_tool: 'Herramienta de catálogo', interpretation: 'Interpretación del mensaje',
  assigned: 'Asignado', queued: 'En cola', acknowledged: 'Reconocido por el equipo', accepted: 'Kommo aceptó iniciar el envío',
  succeeded: 'Paso completado', failed: 'Paso con error', skipped: 'Paso omitido', paused: 'Paso detenido', confirmed: 'Confirmado',
  ask_price: 'Consulta de precio', ask_financing: 'Consulta financiera', request_visit: 'Solicita visita', ask_property: 'Consulta sobre una propiedad',
  show_unit_details: 'Mostrar detalles de la unidad', choose_unit: 'Elegir unidad', choose_category: 'Elegir categoría', choose_floor: 'Elegir planta',
  code: 'Regla del código', prompt: 'Instrucciones del bot', data: 'Datos del proyecto', configuration: 'Configuración',
  specific_fact: 'Dato concreto', general_information: 'Información general', courtesy: 'Cortesía', action: 'Acción',
  client: 'Petición del cliente', memory: 'Memoria y continuidad', operational: 'Operación del sistema', policy: 'Reglas de atención',
  query_resolved: 'Consulta resuelta', clarification_required: 'Se necesita aclarar la consulta', base_reply_prepared: 'Respuesta base preparada',
  no_handoff: 'No requiere derivación', handoff_required: 'Requiere derivación', answered_by_catalog: 'El catálogo ya responde la consulta',
  writing: 'Redacción', review: 'Revisión', extraction: 'Interpretación', structured_result_received: 'Resultado estructurado recibido',
  catalog_compare: 'Comparación del catálogo', catalog_search: 'Búsqueda del catálogo', catalog_rank: 'Ordenación del catálogo', catalog_select: 'Selección de unidad', catalog_details: 'Detalles de unidad',
  numbers_changed: 'Cifras no conservadas o no permitidas', links_changed: 'Enlaces cambiados', unsupported_fact: 'Dato sin respaldo',
  unit_fact_mismatch_or_invalid: 'Un valor atribuido a una unidad no coincide con el catálogo, o la lista de datos extraídos es inválida',
  invalid_review_metadata: 'Ficha interna del revisor inválida; no significa por sí solo que el mensaje comercial tenga datos incorrectos',
  review_fragment_not_in_reply: 'El revisor citó un fragmento que no aparece literalmente en el mensaje propuesto',
  catalog_value_mismatch: 'El valor registrado por el revisor no coincide con el catálogo de esa unidad',
  invalid_unit_fact: 'La referencia a la unidad o al atributo en la ficha del revisor es inválida',
  review_repair_omitted_facts: 'La reparación omitió relaciones que debía volver a comprobar',
  semantic_claims_unsupported_or_invalid: 'La revisión semántica no respaldó todas las afirmaciones o devolvió evidencia inválida',
}
const ruleLabels: Record<string, string> = {
  'property.resolve_query': 'Resolver referencias y mantener los filtros de búsqueda',
  'coverage.verify_information_gap': 'Contrastar los datos que la revisión considera faltantes',
  'advisor.verified_information_gap': 'Derivar una consulta concreta que necesita verificación',
  'advisor.explicit_request': 'Atender la solicitud explícita de un asesor',
  'visit.parser_unavailable': 'Solicitar ayuda cuando la coordinación automática no está disponible',
  'visit.registration_unverified': 'Comprobar una solicitud de visita cuyo registro no pudo verificarse',
  'visit.team_attendance_unverified': 'Verificar la cita y la asistencia del equipo',
  'visit.mixed_scope': 'Separar una visita inmobiliaria de otra gestión',
  'project.location_missing': 'Obtener una ubicación verificada',
  'financing.processing_failed': 'Comprobar el estado de una revisión financiera tras un fallo',
  'financing.unknown_state': 'Revisar un estado financiero no reconocido',
  'financing.ready_for_handoff': 'Pasar al equipo los datos listos para revisión',
  'price.unverified_for_visit': 'Verificar el precio solicitado antes de coordinar la visita',
}
const titles: Record<string, string> = {
  execution_version: 'Versión y lote', message_received: 'Mensaje recibido', response_permission: 'Permiso para responder', commercial_context: 'Contexto de la conversación',
  scope_classification: 'Alcance de la consulta', decision_context: 'Datos disponibles', semantic_extraction: 'Interpretación del mensaje', catalog_resolution: 'Búsqueda y referencias',
  dialogue_decision: 'Decisión de respuesta', response_coverage: 'Revisión de la respuesta', advisor_handoff: 'Derivación al asesor',
  route_selected: 'Ruta aplicada', response_validation: 'Validación final', message_delivery: 'Envío a Kommo', state_persisted: 'Memoria y seguimientos',
  execution_exit: 'Resultado de la ejecución', execution_failed: 'Interrupción', visit_coordination: 'Coordinación de visita', visit_intent: 'Decisión sobre la visita', visit_result: 'Resultado de la visita',
}

export function statusLabel(status: string) { return values[status] || status.replaceAll('_', ' ') }
export function stepTitle(step: WorkflowExecutionStep) {
  if (step.key === 'draft_validation') return 'Código · Aceptación o rechazo del borrador'
  if (step.key === 'model_request') {
    const roles: Record<string, string> = { scope: 'IA · Clasificador de alcance', extractor: 'IA · Extractor de intención y datos', writer: 'IA · Redactor de respuesta', reviewer: 'IA · Revisor de respuesta', draft: 'IA · Generador de borrador', interpretation: 'IA · Interpretación de datos', media: 'IA · Lectura de archivo o imagen' }
    return roles[String(step.input.ai_role)] || 'IA · Llamada histórica (función no registrada)'
  }
  return titles[step.key] || step.label || 'Paso registrado'
}
export function decisionRecord(step: WorkflowExecutionStep) {
  const output = row(step.output.decision)
  return Object.keys(output).length ? output : row(step.input.decision)
}

/** Never replace a historical snapshot with today's catalogue. */
export function catalogSnapshots(execution: WorkflowExecution, step: WorkflowExecutionStep): CatalogSnapshot[] {
  const units = new Map<string, CatalogSnapshot>()
  for (const item of [...execution.steps].filter(item => item.order <= step.order).sort((a, b) => a.order - b.order)) {
    for (const candidate of [...rows(item.output.catalog_snapshot), ...rows(row(item.output.catalog_results).units), ...rows(item.output.review_reference_snapshot)]) {
      if (str(candidate.id) && str(candidate.unit_number)) units.set(str(candidate.id), {
        id: str(candidate.id), unit_number: str(candidate.unit_number), category: str(candidate.category), bedrooms: candidate.bedrooms,
        floor_number: candidate.floor_number, area_internal_m2: candidate.area_internal_m2, area_exterior_m2: candidate.area_exterior_m2,
      })
    }
  }
  return [...units.values()]
}

export function humanValue(value: unknown, snapshots: CatalogSnapshot[] = [], key = '', depth = 0): string {
  if (value === null || value === undefined || value === '') return 'Sin dato registrado'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number') return new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 }).format(value)
  if (Array.isArray(value)) {
    if (!value.length) return 'Ninguno registrado'
    if (/_ids$/.test(key)) {
      const known = value.flatMap(id => snapshots.filter(unit => unit.id === id))
      const missing = value.length - known.length
      return [...known.map(unit => `${unit.category || 'Unidad'} ${unit.unit_number}`), ...(missing ? [`${missing} unidad${missing > 1 ? 'es' : ''} sin número registrado`] : [])].join(', ')
    }
    return value.slice(0, 12).map(item => humanValue(item, snapshots, key, depth + 1)).join(' · ')
  }
  if (typeof value === 'object') {
    if (depth > 3) return 'Detalle disponible en el registro técnico'
    if (key === 'query' || key === 'catalog_query') return queryDescription(value, snapshots) || 'Sin consulta registrada'
    if (key === 'filters' && !Object.values(row(value)).some(item => item !== null && item !== undefined)) return 'Sin filtros adicionales registrados'
    return Object.entries(row(value)).filter(([name]) => labels[name]).map(([name, item]) => `${labels[name]}: ${humanValue(item, snapshots, name, depth + 1)}`).join(' · ') || 'Detalle disponible en el registro técnico'
  }
  const text = str(value)
  const unit = snapshots.find(item => item.id === text)
  if (unit) return `${unit.category || 'Unidad'} ${unit.unit_number}`
  if (UUID.test(text)) return 'Identificador interno; consulte el registro técnico'
  return values[text] || text.replaceAll('_', ' ')
}

function queryDescription(value: unknown, snapshots: CatalogSnapshot[]) {
  const query = row(value), filters = row(query.filters)
  if (!Object.keys(query).length) return ''
  const description = ['group', 'category', 'operation', 'scope', 'selector'].filter(key => query[key] != null && query[key] !== '').map(key => humanValue(query[key], snapshots, key))
  const active = Object.entries(filters).filter(([, value]) => value !== null && value !== undefined)
  description.push(active.length ? active.map(([key, value]) => `${labels[key] || key}: ${humanValue(value)}`).join(', ') : 'Sin filtros adicionales registrados')
  return description.join(' · ')
}

const fact = (label: string, value: string): ExplanationFact => ({ label, value })
function coverageSections(output: Row): ExplanationSection[] {
  const status = str(output.status)
  const invalid = status === 'invalid_coverage'
  const checked = status === 'checked'
  const attempts = rows(output.repair_attempts)
  const requests = rows(output.requests)
  const present = (key: string, label: string): ExplanationFact => ({ label, value: str(output[key]) || 'No se conservó este texto en el registro.' })
  const selection = invalid ? 'Se descartó la propuesta por información interna inválida; no se completó la revisión del contenido.'
    : checked ? 'La propuesta superó la revisión de este paso. Los pasos posteriores aún pueden modificarla.'
      : status ? `Resultado registrado: ${humanValue(status)}. Consulte la respuesta conservada y los controles.`
        : 'No se guardó el resultado de la revisión; no se puede determinar si se aceptó la propuesta.'
  return [
    { title: 'Respuesta elegida en este paso', description: 'El borrador es el texto propuesto por la IA, todavía sujeto a validación. Descartarlo significa utilizar otra respuesta, no dejar al cliente sin contestación. El envío se comprueba en el paso de Kommo.', facts: [
      { label: 'Qué ocurrió', value: selection }, present('final_preview', 'Respuesta conservada'), present('proposed_preview', 'Propuesta de la IA (borrador)'), present('base_preview', 'Respuesta base de respaldo'),
    ] },
    { title: 'Error detectado', description: 'Estos controles explican el rechazo de la propuesta. Un error en requests significa que falló la lista interna de solicitudes; no demuestra que el texto comercial fuera incorrecto.', facts: [
      { label: 'Controles registrados', value: Array.isArray(output.issues) && output.issues.length ? humanValue(output.issues) : checked ? 'No se registraron controles fallidos al terminar este paso.' : 'No se conservó el detalle del control fallido. No se deduce de la redacción.' },
      ...(rows(row(output.semantic_review).validation_details).length ? reviewDecision(output).causes.map(value => ({ label: 'Causa agrupada', value })) : []),
    ] },
    { title: 'Decisiones y evidencia', description: 'El sistema conserva las aperturas elegidas y controla las repeticiones; una apertura vacía permite cortesía opcional. La revisión semántica contrasta las afirmaciones y el código comprueba sus referencias y valores.', facts: [
      { label: 'Apertura', value: output.opening_decision ? humanValue(output.opening_decision) : 'No registrada' },
      { label: 'Cambio de filtros', value: output.query_transition && Object.keys(row(output.query_transition)).length ? humanValue(output.query_transition) : 'No se registró un cambio de alcance.' },
      { label: 'Afirmaciones contrastadas', value: output.semantic_review ? humanValue(output.semantic_review) : 'Este registro no incluye revisión por afirmaciones.' },
    ] },
    { title: 'Intento de reparación', description: 'Indica si se pidió a la IA corregir un resultado inválido antes de conservar o descartar su propuesta.', facts: attempts.length ? attempts.map((attempt, index) => ({
      label: `Intento ${index + 1}${attempt.target === 'review_metadata' ? ' · Reparación de la ficha del revisor, conservando el mensaje' : ''}`, value: `Error inicial: ${humanValue(attempt.status)}. Controles: ${humanValue(attempt.issues)}. Resultado final: ${attempt.final_status ? humanValue(attempt.final_status) : 'No registrado; consulte el resultado general de este paso.'}`,
    })) : [{ label: 'Reparaciones registradas', value: 'No se registró ningún intento de reparación en esta ejecución.' }] },
    { title: 'Solicitudes del cliente atendidas', description: 'La revisión de cobertura comprueba qué pidió el cliente y si la respuesta atiende cada solicitud. Una lista vacía no certifica que todo esté resuelto.', facts: [
      { label: 'Alcance de la revisión', value: invalid ? 'La lista interna no pudo validarse. La revisión de contenido no se completó.' : checked ? 'Revisión completada en este paso.' : 'No hay una revisión aprobada registrada. Las clasificaciones siguientes, si existen, no acreditan cobertura completa.' },
      ...(invalid || !requests.length ? [{ label: 'Solicitudes', value: invalid ? 'Lista rechazada; no hay solicitudes validadas que mostrar.' : 'No se conservó una lista de solicitudes en este registro.' }] : requests.map((request, index) => ({ label: `Solicitud ${index + 1}`, value: `Cliente: ${str(request.fragment) || 'Fragmento no registrado'}. Estado propuesto: ${humanValue(request.status)}. Respaldo indicado: ${str(request.evidence) || 'No registrado'}` }))),
      { label: 'Consultas pendientes registradas', value: Array.isArray(output.unresolved) && output.unresolved.length ? humanValue(output.unresolved) : 'No se registraron consultas pendientes. Esto no equivale a comprobar que se respondió todo.' },
      ...(output.price_evidence ? [{ label: 'Evidencia de precios', value: humanValue(output.price_evidence) }] : []),
    ] },
    { title: 'Datos evaluados para solicitar un asesor', description: 'Esta evaluación es independiente de aceptar o descartar la redacción. Un error interno no implica por sí solo que haga falta un asesor.', facts: [
      { label: '¿La revisión solicita un asesor?', value: output.needs_advisor === true ? 'Sí. Esto registra la necesidad; el envío al asesor debe comprobarse en el paso de derivación.' : output.needs_advisor === false ? 'No. Esta revisión no solicitó una derivación.' : 'No quedó registrado.' },
      { label: 'Datos considerados faltantes', value: Array.isArray(output.missing_fact_fragments) && output.missing_fact_fragments.length ? humanValue(output.missing_fact_fragments) : 'No se registraron datos considerados faltantes.' },
      { label: 'Comprobación de esos faltantes', value: Array.isArray(output.handoff_assessments) && output.handoff_assessments.length ? humanValue(output.handoff_assessments) : 'No se registró un contraste de posibles faltantes.' },
    ] },
  ]
}

export function explainStep(execution: WorkflowExecution, step: WorkflowExecutionStep): StepExplanation {
  const input = step.input, output = step.output, decision = decisionRecord(step), snapshots = catalogSnapshots(execution, step)
  const used = Object.entries(input).filter(([key]) => labels[key] && !['decision', 'query', 'catalog_query'].includes(key))
    .map(([key, value]) => fact(labels[key], humanValue(value, snapshots, key)))
  const found = Object.entries(output).filter(([key]) => labels[key] && !['decision', 'query', 'catalog_query', 'coverage_locked'].includes(key))
    .map(([key, value]) => fact(labels[key], humanValue(value, snapshots, key)))
  const query = output.catalog_query || output.query || input.catalog_query || input.query
  const queryText = queryDescription(query, snapshots)
  if (step.key === 'catalog_resolution') {
    const before = row(input.previous_query), after = row(query)
    const oldFilters = row(before.filters), applied = row(after.filters), supplied = row(input.filters)
    if (after.category && after.category !== before.category) found.push(fact('Qué cambió', `La categoría pasó a ${humanValue(after.category)}.`))
    for (const key of ['bedrooms', 'floor_number', 'min_area_m2', 'max_area_m2']) {
      if (applied[key] != null && oldFilters[key] === applied[key] && supplied[key] == null) {
        found.push(fact('Qué se conservó de la memoria', `${labels[key]}: ${humanValue(applied[key])}. No se indicó un valor nuevo en este mensaje; el sistema mantuvo el de la consulta anterior.`))
      } else if (oldFilters[key] != null && oldFilters[key] !== applied[key]) {
        found.push(fact('Qué filtro cambió', `${labels[key]}: antes ${humanValue(oldFilters[key])}; ahora ${applied[key] == null ? 'sin restricción activa' : humanValue(applied[key])}.`))
      }
    }
    if (queryText) found.push(fact('Qué se buscó con esa decisión', queryText))
    const next = execution.steps.find(item => item.order > step.order && item.key === 'dialogue_decision')
    const results = row(next?.output.catalog_results)
    if (next?.output.catalog_coverage && row(next.output.catalog_coverage).status === 'no_results'
      || results.complete === true && Array.isArray(results.unit_ids) && !results.unit_ids.length) {
      found.push(fact('Resultado de la búsqueda registrada', 'No se encontraron unidades para esa consulta. La ausencia de coincidencias corresponde a estos filtros, no a todo el catálogo.'))
    }
    if (!Object.keys(before).length) used.push(fact('Memoria anterior', 'No hay una consulta anterior registrada en este paso.'))
  }
  if (queryText) used.push(fact('Consulta ejecutada', queryText))
  if (has(output, 'coverage_locked')) found.push(fact('Revisión posterior', output.coverage_locked === false
    ? 'Permitida. Este dato no significa que falte información ni que se haya solicitado un asesor.' : 'La respuesta estaba protegida frente a una reescritura posterior.'))
  if (has(output, 'pending_question')) {
    const pending = row(output.pending_question)
    const field = found.find(item => item.label === labels.pending_question)
    if (field) field.value = str(pending.question) || 'Esta decisión no dejó una pregunta pendiente.'
  }
  if (has(decision, 'before')) used.push(fact('Estado anterior registrado', humanValue(decision.before, snapshots)))
  if (has(decision, 'after')) found.push(fact('Estado posterior registrado', humanValue(decision.after, snapshots)))
  if (has(decision, 'facts')) found.push(fact('Datos contrastados', humanValue(decision.facts, snapshots)))
  const resultIds = output.result_unit_ids || output.candidate_unit_ids || row(output.catalog_results).unit_ids
  const units = Array.isArray(resultIds) ? snapshots.filter(unit => resultIds.includes(unit.id))
    : rows(output.catalog_snapshot).length ? snapshots.filter(unit => rows(output.catalog_snapshot).some(item => item.id === unit.id)) : []
  const recordedCause = decision.caused_by_step ?? (step.key === 'model_request' ? input.caused_by_step : null)
  const causeOrder = Number(recordedCause)
  const hasCause = recordedCause != null
  const cause = hasCause && Number.isSafeInteger(causeOrder) && causeOrder !== step.order ? execution.steps.find(item => item.order === causeOrder) || null : null
  const setting = row(decision.setting)
  const href = str(setting.href)
  const safeHref = /^\/inmobiliaria\/automatizacion(?:\/|$)/.test(href) && !href.includes('\\') && !href.includes('..') ? href : null
  const reason = str(decision.reason) || str(input.reason) || str(output.reason)
  const linkedActions = execution.steps.filter(item => item.key === 'advisor_handoff' && Number(decisionRecord(item).caused_by_step) === step.order)
  const summary = step.key === 'dialogue_decision' && queryText ? `Se eligió responder con esta consulta: ${queryText}.`
    : step.key === 'message_delivery' && output.action === 'accepted' ? 'Kommo aceptó iniciar Salesbot. Esto no confirma entrega ni lectura en WhatsApp.'
      : step.key === 'advisor_handoff' ? 'Este paso registra el intento de derivación y su resultado; el motivo debe estar respaldado por su propio registro.'
        : step.key === 'response_coverage' && output.status === 'invalid_coverage'
          ? `Se descartó el borrador antes de evaluar su contenido porque la ficha interna de la IA no pasó la validación. ${Array.isArray(output.issues) && output.issues.length ? 'Los controles muestran el campo, el valor recibido y lo esperado.' : 'Este registro antiguo no conserva el campo que falló.'} La decisión de derivar a un asesor se registra por separado.`
        : step.key === 'response_coverage' ? 'Se revisó si la respuesta atiende las solicitudes del mensaje. Los estados registrados permiten revisar esa decisión.'
          : 'Entradas y resultados conservados para este paso de la ejecución.'
  return {
    coverageSections: step.key === 'response_coverage' ? coverageSections(output) : null,
    title: stepTitle(step), summary, used, found, units, cause, missingCause: hasCause && !cause, linkedActions,
    origin: str(decision.origin) ? decision.origin === 'catalog' ? 'Consulta calculada del catálogo' : humanValue(decision.origin) : 'Origen no registrado en este paso.',
    reason: reason ? humanValue(reason) : 'No se guardó un motivo específico. No se deduce de los pasos cercanos.',
    rule: str(decision.rule_id) ? ruleLabels[str(decision.rule_id)] || (str(decision.rule_id).startsWith('response.') && values[str(decision.rule_id).slice(9)]
      ? `Preparar respuesta: ${values[str(decision.rule_id).slice(9)]}` : 'Regla identificada en los detalles técnicos; no hay descripción registrada.') : 'No se registró la regla que autorizó esta decisión.',
    outcome: str(decision.outcome) ? humanValue(decision.outcome) : step.key === 'advisor_handoff' && output.handoff_status
      ? `${humanValue(output.handoff_status)}${has(output, 'assigned_advisor') ? ` · Asesor asignado: ${humanValue(output.assigned_advisor)}` : ''}`
      : step.errorCode ? `El paso terminó con error (${step.errorCode}).` : statusLabel(step.status),
    setting: Object.keys(setting).length ? { label: str(setting.label) || 'Ajuste responsable', kind: humanValue(setting.kind), href: safeHref, source: str(setting.source) || null } : null,
    review: step.key === 'advisor_handoff' ? 'Contraste el motivo con los datos del paso causante. Una frase en la respuesta no demuestra por sí sola una derivación.'
      : output.coverage_locked === false ? 'Si hubo una derivación, abra su registro. Permitir la revisión no demuestra cuál fue su causa.'
        : step.status === 'failed' ? 'Revise el error registrado y los pasos posteriores antes de repetir una acción.'
          : 'Un paso completado indica ejecución técnica; no certifica que la interpretación haya sido correcta.',
  }
}

export type MessageBatch = { id: string; execution: WorkflowExecution; members: WorkflowExecution[]; total: number }
export type ConversationGroup = { id: string; label: string; known: boolean; batches: MessageBatch[] }
export function conversationGroups(executions: WorkflowExecution[]): ConversationGroup[] {
  const groups = new Map<string, ConversationGroup>()
  for (const execution of executions) {
    const key = execution.leadGroupId ? `lead:${execution.leadGroupId}` : execution.conversationId || `event:${execution.id}`
    let group = groups.get(key)
    if (!group) { group = { id: key, label: execution.leadName, known: Boolean(execution.leadGroupId || execution.conversationId), batches: [] }; groups.set(key, group) }
    const batchId = execution.batchId || execution.id
    const existing = group.batches.find(batch => batch.id === batchId)
    if (existing) {
      existing.members.push(execution)
      existing.total = Math.max(existing.total, existing.members.length, execution.batchSize || 1, execution.batchEventIds?.length || 1)
      if (execution.steps.length > existing.execution.steps.length) existing.execution = execution
    } else group.batches.push({ id: batchId, execution, members: [execution], total: Math.max(execution.batchSize || 1, execution.batchEventIds?.length || 1) })
  }
  return [...groups.values()]
}

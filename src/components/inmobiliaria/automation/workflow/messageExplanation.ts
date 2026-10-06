import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { catalogSearchDiagnostics, catalogSearchExplanation } from './catalogSearchExplanation'
import { reservationServiceError } from '@/lib/inmobiliaria/automationErrors'
import { repairBudgetFacts, repairTargetLabel, reviewDecision, reviewOwnerLabel, reviewObligationLabel, reviewIssueLabels } from './reviewDecision'

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
  filter_resolution: 'Origen de los filtros', reference_resolution: 'Unidades de la consulta actual', inherited: 'Heredados del contexto',
  requested_ids: 'Unidades referidas', resolved_ids: 'Unidades identificadas', missing_ids: 'Unidades sin resolver',
  message: 'Mensaje utilizado', original_message: 'Mensaje original', property_message: 'Parte inmobiliaria',
  allowed: 'Permite continuar la ruta de visitas', current_domains: 'Temas de la solicitud actual', visit_intent: 'Intención de visita',
  profile_introduction: 'Presentación y captura inicial', stage: 'Etapa', missing_fields: 'Datos pendientes',
  brochure_deferred: 'Brochure reservado para el siguiente intercambio', brochure_required: 'Brochure que debe adjuntarse',
  generic_introduction: 'Presentación general sin categorías', reminder_count: 'Recordatorios de datos', residence_meaning: 'Significado de ubicación',
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
  progressive_selection: 'Avance entre las opciones de interés', post_tour_continuation: 'Continuación después del recorrido',
  criteria: 'Criterios de las opciones', client_requested_change: 'Cambio solicitado por el cliente', preference_kind: 'Tipo de cambio solicitado',
  bedrooms_any: 'Cantidades de dormitorios admitidas',
}
const values: Record<string, string> = {
  ...reviewIssueLabels,
  request_reservation: 'Solicitar el inicio de una reserva con un asesor', ask_reservation: 'Consultar los requisitos o pasos de una reserva',
  reservation_handoff: 'Solicitar reserva y tramitar atención con un asesor', reservation_information: 'Información del proceso de reserva',
  current_reservation: 'Solicitud de reserva interpretada en el mensaje actual', extractor: 'Interpretación del extractor', lexical_fallback: 'Interpretación de respaldo por texto',
  current_reservation_takes_priority: 'La solicitud actual de reserva prevalece sobre la selección de unidad o la respuesta a la pregunta anterior',
  reservation_intent_without_current_action_evidence: 'No se confirmó evidencia de una solicitud actual de reserva; no autoriza iniciar el trámite',
  extractor_intent_precedes_price_keywords: 'Se conserva la intención del extractor aunque el texto incluya palabras relacionadas con precio',
  property_reference_answers_pending_price: 'La referencia de inmueble completa una pregunta de precio pendiente',
  reservation_outside_authorized_scope: 'La reserva no se ejecuta porque el turno está fuera del alcance autorizado',
  suggested_length_exceeded: 'La respuesta supera la extensión recomendada', multiple_questions: 'La respuesta contiene varias preguntas',
  repeated_courtesy: 'La apertura de cortesía se parece a una reciente',
  unauthorized_link: 'La respuesta contiene un enlace sin autorización en la evidencia de este turno',
  required_link_omitted: 'La respuesta omitió un enlace que debía entregar según la solicitud actual',
  required_continuation_missing: 'Respondió la consulta, pero omitió la pregunta necesaria para continuar con el siguiente paso',
  reservation_not_confirmed: 'La respuesta afirma una reserva de inventario que no está confirmada',
  advisor_assignment_not_verified: 'La respuesta afirma una asignación de asesor que no está comprobada',
  reservation_handoff_not_verified: 'La respuesta afirma un trámite de reserva o derivación que no está comprobado',
  contextual_property_followup: 'La consulta continúa sobre las unidades ya identificadas',
  context_reference_requires_clarification: 'Falta identificar todas las unidades de la consulta; esto no demuestra falta de disponibilidad',
  unresolved_reference_is_not_unavailability: 'La respuesta afirma que no hay disponibilidad cuando lo pendiente es identificar las unidades',
  resolved: 'Identificado', pending_question: 'Pregunta pendiente', pending_target: 'Unidad de la pregunta pendiente', explicit_reference: 'Referencia explícita',
  quantity_supported: 'Cantidad respaldada por su atributo y fuente',
  quantity_reference_unresolved: 'No se pudo identificar una referencia de evidencia para la cantidad',
  quantity_evidence_conflict: 'Las fuentes identificadas contienen cantidades diferentes',
  quantity_value_mismatch: 'La cantidad contradice el valor de ese atributo',
  clarification_needed: 'Se necesita una precisión del cliente; no requiere asesor por este motivo',
  review_conflict: 'Clasificaciones contradictorias; no autorizan una derivación automática',
  contradictory_missing_fact: 'La misma consulta figura como atendida o aclaración y como dato faltante',
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
  question_count: 'Límite de preguntas. En registros antiguos también podía significar que la plantilla no tenía pregunta y la IA añadió una',
  operational_question_added: 'Se añadió una pregunta a una plantilla operativa sin revisión de su propósito',
  fallback_unanswered_request: 'La respuesta de respaldo omite una solicitud del cliente y no se conserva como respuesta válida',
  current_request_overrides_pending_visit: 'La consulta actual no pide una visita; una coordinación anterior no puede sustituirla',
  collect_lead_profile: 'Recoger nombre y residencia para personalizar la guía', current_residence: 'Residencia actual, no lugar de contacto',
  lead_profile_question_changed: 'Se omitió o cambió la solicitud de datos con su explicación de brochure y guía personalizada',
  lead_profile_question_missing: 'El sistema detectó que falta la pregunta de datos exigida en esta etapa comercial',
  invalid_review_question_metadata: 'La ficha de la pregunta elaborada por el revisor está incompleta o cita una solicitud incorrecta; corresponde reparar la ficha',
  invalid_opening_stage_review: 'La ficha del revisor no permite comprobar si la presentación respeta la etapa inicial; corresponde reparar la ficha',
  lead_profile_categories_premature: 'La presentación inicial introdujo tipos de inmuebles antes de la etapa permitida, aunque use otras palabras',
  repair_call_failed: 'La llamada para reparar no terminó correctamente',
  lead_profile_brochure_premature: 'Se adjuntó el brochure antes del intercambio previsto',
  lead_profile_brochure_missing: 'Falta el brochure que debía entregarse en este turno',
  lead_profile_confirmation_omitted: 'Se omitió confirmar si el lugar declarado es la residencia actual',
  lead_profile_question_purpose_changed: 'La pregunta cambió el dato que debía recoger o confirmar',
  lead_profile_unconfirmed_residence: 'Se presentó como residencia confirmada un lugar que aún necesita confirmación',
  lead_profile_name_acknowledgement_missing: 'Falta el saludo «Mucho gusto» con el nombre recibido por primera vez',
  commercial_next_question_missing: 'Se omitió la pregunta que permite avanzar entre las opciones de interés',
  commercial_next_question_changed: 'La pregunta cambió el propósito del siguiente paso antes de completar la elección',
  offer_details: 'Invitar a conocer los detalles de las opciones cotizadas', confirm_bedrooms: 'Confirmar si se mantiene la cantidad de dormitorios',
  choose_bedrooms: 'Precisar la cantidad de dormitorios', no_matching_options: 'Aclarar requisitos porque no hay opciones coincidentes',
  fewer_bedrooms: 'Buscar menos dormitorios', cheaper: 'Buscar un precio menor',
  explain_current_quoted_options: 'Se cotizaron las opciones que cumplen el interés actual; corresponde ofrecer sus detalles',
  comparison_answered_before_selection: 'Se atendió la comparación; corresponde que el cliente elija una unidad',
  preference_options: 'Alternativas según el cambio solicitado',
  explore_quoted_options: 'Explorar las opciones cotizadas antes de elegir una unidad',
  details_require_unit_choice: 'Hay varias opciones de interés; corresponde elegir una para conocer sus detalles',
  category_selected_choose_floor: 'La categoría ya está elegida; corresponde elegir entre las plantas disponibles',
  floor_selected_choose_unit: 'La planta ya está elegida; corresponde elegir una de sus unidades',
  requested_fewer_bedrooms: 'El cliente pidió reducir la cantidad de dormitorios',
  requested_cheaper_options: 'El cliente pidió buscar opciones más económicas',
  confirmed_cheaper_bedrooms: 'El cliente confirmó los dormitorios que desea mantener al buscar un precio menor',
  accepted_bedroom_confirmation: 'El cliente confirmó los dormitorios que desea mantener al buscar un precio menor',
  cheaper_requires_bedrooms_confirmation: 'Falta confirmar si la búsqueda más económica mantiene los dormitorios',
  fewer_requires_bedroom_count: 'Falta una cantidad de referencia para buscar menos dormitorios',
  fewer_bedrooms_requires_count: 'Falta una cantidad de referencia para buscar menos dormitorios',
  cheaper_requires_bedroom_count: 'Falta indicar cuántos dormitorios se desean en la búsqueda más económica',
  bedroom_confirmation_declined: 'No se confirmó mantener los dormitorios; corresponde preguntar cuántos desea',
  budget_missing: 'Falta conocer el presupuesto previsto para la compra',
  initial_capital_amount_missing: 'Se conoce que dispone de una entrada, pero falta su monto',
  budget_kind_missing: 'Se conoce un monto, pero falta distinguir presupuesto total de entrada',
  budget_declined: 'El cliente prefirió no indicar su presupuesto; se continúa con sus dudas sobre la unidad',
  budget_deferred: 'El cliente aún no definió su presupuesto; se continúa sin repetir la pregunta',
  budget_already_known: 'El presupuesto ya se conoce; se continúa con los detalles de la unidad',
  financing_information_available: 'Se puede ofrecer información financiera para la unidad elegida según el presupuesto conocido',
  financing_already_started: 'La orientación financiera ya comenzó; no se repite la invitación',
  requested_action_pending: 'La solicitud actual de visita o financiamiento tiene prioridad sobre otra pregunta comercial',
  outside_subject_not_grounded: 'La exclusión como consulta ajena no tenía evidencia de otro negocio en el mensaje del lead. Se conservó la consulta inmobiliaria.',
  clarification_of_price_request: 'La categoría o unidad aclara una consulta de precio anterior; se conserva el objetivo de responder ese precio',
  current_turn: 'Interpretación del mensaje actual',
  price: 'Precio respaldado por el catálogo',
  turn_price_unanswered: 'La respuesta omitió el precio solicitado aunque había un importe verificado disponible',
  project_information: 'Presentar información del proyecto', select_property: 'Buscar o elegir un inmueble', answer_previous: 'Responder una pregunta pendiente',
  clarify_scope: 'Aclarar el alcance de la consulta',
  eq: 'igual a', gt: 'mayor que', gte: 'mayor o igual que', lt: 'menor que', lte: 'menor o igual que', between: 'entre límites',
  numeric_relation_not_in_reply: 'La comparación registrada por el revisor no corresponde al límite u operador escrito en el mensaje',
  catalog_endpoint_mismatch: 'El máximo o mínimo anunciado no coincide con el extremo verificado de ese grupo del catálogo',
  unit_fact_mismatch_or_invalid: 'Un valor atribuido a una unidad no coincide con el catálogo, o la lista de datos extraídos es inválida',
  invalid_review_metadata: 'Ficha interna del revisor inválida; no significa por sí solo que el mensaje comercial tenga datos incorrectos',
  review_fragment_not_in_reply: 'El revisor citó un fragmento que no aparece literalmente en el mensaje propuesto',
  review_unit_binding_mismatch: 'El revisor atribuyó un valor real a otra unidad en su ficha interna',
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
  turn_intent: 'Objetivo compartido del turno', interest_evaluation: 'Interés y recomendación de traspaso',
  budget_resolution: 'Presupuesto frente a precios autorizados',
  lead_profile_resolution: 'Nombre y residencia interpretados', lead_introduction: 'Presentación y datos del lead',
  dialogue_decision: 'Decisión de respuesta', response_coverage: 'Revisión de la respuesta', advisor_handoff: 'Derivación al asesor',
  route_selected: 'Ruta aplicada', response_validation: 'Validación final', message_delivery: 'Envío a Kommo', state_persisted: 'Memoria y seguimientos',
  execution_exit: 'Resultado de la ejecución', execution_failed: 'Interrupción', visit_coordination: 'Coordinación de visita', visit_intent: 'Decisión sobre la visita', visit_result: 'Resultado de la visita',
}

export function statusLabel(status: string) { return values[status] || status.replaceAll('_', ' ') }
export function stepTitle(step: WorkflowExecutionStep) {
  if (step.key === 'catalog_embedding_search') return catalogSearchExplanation(step.output).title
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
  return values[text] || reservationServiceError(text) || text.replaceAll('_', ' ')
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
function leadProfileSections(value: unknown, introductionValue: unknown = {}): ExplanationSection[] {
  const profile = row(value), introduction = row(introductionValue)
  const hasProfile = ['full_name', 'declared_location', 'residence_candidate', 'residence_city', 'residence_country', 'residence_status'].some(key => has(profile, key))
  if (!hasProfile) return []
  const declared = row(profile.declared_location), recordedCandidate = row(introduction.candidate)
  const candidate = Object.keys(recordedCandidate).length ? recordedCandidate : row(profile.residence_candidate)
  const sources = row(profile.sources)
  const place = (value: Row) => [str(value.city), str(value.country)].filter(Boolean).join(', ')
  const evidence = (value: unknown) => str(value) || str(row(value).evidence)
  const residence = [str(profile.residence_city), str(profile.residence_country)].filter(Boolean).join(', ')
  const states: Record<string, string> = {
    unknown: 'Residencia desconocida', pending_confirmation: 'Residencia pendiente de confirmación',
    confirmed: 'Residencia confirmada', declined: 'El lead no desea indicar su residencia',
  }
  const purposes: Record<string, string> = {
    collect_profile: 'Recoger nombre y residencia para personalizar la guía',
    confirm_residence: 'Confirmar si el lugar declarado es la residencia actual',
    collect_residence: 'Recoger la residencia actual', collect_name: 'Recoger el nombre', none: 'No se requiere una pregunta de perfil',
  }
  const placeKinds: Record<string, string> = { origin: 'Lugar de origen declarado', temporary: 'Ubicación temporal declarada', residence: 'Residencia declarada', unspecified: 'Lugar declarado sin significado confirmado' }
  return [{
    title: 'Datos de perfil y confirmación',
    description: 'Este estado conserva lo que el lead declaró y distingue su lugar declarado de su residencia actual. Una ubicación pendiente no equivale a residencia confirmada. Solo se muestran los datos registrados en este paso.',
    facts: [
      fact('Nombre recibido', str(profile.full_name) || 'No registrado.'),
      ...(evidence(sources.full_name) ? [fact('Evidencia del nombre', evidence(sources.full_name))] : []),
      fact('Lugar declarado', place(declared) || 'No registrado.'),
      ...(declared.kind ? [fact('Significado del lugar declarado', placeKinds[str(declared.kind)] || 'No se registró un significado reconocido.')] : []),
      ...(str(declared.evidence) ? [fact('Evidencia del lugar declarado', str(declared.evidence))] : []),
      fact('Estado de residencia', states[str(profile.residence_status)] || 'No se registró el estado; no se deduce de los lugares mencionados.'),
      fact('Residencia actual registrada', residence || 'No registrada.'),
      ...(['residence_city', 'residence_country'].flatMap(key => evidence(sources[key]) ? [fact(key === 'residence_city' ? 'Evidencia de ciudad de residencia' : 'Evidencia de país de residencia', evidence(sources[key]))] : [])),
      ...(place(candidate) ? [fact('Lugar que necesita confirmación', place(candidate))] : []),
      ...(str(candidate.evidence) ? [fact('Evidencia que motiva la confirmación', str(candidate.evidence))] : []),
      ...(has(introduction, 'question_purpose') ? [fact('Propósito de la pregunta de perfil', purposes[str(introduction.question_purpose)] || 'Propósito no reconocido en este registro.')] : []),
      ...(str(introduction.question) ? [fact('Pregunta de perfil preparada', str(introduction.question))] : []),
      ...(str(introduction.name_acknowledgement) ? [fact('Presentación con el nombre recibido', str(introduction.name_acknowledgement))] : []),
    ],
  }]
}
function turnIntentSections(value: unknown, snapshots: CatalogSnapshot[] = []): ExplanationSection[] {
  const contract = row(value)
  if (!['turn-intent-v1', 'turn-intent-v2'].includes(str(contract.version))) return []
  const subject = row(contract.subject), scope = row(contract.scope), outside = row(scope.outside_evidence)
  const pending = row(contract.pending_question)
  const unitNumbers = Array.isArray(subject.unit_numbers) ? subject.unit_numbers.filter(value => typeof value === 'string' || typeof value === 'number').map(String) : []
  return [{
    title: 'Objetivo compartido del turno',
    description: 'Es la interpretación registrada que comparten la ruta, la redacción y la revisión. Una consulta de precio no autoriza por sí sola una cita ni una revisión financiera. Este registro no acredita el envío de la respuesta.',
    facts: [
      fact('Objetivo actual', humanValue(contract.objective)),
      fact('Origen del objetivo', humanValue(contract.interpretation_source)),
      ...(contract.requested_action ? [fact('Acción solicitada', humanValue(contract.requested_action))] : []),
      fact('Categoría de referencia', subject.category ? humanValue(subject.category) : 'No se registró una categoría.'),
      fact('Unidades de referencia', unitNumbers.length ? unitNumbers.join(', ') : 'No se registró una unidad concreta.'),
      fact('Filtros conservados', humanValue(subject.filters, snapshots, 'filters')),
      fact('Datos que debe responder', Array.isArray(contract.required_facts) && !contract.required_facts.length
        ? 'El contrato no enumeró datos obligatorios adicionales.' : humanValue(contract.required_facts)),
      ...(has(contract, 'needs_reference') ? [fact('Falta precisar categoría o unidad', humanValue(contract.needs_reference))] : []),
      fact('Alcance resuelto', humanValue(scope.kind)),
      ...(scope.reason ? [fact('Motivo de conciliación', humanValue(scope.reason))] : []),
      ...(outside.fragment ? [fact('Asunto ajeno citado', str(outside.fragment)),
        fact('Origen de la evidencia', outside.source === 'current' ? 'Mensaje actual del lead' : outside.source === 'history' ? 'Mensaje anterior del lead' : 'No registrado')] : []),
      fact('Objetivo que continúa', contract.continuation_goal ? humanValue(contract.continuation_goal) : 'No se registró un objetivo pendiente para el siguiente intercambio.'),
      fact('Pregunta pendiente registrada', str(pending.question) || str(pending.text) || 'No se registró el texto de una pregunta pendiente.'),
      ...(has(contract, 'profile_pending') ? [fact('Captura inicial de nombre y residencia pendiente', humanValue(contract.profile_pending))] : []),
    ],
  }]
}

function interpretationSections(value: unknown): ExplanationSection[] {
  const diagnostic = row(value)
  const interpretation = has(diagnostic, 'extractor_primary_intent') ? diagnostic : row(diagnostic.interpretation)
  if (!Object.keys(interpretation).length) return []
  const decisions = rows(interpretation.decisions)
  return [{ title: 'Interpretación del extractor y objetivo aplicado',
    description: 'Muestra lo que interpretó el extractor y la decisión compartida con la ruta, el redactor y la revisión. La interpretación identifica una solicitud; la acción se acredita con su resultado operativo.',
    facts: [
      fact('Intención interpretada por el extractor', humanValue(interpretation.extractor_primary_intent)),
      fact('Intención aplicada en este turno', humanValue(interpretation.canonical_primary_intent)),
      ...(diagnostic.confidence ? [fact('Confianza registrada', humanValue(diagnostic.confidence))] : []),
      ...(decisions.length ? decisions.map(decision => fact('Motivo de conciliación', [
        humanValue(decision.code),
        ...(decision.extractor_intent ? [`Interpretada: ${humanValue(decision.extractor_intent)}`] : []),
        ...(decision.canonical_intent ? [`Aplicada: ${humanValue(decision.canonical_intent)}`] : []),
        ...(str(decision.evidence) ? [`Evidencia: ${str(decision.evidence)}`] : []),
      ].join('. '))) : [fact('Conciliaciones registradas', 'No se registraron cambios de prioridad o conciliaciones en esta interpretación.')]),
    ] }]
}

function reservationSections(value: unknown, snapshots: CatalogSnapshot[] = [], writingVerified?: unknown): ExplanationSection[] {
  const reservation = row(value)
  if (!Object.keys(reservation).length || reservation.kind === 'none' && !reservation.request_id) return []
  const status = str(reservation.handoff_status || reservation.status)
  const verified = reservation.handoff_verified === true && reservation.request_status === 'requested' && Boolean(reservation.request_id)
  const assigned = verified && ['assigned', 'acknowledged'].includes(status) && Boolean(reservation.assigned_to)
  const queued = verified && status === 'queued' && !reservation.assigned_to
  const numbers = Array.isArray(reservation.unit_numbers) ? reservation.unit_numbers.filter(item => typeof item === 'string' || typeof item === 'number').map(String) : []
  const modes: Record<string, string> = { reused: 'Se conservó al asesor activo que ya tenía el lead', rotated: 'Se asignó un asesor según la rotación del proyecto', queued: 'La solicitud quedó pendiente de asignación' }
  return [{ title: 'Solicitud de reserva y atención del asesor',
    description: 'Iniciar una solicitud de reserva tramita la atención comercial. Este registro no confirma que se haya separado el inmueble, recibido un pago o enviado el mensaje al lead.',
    facts: [
      fact('Solicitud interpretada', reservation.kind === 'information' ? 'Consultar requisitos o pasos; no iniciar la reserva' : reservation.kind === 'request' || reservation.request_status === 'requested' ? 'Solicitar que un asesor continúe el proceso de reserva' : 'No se registró el tipo de solicitud.'),
      ...(str(reservation.evidence) ? [fact('Evidencia del mensaje', str(reservation.evidence))] : []),
      fact('Unidades de la solicitud', Array.isArray(reservation.unit_ids) && reservation.unit_ids.length ? humanValue(reservation.unit_ids, snapshots, 'unit_ids')
        : numbers.length ? numbers.join(', ') : 'No se identificó una unidad concreta.'),
      ...(Array.isArray(reservation.unresolved_unit_numbers) && reservation.unresolved_unit_numbers.length ? [fact('Números de unidad por aclarar', reservation.unresolved_unit_numbers.map(String).join(', '))] : []),
      fact('Traspaso comprobado', assigned ? 'Hay un asesor asignado a esta atención.' : queued ? 'La solicitud está en cola; todavía no hay asesor asignado.'
        : reservation.handoff_verified === false ? 'No se acreditó un traspaso en este paso.' : 'Falta evidencia suficiente para confirmar el resultado del traspaso.'),
      ...(str(reservation.assignment_mode) ? [fact('Cómo se resolvió la asignación', modes[str(reservation.assignment_mode)] || 'Modo de asignación no reconocido en este registro.')] : []),
      ...(has(reservation, 'replayed') ? [fact('Reutilización de la solicitud', reservation.replayed === true ? 'Se consultó la solicitud ya registrada; no se volvió a asignar por este reintento.' : 'Se registró una nueva solicitud para este mensaje.')] : []),
      ...(reservation.request_status === 'requested' || reservation.inventory_reserved === false ? [fact('Reserva del inmueble', 'Este paso registra una solicitud; no reserva inventario ni confirma la separación.')] : []),
      ...(typeof writingVerified === 'boolean' ? [fact('Redacción contrastada con la acción', writingVerified ? 'La revisión confirmó que el mensaje respeta el resultado operativo registrado.' : 'Este registro no acredita que la redacción haya superado esa comprobación.')] : []),
    ] }]
}

function editorialSections(output: Row): ExplanationSection[] {
  const links = row(output.link_contract)
  const showLinks = has(links, 'allowed_links') || has(links, 'required_links')
  const urls = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') || 'Ninguno registrado.' : 'No se registró esta lista.'
  return [
    ...(typeof row(output.follow_up).usable === 'boolean' ? [{ title: 'Respuesta y seguimiento',
      description: 'La aprobación del texto y la fiabilidad de la ficha de continuación se evalúan por separado. Una advertencia auxiliar no elimina los controles de datos y reglas comerciales.',
      facts: [fact('Seguimiento automático', row(output.follow_up).usable === false
        ? 'Ficha incompleta: no se utilizará para avanzar automáticamente la conversación.' : 'Ficha disponible para el seguimiento.'),
      ...rows(row(output.follow_up).warnings).map(warning => fact('Advertencia auxiliar', typeof warning.reason === 'string' ? warning.reason : 'No se pudo validar un dato de seguimiento.'))],
    }] : []),
    ...(Array.isArray(output.editorial_observations) ? [{ title: 'Observaciones de redacción',
      description: 'Son sugerencias de estilo y continuidad. Por sí solas no rechazan el borrador ni sustituyen los controles de hechos y acciones.',
      facts: output.editorial_observations.length ? output.editorial_observations.filter(item => typeof item === 'string').map(item => fact('Observación informativa', humanValue(item)))
        : [fact('Observaciones registradas', 'No se registraron sugerencias editoriales en este paso.')],
    }] : []),
    ...(showLinks ? [{ title: 'Enlaces permitidos y requeridos',
      description: 'Un enlace permitido puede usarse, pero su presencia en una plantilla no obliga a repetirlo. Los enlaces requeridos responden a la solicitud actual o a una entrega comprometida.',
      facts: [fact('Enlaces permitidos', urls(links.allowed_links)), fact('Enlaces requeridos en este turno', urls(links.required_links))],
    }] : []),
  ]
}

function focusedReviewSections(output: Row): ExplanationSection[] {
  const review = row(output.semantic_review)
  if (review.review_contract !== 'focused-review-v1') return []
  const coverage = row(review.coverage)
  const references = rows(review.sentence_references)
  const segments = (value: unknown) => !Array.isArray(value) ? 'No conservado en el registro.' : value.length === 0 ? 'Ninguno registrado.'
    : value.filter(item => typeof item === 'string').map(id => {
      const reference = references.find(item => item.id === id)
      return reference && str(reference.text) ? `${id}: «${str(reference.text)}»` : `${id} (texto no conservado)`
    }).join('\n')
  const obligations = rows(review.obligation_checks)
  const details = rows(review.validation_details)
  const verdicts: Record<string, string> = { met: 'Cumplida según el revisor', violated: 'Incumplimiento señalado por el revisor', pending: 'Comprobación pendiente; no acredita un incumplimiento' }
  return [{ title: 'Alcance y responsables de la revisión',
    description: 'El revisor IA comprueba hechos del negocio, promesas y obligaciones comerciales del turno. El sistema contrasta datos exactos y aplica la decisión. Una revisión registrada no equivale a una aprobación ni a un envío.',
    facts: [
      fact('Segmentos con revisión registrada', segments(coverage.reviewed_sentence_ids)),
      fact('Segmentos sin hechos del negocio según el revisor', segments(coverage.non_factual_sentence_ids)),
      fact('Segmentos pendientes de comprobación', segments(coverage.pending_sentence_ids)),
      ...details.map(detail => fact('Control y responsables', `${humanValue(detail.code) || 'Control no identificado'}. Responsable registrado: ${reviewOwnerLabel(detail.owner)}. Encargado de corregir: ${reviewOwnerLabel(detail.repair_owner)}.${str(detail.reason) ? ` Motivo registrado: ${str(detail.reason)}` : ''}`)),
    ],
  }, { title: 'Obligaciones comerciales comprobadas',
    description: 'Se muestran solamente las obligaciones de esta ejecución. Una comprobación pendiente es distinta de un incumplimiento identificado.',
    facts: Array.isArray(review.obligation_checks) ? obligations.length ? obligations.map(check => fact(reviewObligationLabel(check.id),
      `${verdicts[str(check.verdict)] || 'Resultado no conservado'}.${str(check.reason) ? ` ${str(check.reason)}` : ''}${Array.isArray(check.sentence_ids) && check.sentence_ids.length ? ` Segmentos: ${segments(check.sentence_ids)}` : ''}`))
      : [fact('Obligaciones registradas', 'No se registraron comprobaciones de obligaciones en este paso.')] : [fact('Obligaciones registradas', 'Este registro no conserva las comprobaciones de obligaciones.')],
  }]
}

function interestDecisionFacts(output: Row): ExplanationFact[] {
  const sources: Record<string, string> = { apply_lead_events: 'Resultado conservado del motor de puntaje', no_new_signals: 'Evaluación sin nuevas señales comerciales', historical_snapshot: 'Reconstrucción desde la evidencia y las reglas originales, sin volver a puntuar', legacy_without_receipt: 'Registro anterior sin resultado de decisión disponible' }
  return [
    fact('Señales de interés reconocidas', humanValue(output.recognized_events)),
    fact('Puntaje de esta evaluación', humanValue(output.temperature_score)),
    fact('Temperatura registrada', humanValue(output.temperature)),
    fact('¿El puntaje recomienda traspaso?', typeof output.handoff_required === 'boolean' ? humanValue(output.handoff_required) : 'El registro no conserva esa decisión.'),
    fact('Motivo de la recomendación', str(output.handoff_reason) || 'Sin motivo de traspaso registrado.'),
    fact('Origen de la decisión', sources[str(output.decision_source)] || 'No registrado.'),
    fact('Acción ejecutada por este paso', output.action_executed === false ? 'Ninguna asignación. La recomendación se registra; la atención del asesor se comprueba en el paso de derivación.' : 'No se registró si este paso ejecutó una acción.'),
  ]
}
function transformationSections(output: Row): ExplanationSection[] {
  if (!Array.isArray(output.text_transformations)) return []
  const changes = rows(output.text_transformations)
  return [...(output.delivery_integrity ? [{ title: 'Integridad antes del envío', description: 'La aprobación se contrasta con el texto preparado para Kommo; no acredita entrega o lectura.', facts: [
    { label: 'Resultado', value: row(output.delivery_integrity).status === 'revalidated' ? 'El contenido cambió y se volvió a revisar.' : row(output.delivery_integrity).status === 'restored_approved' ? 'La modificación no pasó la revisión; se recuperó el contenido aprobado.' : 'Se conserva el contenido aprobado; solo formato o un aviso operativo confirmado.' },
    { label: 'Texto preparado para envío', value: str(row(output.delivery_integrity).final_text) },
  ] }] : []), { title: 'Cambios del sistema sobre el texto', description: changes.length ? 'El sistema modificó el texto en este paso. La aprobación corresponde a la versión resultante, no al borrador intacto. Consulte Envío a Kommo para el estado de envío.' : 'No se registraron transformaciones del texto en este paso.', facts: changes.flatMap(change => [
    { label: 'Etapa responsable', value: str(change.stage) },
    { label: 'Antes de la modificación', value: str(change.before) },
    { label: 'Después de la modificación', value: str(change.after) },
  ]) }]
}

function progressiveSelectionSections(output: Row, snapshots: CatalogSnapshot[]): ExplanationSection[] {
  const plan = row(output.progressive_selection), tour = row(output.post_tour_continuation), budget = row(tour.budget)
  const budgetStates: Record<string, string> = {
    not_discussed: 'Presupuesto todavía no consultado', unknown: 'El cliente aún no tiene un presupuesto definido',
    amount: 'Monto conocido, pendiente de distinguir total o entrada', maximum_total: 'Presupuesto total para la compra',
    initial_capital: 'Dinero disponible para la entrada', sufficient_for_selected_unit: 'El cliente declaró que puede cubrir la unidad elegida',
    insufficient_for_selected_unit: 'El cliente declaró que su presupuesto no cubre la unidad elegida',
    declines_to_disclose: 'El cliente prefirió no indicar el presupuesto',
  }
  const budgetSources: Record<string, string> = { none: 'No hay una declaración registrada', lead_budget: 'Presupuesto guardado del lead',
    qualification: 'Datos de calificación', history: 'Declaración del cliente en el historial', current_message: 'Mensaje actual del cliente',
    turn_semantics: 'Interpretación del turno', commercial_memory: 'Memoria comercial' }
  return [
    ...(Object.keys(plan).length ? [{ title: 'Opciones de interés y siguiente paso',
      description: 'Explica el paso preparado en esta ejecución. Ofrecer detalles o comparar opciones no equivale a elegir una unidad. La elección corresponde al cliente; esta sección no acredita el envío.',
      facts: [
        fact('Paso previsto', str(plan.stage) ? humanValue(plan.stage) : 'No se registró el paso.'),
        fact('Criterios utilizados', has(plan, 'criteria') ? humanValue(plan.criteria, snapshots, 'filters') : 'No se registraron criterios en este paso.'),
        fact('Opciones de referencia', Array.isArray(plan.candidate_ids) ? humanValue(plan.candidate_ids, snapshots, 'candidate_ids') : 'No se registró el conjunto de opciones.'),
        fact('Pregunta siguiente preparada', str(plan.question) || 'No se registró una pregunta.'),
        fact('Motivo del siguiente paso', str(plan.reason) ? humanValue(plan.reason) : 'No se registró el motivo; no se deduce del mensaje.'),
        fact('¿El cliente pidió cambiar la búsqueda?', typeof plan.client_requested_change === 'boolean' ? humanValue(plan.client_requested_change) : 'No quedó registrado; no se deduce de las opciones mostradas.'),
        ...(str(plan.preference_kind) ? [fact('Cambio solicitado', humanValue(plan.preference_kind))] : []),
      ] }] : []),
    ...(Object.keys(tour).length ? [{ title: 'Continuación después del recorrido 360',
      description: 'La pregunta se prepara según el presupuesto conocido y la solicitud actual. Este plan no confirma el envío del recorrido, la aprobación de un crédito ni una cita.',
      facts: [
        fact('Pregunta después del recorrido', str(tour.question) || (has(tour, 'question') ? 'No se preparó otra pregunta en este paso.' : 'No se registró la pregunta.')),
        fact('Motivo de la continuación', str(tour.reason) ? humanValue(tour.reason) : 'No se registró el motivo.'),
        fact('Estado del presupuesto', budgetStates[str(budget.status)] || 'No se registró un estado reconocido; no se deduce del monto.'),
        ...(typeof budget.amount === 'number' && Number.isFinite(budget.amount) ? [fact('Monto de referencia', `$${humanValue(budget.amount)} USD`)] : []),
        ...(str(budget.source) ? [fact('Origen del dato de presupuesto', budgetSources[str(budget.source)] || humanValue(budget.source))] : []),
      ] }] : []),
  ]
}

function coverageSections(output: Row, snapshots: CatalogSnapshot[]): ExplanationSection[] {
  const decision = reviewDecision(output)
  const continuation = row(output.commercial_continuation)
  const question = row(continuation.question)
  const checks = row(continuation.checks)
  const status = str(output.status)
  const invalid = status === 'invalid_coverage'
  const checked = status === 'checked'
  const attempts = rows(output.repair_attempts)
  const requests = rows(output.requests)
  const present = (key: string, label: string): ExplanationFact => ({ label, value: str(output[key]) || 'No se conservó este texto en el registro.' })
  const selection = decision.recoveryPending ? 'La propuesta no quedó aprobada. La base no se usó como reemplazo; la consulta permanece pendiente de recuperación.'
    : invalid ? 'Se descartó la propuesta por información interna inválida; no se completó la revisión del contenido.'
    : checked ? 'La propuesta superó la revisión de este paso. Los pasos posteriores aún pueden modificarla.'
      : status ? `Resultado registrado: ${humanValue(status)}. Consulte la respuesta conservada y los controles.`
        : 'No se guardó el resultado de la revisión; no se puede determinar si se aceptó la propuesta.'
  return [
    ...turnIntentSections(output.resolved_turn_intent),
    ...interpretationSections(row(output.resolved_turn_intent).interpretation || output.interpretation),
    ...reservationSections(output.reservation, snapshots, output.operational_action_verified),
    ...editorialSections(output),
    ...focusedReviewSections(output),
    ...leadProfileSections(row(output.profile_introduction).profile_state, output.profile_introduction),
    ...progressiveSelectionSections(output, snapshots),
    ...transformationSections(output),
    ...(Object.keys(row(output.fallback_validation)).length ? [{ title: 'Validación de la respuesta de respaldo', description: 'El respaldo también debe tener datos verificados y atender la consulta. Una omisión informada se contrasta con la cobertura del catálogo.', facts: [
      { label: 'Resultado', value: decision.recoveryPending ? 'La base no se autorizó como reemplazo; la consulta quedó pendiente de recuperación.' : row(output.fallback_validation).passed === true ? 'Superó los controles registrados del respaldo.' : 'El respaldo original no superó los controles y fue sustituido.' },
      { label: 'Motivos', value: humanValue(row(output.fallback_validation).issues) || 'Sin controles fallidos registrados.' },
      { label: 'Solicitudes omitidas', value: humanValue(row(output.fallback_validation).unanswered_requests) || 'Ninguna registrada.' },
    ] }] : []),
    ...(rows(row(output.final_validation).project_quantity_checks).length ? [{ title: 'Afirmaciones y evidencia de cantidades', description: 'Se compara sujeto, dimensión y valor. Una referencia no resuelta no equivale a una afirmación falsa.', facts: rows(row(output.final_validation).project_quantity_checks).map(check => ({
      label: str(check.fragment), value: `${check.outcome === 'supported' ? 'Respaldada' : check.outcome === 'contradicted' ? 'Contradicha por los datos' : 'Referencia sin resolver'}. ${str(check.context)}. Evidencia: ${rows(check.evidence).map(f => `${str(f.subject)}: ${str(f.text)} [${str(f.source)}]`).join('; ') || 'No identificada'}`,
    })) }] : []),
    ...(Object.keys(continuation).length ? [{ title: 'Objetivo y continuación comercial', description: 'Describe la propuesta evaluada en este paso. Ofrecer alternativas no modifica la selección del cliente. La aceptación no acredita el envío posterior.', facts: [
      { label: 'Objetivo', value: str(continuation.objective) },
      { label: 'Necesidad actual', value: str(continuation.current_request) },
      { label: 'Selección de referencia', value: Array.isArray(continuation.selected_units) && continuation.selected_units.length ? continuation.selected_units.map(String).join(', ') : 'No hay una selección explícita registrada en el contexto de este turno.' },
      { label: 'Pregunta propuesta', value: str(question.text) || 'Sin pregunta propuesta registrada.' },
      { label: 'Dato que busca', value: str(question.missing_datum) || 'No registrado; no se deduce del texto.' },
      { label: 'Propósito de la pregunta', value: str(question.next_decision) || 'No registrado; es válido terminar sin pregunta.' },
      { label: 'Objetivo y selección', value: checks.operational_goal_preserved === true ? 'El revisor aprobó la continuidad del objetivo y el respeto de la selección.' : checks.operational_goal_preserved === false ? 'El revisor rechazó el objetivo o la continuidad de la selección.' : 'No se completó esta comprobación.' },
      { label: 'Resultado y motivo', value: checked ? 'Propuesta aceptada en este paso tras los controles registrados de contenido y continuidad.' : `Propuesta no aceptada. ${reviewDecision(output).causes.join(' ') || humanValue(output.issues) || 'Consulte los controles registrados.'}` },
    ] }] : []),
    { title: 'Respuesta elegida en este paso', description: 'El borrador es el texto propuesto por la IA, todavía sujeto a validación. Una propuesta rechazada puede iniciar una recuperación pendiente; la respuesta preparada y su envío se comprueban en los pasos posteriores y en Kommo.', facts: [
      { label: 'Qué ocurrió', value: selection }, present('final_preview', 'Respuesta conservada'), present('proposed_preview', 'Propuesta de la IA (borrador)'), present('base_preview', 'Respuesta base de respaldo'),
    ] },
    { title: 'Controles de validación', description: 'Estos son los controles registrados al terminar este paso. Las referencias internas corregidas se muestran por separado; un error en requests afecta la ficha interna y no demuestra que el texto comercial fuera incorrecto.', facts: [
      ...(Object.keys(row(output.final_validation)).length ? [{ label: 'Decisión conjunta', value: row(output.final_validation).passed === true
        ? 'Catálogo, relaciones numéricas y controles de la ruta aprobados dentro del mismo proceso de reparación.'
        : `Controles finales: ${humanValue(row(output.final_validation).issues)}` }] : []),
      ...rows(row(output.final_validation).details).map(detail => ({ label: 'Dato comprobado', value:
        `Fragmento: ${str(detail.fragment)}. Atributo: ${humanValue(detail.field)}. Relación: ${humanValue(detail.operator)}. Valores del texto: ${humanValue(detail.received)}. Valores verificados: ${humanValue(detail.expected)}.` })),
      { label: 'Controles registrados', value: Array.isArray(output.issues) && output.issues.length ? humanValue(output.issues) : checked ? 'No se registraron controles fallidos al terminar este paso.' : 'No se conservó el detalle del control fallido. No se deduce de la redacción.' },
      ...(rows(row(output.semantic_review).validation_details).length ? reviewDecision(output).causes.map(value => ({ label: 'Causa agrupada', value })) : []),
    ] },
    ...(decision.resolvedDetails.length ? [{ title: 'Referencias internas corregidas', description: 'Estas incidencias se resolvieron y no explican un rechazo posterior.', facts: decision.resolvedDetails.map(value => ({ label: 'Corrección resuelta', value })) }] : []),
    { title: 'Decisiones y evidencia', description: 'El sistema conserva las aperturas elegidas y controla las repeticiones; una apertura vacía permite cortesía opcional. La revisión semántica contrasta las afirmaciones y el código comprueba sus referencias y valores.', facts: [
      { label: 'Apertura', value: output.opening_decision ? humanValue(output.opening_decision) : 'No registrada' },
      { label: 'Cambio de filtros', value: output.query_transition && Object.keys(row(output.query_transition)).length ? humanValue(output.query_transition) : 'No se registró un cambio de alcance.' },
      ...(Object.keys(row(output.filter_resolution)).length ? [
        { label: 'Restricciones del mensaje actual', value: humanValue(row(output.filter_resolution).current, snapshots, 'filters') },
        { label: 'Características heredadas, sin nueva restricción', value: Object.keys(row(row(output.filter_resolution).inherited)).length ? humanValue(row(output.filter_resolution).inherited) : 'Ninguna registrada.' },
        { label: 'Evidencia de las restricciones', value: humanValue(row(output.filter_resolution).evidence) },
      ] : []),
      ...(Object.keys(row(output.reference_resolution)).length ? [{ label: 'Unidades de la consulta actual', value: humanValue(output.reference_resolution, snapshots) }] : []),
      { label: 'Afirmaciones contrastadas', value: output.semantic_review ? humanValue(output.semantic_review) : 'Este registro no incluye revisión por afirmaciones.' },
    ] },
    { title: 'Intento de reparación', description: 'Distingue la corrección del mensaje comercial de la reparación de una ficha interna. Los límites se muestran solo cuando quedaron registrados; no se deduce el destino de intentos históricos.', facts: [
      ...(attempts.length ? attempts.flatMap((attempt, index) => [{
        label: `Intento ${index + 1} · ${repairTargetLabel(attempt.target)}`, value: `Error inicial: ${humanValue(attempt.status)}. Controles: ${humanValue(attempt.issues)}. Resultado final: ${attempt.final_status ? humanValue(attempt.final_status) : 'No registrado; consulte el resultado general de este paso.'}${attempt.failure ? ` Fallo de la reparación: ${humanValue(attempt.failure)}.` : ''}`,
      }, ...(Array.isArray(attempt.focused_sentence_ids) ? [fact(`Intento ${index + 1} · Segmentos por reparar`, attempt.focused_sentence_ids.filter(item => typeof item === 'string').join(', ') || 'Ninguno registrado.')] : []),
      ...(Array.isArray(attempt.preserved_sentence_ids) ? [fact(`Intento ${index + 1} · Revisiones conservadas`, attempt.preserved_sentence_ids.filter(item => typeof item === 'string').join(', ') || 'Ninguna registrada.')] : []),
      ...(str(attempt.repair_owner) ? [fact(`Intento ${index + 1} · Encargado de corregir`, reviewOwnerLabel(attempt.repair_owner))] : []),
      ]) : [{ label: 'Reparaciones registradas', value: 'No se registró ningún intento de reparación en esta ejecución.' }]),
      { label: 'Resumen de reparaciones', value: decision.repair },
      ...repairBudgetFacts(output),
    ] },
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
      ...rows(output.handoff_assessments).map(item => ({ label: 'Decisión para esta consulta', value: `${str(item.fragment)}: ${humanValue(item.outcome)}. ${str(item.reason)}${item.question ? ` Pregunta conservada: ${str(item.question)}` : ''}` })),
    ] },
  ]
}

export function explainStep(execution: WorkflowExecution, step: WorkflowExecutionStep): StepExplanation {
  const laterValidation = step.key === 'response_coverage' ? execution.steps.find(item => item.key === 'response_validation' && item.order > step.order) : undefined
  const laterChanges = laterValidation && rows(laterValidation.output.text_transformations).length
    ? transformationSections(laterValidation.output).map(section => ({ ...section, title: 'Cambios posteriores a esta aprobación', description: 'La validación final registró estos cambios después de la revisión. La respuesta conservada en este paso es intermedia; consulte Envío a Kommo para verificar el envío.' })) : []
  const input = step.input, output = step.output, decision = decisionRecord(step), snapshots = catalogSnapshots(execution, step)
  const used = Object.entries(input).filter(([key]) => labels[key] && !['decision', 'query', 'catalog_query'].includes(key))
    .map(([key, value]) => fact(labels[key], humanValue(value, snapshots, key)))
  const found = Object.entries(output).filter(([key]) => labels[key] && !['decision', 'query', 'catalog_query', 'coverage_locked'].includes(key)
    && !(step.key === 'catalog_embedding_search' && key === 'model')
    && !(key === 'selected_unit_ids' && Array.isArray(output.selected_unit_numbers)))
    .map(([key, value]) => fact(labels[key], humanValue(value, snapshots, key)))
  if (step.key === 'catalog_embedding_search') {
    const search = catalogSearchDiagnostics(output)
    if (output.optimized === true) found.push(
      fact('Coincidencias confirmadas en toda la consulta', String(output.matched_count)),
      fact('Unidades pendientes de comprobar por falta de datos', String(output.unknown_count)),
      fact('Unidades que no cumplen requisitos', String(output.excluded_count)),
      fact('Números de las fichas incluidas', Array.isArray(output.selected_unit_numbers) ? output.selected_unit_numbers.join(', ') : 'Sin registro'),
      fact('Cobertura de fichas', output.examples_complete === true ? 'Todas las coincidencias confirmadas' : 'Ejemplos dentro del límite de contexto; el resumen incluye todas las coincidencias'))
    found.push(fact('Método utilizado', search.method),
      fact('Modelo de embeddings previsto', search.plannedModel),
      fact('Modelo de embeddings consultado', search.consultedModel),
      fact('Motivo de esta ruta', catalogSearchExplanation(output).reason),
      fact('Unidades seleccionadas', String(Array.isArray(output.selected_unit_ids) ? output.selected_unit_ids.length : 0)),
      fact('Tokens para la consulta de embeddings', String(output.embedding_input_tokens ?? 'Sin registro')),
      fact('Duración de la búsqueda', typeof output.duration_ms === 'number' ? `${output.duration_ms} ms` : 'Sin registro'))
    if (search.querySource) used.push(fact('Origen de la consulta ejecutada', search.querySource))
    if (typeof output.exact_filter_applied === 'boolean') found.push(fact('Filtrado exacto aplicado', output.exact_filter_applied ? 'Sí' : 'No'))
    if (search.requested === true && output.embedding_usage_recorded !== true) found.push(fact('Consumo de la solicitud vectorial', 'Se solicitó la consulta; su consumo no quedó confirmado. No se interpreta como gasto cero.'))
  }
  if (step.key === 'response_coverage' && output.prompt_context_selection) {
    const names: Record<string, string> = { catalogo: 'Catálogo de partida', instalaciones: 'Amenidades', lugares_cercanos: 'Lugares cercanos', contexto_sector: 'Datos del sector', politicas_negocio: 'Políticas específicas' }
    const selection = row(output.prompt_context_selection)
    if (selection.version === 'task-context-v1') found.push(fact('Selección del contexto', selection.embedding_applied === true
      ? 'Contexto reducido con búsqueda por embeddings.' : 'Contexto reducido por consulta, sin búsqueda vectorial.'))
    found.push(fact('Contexto para redactor y revisor', `${selection.included_unit_count} unidades; restricciones generales y obligaciones conservadas.`),
      ...rows(selection.blocks).map(block => fact(names[str(block.key)] || str(block.key), `${block.included} de ${block.available} registros incluidos`)))
  }
  if (step.key === 'turn_intent') found.push(...turnIntentSections(output, snapshots).flatMap(section => section.facts), ...interpretationSections(output.interpretation).flatMap(section => section.facts))
  if (step.key === 'budget_resolution') {
    const statuses: Record<string, string> = { prices_not_authorized: 'Los precios no están autorizados para este turno.', matching_options: 'Hay opciones con precio dentro del presupuesto.', incomplete_prices: 'Faltan precios o la búsqueda está incompleta; no se puede afirmar que no existen opciones.', no_matching_features: 'La búsqueda no encontró unidades con esas características.', below_available_prices: 'El presupuesto está por debajo de los precios comprobados de la búsqueda.' }
    used.push(fact('Presupuesto interpretado', `${input.amount ?? 'Sin importe'} ${input.currency || ''}`))
    found.push(fact('Resultado de la comparación', statuses[str(output.status)] || 'Resultado no reconocido; revisar el registro técnico.'))
    found.push(fact('Evidencia de precios completa', output.price_evidence_complete === true ? 'Sí' : 'No'))
  }
  if (step.key === 'semantic_extraction') found.push(...interpretationSections(output).flatMap(section => section.facts))
  if (step.key === 'advisor_handoff' && (output.requested_action === 'reservation_handoff' || output.request_status === 'requested')) {
    found.push(...reservationSections({ ...input, ...output }, snapshots).flatMap(section => section.facts))
  }
  if (step.key === 'interest_evaluation') found.push(...interestDecisionFacts(output))
  if (step.key === 'lead_profile_resolution') found.push(...leadProfileSections(output.profile, output).flatMap(section => section.facts))
  if (step.key === 'lead_introduction') found.push(...leadProfileSections(row(output.profile_introduction).profile_state, output.profile_introduction).flatMap(section => section.facts))
  const query = output.resolved_query || output.catalog_query || output.query || input.catalog_query || input.query
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
    || (step.key === 'turn_intent' ? str(row(output.scope).reason) : '')
  const linkedActions = execution.steps.filter(item => item.key === 'advisor_handoff' && Number(decisionRecord(item).caused_by_step) === step.order)
  const summary = step.key === 'turn_intent' && ['turn-intent-v1', 'turn-intent-v2'].includes(str(output.version))
    ? `Objetivo registrado: ${humanValue(output.objective)}. ${humanValue(output.interpretation_source)}.`
    : step.key === 'interest_evaluation' ? 'El motor de puntaje registró una recomendación comercial. Este paso no acredita la asignación de un asesor ni la reserva del inmueble.'
    : step.key === 'lead_profile_resolution' ? 'Se conservaron los datos declarados y se resolvió si la residencia está confirmada o necesita una aclaración. Este paso no acredita el envío de la pregunta.'
    : step.key === 'route_consistency' ? humanValue(output.reason)
    : step.key === 'catalog_embedding_search' ? catalogSearchExplanation(output).summary
    : step.key === 'dialogue_decision' && queryText ? `Se eligió responder con esta consulta: ${queryText}.`
    : step.key === 'message_delivery' && output.action === 'accepted' ? 'Kommo aceptó iniciar Salesbot. Esto no confirma entrega ni lectura en WhatsApp.'
      : step.key === 'advisor_handoff' ? 'Este paso registra el intento de derivación y su resultado; el motivo debe estar respaldado por su propio registro.'
        : step.key === 'response_coverage' && output.status === 'invalid_coverage'
          ? `Se descartó el borrador antes de evaluar su contenido porque la ficha interna de la IA no pasó la validación. ${Array.isArray(output.issues) && output.issues.length ? 'Los controles muestran el campo, el valor recibido y lo esperado.' : 'Este registro antiguo no conserva el campo que falló.'} La decisión de derivar a un asesor se registra por separado.`
        : step.key === 'response_coverage' ? 'Se revisó si la respuesta atiende las solicitudes del mensaje. Los estados registrados permiten revisar esa decisión.'
          : 'Entradas y resultados conservados para este paso de la ejecución.'
  return {
    coverageSections: step.key === 'response_coverage' ? [...laterChanges, ...coverageSections(output, snapshots)] : step.key === 'response_validation' ? transformationSections(output) : null,
    title: stepTitle(step), summary, used, found, units, cause, missingCause: hasCause && !cause, linkedActions,
    origin: str(decision.origin) ? decision.origin === 'catalog' ? 'Consulta calculada del catálogo' : humanValue(decision.origin) : 'Origen no registrado en este paso.',
    reason: step.key === 'catalog_embedding_search' ? catalogSearchExplanation(output).reason : reason ? humanValue(reason) : 'No se guardó un motivo específico. No se deduce de los pasos cercanos.',
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

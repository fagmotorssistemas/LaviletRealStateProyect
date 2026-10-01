import type { WorkflowExecutionStep } from './executionWorkflow'
import { WORKFLOWS } from './workflowDefinitions'
import { reviewStepRejected, reviewDiagnostics } from './reviewDiagnostics'

type Step = WorkflowExecutionStep
export type ArchitectureNode = {
  id: string; title: string; description: string; owner: string; source: string
  kind: 'agent' | 'decision' | 'operation' | 'route'; column: number; row: number
  key?: string; branch?: { key: string; field: string; value: string | boolean }
  role?: string[]
}
export type ArchitectureLink = { from: string; to: string; label?: string }
const n = (id: string, title: string, description: string, column: number, row: number, key?: string,
  kind: ArchitectureNode['kind'] = 'operation', source = 'conversation.ts'): ArchitectureNode =>
  ({ id, title, description, column, row, key, kind, source, owner: 'Sistema' })
const agent = (id: string, title: string, description: string, column: number, row: number, role: string[]): ArchitectureNode =>
  ({ ...n(id, title, description, column, row, undefined, 'agent', 'ai.ts · ai-model-routing.ts'), owner: 'IA', role })
const branch = (id: string, title: string, description: string, column: number, row: number, key: string, field: string, value: string | boolean): ArchitectureNode =>
  ({ ...n(id, title, description, column, row, undefined, 'route',
    ({ budget_resolution: 'turn-budget.ts', turn_intent: 'turn-intent.ts', catalog_resolution: 'property-context.ts',
      scope_classification: 'business-scope.ts', response_coverage: 'turn-completeness.ts', dialogue_decision: 'conversation.ts · catalog-dialogue.ts' } as Record<string, string>)[key] || 'conversation.ts'),
    branch: { key, field, value } })

export const INTENT_ROUTES = [
  ['ask_price', 'Consultar precios', 'Buscar precios autorizados para la categoría o unidad solicitada.'],
  ['discuss_budget', 'Evaluar presupuesto', 'Comparar el presupuesto declarado con los precios disponibles; no asumir financiamiento.'],
  ['select_property', 'Elegir un inmueble', 'Resolver la unidad o categoría a la que se refiere el cliente.'],
  ['project_information', 'Conocer el proyecto', 'Preparar información del proyecto con las fuentes disponibles.'],
  ['answer_previous', 'Responder a la pregunta anterior', 'Conservar el objetivo pendiente y resolver la referencia de la respuesta.'],
  ['request_visit', 'Solicitar una visita', 'Comprobar consentimiento, información y estado de la coordinación.'],
  ['ask_financing', 'Consultar financiamiento', 'Consultar condiciones y datos pendientes; una consulta no autoriza trámites.'],
  ['ask_reservation', 'Consultar una reserva', 'Informar las condiciones autorizadas, sin confirmar una reserva.'],
  ['request_reservation', 'Solicitar una reserva', 'Iniciar la gestión con el asesor; no equivale a reservar inventario.'],
  ['other', 'Otro objetivo o aclaración', 'Usar las solicitudes interpretadas y el contexto sin inventar una intención.'],
  ['clarify_scope', 'Aclarar el alcance', 'Resolver la incertidumbre antes de asumir un objetivo comercial.'],
  ['out_of_scope', 'Atender el límite del negocio', 'Responder dentro del alcance autorizado.'],
  ['neutral', 'Continuación neutral', 'Mantener el contexto sin atribuir una solicitud comercial inexistente.'],
] as const

const subflows = ['pauses', 'visits', 'financing', 'nutrition'] as const
const subflowNodes: ArchitectureNode[] = subflows.flatMap((key, index) => WORKFLOWS[key].nodes.map(item => ({
  ...n(`${key}:${item.id}`, item.data.title, `${WORKFLOWS[key].label}: ${item.data.summary}`, item.position.x / 300, 16 + index * 5 + item.position.y / 190,
    undefined, item.data.kind === 'ai' ? 'agent' : item.data.kind === 'decision' ? 'decision' : 'operation', item.data.source),
  owner: item.data.eyebrow === 'Humano' ? 'Asesor' : key === 'visits' && item.id === 'client' ? 'Lead e interpretación' : item.data.kind === 'ai' ? 'IA' : 'Sistema',
})))

// This is a functional map, not a reconstructed call stack. Only explicit trace
// records below can highlight nodes/branches. Missing evidence is never "skipped".
export const ARCHITECTURE_NODES: ArchitectureNode[] = [
  n('message', 'Mensaje recibido', 'Identificar el mensaje, el lead y el lote procesado.', 0, 3, 'message_received'),
  n('permission', '¿Puede responder la IA?', 'Comprobar detención manual, baja y atención humana antes de continuar.', 1, 3, 'response_permission', 'decision'),
  ...[
    ['BOT_CAN_RESPOND', 'Puede continuar', 'El permiso inicial permite procesar el mensaje. Se vuelve a comprobar antes de enviar.'],
    ['MANUAL_STOP', 'IA detenida manualmente', 'El control manual impide la respuesta automática.'],
    ['OPT_OUT', 'El cliente pidió detener mensajes', 'Respetar la baja registrada.'],
    ['NOT_PERMITTED', 'Fuera de los permisos activos', 'La configuración no autoriza responder a este lead.'],
    ['ADVISOR_OWNS_CONVERSATION', 'Un asesor está atendiendo', 'Ceder la conversación según la actividad humana comprobada.'],
  ].map(([value, title, description], i) => branch(`permission_${value}`, title, description, 2, i + 6, 'response_permission', 'reason', value)),
  n('context', 'Cargar contexto', 'Historial, proyecto, políticas y datos confirmados del lead.', 2, 3, 'commercial_context'),
  agent('scope_ai', 'Clasificador de alcance', 'Interpretar si la consulta pertenece al negocio. La salida la aplica el sistema.', 3, 3, ['scope']),
  n('scope', 'Aplicar el alcance', 'El sistema puede resolver saludos sin llamar al clasificador. Esta etapa no demuestra una llamada IA.', 4, 3, 'scope_classification', 'decision', 'business-scope.ts'),
  ...[
    ['property', 'Consulta del negocio', 'La consulta pertenece al proyecto.'],
    ['mixed', 'Consulta mixta', 'Separar la solicitud del proyecto del tema ajeno.'],
    ['out_of_scope', 'Fuera del negocio', 'Mantener el límite comercial; el alcance puede conciliarse con la extracción.'],
    ['neutral', 'Mensaje neutral', 'Usar el contexto para interpretar saludo, cortesía o continuación.'],
  ].map(([value, title, description], i) => branch(`scope_${value}`, title, description, 5, i + 1, 'scope_classification', 'scope', value)),
  branch('scope_uncertain', 'Alcance incierto', 'No tratar una interpretación incierta como decisión definitiva.', 5, 5, 'scope_classification', 'uncertain', true),
  n('data', 'Cargar datos comerciales', 'Recuperar catálogo y contexto financiero necesarios.', 6, 3, 'decision_context'),
  agent('extractor', 'Extractor de intención y datos', 'Interpretar solicitudes, presupuesto, preferencias y datos declarados.', 7, 3, ['extractor']),
  n('reconcile', '¿Coinciden alcance e intención?', 'Conciliar cuando corresponde; no todos los mensajes necesitan arbitraje.', 8, 3, 'scope_reconciliation', 'decision', 'business-scope.ts'),
  n('intent', 'Resolver objetivo del turno', 'Combinar la interpretación actual con el objetivo pendiente. Puede haber varias solicitudes.', 9, 3, 'turn_intent', 'decision', 'turn-intent.ts'),
  ...INTENT_ROUTES.map(([value, title, description], i) => branch(`intent_${value}`, title, description, 10, i, 'turn_intent', 'objective', value)),
  n('catalog', 'Resolver catálogo y referencias', 'Aplicar categoría, dormitorios, planta y demás filtros; identificar candidatas y aclaraciones.', 11, 3, 'catalog_resolution', 'decision', 'property-context.ts'),
  branch('reference_missing', 'Falta referencia para el precio', 'Solicitar la categoría o unidad necesaria para consultar el precio.', 11, 9, 'turn_intent', 'needs_reference', true),
  branch('catalog_clarify', 'Aclarar la búsqueda', 'La resolución del catálogo indica que necesita una aclaración.', 12, 10, 'catalog_resolution', 'needs_clarification', true),
  branch('catalog_resolved', 'Referencia resuelta', 'La resolución del catálogo no exige aclaración. Esto no acredita disponibilidad por sí solo.', 12, 12, 'catalog_resolution', 'needs_clarification', false),
  n('profile', 'Resolver perfil del lead', 'Nombre y residencia declarados; el nombre de WhatsApp no demuestra identidad.', 11, 5, 'lead_profile_resolution', 'decision', 'lead-profile.ts'),
  n('route_guard', '¿La acción corresponde al turno?', 'Comprobar que la solicitud actual permite la ruta operativa.', 12, 3, 'route_consistency', 'decision', 'route-consistency.ts'),
  n('introduction', 'Presentación y datos pendientes', 'Aplicar la etapa comercial y determinar qué datos faltan.', 12, 5, 'lead_introduction', 'decision', 'lead-introduction.ts'),
  n('visit', 'Coordinar visita', 'Registrar la coordinación cuando corresponde; no implica una cita confirmada.', 12, 0, 'visit_coordination'),
  n('visit_result', 'Resultado de visita', 'Aplicar aceptación, cambio o resultado registrado de la cita.', 13, 0, 'visit_result'),
  n('handoff', 'Gestionar atención humana', 'Registrar asignación o cola. El texto de un borrador no acredita esta acción.', 13, 7, 'advisor_handoff'),
  n('dialogue', 'Elegir respuesta y siguiente pregunta', 'Combinar solicitudes, hechos y políticas para preparar la respuesta.', 13, 3, 'dialogue_decision', 'decision'),
  ...[
    ['search', 'Buscar unidades', 'Consultar las unidades que cumplen los filtros.'],
    ['rank', 'Ordenar alternativas', 'Ordenar unidades según el criterio interpretado.'],
    ['compare', 'Comparar unidades', 'Contrastar las unidades identificadas con sus datos.'],
    ['select', 'Resolver selección', 'Aplicar la selección del cliente.'],
    ['details', 'Mostrar detalles', 'Preparar la ficha de la unidad o grupo solicitado.'],
    ['none', 'Sin operación de catálogo', 'La ruta registrada no establece una operación específica.'],
  ].map(([value, title, description], i) => branch(`catalog_${value}`, title, description, 13, i + 9, 'dialogue_decision', 'source', `catalog_${value}`)),
  n('coverage', 'Controlar redacción y revisión', 'Agrupa los intentos de este turno; su duración incluye las llamadas internas.', 14, 3, 'response_coverage', 'decision', 'turn-completeness.ts'),
  n('budget', '¿Qué cubre el presupuesto?', 'Comparar el importe interpretado con los precios autorizados de las unidades consultadas.', 14, 9, 'budget_resolution', 'decision', 'turn-budget.ts'),
  ...[
    ['prices_not_authorized', 'Precios sin autorización', 'No utilizar precios sin autorización comercial.'],
    ['matching_options', 'Hay opciones dentro del presupuesto', 'Se encontraron unidades con precio autorizado dentro del importe.'],
    ['incomplete_prices', 'Faltan precios o evidencia', 'No afirmar que no existen opciones cuando la información está incompleta.'],
    ['no_matching_features', 'Sin opciones con esas características', 'La consulta completa no contiene unidades con los filtros solicitados.'],
    ['below_available_prices', 'Presupuesto inferior a los precios', 'Los precios comprobados de la búsqueda superan el importe declarado.'],
  ].map(([value, title, description], i) => branch(`budget_${value}`, title, description, 15, i + 9, 'budget_resolution', 'status', value)),
  agent('writer', 'Redactor de respuesta', 'Redactar usando los datos y obligaciones del turno. Cada llamada queda separada en el inspector.', 15, 3, ['writer', 'draft']),
  agent('reviewer', 'Revisor de respuesta', 'Revisar el borrador y entregar su ficha. Completar la llamada no significa aprobar el texto.', 16, 3, ['reviewer']),
  n('draft_validation', 'Comprobar ficha y datos', 'Contrastar el resultado de revisión con las fuentes autorizadas y registrar la decisión.', 17, 3, 'draft_validation', 'decision', 'turn-completeness.ts'),
  branch('review_checked', 'Revisión aprobada', 'La revisión registró checked. Aún faltan controles de envío y aceptación de Kommo.', 18, 0, 'response_coverage', 'status', 'checked'),
  branch('review_recovery', 'Recuperación pendiente', 'La revisión dejó la respuesta pendiente de recuperación; consultar las acciones posteriores.', 18, 9, 'response_coverage', 'recovery.pending', true),
  n('repair_metadata', 'Reparar ficha interna', 'Corregir evidencia o estructura de la revisión sin atribuir automáticamente un error al texto.', 16, 5),
  n('repair_draft', 'Solicitar nueva redacción', 'Corregir el borrador cuando la revisión identifica un problema que requiere cambiarlo.', 15, 6),
  n('route_selected', 'Aplicar ruta de respuesta', 'Registrar la ruta elegida después de preparar y revisar el contenido.', 18, 3, 'route_selected', 'decision'),
  n('validation', 'Comprobación final', 'Registrar controles finales antes del envío.', 19, 3, 'response_validation', 'decision'),
  n('content_review', 'Revisar contenido modificado', 'Si cambia el contenido antes del envío, comprobar su integridad.', 19, 5, 'final_content_review', 'decision', 'delivery-integrity.ts'),
  n('failure', 'Error o recuperación', 'Un error requiere consultar su código y los pasos posteriores; no demuestra que se avisó a un asesor.', 18, 7, 'execution_failed', 'decision'),
  n('delivery', 'Enviar a Kommo', 'Comprobar permiso vigente y registrar aceptación. Aceptación no equivale a entrega o lectura en WhatsApp.', 20, 3, 'message_delivery'),
  n('memory', 'Guardar memoria', 'Conservar el estado y los seguimientos, registrando cualquier fallo.', 21, 3, 'state_persisted'),
  n('exit', 'Resultado de ejecución', 'Consultar el resultado registrado: envío, pausa, omisión o error.', 22, 3, 'execution_exit'),
  ...subflowNodes,
]
const link = (from: string, to: string, label?: string): ArchitectureLink => ({ from, to, label })
export const ARCHITECTURE_LINKS: ArchitectureLink[] = [
  link('message', 'permission'), link('permission', 'context', 'Continuar'), link('permission', 'exit', 'Detener / omitir'),
  ...['BOT_CAN_RESPOND', 'MANUAL_STOP', 'OPT_OUT', 'NOT_PERMITTED', 'ADVISOR_OWNS_CONVERSATION'].map(value => link('permission', `permission_${value}`)),
  link('context', 'scope_ai', 'Requiere IA'), link('scope_ai', 'scope'), link('context', 'scope', 'Resolución directa'),
  ...['property', 'mixed', 'out_of_scope', 'neutral', 'uncertain'].flatMap(value => [link('scope', `scope_${value}`), link(`scope_${value}`, 'data', 'Según contexto')]),
  link('data', 'extractor'), link('extractor', 'reconcile', 'Si requiere conciliación'), link('extractor', 'intent'), link('reconcile', 'intent'),
  ...INTENT_ROUTES.flatMap(([value, title]) => [link('intent', `intent_${value}`, title), link(`intent_${value}`, 'catalog', 'Preparar hechos')]),
  link('catalog', 'profile'), link('catalog', 'route_guard'), link('profile', 'introduction'), link('route_guard', 'dialogue'), link('introduction', 'dialogue'),
  link('intent', 'reference_missing', 'needs_reference'), link('catalog', 'catalog_clarify', 'Sí'), link('catalog', 'catalog_resolved', 'No'),
  link('coverage', 'budget', 'Presupuesto interpretado'),
  ...['prices_not_authorized', 'matching_options', 'incomplete_prices', 'no_matching_features', 'below_available_prices'].flatMap(value => [link('budget', `budget_${value}`), link(`budget_${value}`, 'writer', 'Informar al redactor')]),
  link('route_guard', 'visit', 'Visita autorizada'), link('visit', 'visit_result'), link('visit_result', 'dialogue'),
  link('dialogue', 'handoff', 'Requiere asesor'), link('dialogue', 'coverage'), link('coverage', 'writer'), link('writer', 'reviewer'),
  ...['search', 'rank', 'compare', 'select', 'details', 'none'].map(value => link('dialogue', `catalog_${value}`)),
  link('coverage', 'review_checked'), link('coverage', 'review_recovery'),
  link('reviewer', 'draft_validation'), link('draft_validation', 'repair_metadata', 'Ficha inválida y reparable'), link('repair_metadata', 'reviewer'),
  link('draft_validation', 'repair_draft', 'Texto requiere corrección'), link('repair_draft', 'writer'),
  link('draft_validation', 'route_selected', 'Respuesta autorizada'), link('draft_validation', 'failure', 'Sin respuesta autorizada'),
  link('route_selected', 'validation'), link('validation', 'content_review', 'Contenido modificado'), link('content_review', 'delivery'),
  link('validation', 'delivery', 'Puede enviar'), link('validation', 'exit', 'Permiso revocado'), link('failure', 'handoff', 'Recuperación confirmada'),
  link('delivery', 'memory'), link('memory', 'exit'),
  ...subflows.flatMap(key => WORKFLOWS[key].edges.map(e => link(`${key}:${e.source}`, `${key}:${e.target}`, typeof e.label === 'string' ? e.label : undefined))),
  link('permission', 'pauses:inbound', 'Detalle de permisos'), link('intent_request_visit', 'visits:intent', 'Detalle de coordinación'),
  link('intent_ask_financing', 'financing:intent', 'Detalle financiero'), link('memory', 'nutrition:timer', 'Seguimiento posterior'),
]

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const field = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => record(current)[key], value)
const decided = (s: Step) => ['succeeded', 'paused', 'skipped'].includes(s.status)
export function nodeEvidence(node: ArchitectureNode, steps: Step[]): Step[] {
  if (node.role) return steps.filter(s => s.key === 'model_request' && node.role!.includes(String(s.input.ai_role)))
  if (node.branch) return steps.filter(s => s.key === node.branch!.key && decided(s) && field(s.output, node.branch!.field) === node.branch!.value)
  if (node.id === 'repair_metadata' || node.id === 'repair_draft') return steps.filter(s => s.key === 'response_coverage'
    && Array.isArray(s.output.repair_attempts) && s.output.repair_attempts.some(a =>
      node.id === 'repair_draft' ? record(a).target === 'commercial_draft' : ['review_metadata', 'writer_metadata'].includes(String(record(a).target))))
  return node.key ? steps.filter(s => s.key === node.key) : []
}

export function nodeState(node: ArchitectureNode, steps: Step[]) {
  const evidence = nodeEvidence(node, steps)
  if (evidence.length) return evidence.some(s => s.status === 'failed') ? 'failed'
    : evidence.some(s => reviewStepRejected(s) || s.key === 'model_request' && reviewDiagnostics(s).length > 0) ? 'rejected'
    : evidence.some(s => s.status === 'paused') ? 'paused'
      : evidence.every(s => s.status === 'skipped') ? 'skipped' : 'observed'
  // Only an explicit value of the same decision proves this alternative was not selected.
  if (node.branch && steps.some(s => s.key === node.branch!.key && decided(s)
    && (typeof node.branch!.value === 'boolean' ? typeof field(s.output, node.branch!.field) === 'boolean'
      : ARCHITECTURE_NODES.some(candidate => candidate.branch?.key === node.branch!.key && candidate.branch.field === node.branch!.field
        && candidate.branch.value === field(s.output, node.branch!.field))))) return 'not_selected'
  return 'unknown'
}

/** Never connect two observed nodes just because both exist. A branch edge is
 * proven by the parent's exact field; other solid edges require a causal link. */
export function linkObserved(link: ArchitectureLink, steps: Step[]) {
  const from = ARCHITECTURE_NODES.find(n => n.id === link.from)!
  const to = ARCHITECTURE_NODES.find(n => n.id === link.to)!
  const parents = nodeEvidence(from, steps), children = nodeEvidence(to, steps)
  if (to.branch && from.key === to.branch.key) return children.length > 0
  return parents.length > 0 && children.some(s => {
    const cause = s.input.caused_by_step ?? record(s.output.decision).caused_by_step
    return parents.some(p => p.order === cause)
  })
}

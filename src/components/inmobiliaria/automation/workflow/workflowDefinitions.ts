import type { Edge, Node } from '@xyflow/react'

export type WorkflowNodeKind = 'input' | 'process' | 'decision' | 'ai' | 'action' | 'pause' | 'success'

export interface WorkflowNodeData extends Record<string, unknown> {
  title: string
  eyebrow: string
  summary: string
  kind: WorkflowNodeKind
  source: string
  reads: string[]
  result: string
  traceStatus?: string
  durationMs?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  errorCode?: string | null
}

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

export interface WorkflowDefinition {
  label: string
  description: string
  nodes: WorkflowNode[]
  edges: Edge[]
}

const node = (
  id: string,
  x: number,
  y: number,
  data: WorkflowNodeData,
): WorkflowNode => ({ id, type: 'workflow', position: { x, y }, data })

const edge = (source: string, target: string, label?: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
  type: 'smoothstep',
})

export const WORKFLOWS = {
  overview: {
    label: 'Recorrido principal',
    description: 'Desde el mensaje de WhatsApp hasta la respuesta, el cambio de estado o la intervención de un asesor.',
    nodes: [
      node('inbound', 0, 190, {
        title: 'Mensaje entrante', eyebrow: 'Entrada', kind: 'input',
        summary: 'Kommo entrega el mensaje y se identifica el lead, el contacto y la conversación.',
        source: 'webhook.ts · conversation.ts', reads: ['Webhook de Kommo', 'Lead y conversación'], result: 'Mensaje normalizado y registrado',
      }),
      node('guard', 270, 190, {
        title: 'Permiso para responder', eyebrow: 'Control', kind: 'decision',
        summary: 'Comprueba DETENER IA, opt-out, duplicados y si un asesor está atendiendo esta conversación.',
        source: 'conversation.ts · human-attention.ts', reads: ['bot_enabled', 'tracking_opt_out_at', 'Último emisor'], result: 'Continuar o detener esta ejecución',
      }),
      node('context', 550, 190, {
        title: 'Contexto comercial', eyebrow: 'Memoria', kind: 'process',
        summary: 'Reúne historial, catálogo, proyecto, políticas, citas, financiamiento y datos confirmados.',
        source: 'context-read.ts · data.ts', reads: ['Historial reciente', 'Catálogo vigente', 'Estado del lead'], result: 'Contexto acotado para interpretar el turno',
      }),
      node('extractor', 830, 190, {
        title: 'Interpretación del turno', eyebrow: 'IA', kind: 'ai',
        summary: 'Interpreta los mensajes elegibles antes de elegir la respuesta, conservando la pregunta pendiente y sus referentes.',
        source: 'turn-interpretation.ts · turn-semantics.ts', reads: ['Mensaje actual', 'Historial contextual', 'Pregunta pendiente'], result: 'Intención, evidencia y entidades estructuradas',
      }),
      node('catalog', 1110, 500, {
        title: 'Resolver con el catálogo', eyebrow: 'Hechos', kind: 'process',
        summary: 'Aplica restricciones de categoría, planta y superficie, y conserva las unidades que respaldan el resultado.',
        source: 'property-context.ts · commercialContext', reads: ['Interpretación', 'Catálogo disponible', 'Pregunta pendiente'], result: 'Filtros, candidatas y motivo de selección o aclaración',
      }),
      node('router', 1110, 190, {
        title: 'Enrutador de intención', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Selecciona el módulo responsable sin volver a interpretar el mensaje con reglas aisladas.',
        source: 'turn-routing.ts · conversation.ts', reads: ['Intención extraída', 'Estado pendiente'], result: 'Ruta comercial, visita, financiamiento o atención humana',
      }),
      node('commercial', 1390, 0, {
        title: 'Respuesta comercial', eyebrow: 'Ruta', kind: 'action',
        summary: 'Responde sobre unidades, precios, proyecto, ubicación, materiales y alternativas reales.',
        source: 'sdr.ts · direct-reply.ts', reads: ['Catálogo', 'Políticas comerciales'], result: 'Respuesta sustentada en información verificada',
      }),
      node('visit', 1390, 145, {
        title: 'Citas y visitas', eyebrow: 'Ruta', kind: 'action',
        summary: 'Distingue solicitud, propuesta, confirmación, reagendamiento, cancelación y recordatorio.',
        source: 'visits.ts · visit-intake.ts', reads: ['Preferencia de fecha', 'Citas y propuestas'], result: 'Solicitud o cita actualizada',
      }),
      node('finance', 1390, 290, {
        title: 'Financiamiento', eyebrow: 'Ruta', kind: 'action',
        summary: 'Continúa la precalificación y solicita únicamente el siguiente dato faltante.',
        source: 'financing.ts · financing-continuation.ts', reads: ['Entidad elegida', 'Datos ya recopilados'], result: 'Precalificación guardada o enviada a revisión',
      }),
      node('handoff', 1390, 435, {
        title: 'Atención humana', eyebrow: 'Ruta', kind: 'action',
        summary: 'Crea una asignación o tarea para el asesor. El traspaso por sí solo no apaga la IA.',
        source: 'conversation.ts · handoff_lead', reads: ['Motivo', 'Asesor disponible'], result: 'Consulta asignada o en cola',
      }),
      node('quality', 1680, 190, {
        title: 'Plan y control de respuesta', eyebrow: 'Validación', kind: 'decision',
        summary: 'Valida hechos y resultados operativos. La bitácora indica qué controles se ejecutaron y qué respuesta quedó protegida.',
        source: 'response-plan.ts · turn-completeness.ts', reads: ['Respuesta propuesta', 'Acción ejecutada', 'Datos obligatorios'], result: 'Respuesta protegida o revisión controlada',
      }),
      node('delivery', 1960, 190, {
        title: 'Aceptación de Kommo', eyebrow: 'Salida', kind: 'success',
        summary: 'Comprueba de nuevo que nadie haya respondido antes de enviar y registra la salida.',
        source: 'conversation.ts · kommo.ts', reads: ['Permiso vigente', 'Mensajes concurrentes'], result: 'Kommo aceptó iniciar Salesbot; entrega al teléfono sin confirmar',
      }),
      node('memory', 2240, 190, {
        title: 'Guardar memoria', eyebrow: 'Estado', kind: 'process',
        summary: 'Conserva preferencias, opciones, selección y pregunta pendiente después de la aceptación; registra si falla el guardado.',
        source: 'conversation.ts · property-context.ts', reads: ['Respuesta aceptada', 'Decisión del turno'], result: 'Memoria actualizada o fallo visible',
      }),
    ],
    edges: [
      edge('inbound', 'guard'), edge('guard', 'context', 'continúa'), edge('context', 'extractor'), edge('extractor', 'catalog'), edge('catalog', 'router'),
      edge('router', 'commercial', 'información'), edge('router', 'visit', 'visita'), edge('router', 'finance', 'financiamiento'), edge('router', 'handoff', 'asesor'),
      edge('commercial', 'quality'), edge('visit', 'quality'), edge('finance', 'quality'), edge('handoff', 'quality'), edge('quality', 'delivery'), edge('delivery', 'memory'),
    ],
  },
  pauses: {
    label: 'Pausas de la IA',
    description: 'Las tres condiciones funcionales que impiden que el bot conteste una conversación.',
    nodes: [
      node('inbound', 0, 210, {
        title: 'Nuevo mensaje', eyebrow: 'Entrada', kind: 'input',
        summary: 'La verificación se ejecuta para cada mensaje nuevo antes de interpretar su contenido.',
        source: 'conversation.ts', reads: ['Mensaje registrado'], result: 'Inicia la cadena de permisos',
      }),
      node('manual', 300, 80, {
        title: '¿DETENER IA está activo?', eyebrow: 'Condición 1', kind: 'decision',
        summary: 'Respeta el control manual del asesor tanto en el lead local como en Kommo.',
        source: 'conversation.ts · kommo.ts', reads: ['bot_enabled', 'Campo 451530'], result: 'Sí: detener · No: continuar',
      }),
      node('optout', 610, 210, {
        title: '¿El lead pidió no recibir mensajes?', eyebrow: 'Condición 2', kind: 'decision',
        summary: 'Comprueba el opt-out persistido; la baja no se confunde con un simple rechazo comercial.',
        source: 'conversation.ts · conversation-rules.ts', reads: ['tracking_opt_out_at', 'Intención opt_out'], result: 'Sí: detener · No: continuar',
      }),
      node('human', 920, 340, {
        title: '¿Un asesor está contestando?', eyebrow: 'Condición 3', kind: 'decision',
        summary: 'Mira el último emisor saliente de la conversación actual, sin heredar actividad de conversaciones antiguas.',
        source: 'human-attention.ts', reads: ['Mensajes de esta conversación'], result: 'Sí: ceder al asesor · No: continuar',
      }),
      node('pause', 1240, 40, {
        title: 'IA en pausa', eyebrow: 'Resultado', kind: 'pause',
        summary: 'El mensaje queda registrado, pero no se genera ni se envía una respuesta automática.',
        source: 'conversation.ts', reads: ['Causa de la pausa'], result: 'Ejecución finalizada sin respuesta',
      }),
      node('continue', 1240, 360, {
        title: 'Procesar mensaje', eyebrow: 'Resultado', kind: 'success',
        summary: 'El lead puede tener un asesor asignado; la asignación sola no bloquea al bot.',
        source: 'conversation.ts', reads: ['Permisos aprobados'], result: 'Carga contexto y continúa al extractor',
      }),
    ],
    edges: [
      edge('inbound', 'manual'), edge('manual', 'pause', 'sí'), edge('manual', 'optout', 'no'), edge('optout', 'pause', 'sí'),
      edge('optout', 'human', 'no'), edge('human', 'pause', 'sí'), edge('human', 'continue', 'no'),
    ],
  },
  visits: {
    label: 'Citas y visitas',
    description: 'Cómo se convierte una solicitud del lead en una cita confirmada, reagendada o derivada.',
    nodes: [
      node('intent', 0, 190, {
        title: 'Intención de visita', eyebrow: 'Extractor', kind: 'ai',
        summary: 'Distingue agendar, aceptar, proponer otra hora, reagendar, cancelar, preguntar o rechazar.',
        source: 'conversation.ts · visit-choice.ts', reads: ['Turno completo', 'Propuesta vigente'], result: 'visit_intent y preferencia de fecha',
      }),
      node('state', 300, 190, {
        title: 'Estado de coordinación', eyebrow: 'Memoria', kind: 'process',
        summary: 'Comprueba si existe solicitud, propuesta pendiente, cita confirmada o reagendamiento.',
        source: 'visits.ts · visit-intake.ts', reads: ['appointment_requests', 'appointments'], result: 'Acción válida para el estado actual',
      }),
      node('enough', 600, 190, {
        title: '¿Hay fecha y hora?', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Si falta información, ofrece horarios autorizados. Si existe, registra la solicitud.',
        source: 'visit-intake.ts · visitClock.ts', reads: ['Fecha interpretada', 'Horario del proyecto'], result: 'Solicitar dato o crear coordinación',
      }),
      node('hours', 900, 20, {
        title: 'Ofrecer horarios', eyebrow: 'Bot', kind: 'action',
        summary: 'Presenta opciones dentro del horario de atención sin confirmar disponibilidad inexistente.',
        source: 'visit-copy.ts · botVisits.ts', reads: ['Horario autorizado'], result: 'Lead elige o pide ayuda',
      }),
      node('request', 900, 220, {
        title: 'Solicitud al asesor', eyebrow: 'Sistema', kind: 'action',
        summary: 'Crea la solicitud con tipo agendar o reagendar y mantiene la IA disponible.',
        source: 'visits.ts · visitInbox.ts', reads: ['Fecha solicitada', 'Tipo de solicitud'], result: 'Notificación titulada Agendar o Reagendar',
      }),
      node('advisor', 1210, 220, {
        title: 'Revisión del asesor', eyebrow: 'Humano', kind: 'decision',
        summary: 'El asesor acepta el horario o envía alternativas cercanas.',
        source: 'Agenda · Bandeja de citas', reads: ['Agenda', 'Disponibilidad'], result: 'Propuesta oficial para el lead',
      }),
      node('client', 1510, 220, {
        title: 'Respuesta del lead', eyebrow: 'Decisión', kind: 'decision',
        summary: 'La aceptación confirma; una nueva fecha vuelve a coordinar; el rechazo conserva el diálogo.',
        source: 'conversation.ts · visit-choice.ts', reads: ['Propuesta enviada', 'Respuesta actual'], result: 'Confirmar, reagendar o seguir conversando',
      }),
      node('confirmed', 1810, 100, {
        title: 'Cita confirmada', eyebrow: 'Resultado', kind: 'success',
        summary: 'Mantiene el mismo asesor, actualiza la temperatura y programa recordatorios.',
        source: 'visits.ts · visit-reminder.ts', reads: ['Cita y asesor'], result: 'Confirmación, ubicación y recordatorio',
      }),
      node('retry', 1810, 340, {
        title: 'Continuar coordinación', eyebrow: 'Resultado', kind: 'action',
        summary: 'El bot ofrece horarios o el asesor recibe una nueva solicitud; la conversación permanece activa.',
        source: 'visit-intake.ts', reads: ['Motivo del rechazo'], result: 'Nueva propuesta sin abandonar al lead',
      }),
    ],
    edges: [
      edge('intent', 'state'), edge('state', 'enough'), edge('enough', 'hours', 'faltan datos'), edge('hours', 'enough', 'elección'),
      edge('enough', 'request', 'completa'), edge('request', 'advisor'), edge('advisor', 'client'), edge('client', 'confirmed', 'acepta'), edge('client', 'retry', 'cambia o rechaza'), edge('retry', 'advisor'),
    ],
  },
  financing: {
    label: 'Financiamiento',
    description: 'Cómo continúa la precalificación sin reiniciar el formulario ni reinterpretar respuestas como temas externos.',
    nodes: [
      node('intent', 0, 200, {
        title: 'Intención financiera', eyebrow: 'Extractor', kind: 'ai',
        summary: 'Reconoce entidad, consentimiento y datos financieros expresados naturalmente.',
        source: 'conversation-rules.ts · financing.ts', reads: ['Mensaje actual', 'Pregunta anterior'], result: 'Datos estructurados del turno',
      }),
      node('scope', 300, 200, {
        title: '¿Sigue en financiamiento?', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Una pregunta sobre otro tema sale del formulario; una respuesta al dato solicitado continúa.',
        source: 'financing.ts', reads: ['Tema actual', 'Última pregunta del bot'], result: 'Continuar o volver al enrutador general',
      }),
      node('progress', 610, 200, {
        title: 'Progreso guardado', eyebrow: 'Memoria', kind: 'process',
        summary: 'Combina únicamente datos confirmados y conserva lo recopilado en turnos anteriores.',
        source: 'financing-continuation.ts', reads: ['Calificación actual', 'Dato nuevo'], result: 'Campos completos y faltantes',
      }),
      node('next', 920, 200, {
        title: 'Siguiente dato faltante', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Pide una sola cosa, con una frase breve y sin explicar repetidamente para qué sirve cada dato.',
        source: 'financing-continuation.ts', reads: ['Secuencia de la entidad'], result: 'Pregunta siguiente o expediente completo',
      }),
      node('question', 1230, 20, {
        title: 'Pregunta breve', eyebrow: 'Bot', kind: 'action',
        summary: 'Solicita el próximo dato válido y espera la respuesta del lead.',
        source: 'operational-copy.ts', reads: ['Campo faltante'], result: 'Continúa en el siguiente turno',
      }),
      node('validate', 1230, 220, {
        title: 'Validar expediente', eyebrow: 'Control', kind: 'decision',
        summary: 'Revisa formatos, coherencia y datos requeridos antes de enviarlos a revisión.',
        source: 'financing.ts', reads: ['Identificación', 'Actividad', 'Ingresos'], result: 'Completo o corrección puntual',
      }),
      node('handoff', 1530, 220, {
        title: 'Revisión del asesor', eyebrow: 'Traspaso', kind: 'success',
        summary: 'Asigna el expediente al asesor sin apagar automáticamente la IA para futuras preguntas.',
        source: 'conversation.ts · handoff_lead', reads: ['Resumen financiero'], result: 'Tarea asignada y conversación disponible',
      }),
      node('general', 610, 420, {
        title: 'Volver al flujo general', eyebrow: 'Salida', kind: 'action',
        summary: 'Responde el nuevo tema sin borrar ni repetir la precalificación guardada.',
        source: 'turn-routing.ts', reads: ['Nueva intención'], result: 'Ruta correspondiente al turno',
      }),
    ],
    edges: [
      edge('intent', 'scope'), edge('scope', 'progress', 'sí'), edge('scope', 'general', 'cambió de tema'), edge('progress', 'next'),
      edge('next', 'question', 'falta dato'), edge('question', 'progress', 'siguiente turno'), edge('next', 'validate', 'completo'), edge('validate', 'handoff', 'válido'), edge('validate', 'question', 'corregir'),
    ],
  },
  nutrition: {
    label: 'Nutrición y recuperación',
    description: 'Mensajes programados que solo salen si el contacto continúa elegible y nadie está atendiendo.',
    nodes: [
      node('timer', 0, 190, {
        title: 'Tarea programada', eyebrow: 'Tiempo', kind: 'input',
        summary: 'Se activa el seguimiento de 24 horas o de las semanas configuradas.',
        source: 'nutrition.ts · nutrition-week-one.ts', reads: ['Fecha ancla', 'Configuración'], result: 'Tarea lista para verificar',
      }),
      node('eligible', 310, 190, {
        title: '¿El lead sigue elegible?', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Exige consentimiento y descarta opt-out, estados cerrados, cita activa o seguimiento resuelto.',
        source: 'nutrition-context.ts', reads: ['Consentimiento', 'Etapa y citas'], result: 'Continuar o cancelar tarea',
      }),
      node('activity', 620, 190, {
        title: '¿Hubo actividad nueva?', eyebrow: 'Decisión', kind: 'decision',
        summary: 'Evita enviar si llegó otro mensaje, respondió un asesor o cambió la coordinación.',
        source: 'nutrition.ts · nutrition-week-one.ts', reads: ['Mensajes recientes', 'Actividad humana'], result: 'Mantener o descartar el envío',
      }),
      node('context', 930, 190, {
        title: 'Tema útil pendiente', eyebrow: 'Contexto', kind: 'process',
        summary: 'Elige contenido relevante según lo conversado y evita repetir información ya enviada.',
        source: 'nutrition-context.ts', reads: ['Interés del lead', 'Historial'], result: 'Tema y plantilla aprobada',
      }),
      node('send', 1240, 190, {
        title: 'Enviar seguimiento', eyebrow: 'Salida', kind: 'success',
        summary: 'Completa las variables autorizadas, envía la plantilla y registra el resultado.',
        source: 'nutrition.ts · kommo.ts', reads: ['Plantilla aprobada', 'Variables'], result: 'Solicitud aceptada por Kommo; entrega al teléfono sin confirmar',
      }),
      node('cancel', 930, 410, {
        title: 'Cancelar seguimiento', eyebrow: 'Resultado', kind: 'pause',
        summary: 'La tarea termina sin mensaje para evitar duplicados o interferir con atención humana.',
        source: 'nutrition.ts', reads: ['Motivo de inelegibilidad'], result: 'Sin envío',
      }),
    ],
    edges: [
      edge('timer', 'eligible'), edge('eligible', 'activity', 'sí'), edge('eligible', 'cancel', 'no'), edge('activity', 'context', 'sin novedades'),
      edge('activity', 'cancel', 'hay actividad'), edge('context', 'send'),
    ],
  },
} satisfies Record<string, WorkflowDefinition>

export type WorkflowId = keyof typeof WORKFLOWS

export const WORKFLOW_ORDER: WorkflowId[] = ['overview', 'pauses', 'visits', 'financing', 'nutrition']

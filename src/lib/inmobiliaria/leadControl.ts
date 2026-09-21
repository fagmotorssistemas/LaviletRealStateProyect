import type {
  LeadControlCategory,
  LeadControlExecution,
  LeadControlRow,
} from '@/types/leadControl'

export const LEAD_CONTROL_THRESHOLDS = {
  automationResponseMinutes: 10,
  processingMinutes: 5,
  commercialInactivityDays: 21,
} as const

export type LeadControlInput = {
  leadId: string
  kommoId: number | null
  name: string
  phone: string | null
  projectName: string | null
  stage: string
  temperature: string
  botEnabled: boolean
  trackingOptOutAt: string | null
  assigneeName: string | null
  assignedTo: string | null
  handoffStatus: string
  handoffReason: string | null
  sellerResponseDueAt: string | null
  lastInteractionAt: string | null
  lastMessage: { role: string; content: string | null; sentAt: string } | null
  latestAppointment: { status: string; requestedAt: string | null; scheduledAt: string | null } | null
  executions: LeadControlExecution[]
  now?: Date
}

type Diagnosis = Pick<LeadControlRow,
  'state' | 'category' | 'severity' | 'reasonCode' | 'reason' | 'explanation' | 'recommendation' | 'detectedAt'>

const FAILED_CATEGORY: Record<string, LeadControlCategory> = {
  message_received: 'entry',
  response_permission: 'routing',
  commercial_context: 'context',
  scope_classification: 'interpretation',
  semantic_extraction: 'interpretation',
  visit_intent: 'interpretation',
  route_selected: 'routing',
  response_validation: 'generation',
  message_delivery: 'delivery',
  state_persisted: 'routing',
  visit_coordination: 'visit',
  advisor_handoff: 'advisor',
  execution_failed: 'generation',
}

function parse(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function minutesSince(value: string | null | undefined, now: Date) {
  const time = parse(value)
  return time ? Math.max(0, (now.getTime() - time) / 60_000) : 0
}

function latestTrace(input: LeadControlInput) {
  const executions = [...input.executions].sort((a, b) => parse(b.occurredAt) - parse(a.occurredAt))
  const steps = executions[0]?.steps ?? []
  const failed = [...steps].reverse().find(step => step.status === 'failed') ?? null
  const paused = [...steps].reverse().find(step => step.status === 'paused') ?? null
  const succeeded = [...steps].reverse().find(step => step.status === 'succeeded') ?? null
  return { executions, failed, paused, succeeded }
}

function diagnosis(input: LeadControlInput, now: Date): Diagnosis {
  const { executions, failed, paused } = latestTrace(input)
  const latestExecution = executions[0]
  const detectedAt = failed?.completedAt || latestExecution?.occurredAt || input.lastInteractionAt || now.toISOString()

  if (failed) {
    const category = FAILED_CATEGORY[failed.key] ?? 'generation'
    return {
      state: 'intervention', category, severity: 'critical', reasonCode: `TRACE_${failed.key.toUpperCase()}`,
      reason: `La ejecución falló en “${failed.label}”`,
      explanation: failed.errorCode
        ? `El nodo terminó con el código ${failed.errorCode}. Los pasos anteriores sí quedaron registrados.`
        : 'El nodo terminó con error y la ejecución no pudo completar su recorrido normal.',
      recommendation: category === 'delivery'
        ? 'Verifique la entrega en Kommo y WhatsApp antes de reenviar el mensaje.'
        : `Revise la evidencia del nodo “${failed.label}” y el módulo ${failed.source}.`,
      detectedAt,
    }
  }

  if (latestExecution?.status === 'uncertain') {
    return {
      state: 'intervention', category: 'delivery', severity: 'critical', reasonCode: 'EVENT_UNCERTAIN',
      reason: 'La ejecución quedó en estado incierto',
      explanation: 'El worker no puede asegurar si la operación terminó o alcanzó el sistema externo.',
      recommendation: 'Compruebe el último mensaje en Kommo antes de reintentar para evitar duplicados.',
      detectedAt,
    }
  }

  const processingReference = latestExecution?.status === 'pending'
    ? latestExecution.availableAt
    : latestExecution?.occurredAt
  const processingIsDue = latestExecution?.status !== 'pending'
    || (parse(latestExecution.availableAt) > 0 && parse(latestExecution.availableAt) <= now.getTime())
  if (latestExecution && ['pending', 'processing'].includes(latestExecution.status)
    && processingIsDue
    && minutesSince(processingReference, now) >= LEAD_CONTROL_THRESHOLDS.processingMinutes) {
    return {
      state: 'intervention', category: 'entry', severity: 'high', reasonCode: 'EVENT_STALLED',
      reason: 'El procesamiento superó el tiempo esperado',
      explanation: `La ejecución lleva al menos ${LEAD_CONTROL_THRESHOLDS.processingMinutes} minutos sin finalizar.`,
      recommendation: 'Revise el worker, la cola de eventos y el último nodo registrado.',
      detectedAt: processingReference || latestExecution.occurredAt,
    }
  }

  const sellerDue = parse(input.sellerResponseDueAt)
  if (['queued', 'assigned', 'acknowledged'].includes(input.handoffStatus) && sellerDue && sellerDue < now.getTime()) {
    return {
      state: 'intervention', category: 'advisor', severity: 'high', reasonCode: 'ADVISOR_SLA_OVERDUE',
      reason: 'El plazo de respuesta del asesor venció',
      explanation: input.assigneeName
        ? `${input.assigneeName} tiene este lead asignado y aún no consta una respuesta dentro del plazo.`
        : 'El lead necesita atención humana y todavía no tiene un responsable que responda.',
      recommendation: input.assignedTo
        ? 'Contacte al asesor asignado y responda al lead desde Kommo.'
        : 'Asigne un asesor disponible y responda al lead desde Kommo.',
      detectedAt: input.sellerResponseDueAt!,
    }
  }

  if (input.lastMessage?.role === 'cliente'
    && input.botEnabled
    && minutesSince(input.lastMessage.sentAt, now) >= LEAD_CONTROL_THRESHOLDS.automationResponseMinutes) {
    return {
      state: 'intervention', category: 'routing', severity: 'high', reasonCode: 'CUSTOMER_UNANSWERED',
      reason: 'El último mensaje del lead no tiene respuesta',
      explanation: `El mensaje está registrado desde hace más de ${LEAD_CONTROL_THRESHOLDS.automationResponseMinutes} minutos y la IA figura activa.`,
      recommendation: 'Abra la última ejecución para comprobar si se detuvo antes de generar o entregar la respuesta.',
      detectedAt: input.lastMessage.sentAt,
    }
  }

  if (['queued', 'assigned', 'acknowledged'].includes(input.handoffStatus)) {
    return {
      state: 'waiting', category: 'advisor', severity: 'medium', reasonCode: 'WAITING_FOR_ADVISOR',
      reason: input.assigneeName ? `Esperando atención de ${input.assigneeName}` : 'Esperando asignación de asesor',
      explanation: input.handoffReason || 'La automatización indicó que este caso requiere intervención humana.',
      recommendation: input.assignedTo ? 'El asesor asignado debe continuar la conversación.' : 'Asigne un asesor disponible.',
      detectedAt: input.lastInteractionAt || detectedAt,
    }
  }

  if (input.latestAppointment && ['solicitada', 'pendiente'].includes(input.latestAppointment.status)) {
    return {
      state: 'waiting', category: 'visit', severity: 'medium', reasonCode: 'VISIT_PENDING',
      reason: 'La solicitud de visita sigue pendiente',
      explanation: 'La cita todavía no tiene una confirmación final registrada.',
      recommendation: 'Revise la bandeja de citas y confirme o proponga un horario.',
      detectedAt: input.latestAppointment.requestedAt || detectedAt,
    }
  }

  if (input.trackingOptOutAt) {
    return {
      state: 'intentional', category: 'intentional', severity: 'info', reasonCode: 'CONTACT_OPT_OUT',
      reason: 'El lead pidió no recibir mensajes',
      explanation: 'La pausa corresponde a una solicitud explícita del contacto.',
      recommendation: 'Mantenga la automatización detenida salvo que el lead vuelva a autorizar el contacto.',
      detectedAt: input.trackingOptOutAt,
    }
  }

  if (!input.botEnabled) {
    return {
      state: 'intentional', category: 'intentional', severity: 'info', reasonCode: 'AUTOMATION_DISABLED',
      reason: 'La IA está detenida para este lead',
      explanation: paused?.output?.reason === 'ADVISOR_OWNS_CONVERSATION'
        ? 'Un asesor tomó la conversación y la automatización cedió el control.'
        : 'El lead está fuera del grupo autorizado o fue detenido manualmente.',
      recommendation: 'No requiere corrección técnica. El seguimiento corresponde al asesor.',
      detectedAt: paused?.completedAt || input.lastInteractionAt || detectedAt,
    }
  }

  if (input.lastInteractionAt
    && minutesSince(input.lastInteractionAt, now) >= LEAD_CONTROL_THRESHOLDS.commercialInactivityDays * 24 * 60) {
    return {
      state: 'intervention', category: 'inactivity', severity: 'medium', reasonCode: 'COMMERCIAL_INACTIVITY',
      reason: `Sin actividad durante ${LEAD_CONTROL_THRESHOLDS.commercialInactivityDays} días`,
      explanation: 'No consta una interacción reciente después del ciclo de seguimiento configurado.',
      recommendation: 'Revise el historial y decida si corresponde una recuperación manual o cerrar el seguimiento.',
      detectedAt: input.lastInteractionAt,
    }
  }

  return {
    state: 'healthy', category: 'normal', severity: 'info', reasonCode: 'NORMAL_FLOW',
    reason: 'El flujo no presenta bloqueos detectados',
    explanation: 'La última actividad terminó dentro de los estados esperados y no hay plazos vencidos.',
    recommendation: 'No requiere intervención.',
    detectedAt,
  }
}

export function classifyLeadControl(input: LeadControlInput): LeadControlRow {
  const now = input.now ?? new Date()
  const trace = latestTrace(input)
  const result = diagnosis(input, now)
  const latestExecution = trace.executions[0]
  const evidence = [
    input.lastMessage ? { label: `Último mensaje (${input.lastMessage.role})`, value: input.lastMessage.content || 'Mensaje sin texto', at: input.lastMessage.sentAt } : null,
    latestExecution ? { label: 'Última ejecución', value: `${latestExecution.kind} · ${latestExecution.status}${latestExecution.action ? ` · ${latestExecution.action}` : ''}`, at: latestExecution.occurredAt } : null,
    input.handoffReason ? { label: 'Motivo de traspaso', value: input.handoffReason, at: input.lastInteractionAt } : null,
  ].filter((item): item is { label: string; value: string; at: string | null } => Boolean(item))

  return {
    leadId: input.leadId,
    kommoId: input.kommoId,
    name: input.name || 'Lead sin nombre',
    phone: input.phone,
    projectName: input.projectName,
    stage: input.stage,
    temperature: input.temperature,
    botEnabled: input.botEnabled,
    assigneeName: input.assigneeName,
    handoffStatus: input.handoffStatus,
    ...result,
    lastInteractionAt: input.lastInteractionAt,
    lastSuccessfulNode: trace.succeeded?.label ?? null,
    stoppedNode: trace.failed?.label ?? trace.paused?.label ?? null,
    evidence,
    executions: trace.executions,
  }
}

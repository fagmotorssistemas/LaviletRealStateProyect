import {
  LEAD_PIPELINE_STAGE_OPTIONS,
  type LeadPipelineEvidence,
  type LeadPipelineInput,
  type LeadPipelineSnapshot,
  type LeadPipelineSourceRow,
  type LeadPipelineStage,
} from '@/types/leadPipeline'

type Row = LeadPipelineSourceRow
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : ''
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : []
const values = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []
const stamp = (v: unknown): string | null => text(v) && Number.isFinite(Date.parse(text(v))) ? text(v) : null
const at = (v: Row): string | null => stamp(v.source_sent_at || v.sale_at || v.sent_at || v.created_at || v.updated_at)
const time = (v: string | null): number => v ? Date.parse(v) : 0
const latest = (v: Row[]): Row | null => [...v].sort((a, b) => time(at(b)) - time(at(a)))[0] || null
const rank = (s: LeadPipelineStage): number => LEAD_PIPELINE_STAGE_OPTIONS.findIndex(x => x.value === s)

export function leadPipelineStageLabel(stage: LeadPipelineStage): string {
  return LEAD_PIPELINE_STAGE_OPTIONS.find(x => x.value === stage)?.label || 'Nuevo / Por atender'
}

function summaryOf(value: unknown): Row {
  if (typeof value !== 'string') return row(value)
  try { return row(JSON.parse(value)) } catch { return {} }
}

function deliveredResponse(message: Row): boolean {
  if (!['bot', 'asesor'].includes(text(message.role))) return false
  const details = row(message.tool_calls)
  const status = text(message.delivery_status || details.provider_status || details.delivery_status)
  return !['failed', 'error', 'rejected', 'unknown', 'not_sent', 'not_attempted', 'pending', 'prepared'].includes(status)
    && !!stamp(message.sent_at)
}

/** Only operational appointment records establish a requested/coordinated visit.
 * Invitations in the conversation never become confirmed appointments. */
function appointmentView(appointments: Row[]): LeadPipelineSnapshot['appointment'] {
  const selected = latest(appointments)
  if (!selected) return null
  const status = text(selected.status)
  const confirmed = ['aceptado', 'reprogramado'].includes(status)
    && selected.confirmed_by_client === true && !!selected.confirmed_at && !!selected.start_time
  const states: Record<string, string> = {
    solicitada: 'Solicitada', pendiente: 'En coordinación', aceptado: 'En coordinación',
    reprogramado: 'En coordinación', atendido: 'Realizada', cancelado: 'Cancelada',
  }
  return { id: text(selected.id), status: confirmed ? 'confirmada' : status,
    label: selected.no_show === true ? 'No asistió' : confirmed ? 'Confirmada' : states[status] || 'Estado por revisar',
    scheduledAt: stamp(selected.start_time) }
}

/** Deterministic projection of scoped records. No message-keyword inference,
 * score/temperature promotion, legacy stages, browsing consent or invented jobs. */
export function projectLeadPipeline(input: LeadPipelineInput): LeadPipelineSnapshot {
  const lead = input.lead, id = text(lead.id)
  const scoped = (list: Row[] | undefined) => (list || []).filter(x => !x.lead_id || x.lead_id === id)
  const conversation = row(input.conversation), summary = summaryOf(conversation.summary)
  const messages = scoped(input.messages).filter(m => !m.conversation_id || !conversation.id || m.conversation_id === conversation.id)
  const customer = latest(messages.filter(m => m.role === 'cliente'))
  const response = latest(messages.filter(deliveredResponse))
  const events = scoped(input.scoreEvents)
  const appointments = scoped(input.appointments), reservations = scoped(input.reservations), sales = scoped(input.sales)
  const metadata = row(input.metadata)
  const warnings = [...(input.warnings || [])], coverage = { ...(input.coverage || {}) }
  const evidence: (LeadPipelineEvidence & { stage: LeadPipelineStage })[] = []
  const add = (stage: LeadPipelineStage, source: string, value: Row, reason: string, sourceAt?: string | null) => {
    evidence.push({ stage, source, sourceId: text(value.id || value.source_message_id) || null, reason,
      at: sourceAt === undefined ? at(value) : sourceAt })
  }
  if (response) add('contacto_inicial', 'messages', response, 'Existe una respuesta registrada del bot o del asesor.')
  const needEvents = new Set(['declared_unit_type', 'declared_purchase_purpose'])
  const interestEvents = new Set(['asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'asked_availability'])
  for (const event of events) {
    if (needEvents.has(text(event.event_type))) add('necesidad_identificada', 'lead_score_events', event, 'El cliente declaró una necesidad de compra.')
    if (interestEvents.has(text(event.event_type))) add('interes_comercial', 'lead_score_events', event,
      'Consulta comercial registrada; no acredita autorización de trámites ni una reserva.')
  }
  for (const signal of rows(summary._lead_pipeline_events)) {
    if (signal.kind === 'commercial_interest' && signal.topic === 'availability'
      && text(signal.evidence) && text(signal.source_message_id)) {
      add('interes_comercial', 'conversation._lead_pipeline_events', signal,
        'Consulta de disponibilidad respaldada por el mensaje del cliente.', stamp(signal.at))
    }
  }
  const memory = row(summary._interpretation_memory), property = row(memory.property)
  if (text(property.evidence) && ['high', 'medium'].includes(text(property.confidence))
    && (property.group || property.category || Object.keys(row(property.filters)).length)) {
    add('necesidad_identificada', 'conversation._interpretation_memory.property', conversation,
      'Necesidad respaldada por una declaración conservada en la conversación.', stamp(property.declared_at))
  }
  const selected = values(row(summary._property_context).selected_ids)
  // lead_units and navigation are deliberately excluded: they are not choices.
  const unitId = selected.length === 1 ? selected[0] : null
  const unit = unitId ? (input.units || []).find(u => u.id === unitId) : null
  if (unitId) add('interes_comercial', 'conversation._property_context.selected_ids', conversation,
    'Unidad elegida expresamente en la conversación.', stamp(row(summary._property_context).selected_at))
  for (const appointment of appointments) add('interes_comercial', 'appointments', appointment,
    'Existe una gestión de cita; su estado se conserva por separado.')
  for (const reservation of reservations) {
    if (values(reservation.unit_ids).length && text(reservation.evidence) && text(reservation.source_message_id)
      && !['cancelled', 'cancelado', 'rejected', 'superseded'].includes(text(reservation.request_status || reservation.status))) {
      add('proceso_reserva', 'lead_reservation_requests', reservation, 'Solicitud operacional de reserva registrada con unidad y evidencia del cliente.')
    }
  }
  for (const sale of sales) if (text(sale.unit_id) && stamp(sale.sale_at || sale.created_at)) {
    add('venta_cerrada', 'unit_sales_closings', sale, 'Cierre real de venta registrado y vinculado al lead.')
  }
  evidence.sort((a, b) => rank(b.stage) - rank(a.stage) || time(a.at) - time(b.at))
  const strongest = evidence[0], stage = strongest?.stage || 'nuevo'

  const nurture = row(summary._lead_nurture)
  const persisted = Object.keys(metadata).length > 0 && time(stamp(metadata.updated_at)) >= time(stamp(nurture.declared_at))
  const nutrition = persisted ? metadata : nurture
  const active = persisted ? nutrition.nutrition_active === true : nutrition.active === true
  const nutritionEvidence = text(nutrition.nutrition_evidence || nutrition.evidence)
  const nutritionReason = text(nutrition.nutrition_reason || nutrition.reason)
  const purchaseHorizon = text(nutrition.purchase_horizon)
  const contactConsent = nutrition.contact_consent === true
  const contactEvidence = persisted ? contactConsent : contactConsent && !!text(nutrition.contact_evidence)
  const nutritionActive = active && !!nutritionReason && !!nutritionEvidence && !!purchaseHorizon && !!contactEvidence
  if (active && !nutritionActive) warnings.push('La nutrición requiere interés futuro declarado, motivo y acuerdo de contacto respaldados.')

  const pending = rows(summary._pending_requests).filter(r => !['answered', 'resolved', 'cancelled', 'superseded'].includes(text(r.status)))
  const lastCustomerAt = stamp(customer?.sent_at), lastResponseAt = stamp(response?.sent_at)
  const attentionStatus: LeadPipelineSnapshot['attentionStatus'] = !response
    ? coverage.messages === false ? 'sin_datos' : 'por_atender'
    : pending.length || time(lastCustomerAt) > time(lastResponseAt) ? 'pendiente_equipo' : 'esperando_lead'
  const attentionLabels = { por_atender: 'Por atender', pendiente_equipo: 'Respuesta pendiente del equipo', esperando_lead: 'Esperando respuesta del lead', sin_datos: 'Atención por verificar' }
  const jobs = scoped(input.jobs).filter(j => ['pending', 'processing'].includes(text(j.status))
    && j.kind === 'maintenance' && row(j.payload).leadId === id && stamp(j.available_at))
    .sort((a, b) => time(stamp(a.available_at)) - time(stamp(b.available_at)))
  const job = jobs[0]
  const taskLabels: Record<string, string> = { nutrition_24h: 'Seguimiento de 24 horas', nutrition_week_one: 'Seguimiento de 7 días',
    nutrition_week_two: 'Seguimiento de 14 días', nutrition_week_three: 'Seguimiento de 21 días', visit_reminder: 'Recordatorio de cita' }
  const manualAction = text(metadata.next_action)
  const nextAction = manualAction || (job ? taskLabels[text(row(job.payload).task)] || 'Gestión automática pendiente' : null)
  const knownStages = new Set<string>(LEAD_PIPELINE_STAGE_OPTIONS.map(x => x.value))
  const history: LeadPipelineSnapshot['history'] = scoped(input.history)
    .filter(h => knownStages.has(text(h.to_stage)))
    .map(h => ({ from: knownStages.has(text(h.from_stage)) ? h.from_stage as LeadPipelineStage : null,
      to: h.to_stage as LeadPipelineStage, reason: text(h.reason), at: stamp(h.observed_at) || at(h), actor: text(h.actor_id) || null }))
  const won = stage === 'venta_cerrada'
  const lost = metadata.opportunity_status === 'lost' && !!text(metadata.closure_reason)
  if (Object.values(coverage).some(v => !v) && !warnings.length) warnings.push('Hay fuentes pendientes de verificar; la ficha puede estar incompleta.')
  return {
    stage, stageLabel: leadPipelineStageLabel(stage), stageReason: strongest?.reason || (coverage.messages === false
      ? 'Clasificación provisional: no se pudo comprobar la atención.' : 'No existe atención registrada en las fuentes consultadas.'),
    stageChangedAt: history.filter(h => h.to === stage).sort((a, b) => time(b.at) - time(a.at))[0]?.at
      || strongest?.at || (stage === 'nuevo' ? stamp(lead.created_at) : null),
    evidence: evidence.map(({ stage: _stage, ...item }) => { void _stage; return item }),
    nutritionActive, nutritionReason: nutritionActive ? nutritionReason : null, purchaseHorizon: purchaseHorizon || null,
    resumeAt: stamp(nutrition.resume_at), resumeCondition: text(nutrition.resume_condition) || null,
    opportunityStatus: won ? 'won' : lost ? 'lost' : 'open', closureReason: lost && !won ? text(metadata.closure_reason) : null,
    attentionStatus, attentionLabel: attentionLabels[attentionStatus], lastCustomerAt, lastResponseAt,
    lastActivityAt: [lastCustomerAt, lastResponseAt, stamp(lead.last_activity_at), stamp(lead.created_at)].filter((x): x is string => !!x).sort((a, b) => time(b) - time(a))[0] || null,
    selectedUnitId: unitId, selectedUnitNumber: text(unit?.unit_number) || null, appointment: appointmentView(appointments),
    nextAction, nextActionAt: manualAction ? stamp(metadata.next_action_at) : stamp(job?.available_at),
    nextActionOwnerId: manualAction ? text(metadata.next_action_owner_id || lead.assigned_to) || null : null,
    nextActionScheduled: !manualAction && !!job, history, coverage, warnings,
  }
}

export const deriveLeadPipeline = projectLeadPipeline

import { projectLeadPipeline } from './leadPipeline'
import type { LeadPipelineInput } from '@/types/leadPipeline'
import { ANALYSIS_MOMENT_LABELS, type AnalysisFactor, type AnalysisReview, type AnalysisRow as Row, type AnalysisSignal, type ConversationAnalysisCase } from '@/types/conversationAnalysis'

export const analysisRecord = (v: unknown): Row => {
  if (typeof v === 'string') { try { return analysisRecord(JSON.parse(v)) } catch { return {} } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
}
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(analysisRecord) : []
const stamp = (v: unknown): string | null => text(v) && Number.isFinite(Date.parse(text(v))) ? text(v) : null
const time = (v: unknown) => Date.parse(text(v)) || 0
const last = (rows: Row[], key = 'created_at') => [...rows].sort((a, b) => time(b[key]) - time(a[key]))[0]
const sentEvidence = (m: Row) => ['sent', 'delivered', 'read'].includes(text(m.delivery_status || analysisRecord(m.tool_calls).delivery_status || analysisRecord(m.tool_calls).provider_status))
  || Boolean(m.external_message_id && (m.role === 'asesor' || ['kommo_webhook', 'kommo_history', 'advisor_verified'].includes(text(m.verified_source))))
export function redactAnalysisText(v: unknown): string {
  return text(v).replace(/\b(?:c[eé]dula|pasaporte|documento de identidad)\s*(?:es|n[uú]mero|:|#)?\s*[A-Z0-9-]{5,}/gi, '[documento personal]')
    .replace(/\b\d{8,}\b/g, '[dato personal]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[correo]')
}
export type AnalysisCaseInput = LeadPipelineInput & {
  conversations?: Row[]; visits?: Row[]; financing?: Row[]; incidents?: Row[]; analyses?: Row[]; reviews?: Row[]
  advisorName?: string; projectName?: string; asOf: string; canReview?: boolean
  versions?: Row[]
}

/** Messages, operational receipts and assessments are independent evidence axes.
 * Inactivity, a cold score and an opt-out never establish a lost sale. */
export function buildConversationAnalysisCase(input: AnalysisCaseInput): ConversationAnalysisCase {
  const lead = input.lead, conversations = input.conversations || (input.conversation ? [input.conversation] : [])
  const conversation = last(conversations, 'last_message_at') || {}, summary = analysisRecord(conversation.summary)
  const messages = (input.messages || []).filter(m => !m.conversation_id || m.conversation_id === conversation.id)
    .filter(m => time(m.sent_at) <= time(input.asOf)).sort((a, b) => time(a.sent_at) - time(b.sent_at))
  const latestCustomer = messages.filter(m => m.role === 'cliente').at(-1)
  const registered = messages.filter(m => ['bot', 'asesor'].includes(text(m.role)) && !['failed', 'rejected', 'not_sent', 'not_attempted', 'draft', 'generated', 'pending', 'prepared', 'generation_failed', 'error', 'queued'].includes(text(m.delivery_status || analysisRecord(m.tool_calls).delivery_status || analysisRecord(m.tool_calls).provider_status)))
  const latestResponse = registered.at(-1), latestAdvisor = registered.filter(m => m.role === 'asesor').at(-1)
  const pipeline = projectLeadPipeline({ ...input, conversation, messages })
  const latestAnalysis = last((input.analyses || []).filter(a => a.conversation_id === conversation.id))
  const analysis = latestAnalysis ? analysisRecord(latestAnalysis.analysis) : null
  const coverage = input.coverage || {}, warnings = [...(input.warnings || [])]
  const factors: AnalysisFactor[] = analysis ? list(analysis.factors).filter(f => ['customer', 'conversation'].includes(text(f.kind))).map(f => ({
    kind: f.kind as AnalysisFactor['kind'], reason: text(f.reason), basis: (f.basis === 'explicit' ? 'explicit' : 'hypothesis') as AnalysisFactor['basis'],
    explanation: text(f.explanation), next_step: text(f.next_step), evidence: list(f.evidence).map(e => ({ message_id: text(e.message_id), quote: text(e.quote) })),
    status: (f.status === 'addressed' ? 'addressed' : 'open') as AnalysisFactor['status'],
  })).filter(f => f.evidence.length) : []
  if (analysis && !factors.length && analysis.reason && !['unknown', 'not_dropped'].includes(text(analysis.reason)) && list(analysis.evidence).length) factors.push({
    kind: analysis.reason === 'unanswered' ? 'conversation' : 'customer', reason: text(analysis.reason), basis: analysis.basis === 'explicit' ? 'explicit' : 'hypothesis',
    explanation: text(analysis.explanation), next_step: text(analysis.next_step), evidence: list(analysis.evidence).map(e => ({ message_id: text(e.message_id), quote: text(e.quote) })),
  })
  const activeReservations = (input.reservations || []).filter(r => !['cancelled', 'cancelado', 'rejected', 'superseded', 'completed'].includes(text(r.request_status || r.status)))
  const visit = last((input.visits || []).filter(v => ['awaiting_advisor', 'awaiting_client'].includes(text(v.status))))
  const finance = last(input.financing || [], 'updated_at')
  const profile = analysisRecord(summary._lead_profile), property = analysisRecord(summary._property_context)
  const pending = analysisRecord(summary._pending_question), metadata = analysisRecord(input.metadata)
  const contactStopped = Boolean(lead.tracking_opt_out_at), closed = pipeline.opportunityStatus !== 'open'
  let moment = pipeline.stage === 'venta_cerrada' ? 'closure' : activeReservations.length ? 'reservation'
    : visit ? 'visit' : finance?.explicit_consent === true && !['approved', 'rejected', 'cancelled', 'completed'].includes(text(finance.status)) ? 'financing'
      : text(pending.id).startsWith('financing') ? 'financing' : text(pending.id).startsWith('budget') ? 'price'
        : text(pending.id).startsWith('lead_') ? 'discovery' : Array.isArray(property.offered_ids) && property.offered_ids.length ? 'options'
          : registered.length ? 'discovery' : 'entry'
  if (pipeline.opportunityStatus === 'lost') moment = 'closure'
  const signals: AnalysisSignal[] = []
  const add = (s: AnalysisSignal) => { if (!closed && !contactStopped) signals.push(s) }
  const advisorPending = ['queued', 'assigned', 'acknowledged', 'escalated'].includes(text(lead.handoff_status))
    && (!lead.seller_first_response_at || time(lead.seller_first_response_at) < time(lead.handoff_requested_at || lead.handoff_assigned_at))
    && (!latestAdvisor || time(latestAdvisor.sent_at) < time(lead.handoff_requested_at || lead.handoff_assigned_at))
  if (advisorPending && lead.seller_response_due_at && time(lead.seller_response_due_at) < time(input.asOf)) add({
    key: 'advisor_overdue', label: 'Plazo de atención vencido', detail: 'La derivación sigue pendiente y venció el plazo de respuesta configurado.',
    source: 'leads.seller_response_due_at', at: stamp(lead.handoff_requested_at || lead.handoff_assigned_at), priority: 'high', nextStep: 'Revisar la bandeja y registrar la atención del asesor.',
  })
  for (const r of activeReservations) {
    if (!lead.assigned_to || lead.handoff_status === 'queued') add({ key: `reservation_unassigned:${r.id}`, label: 'Reserva solicitada sin asesor', detail: 'Existe una solicitud operativa; todavía no tiene responsable asignado.',
      source: `lead_reservation_requests:${r.id}`, at: stamp(r.created_at), priority: 'high', nextStep: 'Asignar un asesor habilitado y comprobar la atención de la solicitud.' })
    if (['failed', 'pending_assignment'].includes(text(r.notification_status))) add({ key: `reservation_alert:${r.id}`, label: 'Aviso de reserva pendiente', detail: 'La solicitud existe, pero su aviso urgente no consta creado.',
      source: `lead_reservation_requests:${r.id}`, at: stamp(r.created_at), priority: 'high', nextStep: 'Comprobar el destinatario y recuperar la notificación desde la bandeja.' })
  }
  if (visit?.status === 'awaiting_advisor' && !visit.assigned_advisor_id) add({ key: `visit_unassigned:${visit.id}`, label: 'Visita sin responsable', detail: 'La coordinación espera al equipo y no tiene asesor asignado.', source: `appointment_reschedule_requests:${visit.id}`,
    at: stamp(visit.created_at), priority: 'high', nextStep: 'Abrir la bandeja de citas y asignar su coordinación.' })
  for (const incident of input.incidents || []) {
    const result = analysisRecord(incident.result)
    if (result.requires_review !== true || result.recovery === 'webhook_received' || time(incident.received_at) < time(conversation.started_at)) continue
    // A later answer can resolve a pre-send failure. An indeterminate launch still needs reconciliation.
    if (incident.status !== 'uncertain' && latestResponse && time(latestResponse.sent_at) > time(incident.received_at)) continue
    const uncertain = incident.status === 'uncertain' && result.delivery_status !== 'accepted'
    add({ key: `incident:${incident.id}`, label: uncertain ? 'Entrega o gestión incierta' : result.delivery_status === 'accepted' ? 'Registro de respuesta pendiente' : 'Incidencia pendiente de revisión',
      detail: uncertain ? 'Hace falta comprobar el resultado antes de repetir la operación.' : 'Hay un incidente registrado que requiere comprobar su recuperación.', source: `lv_integration_events:${incident.id}`,
      at: stamp(incident.received_at), priority: 'high', nextStep: uncertain ? 'Contrastar con Kommo; evitar un reenvío sin comprobación.' : 'Abrir el diagnóstico y comprobar la consulta pendiente.' })
  }
  for (const job of input.jobs || []) if (['pending', 'processing'].includes(text(job.status)) && time(job.available_at) && time(job.available_at) < time(input.asOf)
    && !advisorPending && lead.bot_enabled === true && lead.tracking_consent === true) add({
    key: `followup:${job.id}`, label: 'Seguimiento pendiente de comprobar', detail: 'Pasó la fecha programada. Hay que comprobar elegibilidad y ejecución; no acredita pérdida.',
    source: `lv_integration_events:${job.id}`, at: stamp(job.available_at), priority: 'medium', nextStep: 'Revisar el trabajo y el consentimiento vigente en Automatización.',
  })
  const customerNewer = Boolean(latestCustomer && (!latestResponse || time(latestCustomer.sent_at) > time(latestResponse.sent_at)))
  if (customerNewer && coverage.messages !== false && coverage.whatsapp_evidence === true && !signals.length) add({
    key: `unanswered:${latestCustomer?.id}`, label: 'Última entrada pendiente', detail: 'El último mensaje del cliente no tiene una respuesta posterior registrada en las fuentes consultadas.',
    source: `messages:${latestCustomer?.id}`, at: stamp(latestCustomer?.sent_at), priority: 'medium', nextStep: 'Comprobar la cola y responder la consulta por el canal autorizado.',
  })
  const operationalChanged = [lead.updated_at, ...activeReservations.map(r => r.created_at), visit?.updated_at || visit?.created_at, finance?.updated_at,
    ...(input.incidents || []).map(i => i.received_at), metadata.updated_at].some(t => time(t) > time(latestAnalysis?.created_at))
  const priorSnapshot = analysisRecord(analysis?.operational_snapshot)
  const signalsChanged = Object.hasOwn(priorSnapshot, 'signals') && JSON.stringify(list(priorSnapshot.signals).map(s => s.key).sort()) !== JSON.stringify(signals.map(s => s.key).sort())
  const stale = Boolean(analysis && (analysis.version !== 2 || time(conversation.last_message_at) > time(latestAnalysis?.source_last_message_at) || operationalChanged || signalsChanged))
  const waiting = closed || contactStopped ? 'unknown' : pipeline.nutritionActive ? 'planned' : advisorPending || visit?.status === 'awaiting_advisor' || customerNewer && coverage.whatsapp_evidence === true ? 'team'
    : latestResponse && sentEvidence(latestResponse) || visit?.status === 'awaiting_client' ? 'customer' : 'unknown'
  const reviews: AnalysisReview[] = (input.reviews || []).map(r => ({ id: text(r.id), status: text(r.status) as AnalysisReview['status'], note: text(r.note), createdAt: text(r.created_at),
    signature: text(r.issue_signature), actor: text(r.actor_name) || 'Usuario del equipo', baselineCustomerAt: stamp(analysisRecord(r.baseline).last_customer_at) })).sort((a, b) => time(b.createdAt) - time(a.createdAt))
  const action = reviews.find(r => ['actioned', 'resolved'].includes(r.status))
  // Measure an observable return, not a causal claim or a manual resolution alone.
  const returnMessage = action ? messages.find(m => m.role === 'cliente' && time(m.sent_at) > time(action.createdAt)) : undefined
  const recovery = returnMessage ? { at: text(returnMessage.sent_at), detail: 'El cliente volvió a escribir después de la gestión registrada. Esto no acredita una venta ni prueba causalidad.' } : null
  const timeline = [
    ...messages.slice(-35).map(m => ({ id: text(m.id), at: text(m.sent_at), label: m.role === 'cliente' ? 'Cliente' : m.role === 'asesor' ? 'Asesor' : 'Bot', detail: m.content ? redactAnalysisText(m.content).slice(0, 900) : 'Mensaje observado; contenido no disponible en esta fuente.', kind: 'message' as const })),
    ...activeReservations.map(r => ({ id: `reservation:${r.id}`, at: text(r.created_at), label: 'Solicitud de reserva registrada', detail: lead.assigned_to ? 'Con asesor asignado; no acredita reserva de inventario.' : 'Pendiente de asignación; no acredita reserva de inventario.', kind: 'operation' as const })),
    ...(input.visits || []).map(v => ({ id: `visit:${v.id}`, at: text(v.updated_at || v.created_at), label: 'Coordinación de visita', detail: v.status === 'awaiting_advisor' ? 'Esperando al equipo' : v.status === 'awaiting_client' ? 'Esperando al cliente' : text(v.status), kind: 'operation' as const })),
    ...signals.filter(s => s.key.startsWith('incident:')).map(s => ({ id: s.key, at: s.at || '', label: s.label, detail: s.detail, kind: 'incident' as const })),
    ...reviews.map(r => ({ id: r.id, at: r.createdAt, label: 'Revisión del equipo', detail: r.note, kind: 'review' as const })),
  ].filter(t => time(t.at)).sort((a, b) => time(a.at) - time(b.at))
  const needEvidence = (input.scoreEvents || []).some(e => ['declared_unit_type', 'declared_purchase_purpose'].includes(text(e.event_type)))
    || Boolean(text(analysisRecord(memoryProperty(summary)).evidence))
  const reservationEvidence = (input.reservations || []).some(r => Array.isArray(r.unit_ids) && r.unit_ids.length && text(r.evidence) && text(r.source_message_id))
  const milestones = [registered.length ? 'response' : '', needEvidence ? 'needs' : '',
    Array.isArray(property.offered_ids) && property.offered_ids.length ? 'options' : '', (input.appointments?.length || input.visits?.length) ? 'visit' : '', reservationEvidence ? 'reservation' : '', pipeline.opportunityStatus === 'won' ? 'sale' : ''].filter(Boolean)
  const version = last((input.versions || []).filter(v => v.conversation_id === conversation.id), 'started_at')
  const codeVersion = text(analysisRecord(version?.output_summary).code_version) || null
  const firstCustomer = messages.find(m => m.role === 'cliente')
  const sent = registered.filter(sentEvidence)
  const firstSent = firstCustomer ? sent.find(m => time(m.sent_at) >= time(firstCustomer.sent_at)) : undefined
  const firstAdvisorSent = firstCustomer ? sent.find(m => m.role === 'asesor' && time(m.sent_at) >= time(firstCustomer.sent_at)) : undefined
  return {
    id: text(lead.id), name: text(lead.name) || 'Contacto sin nombre', projectId: text(lead.project_id), projectName: input.projectName || 'Proyecto sin nombre', createdAt: stamp(lead.created_at),
    source: ({ waba: 'WhatsApp', whatsapp: 'WhatsApp', showroom_360: 'Showroom 360' } as Record<string, string>)[text(lead.source)] || text(lead.source) || 'Sin origen',
    temperature: text(lead.temperature), residence: text(profile.residence_city || profile.residence_country) || 'Sin residencia declarada', category: text(analysisRecord(analysisRecord(summary._interpretation_memory).property).category || lead.preferred_category) || 'Sin tipo declarado',
    advisorId: text(lead.assigned_to), advisorName: input.advisorName || (lead.assigned_to ? 'Asesor por identificar' : 'Sin asignar'), kommoId: Number(lead.kommo_id) || null,
    stage: pipeline.stage, stageLabel: pipeline.stageLabel, stageAt: pipeline.stageChangedAt, stageProvisional: pipeline.stageProvisional === true,
    moment, momentLabel: ANALYSIS_MOMENT_LABELS[moment], waiting, waitingSince: stamp(waiting === 'team' ? lead.handoff_requested_at || latestCustomer?.sent_at : latestResponse?.sent_at),
    lastCustomerAt: stamp(latestCustomer?.sent_at), lastResponseAt: stamp(latestResponse?.sent_at), lost: pipeline.opportunityStatus === 'lost', won: pipeline.opportunityStatus === 'won',
    futureInterest: pipeline.nutritionActive, contactStopped, signals, factors, timeline, analysis, analysisId: text(latestAnalysis?.id) || null,
    reviewAt: stamp(latestAnalysis?.created_at), stale, reviews, signature: '', canReview: input.canReview === true, recovery, coverage, warnings, milestones,
    nextStep: contactStopped ? 'Respetar la baja de contacto; revisar solo las gestiones internas permitidas.' : closed ? 'Consultar el cierre registrado y las tareas internas correspondientes.'
      : signals[0]?.nextStep || (analysis && !stale ? text(analysis.next_step) : '') || pipeline.nextAction || (pipeline.nutritionActive ? 'Respetar el acuerdo de contacto futuro.' : 'Revisar el contexto y definir la próxima acción.'), codeVersion,
    firstResponseSeconds: firstSent ? Math.max(0, (time(firstSent.sent_at) - time(firstCustomer?.sent_at)) / 1000) : null,
    firstAdvisorSeconds: firstAdvisorSent ? Math.max(0, (time(firstAdvisorSent.sent_at) - time(firstCustomer?.sent_at)) / 1000) : null,
    closureReason: pipeline.closureReason,
  }
}

function memoryProperty(summary: Row) { return analysisRecord(analysisRecord(summary._interpretation_memory).property) }

export type AnalysisFilters = { query?: string; project?: string; advisor?: string; source?: string; stage?: string; version?: string; from?: string; to?: string }
export function filterAnalysisCases(items: ConversationAnalysisCase[], filters: AnalysisFilters) {
  const q = (filters.query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return items.filter(item => (!filters.project || item.projectId === filters.project) && (!filters.advisor || (filters.advisor === 'unassigned' ? !item.advisorId : item.advisorId === filters.advisor))
    && (!filters.source || item.source === filters.source) && (!filters.stage || item.stage === filters.stage)
    && (!filters.version || (item.codeVersion || 'unknown') === filters.version)
    && (!filters.from || time(item.createdAt) >= time(`${filters.from}T00:00:00-05:00`))
    && (!filters.to || time(item.createdAt) <= time(`${filters.to}T23:59:59.999-05:00`))
    && (!q || [item.name, item.advisorName, item.kommoId].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q)))
}
export function analysisCsv(items: ConversationAnalysisCase[], context: { asOf?: string; from?: string; to?: string } = {}) {
  const cell = (v: unknown) => { const s = String(v ?? ''); return '"' + (/^[\s]*[=+@\-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"' }
  return '\uFEFF' + [['Lead', 'Proyecto', 'Alta', 'Origen', 'Asesor', 'Etapa', 'Punto del recorrido', 'Alertas', 'Motivos declarados', 'Hipótesis', 'Evaluación', 'Próxima acción', 'Motivo de cierre registrado', 'Versión observada', 'Datos consultados a', 'Cohorte desde (Ecuador)', 'Cohorte hasta (Ecuador)'],
    ...items.map(i => [i.name, i.projectName, i.createdAt, i.source, i.advisorName, i.stageLabel, i.momentLabel, i.signals.map(s => s.label).join(' | '),
      (i.stale ? [] : i.factors).filter(f => f.basis === 'explicit').map(f => f.explanation).join(' | '), (i.stale ? [] : i.factors).filter(f => f.basis === 'hypothesis').map(f => f.explanation).join(' | '),
      !i.analysis ? 'Sin evaluar' : i.stale ? 'Desactualizada' : 'Vigente', i.nextStep, i.closureReason, i.codeVersion, context.asOf, context.from, context.to])].map(row => row.map(cell).join(',')).join('\r\n')
}

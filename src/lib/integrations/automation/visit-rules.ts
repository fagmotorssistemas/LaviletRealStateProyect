import { object, text, type Row } from './data'
import { buildVisitMessage } from '@/lib/inmobiliaria/visitClock'
import { LAVILET_MESSAGE_ROUTES, LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '../lavilet'

const HOUR = 3_600_000
const ms = (v: unknown) => Date.parse(text(v))
export type Decision = { action: 'send' | 'cancel' | 'defer'; reasons: string[] }
export function validateVisit(context: Row, now = Date.now()): Decision {
  const j = object(context.job), l = object(context.lead), c = object(context.config)
  const a = object(context.appointment), r = object(context.request), route = object(context.route)
  const p = object(j.payload), invalid: string[] = [], deferred: string[] = []
  const expected = LAVILET_MESSAGE_ROUTES.find(x => x.kind === j.kind && x.kind !== 'conversation')
  if (!expected) invalid.push('unsupported_kind')
  if (!j.id || !l.id || !a.id || !c.project_id) invalid.push('missing_context')
  for (const row of [j, l, c, a]) {
    if (row.project_id !== LAVILET_PROJECT_ID || row.tenant_id !== LAVILET_TENANT_ID) invalid.push('scope_mismatch')
  }
  if (a.lead_id !== l.id || j.lead_id !== l.id || j.appointment_id !== a.id) invalid.push('lead_mismatch')
  if (!['pending', 'claimed'].includes(text(j.status))) invalid.push('job_not_pending')
  if (!(ms(j.expires_at) > now)) invalid.push('expired')
  if (!(ms(j.scheduled_at) <= now)) deferred.push('not_due')
  if (c.enabled !== true || (c.test_only === true && c.test_lead_id !== l.id)) deferred.push('disabled_or_test_only')
  if (l.channel_origin !== 'whatsapp' || l.tracking_opt_out_at) invalid.push('channel_or_opt_out')
  if (!Number.isSafeInteger(Number(l.kommo_id)) || Number(l.kommo_id) <= 0) deferred.push('invalid_kommo_id')
  if (route.enabled !== true || route.approved !== true || !text(route.body_template)
    || route.bot_id !== expected?.botId || route.detail_field_id !== expected?.fieldId) deferred.push('route_not_configured')
  if (!text(p.detail).trim() || text(p.detail).length > 256) deferred.push('invalid_detail')
  const last = ms(context.last_client_message_at)
  if (!Number.isFinite(last) || last > now || now - last >= 24 * HOUR) deferred.push('outside_whatsapp_window')
  if (context.event_current !== true || a.status === 'cancelado' || a.no_show === true) invalid.push('stale_event')
  if (j.kind === 'visit_2h') {
    if (!['aceptado', 'reprogramado'].includes(text(a.status)) || !(ms(a.start_time) > now)) invalid.push('appointment_not_confirmed')
    if (context.reminders_paused === true) invalid.push('coordination_pending')
    if (context.revision !== j.revision) invalid.push('appointment_changed')
  } else {
    if (!r.id || r.id !== p.request_id || r.appointment_id !== a.id || r.lead_id !== l.id
      || r.tenant_id !== l.tenant_id || r.project_id !== l.project_id) invalid.push('request_mismatch')
    if (!(ms(r.proposed_start_time) > now) || ms(r.proposed_end_time) - ms(r.proposed_start_time) !== HOUR) invalid.push('invalid_interval')
    if (p.advisor_id !== r.assigned_advisor_id || a.responsible_id !== r.assigned_advisor_id
      || ms(p.start_time) !== ms(r.proposed_start_time) || ms(p.end_time) !== ms(r.proposed_end_time)) invalid.push('proposal_changed')
    if (j.kind === 'visit_propose') {
      if (r.status !== 'awaiting_client' || !r.advisor_accepted_at || r.client_accepted_at
        || (r.expires_at && !(ms(r.expires_at) > now))) invalid.push('proposal_not_pending')
    } else if (r.status !== 'confirmed' || !r.advisor_accepted_at || !r.client_accepted_at
      || !['aceptado', 'reprogramado'].includes(text(a.status)) || context.reminders_paused === true
      || ms(a.start_time) !== ms(r.proposed_start_time) || ms(a.end_time) !== ms(r.proposed_end_time)) invalid.push('confirmation_changed')
  }
  for (const other of (Array.isArray(context.recent_jobs) ? context.recent_jobs : []).map(object)) {
    if (other.id === j.id) continue
    if (['claimed', 'uncertain'].includes(text(other.status))) deferred.push('unresolved_send')
    if (j.kind === 'visit_2h' && ['accepted', 'delivered', 'simulated'].includes(text(other.status))
      && ms(other.accepted_at) > now - HOUR / 2) deferred.push('frequency_limit')
  }
  if (j.status === 'claimed') {
    if (String(p._kommo_id) !== String(l.kommo_id)) invalid.push('recipient_changed')
    if (p._route !== routeSignature(route)) invalid.push('route_changed')
  }
  return invalid.length ? { action: 'cancel', reasons: [...new Set(invalid)] }
    : deferred.length ? { action: 'defer', reasons: [...new Set(deferred)] } : { action: 'send', reasons: [] }
}
export function routeSignature(route: Row) {
  return JSON.stringify([route.bot_id, route.detail_field_id, route.link_field_id, route.template_name, route.body_template])
}
export function prepareVisit(context: Row): Row {
  const j = object(context.job), a = object(context.appointment), p = object(j.payload)
  const location = !a.location_type || a.location_type === 'proyecto' ? context.location || p.location : p.location
  const detail = buildVisitMessage({ kind: j.kind as 'visit_propose' | 'visit_confirm' | 'visit_reschedule_confirm' | 'visit_2h',
    startIso: text(p.start_time || a.start_time), leadName: text(object(context.lead).name),
    advisorName: text(context.advisor_name), locationUrl: text(location) })
  // Conservar hechos exactos. La redacción opcional no puede alterar fecha, asesor o ubicación.
  return { ...context, job: { ...j, payload: { ...p, detail } } }
}

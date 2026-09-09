import 'server-only'
import { automationSettings, assertLive } from './config'
import { autoConfig, db, object, permitted, rpc, scope, text, type Row } from './data'
import { getKommoLead, launchSalesbot, setKommoField } from './kommo'
import { prepareVisit, routeSignature, validateVisit } from './visit-rules'

export type Guard = () => Promise<void>
export async function visitContext(jobId: string) { return object(await rpc('lv_app_visit_context', { p_job: jobId })) }

export async function pendingVisits() {
  let q = db().from('lv_outbox').select('id').match(scope).eq('status', 'pending')
    .in('kind', ['visit_propose', 'visit_confirm', 'visit_reschedule_confirm', 'visit_2h'])
    .lte('scheduled_at', new Date().toISOString()).lte('next_attempt_at', new Date().toISOString())
    .order('priority').order('scheduled_at').order('id').limit(10)
  const test = automationSettings().testLeadId
  if (test) q = q.eq('lead_id', test)
  const { data, error } = await q.abortSignal(AbortSignal.timeout(10_000))
  if (error) throw new Error('OUTBOX_READ_FAILED')
  return data ?? []
}

export async function previewVisits() {
  const results = []
  for (const row of await pendingVisits()) {
    const c = prepareVisit(await visitContext(row.id))
    results.push({ jobId: row.id, kind: object(c.job).kind, ...validateVisit(c) })
  }
  return results
}

async function updatePending(id: string, update: Row) {
  const { error } = await db().from('lv_outbox').update(update).match(scope).eq('id', id).eq('status', 'pending')
  if (error) throw new Error('OUTBOX_UPDATE_FAILED')
}
export async function sendVisit(jobId: string, guard: Guard) {
  assertLive(); await guard()
  let context = prepareVisit(await visitContext(jobId))
  let decision = validateVisit(context)
  const lead = object(context.lead), config = object(context.config)
  if (!permitted(config, lead, automationSettings().testLeadId)) return { jobId, status: 'disabled' }
  if (decision.action !== 'send') {
    await updatePending(jobId, decision.action === 'cancel'
      ? { status: 'cancelled', detail: decision.reasons.join(',') }
      : { next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(), detail: decision.reasons.join(',') })
    return { jobId, status: decision.action }
  }
  // También bloquea envíos mientras una conversación tiene un resultado incierto.
  const { count, error } = await db().from('lv_integration_events').select('id', { count: 'exact', head: true })
    .match(scope).eq('status', 'uncertain').like('contact_key', `${Number(lead.kommo_id)}:%`)
  if (error) throw new Error('UNRESOLVED_CHECK_FAILED')
  if (count) return { jobId, status: 'unresolved_conversation' }
  await getKommoLead(Number(lead.kommo_id))
  const route = object(context.route), payload = object(object(context.job).payload)
  const send = { ...payload, detail: payload.detail, link: '', rendered: text(payload.detail),
    _kommo_id: lead.kommo_id, _route: routeSignature(route), _material: null, _app: 'lavilet' }
  await guard()
  const reservation = object(await rpc('lv3_reserve', { p_job: jobId, p_payload: send }))
  if (reservation.reserved !== true) return { jobId, status: 'already_reserved' }
  // La reserva devuelve el ID; el token se vuelve a leer del registro reservado.
  context = await visitContext(jobId)
  const job = object(context.job), token = text(job.claim_token)
  if (job.status !== 'claimed' || !token) throw new Error('INVALID_RESERVATION_RESULT')
  let launched = false
  try {
    decision = validateVisit(context)
    if (decision.action !== 'send' || !permitted(object(context.config), object(context.lead), automationSettings().testLeadId)) {
      await rpc('lv3_finish', { p_job: jobId, p_token: token, p_status: 'failed', p_detail: 'Revalidación: ' + decision.reasons.join(',') })
      return { jobId, status: 'changed_before_send' }
    }
    await guard()
    await setKommoField(Number(lead.kommo_id), Number(route.detail_field_id), text(object(job.payload).detail))
    context = await visitContext(jobId)
    decision = validateVisit(context)
    if (decision.action !== 'send' || !permitted(object(context.config), object(context.lead), automationSettings().testLeadId)) {
      await rpc('lv3_finish', { p_job: jobId, p_token: token, p_status: 'failed', p_detail: 'Cambió antes de Salesbot' })
      return { jobId, status: 'changed_before_salesbot' }
    }
    await guard()
    launched = true
    await launchSalesbot(Number(lead.kommo_id), Number(route.bot_id))
    await rpc('lv3_finish', { p_job: jobId, p_token: token, p_status: 'accepted',
      p_detail: 'Kommo aceptó iniciar Salesbot; entrega no confirmada' })
    return { jobId, status: 'accepted' }
  } catch {
    await rpc('lv3_finish', { p_job: jobId, p_token: token, p_status: launched ? 'uncertain' : 'failed',
      p_detail: launched ? 'Comprobar Kommo antes de reintentar' : 'Falló preparación o revalidación' })
    return { jobId, status: launched ? 'uncertain' : 'failed' }
  }
}

export async function planVisits(guard: Guard) {
  assertLive()
  const config = await autoConfig()
  const candidates = await rpc<Row[]>('lv_app_visit_candidates')
  let enqueued = 0
  for (const raw of candidates) {
    await guard()
    const d = object(raw), a = object(d.appointment), lead = object(d.lead), state = object(d.visit_state)
    if (!permitted(config, lead, automationSettings().testLeadId)) continue
    const now = Date.now(), start = Date.parse(text(a.start_time)), revision = text(d.revision)
    const seen = state.revision === revision ? Date.parse(text(state.seen_at)) : now
    const future = ['aceptado', 'reprogramado'].includes(text(a.status)) && !a.no_show && start > now
    let stale = db().from('lv_outbox').update({ status: 'cancelled', detail: 'La cita cambió o ya no está vigente' })
      .match(scope).eq('appointment_id', a.id).eq('kind', 'visit_2h').eq('status', 'pending')
    if (future) stale = stale.neq('revision', revision)
    const { error: staleError } = await stale
    if (staleError) throw new Error('STALE_REMINDER_CANCEL_FAILED')
    const { error } = await db().from('lv_visit_state').upsert({ appointment_id: a.id, revision,
      seen_at: new Date(Number.isFinite(seen) ? seen : now).toISOString(),
      outcome: a.status === 'cancelado' ? 'cancelled' : a.no_show ? 'no_show' : a.status === 'atendido' ? 'attended' : null,
      outcome_at: ['cancelado', 'atendido'].includes(text(a.status)) || a.no_show ? new Date(now).toISOString() : null },
    { onConflict: 'appointment_id' })
    if (error) throw new Error('VISIT_STATE_UPDATE_FAILED')
    if (!future
      || !(start - 2 * 3_600_000 > seen + 1_800_000)) continue
    const payload = { start_time: a.start_time, end_time: a.end_time, advisor_id: a.responsible_id,
      location: object(d.policy).location_override || d.location || null }
    const prepared = prepareVisit({ ...d, job: { kind: 'visit_2h', payload } })
    await rpc('lv3_enqueue', { p: { ...scope, lead_id: lead.id, kind: 'visit_2h',
      dedupe_key: `${a.id}:${revision}:2h`, appointment_id: a.id, revision,
      scheduled_at: new Date(start - 2 * 3_600_000).toISOString(), expires_at: new Date(start - 1.5 * 3_600_000).toISOString(),
      priority: 15, payload: object(prepared.job).payload } })
    enqueued++
  }
  return enqueued
}

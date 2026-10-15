import 'server-only'
import { db, object, scope, text } from './data'

/** Only this failed read is safe to close by checking the source again.
 * Other maintenance failures may include SQL effects with an unknown outcome. */
export async function recheckMaintenanceReads(eventId?: string, actorId = 'automation') {
  let query = db().from('lv_integration_events').select('id,status,result').match(scope)
    .eq('kind', 'maintenance').eq('result->>reason', 'TEST_CONTACTS_READ_FAILED')
    .eq('result->>requires_review', 'true').in('status', ['uncertain', 'cancelled'])
  if (eventId) query = query.eq('id', eventId)
  const incidents = await query.limit(100).abortSignal(AbortSignal.timeout(10_000))
  if (incidents.error) throw Error('MAINTENANCE_RECHECK_READ_FAILED')
  if (!incidents.data?.length) {
    if (eventId) throw Error('INCIDENT_NOT_REVIEWABLE')
    return { resolved: 0 }
  }
  // Cover both readers of this source: the full ordered test-contact list and
  // the matches/lead_id lookup used by autoConfig.
  const health = await db().from('lv_test_contacts_state').select('*').match(scope).eq('matches', 1).order('created_at')
    .abortSignal(AbortSignal.timeout(10_000))
  if (health.error) throw Error('TEST_CONTACTS_READ_FAILED')
  const at = new Date().toISOString()
  let resolved = 0
  for (const incident of incidents.data) {
    const result = object(incident.result)
    const saved = await db().from('lv_integration_events').update({ status: 'cancelled',
      result: { ...result, requires_review: false, recovery: 'maintenance_read_verified',
        recovered_at: at, recovered_by: actorId, task_replayed: false } })
      .match(scope).eq('id', incident.id).eq('kind', 'maintenance').eq('status', text(incident.status))
      .eq('result->>reason', 'TEST_CONTACTS_READ_FAILED').eq('result->>requires_review', 'true')
      .select('id').abortSignal(AbortSignal.timeout(10_000))
    if (saved.error) throw Error('MAINTENANCE_RECHECK_SAVE_FAILED')
    resolved += saved.data?.length || 0
  }
  return { resolved }
}

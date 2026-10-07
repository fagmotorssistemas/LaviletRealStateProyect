import 'server-only'
import { db, scope, text } from './data'

/** The receiver may resolve a manual message's missing lead ID. Its committed
 * contact key is authoritative; never reconstruct a different workflow key. */
export async function persistedWakeupContacts(inboundIds: string[], advisorIds: string[]): Promise<string[]> {
  const keys = [...new Set([...inboundIds.map(id => `inbound:${id}`), ...advisorIds.map(id => `advisor_outbound:${id}`)])]
  if (!keys.length) return []
  const { data, error } = await db().from('lv_integration_events').select('contact_key').match(scope)
    .in('event_key', keys).eq('status', 'pending').abortSignal(AbortSignal.timeout(10_000))
  if (error) throw Error('PERSISTED_WAKEUP_READ_FAILED')
  return [...new Set((data || []).map(row => text(row.contact_key)).filter(key => /^(?:[1-9]\d*|contact):[1-9]\d*$/.test(key)))]
}

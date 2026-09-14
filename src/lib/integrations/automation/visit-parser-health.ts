import { object, rpc } from './data'

let lastCheck: { at: number; ready: boolean } | undefined

// The application and SQL functions can be deployed separately. Never feed an
// appointment into the known-broken parser while its migration is still pending.
export async function visitParserReady() {
  if (lastCheck && Date.now() - lastCheck.at < 60_000) return lastCheck.ready
  let ready = false
  try {
    const result = object(await rpc('lv_visit_preference_parts', {
      p_text: 'Para mañana a las 8', p_at: '2026-09-14T18:23:06Z', p_timezone: 'America/Guayaquil',
    }))
    ready = result.requested_date === '2026-09-15'
  } catch { /* A missing migration must not restart the client's questions. */ }
  lastCheck = { at: Date.now(), ready }
  return ready
}

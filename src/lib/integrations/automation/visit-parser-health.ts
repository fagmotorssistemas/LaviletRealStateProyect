import { rpc } from './data'
import { VISIT_PREFERENCE_VERSION } from './visit-preference-contract'
let lastCheck: { at: number; ready: boolean } | undefined
/** Deployment compatibility is a version check, never a language-parser probe. */
export async function visitParserReady() {
  if (lastCheck && Date.now() - lastCheck.at < 60_000) return lastCheck.ready
  let ready = false
  try { ready = await rpc('lv_visit_preference_contract', {}) === VISIT_PREFERENCE_VERSION } catch { /* Keep unrecorded preferences pending. */ }
  lastCheck = { at: Date.now(), ready }
  return ready
}

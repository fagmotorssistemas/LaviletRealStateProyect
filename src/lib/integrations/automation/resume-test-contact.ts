import 'server-only'
import { randomUUID } from 'node:crypto'
import { db, object } from './data'
import { setKommoField } from './kommo'

/** Hold the worker lease until the database and Kommo have both been updated. No messages are sent. */
export async function resumeTestContact(id: string, version: number, actor: string) {
  const token = randomUUID()
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await db().rpc(name, args).abortSignal(AbortSignal.timeout(15_000))
    if (error?.code === 'PGRST202' && name === 'lv_resume_enrolled_test_contact') throw Error('TEST_RESUME_NOT_INSTALLED')
    if (error) throw error
    return data
  }
  if (await call('lv_app_worker_lock', { p_token: token, p_action: 'acquire' }) !== true) throw Error('TEST_RESUME_BUSY')
  try {
    const result = object(await call('lv_resume_enrolled_test_contact', {
      p_id: id, p_version: version, p_actor: actor, p_token: token,
    }))
    const kommoId = Number(result.kommo_id)
    if (!Number.isSafeInteger(kommoId) || kommoId <= 0) throw Error('TEST_CONTACT_NOT_LINKED')
    try {
      await setKommoField(kommoId, 451530, 'false')
      return { kommoSynced: true }
    } catch {
      // The local resume is committed. Surface the partial result so retrying
      // resumes again instead of destroying the lead with a reset.
      return { kommoSynced: false }
    }
  } finally {
    // If the release fails, the lease expires without losing the committed result.
    try { await call('lv_app_worker_lock', { p_token: token, p_action: 'release' }) }
    catch { console.error('test_contact_resume_lease_release_failed') }
  }
}

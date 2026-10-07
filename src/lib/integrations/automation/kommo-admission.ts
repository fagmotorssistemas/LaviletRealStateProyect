import 'server-only'
import { rpc } from './data'

/** A reservation is shared by every server instance and every transport lane.
 * Missing SQL or an invalid reply fails before touching the provider. */
export async function reserveKommoCall() {
  const delay = await rpc<number>('lv_app_reserve_kommo_call')
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 10_000) throw Error('KOMMO_ADMISSION_FAILED')
  if (delay) await new Promise(resolve => setTimeout(resolve, delay))
}

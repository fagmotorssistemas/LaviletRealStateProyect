import 'server-only'
import { LAVILET_KOMMO_ORIGIN } from '../lavilet'
import { assertLive } from './config'
import { object, type Row } from './data'

export class ProviderError extends Error {
  constructor(public status: number, public uncertain: boolean, public operation = 'unknown') { super(`KOMMO_${status || 'UNAVAILABLE'}`) }
}
let nextCall = 0
async function request(path: string, method = 'GET', body?: unknown, attempt = 0): Promise<unknown> {
  if (new URL(process.env.KOMMO_BASE_URL || '').origin !== LAVILET_KOMMO_ORIGIN) throw new Error('WRONG_KOMMO_ACCOUNT')
  const token = process.env.KOMMO_ACCESS_TOKEN
  if (!token) throw new Error('KOMMO_CREDENTIALS_MISSING')
  if (method !== 'GET') assertLive()
  // Un worker global y llamadas secuenciales; mantener margen sobre el límite de la cuenta.
  const wait = Math.max(0, nextCall - Date.now()); nextCall = Date.now() + wait + 400
  if (wait) await new Promise(resolve => setTimeout(resolve, wait))
  const operation = method === 'GET' ? 'read' : method === 'PATCH' ? 'update_field' : 'launch_bot'
  const retryRead = async (status: number): Promise<unknown> => {
    // Reads have no delivery side effects. A bot POST or field mutation is never replayed.
    if (method === 'GET' && attempt < 2 && (!status || status === 429 || status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
      return request(path, method, body, attempt + 1)
    }
    throw new ProviderError(status, method !== 'GET', operation)
  }
  let response: Response
  try {
    response = await fetch(`${LAVILET_KOMMO_ORIGIN}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(10_000) })
  } catch { return retryRead(0) }
  if (!response.ok) { await response.body?.cancel(); return retryRead(response.status) }
  let raw: string
  try { raw = await response.text() } catch { return retryRead(0) }
  if (!raw) return null
  try { return JSON.parse(raw) } catch { throw new ProviderError(response.status, method !== 'GET', operation) }
}
export async function getKommoLead(id: number): Promise<Row> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_KOMMO_LEAD')
  const lead = object(await request(`/api/v4/leads/${id}?with=contacts`))
  if (lead.id !== id) throw new Error('KOMMO_LEAD_MISMATCH')
  return lead
}
export async function getKommoContact(id: number): Promise<Row> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_CONTACT')
  const contact = object(await request(`/api/v4/contacts/${id}`))
  if (contact.id !== id) throw new Error('KOMMO_CONTACT_MISMATCH')
  return contact
}
export function botStopped(lead: Row) {
  const fields = Array.isArray(lead.custom_fields_values) ? lead.custom_fields_values.map(object) : []
  const stop = fields.find(f => f.field_id === 451530)
  const value = object(Array.isArray(stop?.values) ? stop.values[0] : {}).value
  return value === true || value === 1 || value === 'true' || value === '1'
}
export async function setKommoField(leadId: number, fieldId: number, value: string) {
  if (![leadId, fieldId].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('INVALID_KOMMO_IDS')
  await request(`/api/v4/leads/${leadId}`, 'PATCH', { custom_fields_values: [{ field_id: fieldId, values: [{ value }] }] })
}
export async function launchSalesbot(leadId: number, botId: number) {
  if (![leadId, botId].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('INVALID_KOMMO_IDS')
  // Nunca reintentar automáticamente un POST que pudo ser aceptado.
  await request('/api/v4/bots/run', 'POST', [{ bot_id: botId, entity_id: leadId, entity_type: 'leads' }])
}

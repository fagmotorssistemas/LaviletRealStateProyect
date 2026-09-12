import { object, text } from './data'

export type Inbound = {
  externalId: string; kommoId: number; contactId: number; chatId: string;
  text: string; name: string; sentAt: string; origin: string;
  media: { type: string; url: string; name?: string } | null
}

export function normalizeWebhook(raw: string, contentType: string, now = Date.now()): Inbound[] {
  let flat: Record<string, string> = {}
  if (contentType.includes('application/json')) {
    const value = object(JSON.parse(raw))
    function flatten(item: unknown, prefix: string) {
      if (item && typeof item === 'object') {
        for (const [key, child] of Object.entries(item)) flatten(child, prefix ? `${prefix}[${key}]` : key)
      } else if (item != null) flat[prefix] = String(item)
    }
    flatten(value, '')
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    flat = Object.fromEntries(new URLSearchParams(raw))
  } else throw new Error('UNSUPPORTED_CONTENT_TYPE')
  if (flat['account[id]'] !== '36919007') throw new Error('WRONG_KOMMO_ACCOUNT')
  const indexes = [...new Set(Object.keys(flat).map(k => k.match(/^message\[add\]\[(\d+)\]/)?.[1]).filter(Boolean))]
  if (indexes.length > 100) throw new Error('TOO_MANY_EVENTS')
  const events: Inbound[] = []
  for (const index of indexes) {
    const get = (key: string) => flat[`message[add][${index}][${key}]`] || ''
    if (get('type') === 'outgoing' || get('author][type') !== 'external') continue
    if (!['waba', 'whatsapp'].includes(get('origin').toLowerCase())) continue
    if (get('entity_type') && !['lead', 'leads'].includes(get('entity_type'))) continue
    const kommoId = Number(get('entity_id') || get('element_id')), contactId = Number(get('contact_id'))
    const externalId = get('id') || get('message_id')
    const date = Number(get('created_at')) * 1000
    if (!Number.isSafeInteger(kommoId) || kommoId <= 0 || !Number.isSafeInteger(contactId) || contactId <= 0
      || !externalId || externalId.length > 200 || !Number.isFinite(date) || date <= 0 || date > now + 60_000) {
      throw new Error('INVALID_MESSAGE_ID_OR_TIME')
    }
    const body = get('text').trim()
    if (body.length > 20_000) throw new Error('MESSAGE_TOO_LONG')
    const mediaUrl = get('attachment][link')
    events.push({ externalId, kommoId, contactId, chatId: get('chat_id'), text: body,
      name: get('author][name').slice(0, 200), sentAt: new Date(date).toISOString(), origin: get('origin'),
      media: mediaUrl ? { type: get('attachment][type'), url: mediaUrl, name: (get('attachment][file_name') || get('attachment][name')).slice(0,200) } : null })
  }
  return events
}

export async function limitedBody(request: Request, maximum = 256_000) {
  const length = Number(request.headers.get('content-length'))
  if (length > maximum) throw new Error('BODY_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) return ''
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) { await reader.cancel(); throw new Error('BODY_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

export function inboundFromRow(value: unknown): Inbound {
  const row = object(value)
  if (!text(row.externalId) || !Number.isSafeInteger(row.kommoId) || !Number.isSafeInteger(row.contactId)) {
    throw new Error('INVALID_STORED_EVENT')
  }
  return row as unknown as Inbound
}

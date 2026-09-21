import { object, text } from './data'
import { extractCtwaFromKommoFlat, type CtwaCapture } from './ctwa-from-kommo'

export type Inbound = {
  externalId: string
  kommoId: number
  contactId: number
  chatId: string
  text: string
  name: string
  sentAt: string
  origin: string
  media: { type: string; url: string; name?: string } | null
  /** Solo si Kommo reenvió ctwa_clid; no implica atribución ads/orgánico. */
  ctwa: CtwaCapture | null
}

/** Aplana JSON anidado a claves tipo message[add][0][referral][ctwa_clid]. */
export function flattenKommoPayload(value: unknown, prefix = '', flat: Record<string, string> = {}): Record<string, string> {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenKommoPayload(child, prefix ? `${prefix}[${key}]` : key, flat)
    }
  } else if (value != null) {
    flat[prefix] = String(value)
  }
  return flat
}

function parseKommoFlat(raw: string, contentType: string): Record<string, string> {
  if (contentType.includes('application/json')) {
    return flattenKommoPayload(object(JSON.parse(raw)))
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw))
  }
  throw new Error('UNSUPPORTED_CONTENT_TYPE')
}

/**
 * Diagnóstico seguro pre-normalización: solo presencia y rutas de referral/ctwa_clid.
 * Nunca registra valores, textos, teléfonos, tokens ni el body completo.
 */
export type KommoCtwaFieldProbe = {
  correlationId: string
  messageIndexes: string[]
  referralOrCtwaPaths: string[]
  /** Por índice: extractor encontró clid válido. */
  extractedByIndex: Record<string, boolean>
  /** Rutas que parecen referral/ctwa pero el extractor no reconoció clid válido. */
  unrecognizedPaths: string[]
  /** true si no hay ninguna clave referral/ctwa_clid en el payload aplanado. */
  fieldsAbsent: boolean
}

const REFERRAL_CTWA_PATH = /\[referral\]|\[ctwa_clid\]|\[ctwaClid\]|referral|ctwa_clid|ctwaClid/i

export function probeKommoCtwaFields(raw: string, contentType: string, correlationId: string): KommoCtwaFieldProbe {
  const flat = parseKommoFlat(raw, contentType)
  const messageIndexes = [...new Set(
    Object.keys(flat)
      .map(k => k.match(/^message\[add\]\[(\d+)\]/)?.[1])
      .filter((value): value is string => Boolean(value)),
  )].sort()
  const referralOrCtwaPaths = Object.keys(flat)
    .filter(key => REFERRAL_CTWA_PATH.test(key))
    .sort()
  const extractedByIndex: Record<string, boolean> = {}
  for (const index of messageIndexes) {
    extractedByIndex[index] = Boolean(extractCtwaFromKommoFlat(flat, index)?.clid)
  }
  const unrecognizedPaths = referralOrCtwaPaths.filter(path => {
    const index = path.match(/^message\[add\]\[(\d+)\]/)?.[1]
    if (!index) return true
    return !extractedByIndex[index]
  })
  return {
    correlationId,
    messageIndexes,
    referralOrCtwaPaths,
    extractedByIndex,
    unrecognizedPaths,
    fieldsAbsent: referralOrCtwaPaths.length === 0,
  }
}

export function logKommoCtwaFieldProbe(probe: KommoCtwaFieldProbe) {
  console.info(JSON.stringify({
    event: 'kommo_ctwa_field_probe',
    correlationId: probe.correlationId,
    messageIndexCount: probe.messageIndexes.length,
    fieldsAbsent: probe.fieldsAbsent,
    pathCount: probe.referralOrCtwaPaths.length,
    paths: probe.referralOrCtwaPaths,
    extractedByIndex: probe.extractedByIndex,
    unrecognizedPathCount: probe.unrecognizedPaths.length,
    unrecognizedPaths: probe.unrecognizedPaths,
  }))
}

export function normalizeWebhook(raw: string, contentType: string, now = Date.now()): Inbound[] {
  const flat = parseKommoFlat(raw, contentType)
  if (flat['account[id]'] !== '36919007') throw new Error('WRONG_KOMMO_ACCOUNT')
  const indexes = [...new Set(
    Object.keys(flat)
      .map(k => k.match(/^message\[add\]\[(\d+)\]/)?.[1])
      .filter((value): value is string => Boolean(value)),
  )]
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
    const mediaType = get('attachment][type'), mediaName = (get('attachment][file_name') || get('attachment][name')).slice(0,200)
    const ctwa = extractCtwaFromKommoFlat(flat, index)
    events.push({
      externalId,
      kommoId,
      contactId,
      chatId: get('chat_id'),
      text: body,
      name: get('author][name').slice(0, 200),
      sentAt: new Date(date).toISOString(),
      origin: get('origin'),
      media: mediaUrl || mediaType || mediaName ? { type: mediaType, url: mediaUrl, name: mediaName } : null,
      ctwa,
    })
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
  const ctwa =
    row.ctwa && typeof row.ctwa === 'object' && text(object(row.ctwa).clid)
      ? (row.ctwa as Inbound['ctwa'])
      : null
  return { ...(row as unknown as Inbound), ctwa }
}

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
  /**
   * Resumen seguro del probe pre-normalización (sin valores/PII).
   * Se persiste en lv_integration_events.payload para correlacionar sin Vercel.
   */
  ctwaProbe?: InboundCtwaProbeSummary | null
}

/** Solo presencia/rutas; nunca clid, texto, teléfono ni body. */
export type InboundCtwaProbeSummary = {
  correlationId: string
  fieldsAbsent: boolean
  pathCount: number
  paths: string[]
  extracted: boolean
  unrecognizedPathCount: number
  unrecognizedPaths: string[]
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

/** Adjunta resumen seguro del probe a cada inbound (para persistir en el evento). */
export function attachCtwaProbeSummary(
  events: Inbound[],
  probe: KommoCtwaFieldProbe,
): Inbound[] {
  const extracted = Object.values(probe.extractedByIndex).some(Boolean)
  const summary: InboundCtwaProbeSummary = {
    correlationId: probe.correlationId,
    fieldsAbsent: probe.fieldsAbsent,
    pathCount: probe.referralOrCtwaPaths.length,
    paths: probe.referralOrCtwaPaths.slice(0, 40),
    extracted,
    unrecognizedPathCount: probe.unrecognizedPaths.length,
    unrecognizedPaths: probe.unrecognizedPaths.slice(0, 40),
  }
  return events.map((event) => ({ ...event, ctwaProbe: summary }))
}

export type AdvisorOutbound = {
  externalId: string
  kommoId: number
  contactId: number
  chatId: string
  text: string
  name: string
  sentAt: string
  origin: string
  userId: number
  authorType: string
}

type NormalizedWebhook = {
  inbound: Inbound[]
  advisorOutbound: AdvisorOutbound[]
}

function flattenWebhook(raw: string, contentType: string) {
  const flat = parseKommoFlat(raw, contentType)
  if (flat['account[id]'] !== '36919007') throw new Error('WRONG_KOMMO_ACCOUNT')
  return flat
}

function eventIndexes(flat: Record<string, string>, root: string) {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^${escaped}\\[(\\d+)\\]`)
  return [...new Set(
    Object.keys(flat)
      .map(key => key.match(matcher)?.[1])
      .filter((value): value is string => Boolean(value)),
  )]
}

function validEventDate(value: string, now: number) {
  const date = Number(value) * 1000
  if (!Number.isFinite(date) || date <= 0 || date > now + 60_000) throw new Error('INVALID_MESSAGE_ID_OR_TIME')
  return new Date(date).toISOString()
}

export function normalizeKommoWebhook(raw: string, contentType: string, now = Date.now()): NormalizedWebhook {
  const flat = flattenWebhook(raw, contentType)
  const inboundIndexes = eventIndexes(flat, 'message[add]')
  const outgoingRoots = ['outgoing_message[add]', 'message[add]'] as const
  const total = inboundIndexes.length + outgoingRoots.reduce((count, root) => count + eventIndexes(flat, root).length, 0)
  if (total > 200) throw new Error('TOO_MANY_EVENTS')

  const inbound: Inbound[] = []
  for (const index of inboundIndexes) {
    const get = (key: string) => flat[`message[add][${index}][${key}]`] || ''
    if (get('type') === 'outgoing' || get('author][type') !== 'external') continue
    if (!['waba', 'whatsapp'].includes(get('origin').toLowerCase())) continue
    if (get('entity_type') && !['lead', 'leads'].includes(get('entity_type'))) continue
    const kommoId = Number(get('entity_id') || get('element_id')), contactId = Number(get('contact_id'))
    const externalId = get('id') || get('message_id')
    if (!Number.isSafeInteger(kommoId) || kommoId <= 0 || !Number.isSafeInteger(contactId) || contactId <= 0
      || !externalId || externalId.length > 200) throw new Error('INVALID_MESSAGE_ID_OR_TIME')
    const body = get('text').trim()
    if (body.length > 20_000) throw new Error('MESSAGE_TOO_LONG')
    const mediaUrl = get('attachment][link')
    const mediaType = get('attachment][type'), mediaName = (get('attachment][file_name') || get('attachment][name')).slice(0,200)
    const ctwa = extractCtwaFromKommoFlat(flat, index)
    inbound.push({
      externalId,
      kommoId,
      contactId,
      chatId: get('chat_id'),
      text: body,
      name: get('author][name').slice(0, 200),
      sentAt: validEventDate(get('created_at'), now),
      origin: get('origin'),
      media: mediaUrl || mediaType || mediaName ? { type: mediaType, url: mediaUrl, name: mediaName } : null,
      ctwa,
    })
  }

  const outgoing = new Map<string, AdvisorOutbound>()
  for (const root of outgoingRoots) {
    for (const index of eventIndexes(flat, root)) {
      const get = (key: string) => flat[`${root}[${index}][${key}]`] || ''
      const type = get('type').toLowerCase()
      const authorType = get('author][type').toLowerCase()
      if (root === 'message[add]' && type !== 'outgoing') continue
      // Salesbot deliveries are not a manual takeover. Kommo identifies a
      // human reply as an internal author with a concrete user_id.
      if (authorType !== 'internal') continue
      const userId = Number(get('author][user_id') || get('author][id'))
      if (!Number.isSafeInteger(userId) || userId <= 0) continue
      const origin = get('origin').toLowerCase()
      if (origin && !['waba', 'whatsapp'].includes(origin)) continue
      if (get('entity_type') && !['lead', 'leads'].includes(get('entity_type'))) continue
      const kommoId = Number(get('entity_id') || get('element_id')) || 0
      const contactId = Number(get('contact_id')) || 0
      const externalId = get('id') || get('message_id')
      if (!Number.isSafeInteger(kommoId) || kommoId < 0
        || !Number.isSafeInteger(contactId) || contactId <= 0
        || !externalId || externalId.length > 200) {
        throw new Error('INVALID_MESSAGE_ID_OR_TIME')
      }
      const body = get('text').trim()
      if (body.length > 20_000) throw new Error('MESSAGE_TOO_LONG')
      outgoing.set(externalId, {
        externalId,
        kommoId,
        contactId,
        chatId: get('chat_id'),
        text: body,
        name: get('author][name').slice(0, 200),
        sentAt: validEventDate(get('created_at'), now),
        origin: get('origin'),
        userId,
        authorType,
      })
    }
  }
  return { inbound, advisorOutbound: [...outgoing.values()] }
}

export function normalizeWebhook(raw: string, contentType: string, now = Date.now()): Inbound[] {
  return normalizeKommoWebhook(raw, contentType, now).inbound
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
  const rawProbe = row.ctwaProbe && typeof row.ctwaProbe === 'object' ? object(row.ctwaProbe) : null
  const ctwaProbe: InboundCtwaProbeSummary | null = rawProbe
    ? {
        correlationId: text(rawProbe.correlationId) || '',
        fieldsAbsent: rawProbe.fieldsAbsent === true,
        pathCount: Number(rawProbe.pathCount) || 0,
        paths: Array.isArray(rawProbe.paths) ? rawProbe.paths.map(String).slice(0, 40) : [],
        extracted: rawProbe.extracted === true,
        unrecognizedPathCount: Number(rawProbe.unrecognizedPathCount) || 0,
        unrecognizedPaths: Array.isArray(rawProbe.unrecognizedPaths)
          ? rawProbe.unrecognizedPaths.map(String).slice(0, 40)
          : [],
      }
    : null
  return { ...(row as unknown as Inbound), ctwa, ctwaProbe }
}

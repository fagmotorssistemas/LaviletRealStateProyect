/**
 * Canal / lane / destino para la bitácora CAPI.
 * Solo evidencia del payload y delivery_lane; no inventa dataset ni atribución.
 */

export type MetaCapiChannelKind = 'web' | 'whatsapp' | 'undetermined'

export type MetaCapiDestinationKind =
  | 'messaging_dataset'
  | 'website_nest'
  | 'undetermined'

export type MetaCapiChannelView = {
  channel: MetaCapiChannelKind
  channelLabel: string
  lane: string
  laneLabel: string
  destination: MetaCapiDestinationKind
  destinationLabel: string
  /** Id de dataset solo si consta en el payload (nunca desde secretos de env). */
  destinationIdHint: string | null
  actionSource: string | null
  messagingChannel: string | null
  eventSourceHost: string | null
  hasCtwaClid: boolean
  /** ctwa_clid presente ≠ atribución ads confirmada. */
  ctwaNote: string | null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t || null
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.host || null
  } catch {
    return null
  }
}

function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

export function resolveMetaCapiChannel(
  payload: Record<string, unknown> | null | undefined,
  deliveryLane: string,
): MetaCapiChannelView {
  const actionSource = asString(payload?.action_source)
  const messagingChannel = asString(payload?.messaging_channel)
  const eventSourceUrl = asString(payload?.event_source_url)
  const messagingDatasetId = asString(payload?.messaging_dataset_id)
  const ctwa =
    asString(payload?.ctwa_clid) || asString(payload?.ctwaClid) || null

  const isWhatsApp =
    messagingChannel === 'whatsapp' || actionSource === 'business_messaging'
  const isWeb =
    !isWhatsApp &&
    (actionSource === 'website' ||
      Boolean(eventSourceUrl) ||
      actionSource === 'system_generated')

  let channel: MetaCapiChannelKind = 'undetermined'
  let channelLabel = 'No determinado'
  if (isWhatsApp) {
    channel = 'whatsapp'
    channelLabel = 'WhatsApp'
  } else if (isWeb) {
    channel = 'web'
    channelLabel = 'Web'
  }

  const lane = deliveryLane || '—'
  const laneLabel = lane === 'test' || lane === 'live' ? lane : lane

  let destination: MetaCapiDestinationKind = 'undetermined'
  let destinationLabel = 'No determinado'
  let destinationIdHint: string | null = null

  if (messagingDatasetId) {
    destination = 'messaging_dataset'
    destinationIdHint = shortId(messagingDatasetId)
    destinationLabel = `Dataset mensajería (${destinationIdHint})`
  } else if (channel === 'web' && actionSource === 'website') {
    destination = 'website_nest'
    destinationLabel =
      'Web vía Nest (pixel/dataset no figura en outbox)'
  }

  return {
    channel,
    channelLabel,
    lane,
    laneLabel,
    destination,
    destinationLabel,
    destinationIdHint,
    actionSource,
    messagingChannel,
    eventSourceHost: hostFromUrl(eventSourceUrl),
    hasCtwaClid: Boolean(ctwa),
    ctwaNote: ctwa
      ? 'ctwa_clid presente en payload (no implica atribución ads confirmada)'
      : null,
  }
}

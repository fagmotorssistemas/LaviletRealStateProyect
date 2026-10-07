type OrderedInbound = { sentAt: string; transportSequence?: number }

/** Source milliseconds first; a durable intake sequence resolves genuine ties.
 * Legacy records without that sequence retain their supplied stable order. */
export function compareInboundOrder(a: OrderedInbound, b: OrderedInbound): number {
  const byTime = Date.parse(a.sentAt) - Date.parse(b.sentAt)
  if (Number.isFinite(byTime) && byTime) return byTime
  return Number.isSafeInteger(a.transportSequence) && Number.isSafeInteger(b.transportSequence)
    ? a.transportSequence! - b.transportSequence! : 0
}

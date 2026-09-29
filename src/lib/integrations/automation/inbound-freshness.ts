/** Provider lag is separate from worker time. Lag alone never cancels a valid request. */
export function inboundFreshness(sentAt: string, receivedAt: string, limitMinutes = 5) {
  const lagMs = Date.parse(receivedAt) - Date.parse(sentAt)
  const lagMinutes = Number.isFinite(lagMs) ? Math.max(0, Math.round(lagMs / 60_000)) : null
  return { lagMinutes, delayed: lagMinutes !== null && lagMs > limitMinutes * 60_000 }
}

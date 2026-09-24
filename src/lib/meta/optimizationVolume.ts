export const META_OPTIMIZATION_WEEKLY_TARGET = 50

export type OptimizationEventEvidence = {
  eventType: string
  eventId: string
  capturedAt: string
  metaAccepted: boolean
  metaAttributionVerified: boolean
  metaAttributed: boolean
  verifiedAdSetId?: string | null
  deliveryEvidenceComplete: boolean
  channel?: string
  dataset?: string
  deliveryLane?: 'test' | 'live'
  status?: string
  deliveryOutcome?: string
  eligible?: boolean
  exclusionReasons?: string[]
}

export type OptimizationEventVolume = {
  eventType: string
  captured: number
  metaAccepted: number
  metaAttributed: number
  capturedGap: number
  acceptedGap: number
  attributedGap: number
  incompleteDeliveryEvidence: number
  incompleteAttributionCoverage: number
  channel: string
  dataset: string
  deliveryLane: string
  eligibleDetected: number
  retained: number
  pending: number
  backendAccepted: number
  metaRejected: number
  transportFailed: number
  exclusionReasons: Record<string, number>
  byVerifiedAdSet: Array<{
    adSetId: string
    captured: number
    metaAccepted: number
    metaAttributed: number
  }>
}

/** Ventana móvil inclusiva de siete días; cada tipo conserva su propio objetivo. */
export function summarizeOptimizationVolume(
  rows: OptimizationEventEvidence[],
  now: string,
): OptimizationEventVolume[] {
  const end = Date.parse(now)
  const start = end - 7 * 24 * 60 * 60 * 1000
  const groups = new Map<string, OptimizationEventEvidence[]>()
  for (const row of rows) {
    const at = Date.parse(row.capturedAt)
    if (!Number.isFinite(at) || at < start || at > end) continue
    const eventType = String(row.eventType || '').trim()
    if (!eventType) continue
    const key = [
      eventType,
      row.channel || 'unknown',
      row.dataset || 'unknown',
      row.deliveryLane || 'unknown',
    ].join('|')
    groups.set(key, [...(groups.get(key) || []), row])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => {
      const unique = [...new Map(items.map((item) => [item.eventId, item])).values()]
      const first = unique[0]
      const exclusionReasons: Record<string, number> = {}
      for (const item of unique)
        for (const reason of item.exclusionReasons || []) {
          exclusionReasons[reason] = (exclusionReasons[reason] || 0) + 1
        }
      const adSets = new Map<string, OptimizationEventEvidence[]>()
      for (const item of unique)
        if (item.verifiedAdSetId) {
          adSets.set(item.verifiedAdSetId, [...(adSets.get(item.verifiedAdSetId) || []), item])
        }
      const accepted = unique.filter((item) => item.metaAccepted).length
      const attributed = unique.filter(
        (item) => item.metaAttributionVerified && item.metaAttributed,
      ).length
      return {
        eventType: first.eventType,
        channel: first.channel || 'unknown',
        dataset: first.dataset || 'unknown',
        deliveryLane: first.deliveryLane || 'unknown',
        eligibleDetected: unique.filter((item) => item.eligible !== false).length,
        retained: unique.filter((item) =>
          ['held', 'review_hold', 'needs_review'].includes(item.status || ''),
        ).length,
        pending: unique.filter((item) => item.status === 'pending').length,
        backendAccepted: unique.filter((item) =>
          [
            'backend_accepted',
            'meta_accepted',
            'meta_rejected',
            'transport_failed',
            'meta_unverified',
          ].includes(item.deliveryOutcome || ''),
        ).length,
        metaRejected: unique.filter((item) => item.deliveryOutcome === 'meta_rejected').length,
        transportFailed: unique.filter((item) => item.deliveryOutcome === 'transport_failed')
          .length,
        exclusionReasons,
        captured: unique.length,
        metaAccepted: accepted,
        metaAttributed: attributed,
        capturedGap: Math.max(0, META_OPTIMIZATION_WEEKLY_TARGET - unique.length),
        acceptedGap: Math.max(0, META_OPTIMIZATION_WEEKLY_TARGET - accepted),
        attributedGap: Math.max(0, META_OPTIMIZATION_WEEKLY_TARGET - attributed),
        incompleteDeliveryEvidence: unique.filter((item) => !item.deliveryEvidenceComplete).length,
        incompleteAttributionCoverage: unique.filter(
          (item) => !item.metaAttributionVerified || !item.verifiedAdSetId,
        ).length,
        byVerifiedAdSet: [...adSets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([adSetId, values]) => ({
            adSetId,
            captured: values.length,
            metaAccepted: values.filter((item) => item.metaAccepted).length,
            metaAttributed: values.filter(
              (item) => item.metaAttributionVerified && item.metaAttributed,
            ).length,
          })),
      }
    })
}

/**
 * Reglas puras de /api/meta/enqueue (ViewContent only).
 * Lead/Schedule no se fabrican desde este endpoint.
 */
export function isAllowedEnqueueEventName(eventName: string): eventName is 'ViewContent' {
  return eventName === 'ViewContent'
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export function assertVisitKeyMatchesVisitor(
  visitKey: string,
  visitorKey: string,
  unitId: string,
): boolean {
  return visitKey === buildUnitVisitKey(visitorKey, unitId)
}

export function buildUnitVisitKey(visitorKey: string, unitId: string) {
  return `view:${visitorKey || 'anon'}:${unitId}`
}

export type RateBucket = Map<string, number[]>

export function allowRateLimited(
  bucket: RateBucket,
  key: string,
  nowMs: number,
  windowMs: number,
  max: number,
): boolean {
  const prev = bucket.get(key) || []
  const recent = prev.filter((t) => nowMs - t < windowMs)
  if (recent.length >= max) {
    bucket.set(key, recent)
    return false
  }
  recent.push(nowMs)
  bucket.set(key, recent)
  return true
}

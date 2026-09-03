export type TourDwellPayload = {
  typologyCode: string
  room: string
  roomLabel?: string
  unitId?: string
  unitCode?: string
  seconds: number
}

export function sendTourDwell(payload: TourDwellPayload) {
  if (payload.seconds < 2) return
  const body = JSON.stringify(payload)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/tour/track', blob)) return
  }
  void fetch('/api/tour/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

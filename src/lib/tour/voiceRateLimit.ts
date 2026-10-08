import { allowRateLimited, type RateBucket } from '@/lib/meta/enqueueGuards'

const bucket: RateBucket = new Map()
const WINDOW_MS = 10 * 60 * 1000

/** Límite por instancia del servidor. En varios procesos cada uno cuenta aparte. */
export function allowVoiceRequest(ip: string, kind: 'assist' | 'speak'): boolean {
  const max = kind === 'speak' ? 40 : 20
  return allowRateLimited(bucket, `${kind}:${ip || 'unknown'}`, Date.now(), WINDOW_MS, max)
}

export function voiceClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

import 'server-only'
import { timingSafeEqual } from 'node:crypto'

export type AutomationMode = 'off' | 'preview' | 'live'
export function automationSettings() {
  const raw = process.env.AUTOMATION_MODE ?? 'off'
  const mode: AutomationMode = raw === 'live' || raw === 'preview' ? raw : 'off'
  const activatedAt = process.env.AUTOMATION_ACTIVATED_AT ?? ''
  return {
    mode, activatedAt,
    live: mode === 'live' && process.env.AUTOMATION_N8N_DISABLED === 'true'
      && Number.isFinite(Date.parse(activatedAt)) && Date.parse(activatedAt) <= Date.now(),
    testLeadId: process.env.AUTOMATION_TEST_LEAD_ID?.trim() || null,
    globalMaintenance: process.env.AUTOMATION_GLOBAL_MAINTENANCE === 'true',
  }
}

export function secretMatches(value: string | null, expected: string | undefined) {
  if (!expected || expected.length < 32 || !value) return false
  const a = Buffer.from(value), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function assertLive() {
  if (!automationSettings().live) throw new Error('AUTOMATION_NOT_LIVE')
}

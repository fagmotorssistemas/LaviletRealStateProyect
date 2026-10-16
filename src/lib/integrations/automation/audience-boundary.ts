export type AudienceBoundary = {
  version: 1
  mode: 'future_messages'
  activatedAt: string
}

export type AutomationSendEvidence = {
  audience?: unknown
  sourceAt?: string
  jobCreatedAt?: string
}

const MAX_SOURCE_CLOCK_SKEW_MS = 5 * 60_000

/** Require an actual instant with a time zone, not Date.parse's loose dates. */
function isoInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = parts
  const year = Number(yearText), month = Number(monthText), day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Absence preserves legacy behavior; a malformed configured boundary never opens it. */
export function audienceBoundary(raw: unknown): AudienceBoundary | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw Error('AUDIENCE_BOUNDARY_INVALID')
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || value.mode !== 'future_messages' || isoInstant(value.activatedAt) === null) {
    throw Error('AUDIENCE_BOUNDARY_INVALID')
  }
  return { version: 1, mode: 'future_messages', activatedAt: value.activatedAt as string }
}

/** Admission follows the action's original source, regardless of the contact's age. */
export function audienceAllows(policy: unknown, sourceAt: unknown, jobCreatedAt?: unknown): boolean {
  const boundary = audienceBoundary(policy)
  if (!boundary) return true
  const cutoff = isoInstant(boundary.activatedAt)!
  const source = isoInstant(sourceAt)
  if (source === null || source < cutoff || source > Date.now() + MAX_SOURCE_CLOCK_SKEW_MS) return false
  if (jobCreatedAt !== undefined) {
    const created = isoInstant(jobCreatedAt)
    if (created === null || created < cutoff) return false
  }
  return true
}

export function assertAudienceAllows(policy: unknown, sourceAt: unknown, jobCreatedAt?: unknown): void {
  if (!audienceAllows(policy, sourceAt, jobCreatedAt)) throw Error('AUTOMATION_AUDIENCE_EXCLUDED')
}

/** Never substitute a retry/schedule time for the original customer action. */
export function audienceSourceForEvent(row: Record<string, unknown>): string | undefined {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown> : {}
  const source = row.kind === 'inbound' || row.kind === 'delivery_retry' ? payload.sentAt
    : row.kind === 'maintenance' && typeof payload.task === 'string' && payload.task.startsWith('nutrition_')
      ? payload.anchorAt : undefined
  return typeof source === 'string' && source.length > 0 ? source : undefined
}

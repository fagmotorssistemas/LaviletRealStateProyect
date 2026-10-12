export const INFO_REQUESTS_KEY = 'lv_info_requests'
const INFO_REQUESTS_EVENT = 'lv:info-requests'

export type StoredInfoRequest = { key: string; unitNumber: string | null; sentAt: string }

export function infoRequestKey(unitId?: string | null, typologyCode?: string | null) {
  return unitId?.trim() || typologyCode?.trim() || 'general'
}

export function infoRequestsSnapshot() {
  if (typeof window === 'undefined') return '[]'
  try { return window.localStorage.getItem(INFO_REQUESTS_KEY) || '[]' } catch { return '[]' }
}

export function readInfoRequests(snapshot = infoRequestsSnapshot()): StoredInfoRequest[] {
  try {
    const data: unknown = JSON.parse(snapshot)
    if (!Array.isArray(data)) return []
    return data.filter((row): row is StoredInfoRequest => Boolean(
      row && typeof row === 'object' && typeof row.key === 'string' &&
      typeof row.sentAt === 'string' && (row.unitNumber == null || typeof row.unitNumber === 'string'),
    ))
  } catch { return [] }
}

export function subscribeInfoRequests(listener: () => void) {
  window.addEventListener(INFO_REQUESTS_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(INFO_REQUESTS_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function saveInfoRequest(record: StoredInfoRequest) {
  if (typeof window === 'undefined') return
  try {
    const other = readInfoRequests().filter((item) => item.key !== record.key)
    window.localStorage.setItem(INFO_REQUESTS_KEY, JSON.stringify([...other, record]))
    window.dispatchEvent(new Event(INFO_REQUESTS_EVENT))
  } catch { /* The request was sent even if browser storage is unavailable. */ }
}

export type LeadSlaStatus = 'no_aplica' | 'pendiente' | 'vencido' | 'respondido'

/** Misma regla que `vw_lead_automation_dashboard.sla_status`. */
export function computeSlaStatus(
  dueAt: string | null | undefined,
  firstResponseAt: string | null | undefined,
  nowMs = Date.now(),
): LeadSlaStatus {
  if (!dueAt) return 'no_aplica'
  if (firstResponseAt) return 'respondido'
  if (new Date(dueAt).getTime() < nowMs) return 'vencido'
  return 'pendiente'
}

export function sanitizeSearch(value: string): string {
  return value.replace(/[%(),]/g, '').trim()
}

export function toInclusiveRange(from: string, to: string): { from: string | undefined; to: string | undefined } {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }
}

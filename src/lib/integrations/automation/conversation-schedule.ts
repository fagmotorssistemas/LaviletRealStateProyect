// Pure helpers: workflow orchestration runs in a durable sandbox. Import no
// database clients, secrets or Node-only modules into that bundle.
type Row = Record<string, unknown>

export type ContactWakeup = { event_id: string; due_at: string } | null

/** A newer pending event owns the next wakeup. Superseded tasks do no AI work. */
export function wakeupDecision(raw: unknown, anchor: string, now: number):
  { action: 'stop' } | { action: 'wait'; until: string } | { action: 'process' } {
  const pending: Row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {}
  if (!pending.event_id || pending.event_id !== anchor) return { action: 'stop' }
  const due = Date.parse(typeof pending.due_at === 'string' ? pending.due_at : '')
  if (!Number.isFinite(due)) return { action: 'stop' }
  return due > now ? { action: 'wait', until: new Date(due).toISOString() } : { action: 'process' }
}

export function shouldStopScheduledWorker(result: Row): boolean {
  return result.mode !== 'live' || ['database_paused', 'kommo_account_blocked'].includes(String(result.reason || ''))
}

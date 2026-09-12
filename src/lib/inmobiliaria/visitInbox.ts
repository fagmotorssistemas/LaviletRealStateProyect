import type { VisitInboxItem } from '@/types/inmobiliaria'

export function visitNeedsAttention(item: VisitInboxItem) {
  return item.status === 'awaiting_advisor'
}

export function visitIsOverdue(item: VisitInboxItem, now: number) {
  return visitNeedsAttention(item) && Boolean(item.escalation_due_at)
    && Date.parse(item.escalation_due_at!) <= now
}

export function prioritizeVisitInbox(items: VisitInboxItem[], now: number) {
  return [...items].sort((a, b) =>
    Number(visitNeedsAttention(b)) - Number(visitNeedsAttention(a))
    || Number(visitIsOverdue(b, now)) - Number(visitIsOverdue(a, now))
    || Date.parse(a.created_at) - Date.parse(b.created_at)
    || a.id.localeCompare(b.id))
}

export function visitWaitLabel(createdAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000))
  if (!Number.isFinite(minutes)) return 'Solicitud recibida'
  if (minutes < 1) return 'Hace un momento'
  if (minutes < 60) return `Hace ${minutes} min`
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`
  return `Hace ${Math.floor(minutes / 1440)} días`
}

import type { VisitInboxItem } from '@/types/inmobiliaria'

export function visitNeedsAttention(item: VisitInboxItem) {
  return item.status === 'awaiting_advisor'
}

export function visitActionTitle(item: VisitInboxItem) {
  const action = item.request_type === 'reschedule' ? 'Reagendar cita' : 'Agendar cita'
  if (item.coordination_urgent_at) return `${action} · contacto requerido`
  if ((item.proposal_rejection_count ?? 0) > 0) return `${action} · enviar nuevas opciones`
  return action
}

export function visitActionButton(item: VisitInboxItem) {
  return item.request_type === 'reschedule' ? 'Revisar reagendamiento' : 'Revisar agendamiento'
}

export function visitUrgencyKey(item: VisitInboxItem) {
  return visitNeedsAttention(item) && item.coordination_urgent_at ? `${item.id}:${item.coordination_urgent_at}` : null
}

export function visitIsOverdue(item: VisitInboxItem, now: number) {
  return visitNeedsAttention(item) && Boolean(item.escalation_due_at)
    && Date.parse(item.escalation_due_at!) <= now
}

export function prioritizeVisitInbox(items: VisitInboxItem[], now: number) {
  return [...items].sort((a, b) =>
    Number(visitNeedsAttention(b)) - Number(visitNeedsAttention(a))
    || Number(Boolean(visitUrgencyKey(b))) - Number(Boolean(visitUrgencyKey(a)))
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

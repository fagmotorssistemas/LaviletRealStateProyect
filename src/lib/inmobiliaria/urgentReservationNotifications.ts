import type { AdvisorNotification } from '@/types/inmobiliaria'
export function nextUrgentReservation(items: AdvisorNotification[], recipientId: string, acknowledged: ReadonlySet<string>) {
  return items.filter(item => item.recipient_id === recipientId && !item.read_at && !acknowledged.has(item.id)
    && ['reservation_requested', 'reservation_confirmed'].includes(item.kind))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] || null
}
